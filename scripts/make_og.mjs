#!/usr/bin/env node
// Link-preview images (og:image) for player and league pages: what KakaoTalk,
// iMessage, Instagram DMs etc. show when someone shares a link.
//
//   node scripts/make_og.mjs                 (draw what changed)
//   node scripts/make_og.mjs --html-only     (write og/out/og.html to look at)
//
// Output: public/og/players/<id>.jpg and public/og/league/<league>.jpg, 1200x630,
// plus src/data/og.json ({ players: { id: hash }, leagues: { id: hash } }), which
// the pages read to point og:image at the card (with ?v=<hash>, so a changed card
// gets a new URL and chat apps don't keep showing the old one). A page with no
// entry keeps the site-wide /og-image.png.
//
// Run by the "Make Report Slides" workflow after every data update, same
// Playwright and fonts as scripts/make_report.mjs (club-green background, no photo). A card is redrawn only when
// its HTML changed, so a quiet data run makes no commit.
//
// Player card = the player's newest league (the section /players/<id>/ opens
// on): name, team, position, that league's goals / assists / weeks attended,
// play-style tag and badges. Never a rank or a rating — the same rule as the
// player pages. League card = the current table (top three), or the champion
// once every fixture is scored.

import { readFileSync, existsSync, mkdirSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));

const leagues = read("src/data/leagues.json");
const matches = read("src/data/matches.json");
const table = read("src/data/league_table.json");
const profiles = read("src/data/player_profiles.json");
const photos = read("src/data/player-photos.json");

// Badge icons and tiers live in src/lib/players.ts (BADGES); read them from there
// so a new badge never needs a second copy here.
const playersTs = readFileSync(join(ROOT, "src/lib/players.ts"), "utf8");
const BADGES = Object.fromEntries(
	[...playersTs.matchAll(/^\t(\w+): \{[^}]*?icon: "([^"]+)",\s*tier: "(\w+)"/gms)].map(([, key, icon, tier]) => [key, { icon, tier }]),
);
const TIER_ORDER = ["icon", "legendary", "rare", "common", "special"];
const badgeRank = (key) => (key === "champion" ? 0.5 : TIER_ORDER.indexOf(BADGES[key]?.tier ?? "special"));

// ---- assets (same files as the report slides) --------------------------------
const dataUrl = (path, mime) => `data:${mime};base64,${readFileSync(path).toString("base64")}`;
const antonio = dataUrl(join(ROOT, "report/assets/Antonio.ttf"), "font/ttf");
const montserrat = dataUrl(join(ROOT, "report/assets/Montserrat.ttf"), "font/ttf");
const kr = dataUrl(join(ROOT, "report/assets/NotoSansKR-subset.ttf"), "font/ttf");
const ball = dataUrl(join(ROOT, "report/assets/kicks-ball.png"), "image/png");
// Background: the club green of the site-wide preview (public/og-image.png), so a
// shared player or league link looks like the rest of KICKS — no photo.
const GREEN = "#3f5128";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const leagueById = new Map(leagues.map((l) => [l.id, l]));
const teamOf = (leagueId, teamId) => leagueById.get(leagueId)?.teams.find((t) => t.team_id === teamId) ?? { name: "TBD", color: "#8a8a8a" };
function textOn(hex) {
	const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((s) => (s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4));
	return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? "#111" : "#fff";
}
const isFinished = (leagueId) => {
	const ms = matches.filter((m) => m.league === leagueId);
	return ms.length > 0 && ms.every((m) => m.status === "completed");
};

const brand = `<div class="brand"><img src="${ball}" alt=""><span>KICKS</span><small>kicksuiuc.com</small></div>`;

// ---- player card ----------------------------------------------------------------
function playerCard(p) {
	const s = p.leagues[0];
	if (!s) return null;
	const team = teamOf(s.league, s.current_team_id);
	const t = s.season_totals;
	const photoEntry = photos[p.id];
	const photoPath = typeof photoEntry === "string" ? photoEntry : photoEntry?.card;
	const photoFile = photoPath && join(ROOT, "public", photoPath);
	const avatar = photoFile && existsSync(photoFile)
		? `<img class="avatar" src="${dataUrl(photoFile, photoPath.endsWith(".png") ? "image/png" : "image/jpeg")}" alt="">`
		: `<div class="avatar" style="background:${team.color};color:${textOn(team.color)}">${esc(p.avatar_initials)}</div>`;
	const badges = [...s.badges].sort((a, b) => badgeRank(a) - badgeRank(b)).map((k) => BADGES[k]?.icon).filter(Boolean).slice(0, 6);
	const position = p.positions?.[0];
	return `<section class="card player">
		<div class="stripe" style="background:${team.color}"></div>
		${avatar}
		<div class="info">
			<div class="kicker">${esc(s.league)} · PLAYER</div>
			<h1>${esc(p.name)}</h1>
			<div class="team"><i style="background:${team.color}"></i><b>${esc(team.name)}</b>${position ? `<span class="pos">${esc(position)}</span>` : ""}<span class="tag">${esc(s.play_style_tag)}</span></div>
			<div class="stats">
				<div><b>${t.goals}</b><small>GOALS</small></div>
				<div><b>${t.assists}</b><small>ASSISTS</small></div>
				<div><b>${t.weeks_attended}<em>/${t.weeks_played}</em></b><small>WEEKS</small></div>
			</div>
			${badges.length ? `<div class="badges">${badges.map((b) => `<span>${b}</span>`).join("")}</div>` : ""}
		</div>
		${brand}
	</section>`;
}

