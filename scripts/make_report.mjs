#!/usr/bin/env node
// Weekly / final league report for Instagram: four 1080x1350 PNG slides
// (cover, match results, league table, player stats), built from the same
// generated JSON the site reads, so a post can never disagree with the table.
//
//   node scripts/make_report.mjs --league FA26-L2 --week 4
//   node scripts/make_report.mjs --league FA26-L2            (latest scored week)
//
// Output: report/out/<league>-W<nn>/1-cover.png … 4-stats.png
// Needs Playwright (`npm i -D playwright` once, or any install that
// `import("playwright")` can find) to turn the HTML into PNGs; with
// --html-only it just writes report.html next to where the PNGs would go.
//
// Design: the club's L1 posts, rebuilt — Antonio for every Latin word, white
// panels on a darkened pitch photo, the league's three team colours as the
// rule under the cover title. What changes per league is only the photos:
// report/backgrounds/<league>/{cover,results,table,stats}.jpg. A league with no
// folder borrows the newest league folder that exists.
//
// The week's table comes from standings_history (the official ranking after
// that week) and P/W/D/L from that week's and earlier matches, so an old week
// can be made again later and still be right. "Final" (cover title, trophy,
// "FINAL STANDINGS") is used only when the week is the league's last and every
// fixture is scored. Defensive Spotlight is the board's pick, not a stat:
// report/spotlight.json, { "<league>": { "<week>": ["name", "name", "name"] } };
// the box is left out for a week with no entry.

import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));
const arg = (name) => {
	const i = process.argv.indexOf(`--${name}`);
	return i > -1 ? process.argv[i + 1] : undefined;
};

const leagues = read("src/data/leagues.json");
const matches = read("src/data/matches.json");
const history = read("src/data/standings_history.json");
const profiles = read("src/data/player_profiles.json");
const goalEvents = read("src/data/goal_events.json");

const leagueId = arg("league") ?? leagues.find((l) => l.latest)?.id;
const league = leagues.find((l) => l.id === leagueId);
if (!league) throw new Error(`Unknown league ${leagueId}`);
const leagueMatches = matches.filter((m) => m.league === leagueId);
const scored = leagueMatches.filter((m) => m.status === "completed");
const week = Number(arg("week") ?? Math.max(...scored.map((m) => m.week)));
const weekMatches = scored.filter((m) => m.week === week).sort((a, b) => a.match_id.localeCompare(b.match_id));
if (!weekMatches.length) throw new Error(`${leagueId} week ${week} has no scored matches`);

const isFinal = week === league.rules.weeks && leagueMatches.every((m) => m.status === "completed");
const leagueNo = leagueId.match(/L(\d+)$/)?.[1] ?? leagueId;
const season = leagueId.split("-")[0];
const ww = String(week).padStart(2, "0");
const date = weekMatches[0].date;
const dateText = new Date(`${date}T12:00:00Z`)
	.toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric", timeZone: "UTC" })
	.toUpperCase();

// ---- teams ---------------------------------------------------------------
const teams = new Map(league.teams.map((t) => [t.team_id, t]));
const team = (id) => teams.get(id) ?? { name: "TBD", color: "#8a8a8a" };
function colorWord(hex) {
	const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
	const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
	if (d < 0.08) return max > 0.6 ? "WHITE" : "BLACK";
	let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
	h = (h * 60 + 360) % 360;
	// The club calls its gold team "orange" (L1 이지선다, L2 Mad Maize), so yellows land there.
	if (h < 18 || h >= 335) return "RED";
	if (h < 70) return "ORANGE";
	if (h < 170) return "GREEN";
	if (h < 260) return "BLUE";
	return "PURPLE";
}

