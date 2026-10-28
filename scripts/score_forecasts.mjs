#!/usr/bin/env node
/**
 * Score a league's published forecasts against the real results
 * (docs/forecast-protocol-v2.md §8). Nothing here changes a forecast:
 * forecasts/*.csv are only read, and scores are recomputed on every run
 * (§6: "Scores are never stored").
 *
 *   node scripts/score_forecasts.mjs --league FA26-L2
 *   node scripts/score_forecasts.mjs --league FA26-L2 --markdown forecasts/scorecard-FA26-L2.md
 *
 * What it does, in order:
 *   1. Integrity (§5, §7): replays git history of forecasts/forecasts.csv to
 *      check the file was only ever appended to, and finds the commit that
 *      first published each row. A row committed after its week's deadline
 *      is "late"; late and invalid rows are listed and left out of the scores.
 *   2. Linking: every completed match is matched to its pairing's forecast.
 *      Forecasts are stored as (team_a, team_b) with team_a the smaller id
 *      (§3), while matches are (home, away) — so the outcome is always read
 *      from team_a's side, never from "home".
 *   3. Match scores (§8): RPS (primary), Brier and log loss per match,
 *      averaged per week, for each model.
 *   4. Title forecasts (§8.1): only once every fixture is played —
 *      probability given to the eventual champion each week and a
 *      multi-class Brier per week. Descriptive only, never pooled with
 *      match scores.
 *
 * Results that don't exist yet are never filled in: an unplayed match is
 * just counted as pending.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = new URL("../", import.meta.url);
const readJson = (path) => JSON.parse(readFileSync(new URL(path, root), "utf8"));

// Outcomes in the protocol's order (§3): team_a win < draw < team_b win.
export const OUTCOMES = ["team_a", "draw", "team_b"];
const SUM_TOLERANCE = 1e-9;

// ---------------------------------------------------------------- scores

/**
 * Ranked Probability Score for one match with ordered outcomes.
 *
 *   RPS = 1/(r-1) · Σ_{i=1}^{r-1} (F_i − O_i)²
 *
 * F_i = forecast probability of outcome ≤ i (cumulative), O_i = 1 if the
 * real outcome is ≤ i. With r = 3 outcomes (a win, draw, b win):
 *
 *   RPS = ½ · [ (p_a − o_a)² + (p_a + p_draw − o_a − o_draw)² ]
 *
 * 0 = perfect, 1 = all probability on the wrong extreme. Because it is
 * cumulative, calling a draw when team_a won is punished less than calling
 * a team_b win — the outcomes have an order, and RPS respects it.
 * The 1/(r−1) scaling (the usual one for football, so values sit in 0..1)
 * multiplies every model's score by the same constant, so it never changes
 * which model scores better.
 *
 * @param {number[]} p  [p_a, p_draw, p_b]
 * @param {number} outcome  index into OUTCOMES (0, 1 or 2)
 */
export function rps(p, outcome) {
	let sum = 0;
	let F = 0;
	let O = 0;
	for (let i = 0; i < p.length - 1; i++) {
		F += p[i];
		O += i === outcome ? 1 : 0;
		sum += (F - O) ** 2;
	}
	return sum / (p.length - 1);
}

/**
 * Brier score, multi-class form (Brier 1950): Σ_k (p_k − o_k)²,
 * summed over the three outcomes. 0 = perfect, 2 = worst. Unlike RPS it
 * ignores the order: a draw call is as wrong as a b-win call.
 */
export function brier(p, outcome) {
	return p.reduce((s, pk, k) => s + (pk - (k === outcome ? 1 : 0)) ** 2, 0);
}

/**
 * Log loss: −ln(probability given to what actually happened).
 * 0 = certain and right; grows without bound as that probability → 0, so
 * it punishes confident misses far harder than RPS or Brier do.
 */
export function logLoss(p, outcome) {
	return -Math.log(p[outcome]);
}

// ---------------------------------------------------------------- linking

