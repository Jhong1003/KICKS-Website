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
const bg = (slide) => dataUrl(join(bgDir, `${slide}.jpg`), "image/jpeg");
const font = dataUrl(join(ROOT, "report/assets/Antonio.ttf"), "font/ttf");
const mark = dataUrl(join(ROOT, "report/assets/kicks-mark.png"), "image/png");

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const pad = (n) => String(n).padStart(2, "0");
const bar = (color) => `<i class="bar" style="background:${color}"></i>`;

const footer = `<footer><span>${dateText}</span><span>KICKS ${season} LEAGUE ${leagueNo} REPORT</span></footer>`;
const card = (slide, inner, extra = "") =>
	`<section class="card ${slide} ${extra}" style="background-image:var(--wash-${slide}),url(${bg(slide)})"><img class="mark" src="${mark}" alt="">${inner}</section>`;

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
			: ""
	}${footer}`,
);

const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
@font-face { font-family: Antonio; src: url(${font}) format("truetype"); font-weight: 100 700; }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: #111; display: grid; gap: 40px; padding: 40px; justify-content: center; }
.card { position: relative; width: 1080px; height: 1350px; overflow: hidden; color: #fff; background-size: cover; background-position: center;
	font-family: Antonio, "Noto Sans CJK KR", "Apple SD Gothic Neo", sans-serif;
	--shade: radial-gradient(120% 90% at 50% 45%, rgba(0,0,0,.25), rgba(0,0,0,.72));
	--wash-cover: linear-gradient(rgba(6,14,6,.30), rgba(6,14,6,.45)), var(--shade);
	--wash-results: linear-gradient(rgba(6,14,6,.40), rgba(6,14,6,.55)), var(--shade);
	--wash-table: linear-gradient(rgba(6,14,6,.40), rgba(6,14,6,.55)), var(--shade);
	--wash-stats: linear-gradient(rgba(6,14,6,.42), rgba(6,14,6,.60)), var(--shade); }
.mark { position: absolute; top: 42px; right: 46px; height: 66px; }
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
.spotlight { width: 936px; margin: 34px auto 0; display: grid; grid-template-columns: 300px 1fr; align-items: center; gap: 24px; padding: 26px 34px; background: rgba(10,10,10,.72); border: 2px solid rgba(255,255,255,.25); border-radius: 14px; }
.sp-head b { display: block; font-size: 44px; font-weight: 700; font-style: italic; line-height: 1; }
.sp-head small { display: block; margin-top: 10px; font-size: 18px; font-weight: 600; letter-spacing: .14em; color: #ccc; }
.sp-names { display: flex; justify-content: space-around; }
.sp-names span { display: flex; align-items: center; gap: 12px; font-size: 32px; font-weight: 500; }
</style></head><body>${cover}${results}${tableCard}${stats}</body></html>`;

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
const names = ["1-cover", "2-results", "3-table", "4-stats"];
const cards = await page.$$(".card");
for (const [i, el] of cards.entries()) {
	const file = join(outDir, `${names[i]}.png`);
	await el.screenshot({ path: file });
	console.log(file);
}
await browser.close();