// ---- table after this week ------------------------------------------------
const record = new Map();
for (const m of scored.filter((m) => m.week <= week)) {
	for (const [id, gf, ga] of [[m.home_team_id, m.home_score, m.away_score], [m.away_team_id, m.away_score, m.home_score]]) {
		const r = record.get(id) ?? { p: 0, w: 0, d: 0, l: 0 };
		r.p++;
		if (gf > ga) r.w++; else if (gf === ga) r.d++; else r.l++;
		record.set(id, r);
	}
}
const table = history
	.filter((h) => h.league === leagueId && h.week === week)
	.sort((a, b) => a.rank - b.rank)
	.map((h) => ({ ...h, ...record.get(h.team_id), team: team(h.team_id) }));

// ---- player totals through this week --------------------------------------
const players = profiles
	.filter((p) => p.status !== "inactive")
	.flatMap((p) => {
		const section = p.leagues.find((s) => s.league === leagueId);
		if (!section) return [];
		const weeks = section.weekly_stats.filter((w) => w.week <= week);
		if (!weeks.length) return [];
		const goals = weeks.reduce((n, w) => n + w.goals, 0);
		const assists = weeks.reduce((n, w) => n + w.assists, 0);
		return [{ name: p.name, goals, assists, ga: goals + assists, color: team(weeks.at(-1).team_id).color }];
	});
function top(key, tiebreak) {
	const list = players
		.filter((p) => p[key] > 0)
		.sort((a, b) => b[key] - a[key] || tiebreak(a, b) || a.name.localeCompare(b.name, "ko"))
		.slice(0, 5);
	// Shared ranks on the stat itself (1, 2, 2, 4), never a hidden tiebreak.
	return list.map((p, i) => ({ ...p, rank: list.findIndex((q) => q[key] === p[key]) + 1, value: p[key] }));
}
const scorers = top("goals", (a, b) => b.assists - a.assists);
const assisters = top("assists", (a, b) => b.goals - a.goals);
const contributors = top("ga", (a, b) => b.goals - a.goals);

// ---- highlights under the leaderboards ----------------------------------------
// Best duo and hat-tricks through this week, from goal_events (so FA26-L2 on;
// a league recorded as weekly totals gets no box). Duo = an unordered pair, one
// assisting the other, the same count as the team page's Duos (src/lib/duos.ts):
// A→B and B→A are one partnership. Own goals count for neither.
const nameOf = new Map(profiles.map((p) => [p.player_id, p.name]));
const inactive = new Set(profiles.filter((p) => p.status === "inactive").map((p) => p.player_id));
const evs = goalEvents.filter((e) => e.league === leagueId && e.week <= week && !e.own_goal);
const playerColor = (id) => players.find((p) => p.name === nameOf.get(id))?.color ?? "#8a8a8a";
const duoCount = new Map();
for (const e of evs) {
	if (!e.assist_id || e.assist_id === e.scorer_id || inactive.has(e.scorer_id) || inactive.has(e.assist_id)) continue;
	const key = [e.scorer_id, e.assist_id].sort().join("|");
	duoCount.set(key, (duoCount.get(key) ?? 0) + 1);
}
const bestDuoGoals = Math.max(0, ...duoCount.values());
// A tie for the top shows both pairs, never a coin-flip pick; three-way and up is cut to two.
const bestDuos = bestDuoGoals >= 2 ? [...duoCount].filter(([, n]) => n === bestDuoGoals).slice(0, 2).map(([k]) => k.split("|")) : [];
const perMatch = new Map();
for (const e of evs) perMatch.set(`${e.match_id}|${e.scorer_id}`, (perMatch.get(`${e.match_id}|${e.scorer_id}`) ?? 0) + 1);
const hatTricks = [...perMatch]
	.filter(([k, n]) => n >= 3 && !inactive.has(k.split("|")[1]))
	.map(([k, n]) => {
		const [matchId, id] = k.split("|");
		const m = matches.find((x) => x.match_id === matchId);
		const ev = evs.find((e) => e.match_id === matchId && e.scorer_id === id);
		const opp = m.home_team_id === ev.scorer_team_id ? m.away_team_id : m.home_team_id;
		return { name: nameOf.get(id), color: team(ev.scorer_team_id).color, week: m.week, opp: team(opp).name, goals: n, matchId };
	})
	.sort((a, b) => a.matchId.localeCompare(b.matchId));