/** Outcome index of one match seen from team_a's side (not home/away). */
export function outcomeFor(match, teamA, teamB) {
	const pair = [match.home_team_id, match.away_team_id];
	if (!(pair.includes(teamA) && pair.includes(teamB)) || teamA === teamB) {
		throw new Error(`${match.match_id} is ${pair.join(" v ")}, not ${teamA} v ${teamB}`);
	}
	const goalsA = match.home_team_id === teamA ? match.home_score : match.away_score;
	const goalsB = match.home_team_id === teamB ? match.home_score : match.away_score;
	if (goalsA > goalsB) return 0;
	if (goalsA === goalsB) return 1;
	return 2;
}

/** "T1|T2" for a pairing, smaller id first (§3). */
export const pairKey = (x, y) => [x, y].sort().join("|");

const isCompleted = (m) =>
	m.status === "completed" && Number.isFinite(m.home_score) && Number.isFinite(m.away_score);

/** Problems with one forecast row's numbers, or [] if it is usable. */
export function rowProblems(row) {
	const problems = [];
	const p = [row.p_a, row.p_draw, row.p_b].map(Number);
	if (!(row.team_a < row.team_b)) problems.push("team_a is not the smaller team_id");
	if (p.some((x) => !Number.isFinite(x) || x < 0 || x > 1)) problems.push("a probability is not in [0, 1]");
	else if (Math.abs(p[0] + p[1] + p[2] - 1) > SUM_TOLERANCE) problems.push("probabilities do not sum to 1");
	if (Number(row.data_through_week) !== Number(row.week) - 1) problems.push("data_through_week is not week − 1");
	return problems;
}

/**
 * Join forecasts to completed matches.
 * Returns one scored entry per (completed match, model with a usable
 * forecast for that week), plus everything that could not be scored.
 */
export function linkForecasts(forecastRows, matches, { league, matchesPerPair }) {
	const leagueMatches = matches.filter((m) => m.league === league);
	const forecasts = new Map(); // `${week}|${pair}|${model}` -> row
	const duplicates = [];
	for (const row of forecastRows) {
		const key = `${row.week}|${pairKey(row.team_a, row.team_b)}|${row.model}`;
		if (forecasts.has(key)) duplicates.push(key);
		else forecasts.set(key, row);
	}

	const models = [...new Set(forecastRows.map((r) => r.model))];
	const scored = [];
	const missing = []; // completed match, model forecast for its week, but no row for its pairing
	const pending = leagueMatches.filter((m) => !isCompleted(m)).map((m) => m.match_id);

	// Each pairing should have matchesPerPair fixtures a week; a different
	// count means fixtures and forecasts don't line up, so say so.
	const fixtureCounts = new Map();
	for (const m of leagueMatches) {
		if (!m.home_team_id || !m.away_team_id) continue;
		const k = `${m.week}|${pairKey(m.home_team_id, m.away_team_id)}`;
		fixtureCounts.set(k, (fixtureCounts.get(k) ?? 0) + 1);
	}
	const fixtureProblems = [...fixtureCounts]
		.filter(([, n]) => n !== matchesPerPair)
		.map(([k, n]) => `week ${k.split("|")[0]} ${k.split("|").slice(1).join(" v ")}: ${n} fixtures, expected ${matchesPerPair}`);

	for (const m of leagueMatches.filter(isCompleted)) {
		const pair = pairKey(m.home_team_id, m.away_team_id);
		for (const model of models) {
			// A model counts as forecasting a week if it published anything that week.
			const modelWeek = forecastRows.some((r) => r.model === model && Number(r.week) === m.week);
			if (!modelWeek) continue;
			const row = forecasts.get(`${m.week}|${pair}|${model}`);
			if (!row) {
				missing.push({ match_id: m.match_id, model });
				continue;
			}
			const p = [Number(row.p_a), Number(row.p_draw), Number(row.p_b)];
			const outcome = outcomeFor(m, row.team_a, row.team_b);
			scored.push({
				week: m.week,
				match_id: m.match_id,
				model,
				team_a: row.team_a,
				team_b: row.team_b,
				goals_a: m.home_team_id === row.team_a ? m.home_score : m.away_score,
				goals_b: m.home_team_id === row.team_b ? m.home_score : m.away_score,
				outcome: OUTCOMES[outcome],
				p,
				rps: rps(p, outcome),
				brier: brier(p, outcome),
				log_loss: logLoss(p, outcome),
			});
		}
	}
	return { scored, missing, pending, duplicates, fixtureProblems };
}

