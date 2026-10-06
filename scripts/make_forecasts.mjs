#!/usr/bin/env node
/**
 * Make one league week's published forecasts (docs/forecast-protocol-v2.md)
 * and append them to forecasts/forecasts.csv and forecasts/title_forecasts.csv.
 *
 *   node scripts/make_forecasts.mjs --league FA26-L2 --week 2
 *   node scripts/make_forecasts.mjs --league FA26-L2 --week 2 --dry-run
 *   node scripts/make_forecasts.mjs --league FA26-L1 --week 3 --dry-run --replay
 *   node scripts/make_forecasts.mjs --next      (the next league week in schedule.json;
 *                                                used by .github/workflows/publish-forecasts.yml)
 *
 * Week N uses results through week N-1 (data_through_week = N-1):
 *   match forecasts  - `baseline` (previous league's draw rate, wins split evenly)
 *                      and, from week 2, `poisson-v1` (§4.1, §4.2)
 *   title forecasts  - week 1 `baseline` (1/n each, exact), from week 2
 *                      `poisson-v1-title`: 100,000 seeded runs (§4.3)
 *
 * Safety (§5, §7): refuses after the week's deadline (Friday 23:59 Chicago
 * before the week's Saturday in schedule.json), refuses if any week before N
 * isn't fully scored or any week N+ already has a score, and never writes a
 * second row for an already-published (league, week, model). It only appends;
 * commit the two CSVs afterwards (that commit is the publication record).
 *
 * --dry-run prints the rows without writing or checking the deadline.
 * --replay (dry-run only) ignores scores from week N on, to try the script on
 * a finished league.
 */