const hasHighlights = evs.length > 0 && (bestDuos.length > 0 || hatTricks.length > 0);

const spotlightFile = join(ROOT, "report/spotlight.json");
const spotlightNames = existsSync(spotlightFile) ? JSON.parse(readFileSync(spotlightFile, "utf8"))[leagueId]?.[String(week)] ?? [] : [];
const spotlight = spotlightNames.map((name) => {
	const p = profiles.find((x) => x.name === name);
	const w = p?.leagues.find((s) => s.league === leagueId)?.weekly_stats.filter((x) => x.week <= week).at(-1);
	return { name, color: w ? team(w.team_id).color : "#8a8a8a" };
});

// ---- assets -----------------------------------------------------------------
const dataUrl = (path, mime) => `data:${mime};base64,${readFileSync(path).toString("base64")}`;
const bgRoot = join(ROOT, "report/backgrounds");
const bgDir = existsSync(join(bgRoot, leagueId))
	? join(bgRoot, leagueId)
	: join(bgRoot, readdirSync(bgRoot).sort().at(-1));
// The race slide has no photo of its own: it takes the results photo, since a
// final report shows the race where a weekly one shows the results.
const bg = (slide) => {
	const own = join(bgDir, `${slide}.jpg`);
	return dataUrl(existsSync(own) ? own : join(bgDir, "results.jpg"), "image/jpeg");
};
const font = dataUrl(join(ROOT, "report/assets/Antonio.ttf"), "font/ttf");
const ball = dataUrl(join(ROOT, "report/assets/kicks-ball.png"), "image/png");
const brandFont = dataUrl(join(ROOT, "report/assets/Montserrat.ttf"), "font/ttf");

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const pad = (n) => String(n).padStart(2, "0");
const bar = (color) => `<i class="bar" style="background:${color}"></i>`;

const footer = `<footer><span>${dateText}</span><span>KICKS ${season} LEAGUE ${leagueNo} REPORT</span></footer>`;
const card = (slide, inner, extra = "") =>
	`<section class="card ${slide} ${extra}" style="background-image:var(--wash-${slide}),url(${bg(slide)})"><div class="mark"><img src="${ball}" alt=""><span>KICKS</span></div>${inner}</section>`;

const cover = card(
	"cover",
	`<div class="cover-body">
		<p class="kicker">KICKS ${season}</p>
		<h1>LEAGUE ${leagueNo}<br>${isFinal ? "FINAL" : `WEEK ${ww}`}</h1>
		<div class="rule">${league.teams.map((t) => `<i style="background:${t.color}"></i>`).join("")}</div>
		<h2>STATS &amp; RESULTS</h2>
		<p class="meta">${dateText}<br>${isFinal ? `LEAGUE ${leagueNo} REPORT` : `WEEK ${ww} REPORT`}</p>
	</div>`,
);

const rounds = [...new Set(weekMatches.map((m) => m.round))].sort((a, b) => a - b);
const results = card(
	"results",
	`<h1 class="title">MATCH RESULTS</h1><p class="sub">WEEK ${ww}</p>
	<div class="rounds">${rounds
		.map(
			(r) => `<div class="round"><p class="round-label"><span>ROUND ${r}</span></p><div class="panel">${weekMatches
				.filter((m) => m.round === r)
				.map((m) => {
					const h = team(m.home_team_id), a = team(m.away_team_id);
					return `<div class="match"><span class="side home">${bar(h.color)}${esc(h.name)}</span><b class="score">${m.home_score} - ${m.away_score}</b><span class="side away">${esc(a.name)}${bar(a.color)}</span></div>`;
				})
				.join("")}</div></div>`,
		)
		.join("")}</div>${footer}`,
);