// ---- league card ----------------------------------------------------------------
function leagueCard(league) {
	const rows = table.filter((r) => r.league === league.id).sort((a, b) => a.rank - b.rank);
	if (!rows.length) return null;
	const done = isFinished(league.id);
	const scoredWeeks = [...new Set(matches.filter((m) => m.league === league.id && m.status === "completed").map((m) => m.week))];
	const week = Math.max(...scoredWeeks);
	const status = done ? "FINAL STANDINGS" : `AFTER WEEK ${week} OF ${league.rules.weeks}`;
	const champion = done ? teamOf(league.id, rows[0].team_id) : null;
	return `<section class="card league">
		<div class="lhead">
			<div class="kicker">KICKS LEAGUE</div>
			<h1>${esc(league.id)}</h1>
			<div class="status">${status}</div>
			${champion ? `<div class="champ">🏆 <b>${esc(champion.name)}</b></div>` : ""}
		</div>
		<div class="ltable">
			<div class="lrow lhd"><span></span><span></span><span>W-D-L</span><span>PTS</span></div>
			${rows.slice(0, 3).map((r) => {
				const team = teamOf(league.id, r.team_id);
				return `<div class="lrow"><span class="rk">${r.rank}</span><span class="nm"><i style="background:${team.color}"></i>${esc(team.name)}</span><span class="wdl">${r.wins}-${r.draws}-${r.losses}</span><span class="pts">${r.points}</span></div>`;
			}).join("")}
		</div>
		${brand}
	</section>`;
}

const css = `
@font-face { font-family: Antonio; src: url(${antonio}) format("truetype"); font-weight: 100 700; }
@font-face { font-family: Montserrat; src: url(${montserrat}) format("truetype"); font-weight: 100 900; }
@font-face { font-family: "KICKS KR"; src: url(${kr}) format("truetype"); font-weight: 100 900; }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: #222; }
.card { position: relative; width: 1200px; height: 630px; overflow: hidden; color: #fff; background: ${GREEN};
	font-family: "KICKS KR", "Noto Sans CJK KR", "Apple SD Gothic Neo", sans-serif; }
.card > * { position: relative; }
.kicker { font-family: Antonio, sans-serif; font-size: 30px; font-weight: 700; letter-spacing: .18em; color: #d6dfcf; }
.brand { position: absolute !important; left: 64px; bottom: 44px; display: flex; align-items: center; gap: 14px; }
.brand img { width: 46px; height: 46px; }
.brand span { font-family: Montserrat, sans-serif; font-size: 32px; font-weight: 900; letter-spacing: .04em; }
.brand small { font-family: Montserrat, sans-serif; font-size: 22px; font-weight: 600; color: #c3cdbb; margin-left: 10px; }
/* player */
.player .brand { left: auto; right: 84px; }
.player .stripe { position: absolute !important; left: 0; top: 0; bottom: 0; width: 18px; }
.player .avatar { position: absolute !important; right: 84px; top: 125px; width: 300px; height: 300px; border-radius: 50%; object-fit: cover;
	display: flex; align-items: center; justify-content: center; font-size: 104px; font-weight: 800; border: 8px solid rgba(255,255,255,.9); box-shadow: 0 12px 40px rgba(0,0,0,.45); }
.player .info { position: absolute !important; left: 64px; top: 58px; width: 700px; }
.player h1 { margin-top: 6px; font-size: 104px; font-weight: 800; line-height: 1.12; letter-spacing: -.01em; white-space: nowrap; }
.player .team { display: flex; align-items: center; gap: 16px; margin-top: 8px; font-size: 36px; }
.player .team i { width: 12px; height: 40px; border-radius: 3px; }
.player .team b { font-weight: 700; }
.player .pos, .player .tag { font-family: Antonio, sans-serif; font-size: 28px; font-weight: 700; letter-spacing: .1em; padding: 4px 14px; border-radius: 8px; background: rgba(255,255,255,.14); }
.player .stats { display: flex; gap: 56px; margin-top: 30px; }
.player .stats b { display: block; font-family: Antonio, sans-serif; font-size: 96px; font-weight: 700; line-height: 1; }
.player .stats em { font-style: normal; font-size: 52px; color: #c3cdbb; }
.player .stats small { display: block; margin-top: 6px; font-family: Antonio, sans-serif; font-size: 24px; font-weight: 700; letter-spacing: .2em; color: #d6dfcf; }
.player .badges { display: flex; gap: 12px; margin-top: 26px; font-size: 44px; }
/* league */
.league .lhead { position: absolute !important; left: 64px; top: 58px; width: 440px; }
.league h1 { font-family: Antonio, sans-serif; font-size: 150px; font-weight: 700; line-height: 1; margin-top: 8px; }
.league .status { margin-top: 14px; font-family: Antonio, sans-serif; font-size: 34px; font-weight: 700; letter-spacing: .12em; color: #e8c766; }
.league .champ { margin-top: 18px; font-size: 40px; }
.league .ltable { position: absolute !important; right: 64px; top: 110px; width: 600px; padding: 18px 30px 22px; background: #fff; color: #111; border-radius: 14px; box-shadow: 0 12px 40px rgba(0,0,0,.45); }
.league .lrow { display: grid; grid-template-columns: 50px 1fr 130px 90px; align-items: center; height: 104px; border-top: 2px solid #ececec; }
.league .lrow.lhd { height: 44px; border-top: 0; font-family: Antonio, sans-serif; font-size: 24px; font-weight: 700; letter-spacing: .14em; color: #777; }
.league .lrow.lhd span:nth-child(n+3) { text-align: right; }
.league .rk { font-family: Antonio, sans-serif; font-size: 44px; font-weight: 700; color: #555; }
.league .nm { display: flex; align-items: center; gap: 16px; font-size: 42px; font-weight: 700; white-space: nowrap; overflow: hidden; }
.league .nm i { flex: none; width: 12px; height: 46px; border-radius: 3px; }
.league .wdl { text-align: right; font-family: Antonio, sans-serif; font-size: 36px; font-weight: 600; color: #444; }
.league .pts { text-align: right; font-family: Antonio, sans-serif; font-size: 58px; font-weight: 700; }
`;

