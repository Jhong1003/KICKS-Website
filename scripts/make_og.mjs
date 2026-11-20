#!/usr/bin/env node
// Link-preview images (og:image): what KakaoTalk, iMessage, Instagram DMs etc.
// show when someone shares a link. Player, league, team, Wrapped and gallery
// album pages get a card of their own, and so do the site's other pages
// (Schedule, Hall of Fame, Partners, the mini games …); the homepage keeps
// public/og-image.png.
//
//   node scripts/make_og.mjs                 (draw what changed)
//   node scripts/make_og.mjs --html-only     (write og/out/og.html to look at)
//
// Output (all 1200x630): public/og/players/<id>.jpg, public/og/league/<league>.jpg,
// public/og/team/<league>-<team>.jpg, public/og/wrapped/<league>-<id>.jpg,
// public/og/album/<album>.jpg and public/og/page/<page>.jpg, plus
// src/data/og.json ({ players: { id: hash }, leagues: {…}, teams, wrapped,
// albums, pages }), which
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
// player pages. League card = the current table (top three) while it runs; once
// every fixture is scored, the CHAMPIONS banner (dark green, gold wordmark,
// champion's name between bars in its colour, partner logos along the bottom).

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
const partners = read("src/data/partners.json");
const teamInfo = read("src/data/team-info.json");
const albumEntries = read("src/data/gallery-albums.json");
const schedule = read("src/data/schedule.json");

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
const interTight = dataUrl(join(ROOT, "report/assets/InterTight.woff2"), "font/woff2");
const pretendard = dataUrl(join(ROOT, "report/assets/Pretendard-subset.woff2"), "font/woff2");
const montserrat = dataUrl(join(ROOT, "report/assets/Montserrat.ttf"), "font/ttf");
const kr = dataUrl(join(ROOT, "report/assets/NotoSansKR-subset.ttf"), "font/ttf");
// The banner's CHAMPIONS lettering, as an outline (no font needed).
const championsWord = dataUrl(join(ROOT, "report/assets/champions-wordmark.svg"), "image/svg+xml");
const imageMime = (path) => ({ png: "image/png", webp: "image/webp", svg: "image/svg+xml" })[path.split(".").pop().toLowerCase()] ?? "image/jpeg";
const publicImage = (path) => {
	const file = join(ROOT, "public", path);
	return existsSync(file) ? dataUrl(file, imageMime(file)) : null;
};
const logoWhite = publicImage("/kicks-logo-white.jpg");

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
// Same rule as isShownInLeague in src/lib/finale.ts: inactive players count in a
// finished league they played through to its last week.
function shownInLeague(p, leagueId) {
	const sec = p.leagues.find((x) => x.league === leagueId);
	if (!sec) return false;
	if (p.status !== "inactive") return true;
	if (!isFinished(leagueId)) return false;
	const last = Math.max(...matches.filter((m) => m.league === leagueId).map((m) => m.week));
	return sec.weekly_stats.some((w) => w.week === last);
}
const ordinal = (n) => { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };

// ---- KICKS 2.0 frame ---------------------------------------------------------------
// Olive card (the club colour, so a shared link stands out in a chat), white logo top
// left, the KICKS 2.0 layout and type: Inter Tight for titles and numbers, Pretendard
// for Korean (both embedded: CI has no fonts). No strip or small print along the
// bottom: at chat-preview size it only read as a business card.
const OLIVE = "#3f5128";
const frame = (cls, inner) => `<section class="card ${cls}">${logoWhite ? `<img class="logo" src="${logoWhite}" alt="">` : ""}${inner}</section>`;
const leagueName = (id) => {
	const [s, n] = id.split("-");
	return n?.startsWith("L") ? `${s} League ${n.slice(1)}` : id;
};
const badgeDots = (keys) =>
	`<div class="badges">${keys.map((k) => {
		const b = BADGES[k];
		return b ? `<span class="badge t-${k === "champion" ? "champion" : b.tier}">${b.icon}</span>` : "";
	}).join("")}</div>`;