const tableCard = card(
	"table",
	`<h1 class="title">${isFinal ? "FINAL LEAGUE TABLE" : "LEAGUE TABLE"}</h1><p class="sub">${isFinal ? "FINAL STANDINGS" : `WEEK ${ww} STANDINGS`}</p>
	<div class="standings">
		<div class="thead"><span>RANK</span><span>TEAM</span><span>P</span><span>W</span><span>D</span><span>L</span><span>PTS</span></div>
		${table
			.map(
				(r) => `<div class="row">
			<span class="rank">${isFinal && r.rank === 1 ? `<span class="trophy">🏆</span>` : pad(r.rank)}</span>
			<span class="teamcell">${bar(r.team.color)}<span><b>${esc(r.team.name)}</b><small>${colorWord(r.team.color)}</small></span></span>
			<span>${r.p}</span><span>${r.w}</span><span>${r.d}</span><span>${r.l}</span>
			<span class="pts"><b>${r.points}</b><small>PTS</small></span>
		</div>`,
			)
			.join("")}
	</div>${footer}`,
);

const ICONS = {
	ball: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7l4 3-1.5 4.5h-5L8 10z" fill="currentColor"/><path d="M12 7V2.5M16 10l4.5-1.5M14.5 14.5l2.8 4M9.5 14.5l-2.8 4M8 10L3.5 8.5" stroke="currentColor" stroke-width="1.6"/></svg>`,
	boot: `<svg viewBox="0 0 24 24"><path d="M3 6h6l1 4 5 2c3 1 6 2 6 5v1H3z" fill="currentColor"/><path d="M5 20h2M10 20h2M15 20h2" stroke="currentColor" stroke-width="2"/></svg>`,
	chart: `<svg viewBox="0 0 24 24"><path d="M4 20V13h4v7zM10 20V8h4v12zM16 20V4h4v16z" fill="currentColor"/></svg>`,
};
const leaders = (title, sub, icon, list) => `<div class="leaders">
	<div class="lhead"><b>${title}</b>${ICONS[icon]}</div><small class="lsub">${sub}</small>
	${list
		.map((p) => `<div class="lrow"><span class="lrank">${pad(p.rank)}</span><span class="lname">${esc(p.name)}</span>${bar(p.color)}<b class="lval">${p.value}</b></div>`)
		.join("")}
</div>`;
const stats = card(
	"stats",
	`<h1 class="title">PLAYER STATS</h1><p class="sub">LEAGUE ${leagueNo} ${isFinal ? "TOTAL" : `· THROUGH WEEK ${ww}`}</p>
	<div class="leaderboards">
		${leaders("TOP SCORERS", "GOALS", "ball", scorers)}
		${leaders("TOP ASSISTS", "ASSISTS", "boot", assisters)}
		${leaders("TOP G+A", "GOALS + ASSISTS", "chart", contributors)}
	</div>
	${
		spotlight.length
			? `<div class="spotlight"><div class="sp-head"><b>DEFENSIVE<br>SPOTLIGHT</b><small>WEEK ${ww} · SELECTED BY KICKS</small></div>
			<div class="sp-names">${spotlight.map((s) => `<span>${bar(s.color)}${esc(s.name)}</span>`).join("")}</div></div>`
			: hasHighlights
				? `<div class="highlights">
				<div class="hl"><div class="hl-head"><b>BEST DUO</b><small>GOALS TOGETHER</small></div>
					${bestDuos.length
						? bestDuos.map(([a, b]) => `<div class="duo"><span>${bar(playerColor(a))}${esc(nameOf.get(a))}</span><em>↔</em><span>${bar(playerColor(b))}${esc(nameOf.get(b))}</span></div>`).join("") + `<b class="duo-n">${bestDuoGoals}<small> GOALS</small></b>`
						: `<p class="hl-none">—</p>`}
				</div>
				<div class="hl"><div class="hl-head"><b>HAT-TRICK HEROES</b><small>3+ GOALS IN ONE MATCH</small></div>
					${hatTricks.length
						? hatTricks.slice(0, 3).map((h) => `<div class="ht"><span>${bar(h.color)}${esc(h.name)}${h.goals > 3 ? ` <b>×${h.goals}</b>` : ""}</span><small>W${h.week} vs ${esc(h.opp)}</small></div>`).join("")
						: `<p class="hl-none">NONE THIS LEAGUE</p>`}
				</div>
			</div>`
				: ""
	}${footer}`,
);