// ---- build ----------------------------------------------------------------------
const jobs = [];
for (const p of profiles) {
	const html = playerCard(p);
	if (html) jobs.push({ kind: "players", id: p.id, league: p.leagues[0].league, html, file: join(ROOT, "public/og/players", `${p.id}.jpg`) });
}
for (const l of leagues) {
	const html = leagueCard(l);
	if (html) jobs.push({ kind: "leagues", id: l.id, league: l.id, html, file: join(ROOT, "public/og/league", `${l.id}.jpg`) });
}
const pageHtml = (cards) =>
	`<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${cards
		.map((j) => j.html)
		.join("")}</body></html>`;

if (process.argv.includes("--html-only")) {
	const out = join(ROOT, "og/out");
	mkdirSync(out, { recursive: true });
	writeFileSync(join(out, "og.html"), pageHtml(jobs));
	console.log(`Wrote ${join(out, "og.html")}`);
	process.exit(0);
}

const manifestPath = join(ROOT, "src/data/og.json");
const old = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : {};
const manifest = { _readme: 'Generated by scripts/make_og.mjs (workflow "Make Report Slides"). Don\'t hand-edit.', players: {}, leagues: {} };
const todo = [];
for (const j of jobs) {
	// The hash covers the card's own markup and the shared CSS (fonts included),
	// not the background photo bytes — a new league photo means a new league id anyway.
	const hash = createHash("sha256").update(css).update(j.html).update(j.league).digest("hex").slice(0, 10);
	manifest[j.kind][j.id] = hash;
	if (old[j.kind]?.[j.id] !== hash || !existsSync(j.file)) todo.push(j);
}
// Cards for players/leagues that no longer exist go away with their entry.
for (const [kind, dir] of [["players", "public/og/players"], ["leagues", "public/og/league"]]) {
	if (!existsSync(join(ROOT, dir))) continue;
	for (const f of readdirSync(join(ROOT, dir))) if (!manifest[kind][f.replace(/\.jpg$/, "")]) rmSync(join(ROOT, dir, f));
}

if (todo.length) {
	const { chromium } = await import("playwright").catch(() => createRequire(import.meta.url)("playwright"));
	const browser = await chromium.launch();
	const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
	// In batches, so one page never holds every embedded photo at once.
	for (let i = 0; i < todo.length; i += 12) {
		const batch = todo.slice(i, i + 12);
		await page.setContent(pageHtml(batch), { waitUntil: "load" });
		await page.evaluate(() => document.fonts.ready);
		const cards = await page.$$(".card");
		for (const [k, el] of cards.entries()) {
			mkdirSync(dirname(batch[k].file), { recursive: true });
			await el.screenshot({ path: batch[k].file, type: "jpeg", quality: 88 });
		}
	}
	await browser.close();
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, "\t") + "\n");
console.log(`og cards: ${todo.length} drawn, ${jobs.length - todo.length} unchanged`);