const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;

/** Mean RPS / Brier / log loss per (week, model), plus how many matches. */
export function weeklySummary(scored, weekFixtureCount) {
	const groups = new Map();
	for (const s of scored) {
		const key = `${s.week}|${s.model}`;
		groups.set(key, [...(groups.get(key) ?? []), s]);
	}
	return [...groups]
		.map(([key, rows]) => {
			const [week, model] = key.split("|");
			return {
				week: Number(week),
				model,
				n: rows.length,
				fixtures: weekFixtureCount.get(Number(week)) ?? rows.length,
				rps: mean(rows.map((r) => r.rps)),
				brier: mean(rows.map((r) => r.brier)),
				log_loss: mean(rows.map((r) => r.log_loss)),
			};
		})
		.sort((a, b) => a.week - b.week || a.model.localeCompare(b.model));
}

/**
 * Model − baseline difference, only over matches BOTH scored (the same
 * matches, so the comparison is like for like). Negative = model better.
 */
export function paired(scored, model, baseline = "baseline") {
	const base = new Map(scored.filter((s) => s.model === baseline).map((s) => [s.match_id, s]));
	const pairs = scored.filter((s) => s.model === model && base.has(s.match_id)).map((s) => [s, base.get(s.match_id)]);
	if (!pairs.length) return null;
	const byWeek = new Map();
	for (const [m, b] of pairs) byWeek.set(m.week, [...(byWeek.get(m.week) ?? []), [m, b]]);
	const diff = (ps) => ({
		n: ps.length,
		model_rps: mean(ps.map(([m]) => m.rps)),
		baseline_rps: mean(ps.map(([, b]) => b.rps)),
		diff_rps: mean(ps.map(([m, b]) => m.rps - b.rps)),
		diff_brier: mean(ps.map(([m, b]) => m.brier - b.brier)),
		diff_log_loss: mean(ps.map(([m, b]) => m.log_loss - b.log_loss)),
	});
	return {
		weeks: [...byWeek].sort(([a], [b]) => a - b).map(([week, ps]) => ({ week, ...diff(ps) })),
		overall: diff(pairs),
	};
}

// ---------------------------------------------------------------- titles

/**
 * Title forecasts against the one real outcome (§8.1). A shared title
 * counts as an equal split. Multi-class Brier per week: Σ_teams (p − o)².
 */
export function titleSummary(titleRows, champions, teams) {
	const o = Object.fromEntries(teams.map((t) => [t, champions.includes(t) ? 1 / champions.length : 0]));
	const byWeek = new Map();
	for (const r of titleRows) byWeek.set(Number(r.week), [...(byWeek.get(Number(r.week)) ?? []), r]);
	return [...byWeek]
		.sort(([a], [b]) => a - b)
		.map(([week, rows]) => {
			const p = Object.fromEntries(rows.map((r) => [r.team, Number(r.p_title)]));
			return {
				week,
				model: rows[0].model,
				p_champion: champions.reduce((s, t) => s + (p[t] ?? 0), 0),
				brier: teams.reduce((s, t) => s + ((p[t] ?? 0) - o[t]) ** 2, 0),
			};
		});
}

// ---------------------------------------------------------------- integrity

/** Friday 23:59:59 Chicago before the week's Saturday (§5), as "YYYY-MM-DDTHH:MM:SS" local. */
export function deadlineFor(schedule, league, week) {
	const entry = schedule.find((e) => e.type === "league" && e.league === league && e.week === week);
	if (!entry?.date) throw new Error(`No schedule.json date for ${league} week ${week}.`);
	const day = new Date(`${entry.date}T12:00:00Z`);
	day.setUTCDate(day.getUTCDate() - 1);
	return `${day.toISOString().slice(0, 10)}T23:59:59`;
}

/** An instant as Chicago local time "YYYY-MM-DDTHH:MM:SS" (same format as deadlineFor). */
export const toChicago = (iso) =>
	new Intl.DateTimeFormat("sv-SE", {
		timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
		hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
	}).format(new Date(iso)).replace(" ", "T");