// ---- points race (final report) ---------------------------------------------
// Cumulative points after each week, from standings_history (official). Every
// line starts from one shared 0 at the left edge (every team starts level, so
// the start is a single dot, not three), the last week sits at the right edge,
// and the teams are named in a legend in the chart's empty top-left corner —
// in their colour, final rank order, with final points — instead of labels at
// the line ends, which ate a quarter of the width.
function raceSvg() {
	const W = 900, H = 730, L = 70, R = 34, T = 24, B = 66;
	const weeks = Array.from({ length: week }, (_, i) => i + 1);
	const lines = league.teams.map((t) => ({
		t,
		pts: [0, ...weeks.map((w) => history.find((h) => h.league === leagueId && h.week === w && h.team_id === t.team_id)?.points ?? 0)],
	}));
	const maxP = Math.max(...lines.flatMap((l) => l.pts));
	const step = maxP > 40 ? 10 : 5;
	const top = Math.ceil(maxP / step) * step;
	const x = (i) => L + (i * (W - L - R)) / week;
	const y = (p) => T + (H - T - B) * (1 - p / top);
	let svg = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`;
	const fw = league.rules.final_week;
	if (fw && fw <= week) {
		svg += `<rect x="${x(fw - 1)}" y="${T}" width="${x(week) - x(fw - 1)}" height="${H - T - B}" fill="#f4e7bf"/>`;
		svg += `<text x="${(x(fw - 1) + x(week)) / 2}" y="${H - B - 22}" class="band">WIN = ${league.rules.final_win_points} PTS</text>`;
	}
	for (let p = 0; p <= top; p += step)
		svg += `<line x1="${L}" x2="${W - R}" y1="${y(p)}" y2="${y(p)}" class="grid"/><text x="${L - 16}" y="${y(p) + 10}" class="tick" text-anchor="end">${p}</text>`;
	weeks.forEach((w) => (svg += `<text x="${x(w)}" y="${H - B + 50}" class="tick" text-anchor="${w === week ? "end" : "middle"}">W${w}</text>`));
	for (const { t, pts } of lines) {
		svg += `<polyline points="${pts.map((p, i) => `${x(i)},${y(p)}`).join(" ")}" fill="none" stroke="${t.color}" stroke-width="8" stroke-linejoin="round" stroke-linecap="round"/>`;
		pts.forEach((p, i) => i && (svg += `<circle cx="${x(i)}" cy="${y(p)}" r="10" fill="#fff" stroke="${t.color}" stroke-width="5"/>`));
	}
	svg += `<circle cx="${x(0)}" cy="${y(0)}" r="10" fill="#fff" stroke="#444" stroke-width="5"/>`;
	const ranked = [...lines].sort((a, b) => b.pts.at(-1) - a.pts.at(-1));
	ranked.forEach(({ t, pts }, i) => {
		const ly = T + 46 + i * 66;
		svg += `<line x1="${L + 28}" x2="${L + 84}" y1="${ly}" y2="${ly}" stroke="${t.color}" stroke-width="8" stroke-linecap="round"/>`;
		svg += `<text x="${L + 104}" y="${ly}" class="lgname" fill="${t.color}">${esc(t.name)}</text>`;
		svg += `<text x="${L + 104 + 230}" y="${ly}" class="lgpts" fill="${t.color}">${pts.at(-1)}</text>`;
	});
	return svg + "</svg>";
}
const race = card(
	"race",
	`<h1 class="title">TITLE RACE</h1><p class="sub">POINTS BY WEEK</p>
	<div class="race-panel">${raceSvg()}</div>${footer}`,
);

// A final report is the season recap: cover, final table, how it unfolded,
// player stats. The last week's nine scores belong to a weekly post, not here.
const slides = isFinal
	? [{ name: "1-cover", html: cover }, { name: "2-table", html: tableCard }, { name: "3-race", html: race }, { name: "4-stats", html: stats }]
	: [{ name: "1-cover", html: cover }, { name: "2-results", html: results }, { name: "3-table", html: tableCard }, { name: "4-stats", html: stats }];

const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
@font-face { font-family: Antonio; src: url(${font}) format("truetype"); font-weight: 100 700; }
@font-face { font-family: Montserrat; src: url(${brandFont}) format("truetype"); font-weight: 100 900; }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: #111; display: grid; gap: 40px; padding: 40px; justify-content: center; }
.card { position: relative; width: 1080px; height: 1350px; overflow: hidden; color: #fff; background-size: cover; background-position: center;
	font-family: Antonio, "Noto Sans CJK KR", "Apple SD Gothic Neo", sans-serif;
	--shade: radial-gradient(120% 90% at 50% 45%, rgba(0,0,0,.25), rgba(0,0,0,.72));
	--wash-cover: linear-gradient(rgba(6,14,6,.30), rgba(6,14,6,.45)), var(--shade);
	--wash-results: linear-gradient(rgba(6,14,6,.40), rgba(6,14,6,.55)), var(--shade);
	--wash-table: linear-gradient(rgba(6,14,6,.40), rgba(6,14,6,.55)), var(--shade);
	--wash-race: linear-gradient(rgba(6,14,6,.40), rgba(6,14,6,.55)), var(--shade);
	--wash-stats: linear-gradient(rgba(6,14,6,.42), rgba(6,14,6,.60)), var(--shade); }
/* The KICKS mark: the logo's ball plus the wordmark set in type (the logo
   file's wordmark carries a print texture that looks like noise at this size). */
.mark { position: absolute; top: 40px; right: 46px; display: flex; align-items: center; gap: 12px; }
.mark img { width: 72px; height: 72px; filter: drop-shadow(0 2px 6px rgba(0,0,0,.35)); }
.mark span { font-family: Montserrat, sans-serif; font-size: 50px; font-weight: 800; letter-spacing: .01em; color: #fff; line-height: 1; text-shadow: 0 2px 10px rgba(0,0,0,.35); }
.ko, .side, .teamcell b, .lname, .sp-names span { font-family: "Noto Sans CJK KR", "Apple SD Gothic Neo", sans-serif; }
.bar { display: inline-block; width: 7px; height: 1.15em; border-radius: 2px; flex: none; }
h1, h2, .title, .sub, .kicker, .meta, footer { text-align: center; text-shadow: 0 4px 18px rgba(0,0,0,.45); }
.title { margin-top: 140px; font-size: 168px; font-weight: 700; line-height: .95; letter-spacing: -.01em; }
.sub { margin-top: 14px; font-size: 52px; font-weight: 500; letter-spacing: .14em; }
footer { position: absolute; left: 0; right: 0; bottom: 52px; display: grid; gap: 6px; font-size: 26px; font-weight: 600; letter-spacing: .22em; }

/* cover */
.cover-body { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; padding-top: 30px; }
.kicker { font-size: 60px; font-weight: 600; letter-spacing: .1em; }
.cover h1 { margin-top: 18px; font-size: 270px; font-weight: 700; line-height: .9; }
.rule { display: flex; gap: 26px; margin: 46px 0 34px; }
.rule i { width: 200px; height: 18px; }
.cover h2 { font-size: 112px; font-weight: 700; letter-spacing: .01em; }
.meta { margin-top: 22px; font-size: 34px; font-weight: 600; letter-spacing: .18em; line-height: 1.35; }

/* results */
.rounds { width: 870px; margin: 44px auto 0; display: grid; gap: 16px; }
.round-label { position: relative; text-align: center; height: 34px; margin-bottom: 10px; }
.round-label::before { content: ""; position: absolute; left: 0; right: 0; top: 50%; height: 22px; transform: translateY(-50%); background: rgba(20,20,20,.85); }
.round-label span { position: relative; display: inline-block; padding: 2px 34px; background: #111; font-size: 24px; font-weight: 600; letter-spacing: .3em; }
.panel { background: #fff; border-radius: 6px; color: #1b1b1b; box-shadow: 0 10px 30px rgba(0,0,0,.35); }
.match { display: grid; grid-template-columns: 1fr 190px 1fr; align-items: center; height: 64px; padding: 0 30px; }
.match + .match { border-top: 1px solid #e3e3e3; }
.side { display: flex; align-items: center; gap: 16px; font-size: 30px; font-weight: 500; white-space: nowrap; }
.side.away { justify-content: flex-end; }
.score { text-align: center; font-size: 42px; font-weight: 700; letter-spacing: .04em; }

/* table */
.table .title { font-size: 138px; }
.standings { width: 900px; margin: 70px auto 0; display: grid; gap: 28px; }
.thead, .row { display: grid; grid-template-columns: 150px 1fr 60px 60px 60px 60px 160px; align-items: center; text-align: center; }
.thead { background: rgba(15,15,15,.85); height: 50px; font-size: 22px; font-weight: 600; letter-spacing: .14em; margin-bottom: -6px; }
.thead span:nth-child(2) { text-align: left; padding-left: 26px; }
.row { background: #fff; color: #1b1b1b; height: 168px; border-radius: 6px; font-size: 40px; font-weight: 500; box-shadow: 0 10px 30px rgba(0,0,0,.35); }
.rank { font-size: 110px; font-weight: 700; }
.trophy { font-size: 92px; font-family: "Noto Color Emoji", sans-serif; }
.teamcell { display: flex; align-items: center; gap: 20px; text-align: left; padding-left: 4px; }
.teamcell .bar { height: 74px; width: 9px; }
.teamcell b { display: block; font-size: 46px; font-weight: 700; line-height: 1.15; }
.teamcell small { display: block; margin-top: 6px; font-size: 22px; font-weight: 600; letter-spacing: .14em; color: #666; }
.pts { border-left: 2px solid #ddd; height: 120px; display: flex; flex-direction: column; justify-content: center; }
.pts b { font-size: 92px; font-weight: 700; line-height: .95; }
.pts small { font-size: 20px; font-weight: 600; letter-spacing: .14em; color: #666; }

/* stats */
.leaderboards { width: 936px; margin: 64px auto 0; display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
.leaders { background: #fff; color: #1b1b1b; border-radius: 10px; padding: 26px 22px 18px; box-shadow: 0 10px 30px rgba(0,0,0,.35); }
.lhead { display: flex; align-items: center; justify-content: space-between; }
.lhead b { font-size: 40px; font-weight: 700; letter-spacing: .01em; }
.lhead svg { width: 36px; height: 36px; }
.lsub { display: block; padding: 4px 0 12px; border-bottom: 2px solid #e5e5e5; font-size: 20px; font-weight: 600; letter-spacing: .16em; color: #666; }
.lrow { display: grid; grid-template-columns: 44px 1fr 8px 46px; align-items: center; gap: 10px; height: 62px; font-size: 27px; }
.lrank { font-weight: 600; color: #555; }
.lname { font-weight: 500; white-space: nowrap; overflow: hidden; }
.lrow .bar { height: 30px; }
.lval { text-align: right; font-size: 30px; font-weight: 700; }
.highlights { width: 936px; margin: 34px auto 0; display: grid; grid-template-columns: 1fr 1fr; background: rgba(10,10,10,.72); border: 2px solid rgba(255,255,255,.25); border-radius: 14px; }
.hl { padding: 24px 30px 26px; display: flex; flex-direction: column; gap: 12px; }
.hl + .hl { border-left: 2px solid rgba(255,255,255,.2); }
.hl-head b { display: block; font-size: 40px; font-weight: 700; font-style: italic; line-height: 1; }
.hl-head small { display: block; margin-top: 6px; font-size: 17px; font-weight: 600; letter-spacing: .16em; color: #ccc; }
.duo { display: flex; align-items: center; gap: 12px; font-family: "Noto Sans CJK KR", "Apple SD Gothic Neo", sans-serif; font-size: 30px; font-weight: 500; }
.duo span { display: flex; align-items: center; gap: 10px; }
.duo em { font-style: normal; color: #bbb; font-size: 26px; }
.duo-n { font-size: 46px; font-weight: 700; line-height: 1; }
.duo-n small { font-size: 22px; font-weight: 600; letter-spacing: .14em; color: #ccc; }
.ht { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.ht span { display: flex; align-items: center; gap: 10px; font-family: "Noto Sans CJK KR", "Apple SD Gothic Neo", sans-serif; font-size: 30px; font-weight: 500; }
.ht small { font-size: 22px; font-weight: 600; letter-spacing: .08em; color: #ccc; font-family: Antonio, "Noto Sans CJK KR", sans-serif; }
.hl-none { font-size: 26px; font-weight: 600; letter-spacing: .14em; color: #aaa; }
.spotlight { width: 936px; margin: 34px auto 0; display: grid; grid-template-columns: 300px 1fr; align-items: center; gap: 24px; padding: 26px 34px; background: rgba(10,10,10,.72); border: 2px solid rgba(255,255,255,.25); border-radius: 14px; }
.sp-head b { display: block; font-size: 44px; font-weight: 700; font-style: italic; line-height: 1; }
.sp-head small { display: block; margin-top: 10px; font-size: 18px; font-weight: 600; letter-spacing: .14em; color: #ccc; }
.sp-names { display: flex; justify-content: space-around; }
.sp-names span { display: flex; align-items: center; gap: 12px; font-size: 32px; font-weight: 500; }
.race .title { font-size: 150px; margin-top: 124px; }
.race-panel { width: 960px; margin: 40px auto 0; padding: 30px 30px 16px; background: #fff; border-radius: 10px; box-shadow: 0 10px 30px rgba(0,0,0,.35); }
.race-panel svg { display: block; width: 900px; height: 730px; }
.race-panel .grid { stroke: #e6e6e6; stroke-width: 2; }
.race-panel .tick { font-family: Antonio, sans-serif; font-size: 32px; font-weight: 700; fill: #666; letter-spacing: .06em; }
.race-panel .band { font-family: Antonio, sans-serif; font-size: 26px; font-weight: 700; fill: #9a7a1c; letter-spacing: .14em; text-anchor: middle; }
.race-panel .lgname { font-family: "Noto Sans CJK KR", "Apple SD Gothic Neo", sans-serif; font-size: 36px; font-weight: 500; dominant-baseline: middle; }
.race-panel .lgpts { font-family: Antonio, sans-serif; font-size: 44px; font-weight: 600; dominant-baseline: middle; }
</style></head><body>${slides.map((s) => s.html).join("")}</body></html>`;

const outDir = join(ROOT, "report/out", `${leagueId}-W${ww}`);
mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "report.html"), html);
if (process.argv.includes("--html-only")) {
	console.log(`Wrote ${join(outDir, "report.html")}`);
	process.exit(0);
}

// ESM import ignores NODE_PATH, so fall back to require() for a global install.
const { chromium } = await import("playwright").catch(() => createRequire(import.meta.url)("playwright"));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 1500 }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: "load" });
await page.evaluate(() => document.fonts.ready);
const names = slides.map((s) => s.name);
const cards = await page.$$(".card");
for (const [i, el] of cards.entries()) {
	const file = join(outDir, `${names[i]}.png`);
	await el.screenshot({ path: file });
	console.log(file);
}
await browser.close();