import { readFileSync, appendFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { buildSimulationModel, simulate } from "../src/lib/championship-simulator.ts";
import { expectedGoals, outcomeProbabilities } from "../src/lib/poisson-model.ts";

const TITLE_RUNS = 100_000;
const root = new URL("../", import.meta.url);
const readJson = (path) => JSON.parse(readFileSync(new URL(path, root), "utf8"));

function parseArgs(argv) {
	const args = { dryRun: false, replay: false };
	for (let i = 0; i < argv.length; i++) {
		if (argv[i] === "--league") args.league = argv[++i];
		else if (argv[i] === "--week") args.week = Number(argv[++i]);
		else if (argv[i] === "--dry-run") args.dryRun = true;
		else if (argv[i] === "--replay") args.replay = true;
		else if (argv[i] === "--next") args.next = true;
		else throw new Error(`Unknown argument: ${argv[i]}`);
	}
	if (args.next) {
		// The soonest league week whose date is after today (Chicago).
		const today = chicagoNow().slice(0, 10);
		const upcoming = readJson("src/data/schedule.json")
			.filter((e) => e.type === "league" && e.date && e.date > today)
			.sort((a, b) => a.date.localeCompare(b.date))[0];
		if (!upcoming) throw new Error("No upcoming league week in schedule.json.");
		args.league = upcoming.league;
		args.week = upcoming.week;
	}
	if (!args.league || !Number.isInteger(args.week) || args.week < 1) {
		throw new Error("Usage: node scripts/make_forecasts.mjs --league FA26-L2 --week 2 [--dry-run]");
	}
	if (args.replay && !args.dryRun) throw new Error("--replay only works with --dry-run.");
	return args;
}

/** Deterministic 32-bit RNG (mulberry32), so a recorded seed reproduces the numbers. */
function mulberry32(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Seed from the forecast's identity, e.g. "FA26-L2 W2" -> fixed number (also stored in the CSV). */
function seedFor(league, week) {
	let hash = 2166136261;
	for (const ch of `${league} W${week}`) hash = Math.imul(hash ^ ch.charCodeAt(0), 16777619) >>> 0;
	return hash;
}

const chicagoNow = () =>
	new Intl.DateTimeFormat("sv-SE", {
		timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
	}).format(new Date()).replace(" ", "T");

function deadlineFor(league, week) {
	const entry = readJson("src/data/schedule.json").find((e) => e.type === "league" && e.league === league && e.week === week);
	if (!entry?.date) throw new Error(`No schedule.json date for ${league} week ${week}.`);
	const day = new Date(`${entry.date}T12:00:00Z`);
	day.setUTCDate(day.getUTCDate() - 1);
	return `${day.toISOString().slice(0, 10)}T23:59:59`;
}

function readCsv(path) {
	const [header, ...lines] = readFileSync(new URL(path, root), "utf8").trim().split(/\r?\n/);
	const cols = header.split(",");
	return { cols, rows: lines.filter(Boolean).map((line) => Object.fromEntries(line.split(",").map((v, i) => [cols[i], v]))) };
}

function main() {
	const args = parseArgs(process.argv.slice(2));
	const { league: leagueId, week } = args;
	const leagues = readJson("src/data/leagues.json");
	const league = leagues.find((l) => l.id === leagueId);
	if (!league) throw new Error(`Unknown league ${leagueId}.`);
	if (week > league.rules.weeks) throw new Error(`${leagueId} has only ${league.rules.weeks} weeks.`);

	// Results through week N-1 only.
	const allMatches = readJson("src/data/matches.json");
	const own = allMatches.filter((m) => m.league === leagueId);
	const earlier = own.filter((m) => m.week < week);
	const unscored = earlier.filter((m) => m.status !== "completed");
	if (unscored.length) throw new Error(`Weeks before ${week} aren't fully scored yet (${unscored.length} matches). Enter the results first.`);
	if (earlier.length !== (week - 1) * league.rules.matches_per_week) throw new Error(`Expected ${(week - 1) * league.rules.matches_per_week} matches before week ${week}, found ${earlier.length}.`);
	const later = own.filter((m) => m.week >= week && m.status === "completed");
	if (later.length && !args.replay) throw new Error(`Week ${week} or later already has scores — too late to forecast it.`);
	const asOf = allMatches.map((m) =>
		m.league === leagueId && m.week >= week ? { ...m, home_score: null, away_score: null, status: "scheduled" } : m,
	);

	if (!args.dryRun) {
		const now = chicagoNow();
		const deadline = deadlineFor(leagueId, week);
		if (now > deadline) throw new Error(`Deadline passed: ${deadline} Chicago (now ${now}). §5: no forecast after the deadline.`);
	}

	const matchCsv = readCsv("forecasts/forecasts.csv");
	const titleCsv = readCsv("forecasts/title_forecasts.csv");
	const published = (rows, model) => rows.some((r) => r.league === leagueId && Number(r.week) === week && r.model === model && r.status === "published");

	const generatedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
	const commit = execSync("git rev-parse HEAD", { cwd: root }).toString().trim();
	const teamIds = league.teams.map((t) => t.team_id).sort();
	const pairs = teamIds.flatMap((a, i) => teamIds.slice(i + 1).map((b) => [a, b]));

	// §4.1 baseline: the previous league's draw rate (in teams-tab order).
	const prevLeague = leagues[leagues.findIndex((l) => l.id === leagueId) - 1];
	if (!prevLeague && !args.replay) throw new Error(`No league before ${leagueId} to take the baseline draw rate from.`);
	// Replay of the very first league has no earlier league; use its own rate just to exercise the script.
	const prev = allMatches.filter((m) => m.league === (prevLeague ?? league).id && m.status === "completed");
	const draw = prev.filter((m) => m.home_score === m.away_score).length / prev.length;

	const matchRows = [];
	const titleRows = [];
	const common = (dataThrough) => ({ data_through_week: dataThrough, generated_at: generatedAt, code_commit: commit, status: "published" });

	if (!published(matchCsv.rows, "baseline")) {
		for (const [a, b] of pairs) {
			matchRows.push({ league: leagueId, week, team_a: a, team_b: b, model: "baseline", p_a: (1 - draw) / 2, p_draw: draw, p_b: (1 - draw) / 2, ...common(week - 1) });
		}
	}

	const standings = readJson("src/data/standings_history.json")
		.filter((r) => r.league === leagueId && r.week === week - 1)
		.map((r) => ({ ...r, league: leagueId }));
	const model = buildSimulationModel(league, asOf, standings);

	if (week >= 2) {
		if (!published(matchCsv.rows, "poisson-v1")) {
			for (const [a, b] of pairs) {
				const p = outcomeProbabilities(expectedGoals(model.strengths, a, b), expectedGoals(model.strengths, b, a));
				matchRows.push({ league: leagueId, week, team_a: a, team_b: b, model: "poisson-v1", p_a: p.pA, p_draw: p.pDraw, p_b: p.pB, ...common(week - 1) });
			}
		}
	}
	return { args, leagueId, week, model, teamIds, matchRows, titleRows, matchCsv, titleCsv, published, common };
}

async function run() {
	const ctx = main();
	const { args, leagueId, week, model, teamIds, matchRows, titleRows, matchCsv, titleCsv, published, common } = ctx;

	if (week === 1) {
		if (!published(titleCsv.rows, "baseline")) {
			for (const team of teamIds) titleRows.push({ league: leagueId, week, team, model: "baseline", p_title: 1 / teamIds.length, runs: "", seed: "", ...common(0) });
		}
	} else if (!published(titleCsv.rows, "poisson-v1-title")) {
		if (model.lambda === null) throw new Error("No completed matches to estimate strengths from.");
		const seed = seedFor(leagueId, week);
		const result = await simulate(model, {}, TITLE_RUNS, mulberry32(seed));
		for (const team of teamIds) {
			titleRows.push({ league: leagueId, week, team, model: "poisson-v1-title", p_title: result.credits[team], runs: result.trials, seed, ...common(week - 1) });
		}
	}

	const line = (cols, row) => cols.map((c) => (typeof row[c] === "number" && !Number.isInteger(row[c]) ? String(row[c]) : row[c] ?? "")).join(",");
	console.log(`${leagueId} week ${week} — data through week ${week - 1}${model.lambda !== null ? `, μ = ${model.lambda}` : ""}`);
	for (const r of matchRows) console.log(`  match  ${r.model.padEnd(16)} ${r.team_a} v ${r.team_b}: ${(r.p_a * 100).toFixed(1)}% / ${(r.p_draw * 100).toFixed(1)}% / ${(r.p_b * 100).toFixed(1)}%`);
	for (const r of titleRows) console.log(`  title  ${r.model.padEnd(16)} ${r.team}: ${(r.p_title * 100).toFixed(1)}%`);
	if (!matchRows.length && !titleRows.length) console.log("  Nothing new: this week's forecasts are already published.");

	if (args.dryRun) {
		console.log("\nDry run — nothing written.");
		return;
	}
	if (matchRows.length) appendFileSync(new URL("forecasts/forecasts.csv", root), matchRows.map((r) => line(matchCsv.cols, r)).join("\n") + "\n");
	if (titleRows.length) appendFileSync(new URL("forecasts/title_forecasts.csv", root), titleRows.map((r) => line(titleCsv.cols, r)).join("\n") + "\n");
	console.log(`\nAppended ${matchRows.length} match and ${titleRows.length} title rows. Commit forecasts/ to main before the deadline.`);
}

run().catch((error) => {
	console.error(`\n${error.message}`);
	process.exitCode = 1;
});