/**
 * Given the file's versions in commit order, check every version starts
 * with the previous one (append-only, §7) and record the commit that first
 * contained each line.
 * @param {{sha: string, time: string, text: string}[]} versions
 */
export function appendOnlyHistory(versions) {
	const firstSeen = new Map();
	const violations = [];
	let prev = [];
	for (const v of versions) {
		const lines = v.text.trim().split(/\r?\n/).filter(Boolean);
		const kept = prev.every((line, i) => lines[i] === line);
		if (!kept) violations.push(`${v.sha.slice(0, 7)} changed or removed an existing line`);
		for (const line of lines) if (!firstSeen.has(line)) firstSeen.set(line, { sha: v.sha, time: v.time });
		prev = lines;
	}
	return { firstSeen, violations };
}

function gitVersions(path) {
	const git = (...args) => execFileSync("git", args, { cwd: fileURLToPath(root), encoding: "utf8" });
	if (git("rev-parse", "--is-shallow-repository").trim() === "true") {
		throw new Error("This clone is shallow, so the forecast history can't be checked. Run `git fetch --unshallow` first.");
	}
	return git("log", "--reverse", "--format=%H %cI", "--", path)
		.trim().split("\n").filter(Boolean)
		.map((line) => {
			const [sha, time] = line.split(" ");
			return { sha, time, text: git("show", `${sha}:${path}`) };
		});
}

// ---------------------------------------------------------------- CSV

function parseCsv(text) {
	const [header, ...lines] = text.trim().split(/\r?\n/);
	const cols = header.split(",");
	return lines.filter(Boolean).map((line) => ({ ...Object.fromEntries(line.split(",").map((v, i) => [cols[i], v])), _line: line }));
}

// ---------------------------------------------------------------- report

const f3 = (x) => x.toFixed(3);
const signed = (x) => (x > 0 ? "+" : x < 0 ? "−" : "±") + Math.abs(x).toFixed(3);
const pct = (x) => `${(x * 100).toFixed(1)}%`;

export function score(league, { skipHistory = false } = {}) {
	const leagues = readJson("src/data/leagues.json");
	const info = leagues.find((l) => l.id === league);
	if (!info) throw new Error(`Unknown league ${league}.`);
	const matches = readJson("src/data/matches.json");
	const schedule = readJson("src/data/schedule.json");
	const leagueTable = readJson("src/data/league_table.json");

	const matchCsv = readFileSync(new URL("forecasts/forecasts.csv", root), "utf8");
	const titleCsv = readFileSync(new URL("forecasts/title_forecasts.csv", root), "utf8");
	const allRows = parseCsv(matchCsv).filter((r) => r.league === league);
	const titleRows = parseCsv(titleCsv).filter((r) => r.league === league && r.status === "published");

	// 1. Integrity
	let history = null;
	const excluded = []; // {row, reasons}
	if (!skipHistory) {
		const { firstSeen, violations } = appendOnlyHistory(gitVersions("forecasts/forecasts.csv"));
		const published = [];
		for (const r of allRows) {
			const seen = firstSeen.get(r._line);
			published.push({ ...r, committed: seen ? toChicago(seen.time) : null, sha: seen?.sha });
		}
		history = { violations, published };
	}
	const usable = [];
	for (const r of allRows) {
		const reasons = r.status === "published" ? [] : [`status "${r.status}"`];
		reasons.push(...rowProblems(r));
		if (history) {
			const pub = history.published.find((x) => x._line === r._line);
			const deadline = deadlineFor(schedule, league, Number(r.week));
			if (!pub.committed) reasons.push("not found in git history");
			else if (pub.committed > deadline) reasons.push(`committed ${pub.committed} after deadline ${deadline}`);
		}
		if (reasons.length) excluded.push({ row: r, reasons });
		else usable.push(r);
	}

	// 2–3. Link and score
	const linked = linkForecasts(usable, matches, { league, matchesPerPair: info.rules.matches_per_pair_per_week });
	const weekFixtureCount = new Map();
	for (const m of matches.filter((m) => m.league === league)) weekFixtureCount.set(m.week, (weekFixtureCount.get(m.week) ?? 0) + 1);
	const weekly = weeklySummary(linked.scored, weekFixtureCount);
	const comparison = paired(linked.scored, "poisson-v1");

	// 4. Titles, only for a finished league
	const finished = matches.filter((m) => m.league === league).every(isCompleted);
	const teams = info.teams.map((t) => t.team_id);
	const champions = leagueTable.filter((r) => r.league === league && r.rank === 1).map((r) => r.team_id);
	const titles = finished ? titleSummary(titleRows, champions, teams) : null;

	return { league, info, history, excluded, linked, weekly, comparison, finished, champions, titles, schedule };
}