const sq = (color, size = 18) => `<i class="sq" style="background:${color};width:${size}px;height:${size}px"></i>`;
const numbers = (cells) => `<dl class="nums">${cells.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${value}</dd></div>`).join("")}</dl>`;

// ---- homepage (public/og-image.png) -------------------------------------------------
function homeCard() {
	return `<section class="card home">${logoWhite ? `<img class="hlogo" src="${logoWhite}" alt="">` : ""}<div class="hline">UIUC 한인 풋살 동아리 · 7v7 every Saturday</div></section>`;
}

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
		? `<img class="avatar" src="${dataUrl(photoFile, imageMime(photoFile))}" alt="">`
		: `<div class="avatar" style="background:${team.color};color:${textOn(team.color)}">${esc(p.avatar_initials)}</div>`;
	const badges = [...s.badges].sort((a, b) => badgeRank(a) - badgeRank(b)).slice(0, 7);
	return frame("player", `
		<div class="info">
			<div class="meta">${esc(leagueName(s.league))}</div>
			<h1>${esc(p.name)}</h1>
			<div class="line">${sq(team.color)}<b>${esc(team.name)}</b><span>${esc(s.play_style_tag)}</span></div>
			${numbers([["Goals", t.goals], ["Assists", t.assists], ["Weeks played", `${t.weeks_attended}<em>/${t.weeks_played}</em>`]])}
			${badges.length ? badgeDots(badges) : ""}
		</div>
		${avatar}`);
}

// ---- league card ----------------------------------------------------------------
function leagueCard(league) {
	const rows = table.filter((r) => r.league === league.id).sort((a, b) => a.rank - b.rank);
	if (!rows.length) return null;
	if (isFinished(league.id)) return championCard(league, rows);
	const scoredWeeks = [...new Set(matches.filter((m) => m.league === league.id && m.status === "completed").map((m) => m.week))];
	const week = Math.max(...scoredWeeks);
	return frame("league", `
		<div class="info">
			<div class="meta">KICKS League</div>
			<h1>${esc(leagueName(league.id))}</h1>
			<div class="sub">After week ${week} of ${league.rules.weeks}</div>
		</div>
		<div class="ltable">
			<div class="lrow lhd"><span></span><span>Team</span><span>W-D-L</span><span>Pts</span></div>
			${rows.slice(0, 3).map((r) => {
				const team = teamOf(league.id, r.team_id);
				return `<div class="lrow"><span class="rk">${r.rank}</span><span class="nm">${sq(team.color, 20)}${esc(team.name)}</span><span class="wdl">${r.wins}-${r.draws}-${r.losses}</span><span class="pts">${r.points}</span></div>`;
			}).join("")}
		</div>`);
}

// ---- champion banner (finished league) --------------------------------------------
// The club's champion banner (also posted on Instagram): KICKS logo, "FA26 · LEAGUE 2"
// between gold rules, the gold CHAMPIONS wordmark, the champion's name between two bars
// in its colour, and the partners along a cream strip. Kept as it is on purpose.
function championCard(league, rows) {
	const champs = rows.filter((r) => r.rank === 1).map((r) => teamOf(league.id, r.team_id));
	const [season, num] = league.id.split("-");
	const label = `${season} · ${num?.startsWith("L") ? `LEAGUE ${num.slice(1)}` : num ?? ""}`;
	const logos = partners.map((p) => publicImage(p.logo)).filter(Boolean);
	const names = champs.map((t) => `<span class="cname"><i style="background:${t.color}"></i><b>${esc(t.name)}</b><i style="background:${t.color}"></i></span>`).join("");
	return `<section class="card champion">
		${logoWhite ? `<img class="clogo" src="${logoWhite}" alt="">` : ""}
		<div class="cleague"><i></i><span>${esc(label)}</span><i></i></div>
		<img class="cword" src="${championsWord}" alt="CHAMPIONS">
		<div class="cnames">${names}</div>
		${logos.length ? `<div class="cstrip"><small>PROUDLY SUPPORTED BY</small><div>${logos.map((l) => `<img src="${l}" alt="">`).join("")}</div></div>` : ""}
	</section>`;
}

// ---- team card ---------------------------------------------------------------------
function teamCard(league, team) {
	const row = table.find((r) => r.league === league.id && r.team_id === team.team_id);
	const done = isFinished(league.id);
	const champ = done && row?.rank === 1;
	const captain = teamInfo[league.id]?.[team.team_id]?.captain;
	const shared = row && table.filter((r) => r.league === league.id && r.rank === row.rank).length > 1;
	return frame("team", `
		<div class="info">
			<div class="meta">${esc(leagueName(league.id))}${champ ? ` · <b class="olive">Champions</b>` : ""}</div>
			<h1>${esc(team.name)}</h1>
			${captain ? `<div class="sub">Captain ${esc(captain)}</div>` : ""}
			${row ? numbers([[done ? "Final" : "Place", `${shared ? "T-" : ""}${ordinal(row.rank)}`], ["Points", row.points], ["W-D-L", `${row.wins}-${row.draws}-${row.losses}`]]) : ""}
		</div>
		<div class="emblem" style="background:${team.color};color:${textOn(team.color)}">${esc([...team.name][0] ?? "")}</div>`);
}

// ---- Wrapped card --------------------------------------------------------------------
// A teaser for /wrapped/<league>/<id> in the Wrapped look: dark olive, faint court
// lines, gold. Who and which league, not the slides' contents.
function wrappedCard(p, league) {
	const s = p.leagues.find((x) => x.league === league.id);
	const team = teamOf(league.id, s.current_team_id);
	const champ = (s.badges ?? []).includes("champion");
	const badges = [...s.badges].filter((k) => k !== "own_goal_award").sort((a, b) => badgeRank(a) - badgeRank(b)).slice(0, 7);
	return `<section class="card wrapped">
		<div class="court"><i class="half"></i><i class="circle"></i><i class="box l"></i><i class="box r"></i></div>
		${logoWhite ? `<img class="wlogo" src="${logoWhite}" alt="">` : ""}
		<div class="info">
			<div class="gold">KICKS Wrapped · ${esc(leagueName(league.id))}</div>
			<h1>${esc(p.name)}</h1>
			<div class="line">${sq(team.color)}<b>${esc(team.name)}</b>${champ ? `<span class="gold">Champions</span>` : ""}</div>
			${badges.length ? badgeDots(badges) : ""}
		</div>
		<div class="wplay"><span></span></div>
		<div class="wsite">kicksuiuc.com</div>
	</section>`;
}

// ---- gallery album card ----------------------------------------------------------------
// Same albums and covers as src/lib/gallery.ts: a folder per album under
// src/assets/gallery, titles from gallery-albums.json, cover = its `cover` file or
// the first photo in natural order.
const GALLERY = join(ROOT, "src/assets/gallery");
const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true });
function albums() {
	if (!existsSync(GALLERY)) return [];
	const folders = readdirSync(GALLERY, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
	const ids = [...new Set([...albumEntries.map((e) => e.id), ...folders])];
	return ids.flatMap((id) => {
		const entry = albumEntries.find((e) => e.id === id);
		const dir = join(GALLERY, id);
		const photos = existsSync(dir) ? readdirSync(dir).filter((f) => /\.(jpe?g|png|webp)$/i.test(f)).sort(natural) : [];
		if (!photos.length) return [];
		const cover = entry?.cover && photos.includes(entry.cover) ? entry.cover : photos[0];
		return [{ id, title: entry?.title ?? id, titleKo: entry?.title_ko ?? entry?.title ?? id, date: entry?.date ?? null, count: photos.length + (entry?.site_photos ? 2 : 0), cover: join(dir, cover) }];
	}).sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
}
const fmtDate = (d) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "");
function albumCard(a) {
	return frame("album", `
		<img class="photo" src="${dataUrl(a.cover, imageMime(a.cover))}" alt="">
		<div class="info">
			<div class="meta">Photos${a.date ? ` · ${fmtDate(a.date)}` : ""}</div>
			<h1>${esc(a.titleKo)}</h1>
			${a.titleKo !== a.title ? `<div class="sub">${esc(a.title)}</div>` : ""}
			<div class="count">${a.count} photos</div>
		</div>`);
}

// ---- other pages ---------------------------------------------------------------------
// One card per page: the page's English title and its Korean name on the left, and on
// the right whatever shows the page best. Keys match pageOgImage(<key>) calls in src/pages.
function pageCard({ title, ko, side = "" }) {
	return frame("page", `
		<div class="info">
			<h1>${esc(title)}</h1>
			${ko ? `<div class="ko">${esc(ko)}</div>` : ""}
		</div>
		${side}`);
}
const season = leagues.at(-1)?.id.split("-")[0] ?? "";
function pageCards() {
	const img = (src, cls = "") => (src ? `<div class="side pic ${cls}"><img src="${src}" alt=""></div>` : "");
	const assetPhoto = (p) => (existsSync(join(ROOT, p)) ? dataUrl(join(ROOT, p), imageMime(p)) : "");
	const logoGrid = `<div class="side logos">${partners.map((p) => publicImage(p.logo)).filter(Boolean).map((l) => `<span><img src="${l}" alt=""></span>`).join("")}</div>`;
	const finished = leagues.filter((l) => isFinished(l.id)).reverse();
	const honours = finished.length
		? `<div class="side list honours"><div class="lhd">Champions</div>${finished.slice(0, 3).map((l) => {
				const champs = table.filter((r) => r.league === l.id && r.rank === 1).map((r) => teamOf(l.id, r.team_id));
				return `<div class="hrow"><small>${esc(leagueName(l.id))}</small><b>${champs.map((t) => `${sq(t.color, 22)}${esc(t.name)}`).join(" ")}</b></div>`;
			}).join("")}</div>`
		: "";
	const covers = albums().slice(0, 3);
	const collage = covers.length ? `<div class="side collage">${covers.map((a) => `<img src="${dataUrl(a.cover, imageMime(a.cover))}" alt="">`).join("")}</div>` : "";
	// Schedule: the next dates on schedule.json (Chicago date at draw time; the workflow
	// redraws several times a day, so it moves on by itself), with the latest past ones
	// faded filling the rest. English titles: the embedded Korean font is a subset.
	const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
	const dated = schedule.filter((e) => e.date).sort((a, b) => a.date.localeCompare(b.date));
	const upcoming = dated.filter((e) => e.date >= today);
	const next = dated.findIndex((e) => e.date >= today);
	const from = next === -1 ? Math.max(0, dated.length - 4) : Math.max(0, Math.min(next - 4 + Math.min(upcoming.length, 4), dated.length - 4));
	const shown = dated.slice(from, from + 4);
	const md = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).split(" ");
	const scheduleSide = shown.length
		? `<div class="side list agenda"><div class="lhd">${upcoming.length ? "Coming up" : "Season wrapped"}</div>${shown.map((e) => {
				const [mon, day] = md(e.date);
				return `<div class="arow${e.date < today ? " past" : ""}"><span class="adate"><em>${mon}</em><b>${day}</b></span><span class="atitle">${esc(e.short ?? e.title)}</span></div>`;
			}).join("")}</div>`
		: "";
	// Players: the current league's roster, one column per team (team colour and name,
	// captain first with a C, then name order — never by a stat, same as /players).
	const current = [...leagues].reverse().find((l) => profiles.some((p) => p.leagues.some((x) => x.league === l.id)));
	const roster = current
		? profiles.filter((p) => p.status !== "inactive" && p.leagues.some((x) => x.league === current.id)).sort((a, b) => a.name.localeCompare(b.name, "ko"))
		: [];
	const rosterSide = current && roster.length
		? `<div class="side squads">${current.teams.map((t) => {
				const captain = teamInfo[current.id]?.[t.team_id]?.captain;
				const names = roster.filter((p) => p.leagues.find((x) => x.league === current.id).current_team_id === t.team_id).map((p) => p.name);
				const ordered = [...names.filter((n) => n === captain), ...names.filter((n) => n !== captain)];
				return `<div class="squad"><div class="shead">${sq(t.color, 16)}<b>${esc(t.name)}</b></div><ul>${ordered.map((n) => `<li>${esc(n)}${n === captain ? "<em>C</em>" : ""}</li>`).join("")}</ul></div>`;
			}).join("")}</div>`
		: "";
	// Dream Team: an empty 7-a-side pitch waiting to be filled.
	const spots = [[50, 88], [28, 68], [72, 68], [18, 42], [50, 46], [82, 42], [50, 18]];
	const pitch = `<div class="side pitch"><i class="half"></i><i class="circle"></i><i class="box"></i>${spots.map(([x, y]) => `<span style="left:${x}%;top:${y}%">+</span>`).join("")}</div>`;
	// App: a phone with the home-screen icon.
	const icon = publicImage("/icons/icon-512.png");
	const phone = icon ? `<div class="side phone"><div class="screen"><img src="${icon}" alt=""><b>KICKS</b></div></div>` : "";
	const play = `<span class="playbtn"><span></span></span>`;
	return {
		about: { title: "About KICKS", ko: "UIUC 한인 풋살 동아리", side: img(assetPhoto("src/assets/about.jpg")) },
		schedule: { title: `${season} Schedule`, ko: "시즌 일정", side: scheduleSide },
		players: { title: "Players", ko: current ? `${leagueName(current.id)} 선수단` : "KICKS 선수단", side: rosterSide },
		join: { title: "Join KICKS", ko: "멤버 모집", side: img(assetPhoto("src/assets/hero.jpg")) },
		partners: { title: "Partners", ko: "KICKS와 함께하는 곳", side: logoGrid },
		"hall-of-fame": { title: "Hall of Fame", ko: "명예의 전당", side: honours },
		gallery: { title: "Photos", ko: "KICKS의 순간들", side: collage },
		"full-matches": { title: "Full matches", ko: "경기 풀영상 · 멤버 전용", side: assetPhoto("src/assets/hero-wide.jpg") ? `<div class="side pic">${`<img src="${assetPhoto("src/assets/hero-wide.jpg")}" alt="">`}${play}</div>` : "" },
		"dream-team": { title: "Dream Team", ko: "나만의 드림팀 만들기", side: pitch },
		app: { title: "KICKS app", ko: "홈 화면에 KICKS 설치하기", side: phone },
		keeper: { title: "Keeper Challenge", ko: "골키퍼 챌린지", side: img(publicImage("/keeper/card.webp")) },
		freekick: { title: "Free Kick", ko: "프리킥 챌린지", side: img(publicImage("/freekick/card.webp")) },
	};
}

const css = `
@font-face { font-family: "Inter Tight"; src: url(${interTight}) format("woff2"); font-weight: 100 900; }
@font-face { font-family: Pretendard; src: url(${pretendard}) format("woff2"); font-weight: 100 900; }
@font-face { font-family: Montserrat; src: url(${montserrat}) format("truetype"); font-weight: 100 900; }
@font-face { font-family: "KICKS KR"; src: url(${kr}) format("truetype"); font-weight: 100 900; }
* { box-sizing: border-box; margin: 0; padding: 0; }
body { background: #222; }
.card { position: relative; width: 1200px; height: 630px; overflow: hidden; color: #fff; background: ${OLIVE};
	font-family: "Inter Tight", Pretendard, sans-serif; }
.card > * { position: absolute; }
.logo { left: 64px; top: 44px; height: 58px; }
.info { left: 64px; top: 150px; width: 640px; }
.meta { font-size: 26px; font-weight: 600; color: #c9d3bf; }
.meta .olive, .olive { color: #e8c766; }
h1 { margin-top: 6px; font-size: 92px; font-weight: 800; line-height: 1.08; letter-spacing: -.02em; white-space: nowrap; }
.sub { margin-top: 12px; font-size: 30px; font-weight: 500; color: #c9d3bf; }
.sq { display: inline-block; flex: none; }
.line { display: flex; align-items: center; gap: 14px; margin-top: 12px; font-size: 32px; }
.line b { font-weight: 700; }
.line span { color: #c9d3bf; font-weight: 500; }
.line b + span::before { content: "·"; margin-right: 14px; }
.nums { display: flex; margin-top: 30px; border: 1px solid rgba(255,255,255,.28); width: max-content; }
.nums div { padding: 14px 30px 16px 22px; min-width: 170px; }
.nums div + div { border-left: 1px solid rgba(255,255,255,.28); }
.nums dt { font-size: 20px; font-weight: 600; color: #c9d3bf; }
.nums dd { margin-top: 2px; font-size: 64px; font-weight: 800; line-height: 1; letter-spacing: -.02em; }
.nums em { font-style: normal; font-size: 34px; color: #a9b69c; font-weight: 700; }
.badges { display: flex; gap: 14px; margin-top: 26px; }
.badge { width: 54px; height: 54px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 28px; background: rgba(255,255,255,.14); }
.t-rare { box-shadow: 0 0 0 3px #4a7fc1; }
.t-legendary { background: #f6e7b8; box-shadow: 0 0 0 3px #c9a227; }
.t-champion { background: radial-gradient(circle at 35% 30%, #fff6d6, #f1cf63 70%, #c9a227); box-shadow: 0 0 0 3px #c9a227; }
.t-icon { background: #fffaf0; box-shadow: 0 0 0 3px #c9a227, 0 0 0 6px ${OLIVE}, 0 0 0 8px #c9a227; }
/* home */
.home .hlogo { left: 50%; top: 168px; width: 700px; transform: translateX(-50%); }
.home .hline { left: 0; right: 0; top: 470px; text-align: center; font-family: Pretendard, sans-serif; font-size: 32px; font-weight: 600; color: #c9d3bf; }
/* player */
.player h1 { font-family: Pretendard, sans-serif; }
.player .avatar { right: 96px; top: 150px; width: 300px; height: 300px; border-radius: 50%; object-fit: cover;
	display: flex; align-items: center; justify-content: center; font-family: Pretendard, sans-serif; font-size: 104px; font-weight: 800; }
.player .line, .team .line { font-family: Pretendard, "Inter Tight", sans-serif; }
/* league */
.league h1 { font-size: 84px; }
.league .ltable { right: 64px; top: 150px; width: 560px; }
.league .lrow { display: grid; grid-template-columns: 44px 1fr 120px 80px; align-items: center; height: 96px; border-bottom: 1px solid rgba(255,255,255,.22); }
.league .lrow.lhd { height: 46px; border-bottom: 2px solid #fff; font-size: 20px; font-weight: 600; color: #c9d3bf; }
.league .lrow span:nth-child(n+3) { text-align: right; }
.league .rk { font-size: 32px; font-weight: 700; color: #c9d3bf; }
.league .nm { display: flex; align-items: center; gap: 14px; font-family: Pretendard, sans-serif; font-size: 36px; font-weight: 700; white-space: nowrap; overflow: hidden; }
.league .wdl { font-size: 30px; font-weight: 500; color: #dfe6d7; }
.league .pts { font-size: 46px; font-weight: 800; }
/* champion banner (unchanged) */
.champion { background: #23311a; color: #fff; font-family: "KICKS KR", "Noto Sans CJK KR", sans-serif; }
.champion .clogo { left: 50%; top: 40px; width: 300px; transform: translateX(-50%); }
.champion .cleague { left: 0; right: 0; top: 190px; display: flex; align-items: center; justify-content: center; gap: 26px; }
.champion .cleague i { width: 158px; height: 2px; background: #e2b94a; }
.champion .cleague span { font-family: Montserrat, sans-serif; font-size: 23px; font-weight: 700; letter-spacing: .3em; color: #e8e5d6; margin-right: -.3em; }
.champion .cword { left: 50%; top: 232px; width: 994px; transform: translateX(-50%); }
.champion .cnames { left: 0; right: 0; top: 352px; display: flex; justify-content: center; gap: 48px; }
.champion .cname { display: flex; align-items: center; gap: 30px; }
.champion .cname i { width: 88px; height: 10px; border-radius: 5px; }
.champion .cname b { font-size: 66px; font-weight: 800; line-height: 1; }
.champion .cstrip { left: 0; right: 0; bottom: 0; height: 120px; background: #f4f1e8; color: #22301a; text-align: center; }
.champion .cstrip small { display: block; margin-top: 14px; font-family: Montserrat, sans-serif; font-size: 14px; font-weight: 800; letter-spacing: .32em; }
.champion .cstrip div { display: flex; align-items: center; justify-content: space-evenly; height: 76px; padding: 0 60px; }
.champion .cstrip img { max-height: 58px; max-width: 165px; object-fit: contain; }
/* team */
.team h1 { font-family: Pretendard, sans-serif; }
.team .emblem { right: 96px; top: 150px; width: 290px; height: 290px; display: flex; align-items: center; justify-content: center;
	font-family: Pretendard, sans-serif; font-size: 150px; font-weight: 800; }
/* wrapped */
.wrapped { background: #26321a; color: #fff; }
.wrapped .court { inset: 0; }
.wrapped .court i { position: absolute; border: 2px solid rgba(255,255,255,.07); }
.wrapped .court .half { left: 50%; top: 0; bottom: 0; border-width: 0 0 0 2px; }
.wrapped .court .circle { left: 50%; top: 50%; width: 220px; height: 220px; border-radius: 50%; transform: translate(-50%, -50%); }
.wrapped .court .box { top: 165px; width: 150px; height: 300px; }
.wrapped .court .box.l { left: -2px; } .wrapped .court .box.r { right: -2px; }
.wrapped .wlogo { left: 64px; top: 44px; height: 54px; }
.wrapped .info { top: 150px; width: 760px; }
.wrapped .gold { color: #d9b04a; font-size: 28px; font-weight: 700; }
.wrapped h1 { margin-top: 10px; font-family: Pretendard, sans-serif; font-size: 104px; }
.wrapped .line { font-family: Pretendard, "Inter Tight", sans-serif; }
.wrapped .line .gold { font-size: 30px; }
.wrapped .badge { background: rgba(255,255,255,.1); }
.wrapped .badge.t-legendary, .wrapped .badge.t-champion { background: #f6e7b8; }
.wrapped .badge.t-icon { background: #fffaf0; box-shadow: 0 0 0 3px #c9a227, 0 0 0 6px #26321a, 0 0 0 8px #c9a227; }
.wrapped .wplay { right: 120px; top: 200px; width: 200px; height: 200px; border-radius: 50%; border: 6px solid #d9b04a; display: flex; align-items: center; justify-content: center; }
.wrapped .wplay span { width: 0; height: 0; margin-left: 16px; border-left: 64px solid #d9b04a; border-top: 40px solid transparent; border-bottom: 40px solid transparent; }
.wrapped .wsite { left: 64px; bottom: 40px; font-size: 24px; font-weight: 600; color: rgba(255,255,255,.6); }
/* album */
.album .photo { right: 0; top: 0; width: 560px; height: 630px; object-fit: cover; }
.album .info { width: 520px; }
.album h1 { font-family: Pretendard, sans-serif; font-size: 58px; line-height: 1.18; white-space: normal; }
.album .sub { font-size: 28px; }
.album .count { margin-top: 26px; font-size: 26px; font-weight: 700; color: #e8c766; }
/* generic page */
.page .info { top: 170px; width: 520px; }
.page h1 { font-size: 80px; white-space: normal; }
.page .ko { margin-top: 18px; font-family: Pretendard, sans-serif; font-size: 34px; font-weight: 600; color: #c9d3bf; }
.page .side { right: 64px; top: 56px; width: 540px; height: 518px; }
.page .pic img { width: 100%; height: 100%; object-fit: cover; display: block; }
.page .pic .playbtn { position: absolute; left: 50%; top: 50%; width: 140px; height: 140px; transform: translate(-50%, -50%); border-radius: 50%; background: #fff; display: flex; align-items: center; justify-content: center; }
.page .pic .playbtn span { width: 0; height: 0; margin-left: 12px; border-left: 46px solid #2f3d1e; border-top: 28px solid transparent; border-bottom: 28px solid transparent; }
.page .list { top: 60px; height: auto; }
.page .lhd { padding-bottom: 12px; border-bottom: 2px solid #fff; font-size: 22px; font-weight: 600; color: #c9d3bf; }
.page .arow { display: flex; align-items: center; gap: 24px; height: 100px; border-bottom: 1px solid rgba(255,255,255,.22); }
.page .arow.past { opacity: .45; }
.page .adate { flex: none; width: 74px; height: 74px; border: 1px solid rgba(255,255,255,.4); display: flex; flex-direction: column; align-items: center; justify-content: center; line-height: 1; }
.page .adate em { font-style: normal; font-size: 18px; font-weight: 700; color: #e8c766; }
.page .adate b { margin-top: 4px; font-size: 34px; font-weight: 800; }
.page .atitle { font-size: 28px; font-weight: 700; line-height: 1.2; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.page .hrow { padding: 22px 0; border-bottom: 1px solid rgba(255,255,255,.22); }
.page .hrow small { display: block; font-size: 22px; font-weight: 600; color: #c9d3bf; }
.page .hrow b { display: flex; align-items: center; gap: 14px; margin-top: 6px; font-family: Pretendard, sans-serif; font-size: 42px; font-weight: 800; }
.page .squads { top: 44px; right: 48px; width: auto; height: auto; display: flex; gap: 20px; }
.page .squad { width: 184px; }
.page .shead { display: flex; align-items: center; gap: 10px; padding-bottom: 10px; border-bottom: 2px solid #fff; font-family: Pretendard, sans-serif; font-size: 24px; white-space: nowrap; overflow: hidden; }
.page .squad ul { list-style: none; }
.page .squad li { display: flex; align-items: center; gap: 8px; height: 48px; border-bottom: 1px solid rgba(255,255,255,.2); font-family: Pretendard, sans-serif; font-size: 23px; font-weight: 600; }
.page .squad em { font-style: normal; width: 24px; height: 24px; border-radius: 50%; background: #fff; color: #111; font-size: 14px; font-weight: 800; display: flex; align-items: center; justify-content: center; }
.page .logos { display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: repeat(3, minmax(0, 1fr)); gap: 14px; }
.page .logos span { display: flex; align-items: center; justify-content: center; min-height: 0; padding: 18px 28px; background: #fff; overflow: hidden; }
.page .logos img { max-width: 100%; max-height: 100%; object-fit: contain; }
.page .logos span:last-child:nth-child(odd) { grid-column: 1 / -1; }
.page .collage { display: grid; grid-template-columns: 1.5fr 1fr; grid-template-rows: 1fr 1fr; gap: 10px; }
.page .collage img { width: 100%; height: 100%; object-fit: cover; display: block; }
.page .collage img:first-child { grid-row: 1 / 3; }
.page .pitch { right: 120px; width: 420px; background: #2f3d1e; border: 4px solid #fff; }
.page .pitch i { position: absolute; border: 3px solid rgba(255,255,255,.75); }
.page .pitch .half { left: 0; right: 0; top: 50%; border-width: 3px 0 0; }
.page .pitch .circle { left: 50%; top: 50%; width: 110px; height: 110px; border-radius: 50%; transform: translate(-50%, -50%); }
.page .pitch .box { left: 50%; bottom: -3px; width: 190px; height: 70px; transform: translateX(-50%); border-bottom: 0; }
.page .pitch span { position: absolute; width: 62px; height: 62px; transform: translate(-50%, -50%); border-radius: 50%; border: 3px dashed rgba(255,255,255,.9);
	display: flex; align-items: center; justify-content: center; font-size: 34px; font-weight: 700; color: #fff; }
.page .phone { right: 150px; top: 34px; width: 250px; height: 504px; padding: 12px; border-radius: 40px; background: #111; }
.page .phone .screen { width: 100%; height: 100%; border-radius: 30px; background: #2f3d1e; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; }
.page .phone img { width: 112px; height: 112px; border-radius: 26px; }
.page .phone b { color: #fff; font-size: 26px; font-weight: 700; }
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
	for (const t of l.teams) {
		const id = `${l.id}-${t.team_id}`;
		jobs.push({ kind: "teams", id, league: l.id, html: teamCard(l, t), file: join(ROOT, "public/og/team", `${id}.jpg`) });
	}
	// Wrapped exists only for a finished league (src/lib/wrapped.ts, wrappedPlayers).
	if (isFinished(l.id)) {
		for (const p of profiles) {
			if (!shownInLeague(p, l.id)) continue;
			const id = `${l.id}-${p.id}`;
			jobs.push({ kind: "wrapped", id, league: l.id, html: wrappedCard(p, l), file: join(ROOT, "public/og/wrapped", `${id}.jpg`) });
		}
	}
}
for (const a of albums()) jobs.push({ kind: "albums", id: a.id, league: "", html: albumCard(a), file: join(ROOT, "public/og/album", `${a.id}.jpg`) });
jobs.push({ kind: "home", id: "home", league: "", html: homeCard(), file: join(ROOT, "public/og-image.png") });
for (const [id, page] of Object.entries(pageCards())) jobs.push({ kind: "pages", id, league: "", html: pageCard(page), file: join(ROOT, "public/og/page", `${id}.jpg`) });
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
const KINDS = { players: "public/og/players", leagues: "public/og/league", teams: "public/og/team", wrapped: "public/og/wrapped", albums: "public/og/album", pages: "public/og/page" };
const manifest = { _readme: 'Generated by scripts/make_og.mjs (workflow "Make Report Slides"). Don\'t hand-edit.', ...Object.fromEntries(Object.keys(KINDS).map((k) => [k, {}])), home: {} };
const todo = [];
for (const j of jobs) {
	// The hash covers the card's own markup and the shared CSS (fonts included),
	// not the background photo bytes — a new league photo means a new league id anyway.
	const hash = createHash("sha256").update(css).update(j.html).update(j.league).digest("hex").slice(0, 10);
	manifest[j.kind][j.id] = hash;
	if (old[j.kind]?.[j.id] !== hash || !existsSync(j.file)) todo.push(j);
}
// Cards for players/leagues that no longer exist go away with their entry.
for (const [kind, dir] of Object.entries(KINDS)) {
	if (!existsSync(join(ROOT, dir))) continue;
	for (const f of readdirSync(join(ROOT, dir))) if (!manifest[kind][f.replace(/\.jpg$/, "")]) rmSync(join(ROOT, dir, f));
}

if (todo.length) {
	const { chromium } = await import("playwright").catch(() => createRequire(import.meta.url)("playwright"));
	// CHROME_PATH: use an installed Chrome instead of Playwright's own (local runs).
	const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
	const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
	// In batches, so one page never holds every embedded photo at once.
	for (let i = 0; i < todo.length; i += 12) {
		const batch = todo.slice(i, i + 12);
		await page.setContent(pageHtml(batch), { waitUntil: "load" });
		await page.evaluate(() => document.fonts.ready);
		const cards = await page.$$(".card");
		for (const [k, el] of cards.entries()) {
			mkdirSync(dirname(batch[k].file), { recursive: true });
			await el.screenshot(batch[k].file.endsWith(".png") ? { path: batch[k].file, type: "png" } : { path: batch[k].file, type: "jpeg", quality: 88 });
		}
	}
	await browser.close();
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, "\t") + "\n");
console.log(`og cards: ${todo.length} drawn, ${jobs.length - todo.length} unchanged`);