export function toMarkdown(result, { commit } = {}) {
	const { league, history, excluded, linked, weekly, comparison, finished, champions, titles, schedule } = result;
	const out = [];
	const weeks = [...new Set(weekly.map((w) => w.week))];
	out.push(`# ${league} forecast scorecard`, "");
	out.push(
		`Scored under [Forecast Protocol v2](../docs/forecast-protocol-v2.md) §8. Generated by`,
		"`node scripts/score_forecasts.mjs --league " + league + "`" + (commit ? ` at commit \`${commit.slice(0, 7)}\`` : "") + ".",
		"Scores are recomputed from `forecasts.csv` and the results every time; none are stored (§6).",
		"",
	);
	if (!finished) {
		out.push(`> **Provisional.** ${linked.pending.length} fixture(s) not played yet. Their results are not filled in; the scorecard is final once every fixture is played.`, "");
	}

	out.push("## Publication record", "");
	if (history) {
		out.push(history.violations.length ? `**Append-only check failed:** ${history.violations.join("; ")}.` : "`forecasts.csv` was only ever appended to: every version in git history starts with the previous one (§7).", "");
		const byWeek = new Map();
		for (const p of history.published) {
			// The latest commit among a (week, model)'s rows decides whether that week was on time.
			const key = `${p.week}|${p.model}`;
			const prev = byWeek.get(key);
			if (!prev || (p.committed ?? "9") > (prev.committed ?? "")) byWeek.set(key, p);
		}
		out.push("| Week | Model | Committed (Chicago) | Deadline (Chicago) | On time |", "|---:|---|---|---|---|");
		for (const [, p] of [...byWeek].sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))) {
			const deadline = deadlineFor(schedule, league, Number(p.week));
			out.push(`| ${p.week} | ${p.model} | ${p.committed?.replace("T", " ") ?? "—"} | ${deadline.replace("T", " ")} | ${p.committed && p.committed <= deadline ? "yes" : "**no**"} |`);
		}
		out.push("");
	} else {
		out.push("Git history not checked (--skip-history).", "");
	}
	if (excluded.length) {
		out.push("Rows left out of the scores (§7):", "");
		for (const e of excluded) out.push(`- week ${e.row.week} ${e.row.team_a} v ${e.row.team_b} ${e.row.model}: ${e.reasons.join("; ")}`);
		out.push("");
	}
	if (linked.missing.length) out.push(`Missing forecasts (shown, never filled in): ${linked.missing.map((m) => `${m.match_id} ${m.model}`).join(", ")}.`, "");
	if (linked.duplicates.length) out.push(`Duplicate forecasts (first one used): ${linked.duplicates.join(", ")}.`, "");
	if (linked.fixtureProblems.length) out.push(`Fixture count mismatches: ${linked.fixtureProblems.join("; ")}.`, "");

	out.push("## Match forecasts", "");
	out.push(
		"Lower is better for all three. RPS (primary) respects the order team_a win < draw < team_b win;",
		"Brier ignores the order; log loss punishes confident misses hardest.",
		"",
		"| Week | Model | Matches scored | RPS | Brier | Log loss |",
		"|---:|---|---:|---:|---:|---:|",
	);
	for (const w of weekly) out.push(`| ${w.week} | ${w.model} | ${w.n} / ${w.fixtures} | ${f3(w.rps)} | ${f3(w.brier)} | ${f3(w.log_loss)} |`);
	out.push("");

	if (comparison) {
		out.push(
			"### Poisson v1 − baseline",
			"",
			"Same matches for both models (weeks with both published). **Negative = Poisson v1 scored better.**",
			"",
			"| Week | Matches | Poisson v1 RPS | Baseline RPS | Δ RPS | Δ Brier | Δ Log loss |",
			"|---:|---:|---:|---:|---:|---:|---:|",
		);
		for (const w of comparison.weeks) out.push(`| ${w.week} | ${w.n} | ${f3(w.model_rps)} | ${f3(w.baseline_rps)} | ${signed(w.diff_rps)} | ${signed(w.diff_brier)} | ${signed(w.diff_log_loss)} |`);
		const o = comparison.overall;
		out.push(`| **all** | ${o.n} | ${f3(o.model_rps)} | ${f3(o.baseline_rps)} | ${signed(o.diff_rps)} | ${signed(o.diff_brier)} | ${signed(o.diff_log_loss)} |`, "");
		out.push(
			"These are plain descriptive numbers (§8). No interval or significance test is given: the three",
			"matches of a pairing in a week share one forecast and are not independent, so the",
			`${o.n} matches are effectively ${comparison.weeks.length * 3} pairing-forecasts, far too few to separate skill from luck.`,
			"",
		);
	}

	out.push("### Every scored match", "", "| Match | Model | Pairing | Score (a–b) | Outcome | p(a / draw / b) | RPS |", "|---|---|---|---|---|---|---:|");
	for (const s of [...linked.scored].sort((a, b) => a.match_id.localeCompare(b.match_id) || a.model.localeCompare(b.model))) {
		out.push(`| ${s.match_id} | ${s.model} | ${s.team_a} v ${s.team_b} | ${s.goals_a}–${s.goals_b} | ${s.outcome.replace("_", " ")} | ${s.p.map(pct).join(" / ")} | ${f3(s.rps)} |`);
	}
	out.push("");

	out.push("## Title forecasts (§8.1)", "");
	if (!titles) {
		out.push("Not scored yet: the league is not finished, so there is no title outcome.", "");
	} else {
		out.push(
			`Champion: ${champions.join(", ")}${champions.length > 1 ? " (shared, counted as an equal split)" : ""}.`,
			"",
			"| Week | Model | p(eventual champion) | Brier (multi-class) |",
			"|---:|---|---:|---:|",
		);
		for (const t of titles) out.push(`| ${t.week} | ${t.model} | ${pct(t.p_champion)} | ${f3(t.brier)} |`);
		out.push(
			"",
			"Descriptive only. A league has one title outcome, and every week's title forecast is judged",
			"against that same outcome, so this is effectively one data point. No claim is made that the",
			"model beat or lost to the baseline on titles, and title scores are never pooled with match scores.",
			"",
		);
	}

	out.push(
		"## Notes on the numbers",
		"",
		"- RPS = ½·[(p_a − o_a)² + (p_a + p_draw − o_a − o_draw)²], the usual 1/(r−1) scaling (0 best, 1 worst).",
		"- Brier = Σ over the three outcomes of (p − o)² (0 best, 2 worst). Log loss = −ln(p of what happened).",
		"- §8 names the scores but not their scaling; the scalings above are the standard ones. A constant",
		"  scaling multiplies both models' scores alike, so it cannot change which model scored better.",
		"- Outcomes are read from team_a's side (the smaller team_id), never from home/away.",
		"- Post-league analyses that are not part of this pre-registered score (§9: k = 3/6/12 sensitivity,",
		"  draw calibration, any other model) are reported separately and labelled as such.",
		"",
	);
	return out.join("\n");
}

// ---------------------------------------------------------------- CLI

function main() {
	const argv = process.argv.slice(2);
	const arg = (name) => {
		const i = argv.indexOf(name);
		return i >= 0 ? argv[i + 1] : undefined;
	};
	const league = arg("--league");
	if (!league) throw new Error("Usage: node scripts/score_forecasts.mjs --league FA26-L2 [--markdown path] [--skip-history]");
	const result = score(league, { skipHistory: argv.includes("--skip-history") });
	let commit;
	try {
		commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: fileURLToPath(root), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
	} catch {}
	const md = toMarkdown(result, { commit });
	const path = arg("--markdown");
	if (path) {
		writeFileSync(new URL(path, root), md);
		console.log(`Wrote ${path}`);
	} else {
		console.log(md);
	}
	if (result.history?.violations.length || result.linked.fixtureProblems.length) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	try {
		main();
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
