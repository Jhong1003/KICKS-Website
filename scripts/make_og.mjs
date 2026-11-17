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
const antonio = dataUrl(join(ROOT, "report/assets/Antonio.ttf"), "font/ttf");
const montserrat = dataUrl(join(ROOT, "report/assets/Montserrat.ttf"), "font/ttf");
const kr = dataUrl(join(ROOT, "report/assets/NotoSansKR-subset.ttf"), "font/ttf");
const ball = dataUrl(join(ROOT, "report/assets/kicks-ball.png"), "image/png");
// The banner's CHAMPIONS lettering, as an outline (no font needed).
const championsWord = dataUrl(join(ROOT, "report/assets/champions-wordmark.svg"), "image/svg+xml");
const imageMime = (path) => ({ png: "image/png", webp: "image/webp", svg: "image/svg+xml" })[path.split(".").pop().toLowerCase()] ?? "image/jpeg";
const publicImage = (path) => {
	const file = join(ROOT, "public", path);
	return existsSync(file) ? dataUrl(file, imageMime(file)) : null;
};
const logoWhite = publicImage("/kicks-logo-white.jpg");
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
	if (done) return championCard(league, rows);
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


// ---- champion banner (finished league) --------------------------------------------
// The same design as the champion banner made for Instagram: KICKS logo, "FA26 ·
// LEAGUE 2" between gold rules, the gold CHAMPIONS wordmark, the champion's name
// between two bars in its colour, and the partners along a cream strip.
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
	const squad = profiles.filter((p) => shownInLeague(p, league.id) && p.leagues.find((x) => x.league === league.id)?.current_team_id === team.team_id).length;
	const shared = row && table.filter((r) => r.league === league.id && r.rank === row.rank).length > 1;
	const stats = row
		? `<div class="stats">
			<div><b>${shared ? "T-" : ""}${ordinal(row.rank)}</b><small>${done ? "FINAL" : "PLACE"}</small></div>
			<div><b>${row.points}</b><small>POINTS</small></div>
			<div><b>${row.wins}-${row.draws}-${row.losses}</b><small>W-D-L</small></div>
		</div>`
		: "";
	return `<section class="card team">
		<div class="stripe" style="background:${team.color}"></div>
		<div class="info">
			<div class="kicker">${esc(league.id)} · TEAM</div>
			<h1>${esc(team.name)}</h1>
			<div class="team-line">${champ ? `<span class="chip gold">🏆 CHAMPION</span>` : ""}${captain ? `<span class="chip">C · ${esc(captain)}</span>` : ""}${squad ? `<span class="chip">${squad} PLAYERS</span>` : ""}</div>
			${stats}
		</div>
		<div class="disc" style="background:${team.color};color:${textOn(team.color)}">${esc([...team.name][0] ?? "")}</div>
		${brand}
	</section>`;
}

// ---- Wrapped card --------------------------------------------------------------------
// A teaser for /wrapped/<league>/<id>: who and which league, not the slides' contents.
function wrappedCard(p, league) {
	const s = p.leagues.find((x) => x.league === league.id);
	const team = teamOf(league.id, s.current_team_id);
	const champ = (s.badges ?? []).includes("champion");
	const badges = [...s.badges].filter((k) => k !== "own_goal_award").sort((a, b) => badgeRank(a) - badgeRank(b)).map((k) => BADGES[k]?.icon).filter(Boolean).slice(0, 6);
	return `<section class="card wrapped">
		<div class="glow" style="background:radial-gradient(circle at 80% 30%, ${team.color}88, transparent 60%)"></div>
		<div class="info">
			<div class="kicker">KICKS WRAPPED</div>
			<div class="wleague">${esc(league.id)} SEASON RECAP</div>
			<h1>${esc(p.name)}</h1>
			<div class="team"><i style="background:${team.color}"></i><b>${esc(team.name)}</b>${champ ? `<span class="tag gold">🏆 CHAMPION</span>` : ""}</div>
			${badges.length ? `<div class="badges">${badges.map((b) => `<span>${b}</span>`).join("")}</div>` : ""}
		</div>
		<div class="wplay">▶</div>
		${brand}
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
const fmtDate = (d) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).toUpperCase() : "");
function albumCard(a) {
	return `<section class="card album">
		<img class="photo" src="${dataUrl(a.cover, imageMime(a.cover))}" alt="">
		<div class="shade"></div>
		<div class="info">
			<div class="kicker">KICKS GALLERY${a.date ? ` · ${fmtDate(a.date)}` : ""}</div>
			<h1>${esc(a.titleKo)}</h1>
			${a.titleKo !== a.title ? `<div class="sub">${esc(a.title)}</div>` : ""}
			<div class="count">📷 ${a.count} PHOTOS</div>
		</div>
		${brand}
	</section>`;
}

// ---- other pages ---------------------------------------------------------------------
// One card per page: a label, the page's English title and its Korean name, and on
// the right whatever shows the page best (game stills, partner logos, champions,
// album covers). Keys match pageOgImage(<key>) calls in src/pages.
function pageCard({ kicker, title, ko, side = "", photo = "" }) {
	return `<section class="card page${side ? " has-side" : ""}${photo ? " has-photo" : ""}${side.includes('class="side squads"') ? " has-squads" : ""}">
		${photo ? `<img class="photo" src="${photo}" alt=""><div class="shade"></div>` : ""}
		<div class="info">
			<div class="kicker">${esc(kicker)}</div>
			<h1>${esc(title)}</h1>
			${ko ? `<div class="ko">${esc(ko)}</div>` : ""}
		</div>
		${side}
		${brand}
	</section>`;
}
const season = leagues.at(-1)?.id.split("-")[0] ?? "";
function pageCards() {
	const still = (path) => {
		const img = publicImage(path);
		return img ? `<img class="side still" src="${img}" alt="">` : "";
	};
	const logoGrid = `<div class="side logos">${partners.map((p) => publicImage(p.logo)).filter(Boolean).map((l) => `<span><img src="${l}" alt=""></span>`).join("")}</div>`;
	const finished = leagues.filter((l) => isFinished(l.id)).reverse();
	const honours = finished.length
		? `<div class="side honours">${finished.slice(0, 3).map((l) => {
				const champs = table.filter((r) => r.league === l.id && r.rank === 1).map((r) => teamOf(l.id, r.team_id));
				return `<div class="hrow"><small>${esc(l.id)}</small><b>🏆 ${champs.map((t) => `<i style="background:${t.color}"></i>${esc(t.name)}`).join(" ")}</b></div>`;
			}).join("")}</div>`
		: "";
	const covers = albums().slice(0, 3);
	const collage = covers.length ? `<div class="side collage">${covers.map((a) => `<img src="${dataUrl(a.cover, imageMime(a.cover))}" alt="">`).join("")}</div>` : "";
	const assetPhoto = (p) => (existsSync(join(ROOT, p)) ? dataUrl(join(ROOT, p), imageMime(p)) : "");
	// Schedule: the next three dates on schedule.json (Chicago date at draw time; the
	// workflow redraws several times a day, so it moves on by itself), or the last
	// three once the season is over. English titles: the embedded Korean font is a subset.
	const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
	const dated = schedule.filter((e) => e.date).sort((a, b) => a.date.localeCompare(b.date));
	const upcoming = dated.filter((e) => e.date >= today);
	// Four rows: what's next, with the latest past dates (faded) filling the rest.
	const next = dated.findIndex((e) => e.date >= today);
	const from = next === -1 ? Math.max(0, dated.length - 4) : Math.max(0, Math.min(next - 4 + Math.min(upcoming.length, 4), dated.length - 4));
	const shown = dated.slice(from, from + 4);
	const md = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).toUpperCase().split(" ");
	const scheduleSide = shown.length
		? `<div class="side agenda"><small>${upcoming.length ? "COMING UP" : "SEASON WRAPPED"}</small>${shown.map((e) => {
				const [mon, day] = md(e.date);
				return `<div class="arow${e.date < today ? " past" : ""}"><span class="adate"><em>${mon}</em><b>${day}</b></span><span class="atitle">${esc(e.title)}</span></div>`;
			}).join("")}</div>`
		: "";
	// Players: the current league's roster (used for the team columns below).
	const current = [...leagues].reverse().find((l) => profiles.some((p) => p.leagues.some((x) => x.league === l.id)));
	const roster = current
		? profiles.filter((p) => p.status !== "inactive" && p.leagues.some((x) => x.league === current.id)).sort((a, b) => a.name.localeCompare(b.name, "ko"))
		: [];
	// The whole roster, one column per team (team colour, name, captain first with a
	// C, then everyone else in name order — never by a stat, same as /players).
	const rosterSide = current && roster.length
		? `<div class="side squads">${current.teams.map((t) => {
				const captain = teamInfo[current.id]?.[t.team_id]?.captain;
				const names = roster.filter((p) => p.leagues.find((x) => x.league === current.id).current_team_id === t.team_id).map((p) => p.name);
				const ordered = [...names.filter((n) => n === captain), ...names.filter((n) => n !== captain)];
				return `<div class="squad"><div class="shead" style="background:${t.color};color:${textOn(t.color)}">${esc(t.name)}</div><ul>${ordered.map((n) => `<li>${esc(n)}${n === captain ? "<em>C</em>" : ""}</li>`).join("")}</ul></div>`;
			}).join("")}</div>`
		: "";
	// Dream Team: an empty 7-a-side pitch waiting to be filled.
	const spots = [[50, 88], [30, 68], [70, 68], [20, 44], [50, 48], [80, 44], [50, 20]];
	const pitch = `<div class="side pitch"><i class="half"></i><i class="circle"></i><i class="box"></i>${spots.map(([x, y]) => `<span style="left:${x}%;top:${y}%">+</span>`).join("")}</div>`;
	// App: a phone with the home-screen icon.
	const icon = publicImage("/icons/icon-512.png");
	const phone = icon ? `<div class="side phone"><div class="screen"><img src="${icon}" alt=""><b>KICKS</b></div></div>` : "";
	return {
		about: { kicker: "ABOUT", title: "About KICKS", ko: "UIUC 한인 풋살 동아리", side: logoWhite ? `<img class="side brandmark" src="${logoWhite}" alt="">` : "" },
		schedule: { kicker: `${season} SEASON`, title: "Schedule", ko: "시즌 일정", side: scheduleSide },
		players: { kicker: current ? `${current.id} · PLAYERS` : "PLAYERS", title: "Meet the Roster", ko: "KICKS 선수단", side: rosterSide },
		join: { kicker: "JOIN KICKS", title: "Ready to play?", ko: "멤버 모집", photo: assetPhoto("src/assets/hero.jpg") },
		partners: { kicker: "PARTNERS", title: "Our Partners", ko: "KICKS와 함께하는 곳", side: logoGrid },
		"hall-of-fame": { kicker: "HALL OF FAME", title: "Hall of Fame", ko: "명예의 전당", side: honours },
		gallery: { kicker: "GALLERY", title: "Moments from the pitch.", ko: "KICKS의 순간들", side: collage },
		"full-matches": { kicker: "🔒 MEMBERS ONLY", title: "Full Matches", ko: "경기 풀영상", photo: assetPhoto("src/assets/about.jpg"), side: `<div class="side play">▶</div>` },
		"dream-team": { kicker: "MY KICKS XI", title: "Dream Team", ko: "나만의 드림팀 만들기", side: pitch },
		app: { kicker: "KICKS APP", title: "KICKS on your home screen", ko: "KICKS 앱 설치하기", side: phone },
		keeper: { kicker: "MINI GAME", title: "Keeper Challenge", ko: "골키퍼 챌린지", side: still("/keeper/card.webp") },
		freekick: { kicker: "MINI GAME", title: "Free Kick Challenge", ko: "프리킥 챌린지", side: still("/freekick/card.webp") },
	};
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
/* champion banner */
.champion { background: #23311a; }
.champion .clogo { position: absolute !important; left: 50%; top: 40px; width: 300px; transform: translateX(-50%); }
.champion .cleague { position: absolute !important; left: 0; right: 0; top: 190px; display: flex; align-items: center; justify-content: center; gap: 26px; }
.champion .cleague i { width: 158px; height: 2px; background: #e2b94a; }
.champion .cleague span { font-family: Montserrat, sans-serif; font-size: 23px; font-weight: 700; letter-spacing: .3em; color: #e8e5d6; margin-right: -.3em; }
.champion .cword { position: absolute !important; left: 50%; top: 232px; width: 994px; transform: translateX(-50%); }
.champion .cnames { position: absolute !important; left: 0; right: 0; top: 352px; display: flex; justify-content: center; gap: 48px; }
.champion .cname { display: flex; align-items: center; gap: 30px; }
.champion .cname i { width: 88px; height: 10px; border-radius: 5px; }
.champion .cname b { font-size: 66px; font-weight: 800; line-height: 1; }
.champion .cstrip { position: absolute !important; left: 0; right: 0; bottom: 0; height: 120px; background: #f4f1e8; color: #22301a; text-align: center; }
.champion .cstrip small { display: block; margin-top: 14px; font-family: Montserrat, sans-serif; font-size: 14px; font-weight: 800; letter-spacing: .32em; }
.champion .cstrip div { display: flex; align-items: center; justify-content: space-evenly; height: 76px; padding: 0 60px; }
.champion .cstrip img { max-height: 58px; max-width: 165px; object-fit: contain; }
/* team */
.team .stripe { position: absolute !important; left: 0; top: 0; bottom: 0; width: 18px; }
.team .info { position: absolute !important; left: 64px; top: 58px; width: 720px; }
.team h1 { margin-top: 6px; font-size: 118px; font-weight: 800; line-height: 1.1; white-space: nowrap; }
.team .team-line { display: flex; gap: 14px; margin-top: 12px; }
.chip, .tag.gold { font-family: Antonio, sans-serif; font-size: 28px; font-weight: 700; letter-spacing: .08em; padding: 4px 16px; border-radius: 8px; background: rgba(255,255,255,.14); }
.chip.gold, .tag.gold { background: #e8c766; color: #2a2a12; }
.team .stats { display: flex; gap: 56px; margin-top: 34px; }
.team .stats b { display: block; font-family: Antonio, sans-serif; font-size: 92px; font-weight: 700; line-height: 1; }
.team .stats small { display: block; margin-top: 6px; font-family: Antonio, sans-serif; font-size: 24px; font-weight: 700; letter-spacing: .2em; color: #d6dfcf; }
.team .disc { position: absolute !important; right: 84px; top: 140px; width: 280px; height: 280px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
	font-size: 150px; font-weight: 800; border: 8px solid rgba(255,255,255,.9); box-shadow: 0 12px 40px rgba(0,0,0,.45); }
.team .brand { left: auto; right: 84px; }
/* wrapped */
.wrapped { background: #1d2815; }
.wrapped .glow { position: absolute !important; inset: 0; }
.wrapped .info { position: absolute !important; left: 64px; top: 58px; width: 820px; }
.wrapped .kicker { color: #e8c766; font-size: 34px; }
.wrapped .wleague { margin-top: 6px; font-family: Antonio, sans-serif; font-size: 30px; font-weight: 700; letter-spacing: .14em; color: #d6dfcf; }
.wrapped h1 { margin-top: 18px; font-size: 120px; font-weight: 800; line-height: 1.1; white-space: nowrap; }
.wrapped .team { display: flex; align-items: center; gap: 16px; margin-top: 10px; font-size: 38px; }
.wrapped .team i { width: 12px; height: 42px; border-radius: 3px; }
.wrapped .badges { display: flex; gap: 12px; margin-top: 30px; font-size: 46px; }
.wrapped .wplay { position: absolute !important; right: 96px; top: 190px; width: 190px; height: 190px; border-radius: 50%; background: rgba(255,255,255,.95); color: #1d2815;
	display: flex; align-items: center; justify-content: center; font-size: 84px; padding-left: 14px; box-shadow: 0 12px 40px rgba(0,0,0,.45); }
.wrapped .brand { left: auto; right: 84px; }
/* album */
.album .photo { position: absolute !important; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.album .shade { position: absolute !important; inset: 0; background: linear-gradient(90deg, rgba(20,28,12,.88) 0%, rgba(20,28,12,.6) 50%, rgba(20,28,12,.1) 100%); }
.album .info { position: absolute !important; left: 64px; top: 64px; width: 760px; }
.album .kicker { color: #e8c766; }
.album h1 { margin-top: 14px; font-size: 76px; font-weight: 800; line-height: 1.15; }
.album .sub { margin-top: 10px; font-family: Montserrat, sans-serif; font-size: 28px; font-weight: 600; color: #d6dfcf; }
.album .count { margin-top: 22px; font-family: Antonio, sans-serif; font-size: 30px; font-weight: 700; letter-spacing: .1em; }
/* generic page */
.page .info { position: absolute !important; left: 64px; top: 40px; bottom: 120px; width: 640px; display: flex; flex-direction: column; justify-content: center; }
.page.has-side .info { width: 540px; }
.page.has-side h1 { font-size: 70px; }
.page .photo { position: absolute !important; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.page .shade { position: absolute !important; inset: 0; background: linear-gradient(90deg, rgba(20,28,12,.9) 0%, rgba(20,28,12,.55) 55%, rgba(20,28,12,.15) 100%); }
.page .agenda { top: 60px; width: 540px; padding: 18px 30px 10px; background: #fff; color: #111; border-radius: 14px; box-shadow: 0 12px 40px rgba(0,0,0,.45); }
.page .agenda small { font-family: Antonio, sans-serif; font-size: 24px; font-weight: 700; letter-spacing: .16em; color: #777; }
.page .arow { display: flex; align-items: center; gap: 22px; padding: 14px 0; border-top: 2px solid #ececec; }
.page .agenda small + .arow { border-top: 0; }
.page .arow.past { opacity: .4; }
.page .adate { flex: none; width: 76px; text-align: center; font-family: Antonio, sans-serif; line-height: 1; }
.page .adate em { display: block; font-style: normal; font-size: 22px; font-weight: 700; letter-spacing: .1em; color: #3f5128; }
.page .adate b { display: block; font-size: 52px; font-weight: 700; }
.page .atitle { font-family: Montserrat, sans-serif; font-size: 25px; font-weight: 700; line-height: 1.25; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.page .squads { top: 50px; right: 48px; display: flex; gap: 14px; }
.page .squad { width: 212px; background: #fff; color: #111; border-radius: 14px; overflow: hidden; box-shadow: 0 12px 40px rgba(0,0,0,.45); }
.page .shead { padding: 12px 16px; font-size: 27px; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.page .squad ul { list-style: none; padding: 8px 16px 12px; }
.page .squad li { display: flex; align-items: center; gap: 8px; height: 40px; font-size: 26px; font-weight: 700; border-top: 1px solid #eee; }
.page .squad li:first-child { border-top: 0; }
.page .squad em { font-style: normal; font-family: Antonio, sans-serif; font-size: 18px; font-weight: 700; padding: 0 7px; border-radius: 5px; background: #111; color: #fff; }
.page.has-squads .info { width: 400px; }
.page .pitch { top: 60px; width: 400px; height: 450px; right: 110px; border: 4px solid rgba(255,255,255,.85); border-radius: 10px; background: repeating-linear-gradient(180deg, #4d6432 0 56px, #46602d 56px 112px); box-shadow: 0 12px 40px rgba(0,0,0,.4); }
.page .pitch i { position: absolute; border: 3px solid rgba(255,255,255,.7); }
.page .pitch .half { left: 0; right: 0; top: 50%; border-width: 3px 0 0; }
.page .pitch .circle { left: 50%; top: 50%; width: 110px; height: 110px; border-radius: 50%; transform: translate(-50%, -50%); }
.page .pitch .box { left: 50%; bottom: -3px; width: 190px; height: 70px; transform: translateX(-50%); border-bottom: 0; }
.page .pitch span { position: absolute; width: 64px; height: 64px; transform: translate(-50%, -50%); border-radius: 50%; border: 3px dashed rgba(255,255,255,.9); background: rgba(0,0,0,.18);
	display: flex; align-items: center; justify-content: center; font-family: Montserrat, sans-serif; font-size: 36px; font-weight: 700; color: #fff; }
.page .phone { top: 34px; right: 150px; width: 270px; height: 540px; padding: 14px; border-radius: 44px; background: #111; box-shadow: 0 16px 40px rgba(0,0,0,.5); }
.page .phone .screen { width: 100%; height: 100%; border-radius: 32px; background: linear-gradient(160deg, #6d8a4a, #2c3b1c); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; }
.page .phone img { width: 120px; height: 120px; border-radius: 28px; box-shadow: 0 8px 24px rgba(0,0,0,.4); }
.page .phone b { font-family: Montserrat, sans-serif; font-size: 26px; font-weight: 700; }
.page .play { top: 200px; right: 150px; width: 200px; height: 200px; border-radius: 50%; background: rgba(255,255,255,.95); color: #1d2815; display: flex; align-items: center; justify-content: center; font-size: 88px; padding-left: 14px; box-shadow: 0 12px 40px rgba(0,0,0,.5); }
.page .kicker { color: #e8c766; }
.page h1 { margin-top: 12px; font-family: Montserrat, sans-serif; font-size: 76px; font-weight: 900; line-height: 1.05; letter-spacing: -.01em; }
.page .ko { margin-top: 20px; font-size: 40px; font-weight: 700; color: #e6ecdf; }
.page .side { position: absolute !important; right: 64px; top: 70px; }
.page .still { width: 500px; height: 375px; object-fit: cover; border-radius: 18px; border: 6px solid rgba(255,255,255,.9); box-shadow: 0 12px 40px rgba(0,0,0,.45); top: 110px; }
.page .brandmark { width: 500px; top: 200px; }
.page .logos { top: 90px; width: 500px; display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.page .logos span { display: flex; align-items: center; justify-content: center; height: 132px; padding: 18px 26px; background: #fff; border-radius: 14px; }
.page .logos img { max-width: 100%; max-height: 100%; object-fit: contain; }
.page .logos span:last-child:nth-child(odd) { grid-column: 1 / -1; }
.page .honours { top: 110px; width: 520px; padding: 14px 32px; background: #fff; color: #111; border-radius: 14px; box-shadow: 0 12px 40px rgba(0,0,0,.45); }
.page .hrow { padding: 18px 0; border-top: 2px solid #ececec; }
.page .hrow:first-child { border-top: 0; }
.page .hrow small { display: block; font-family: Antonio, sans-serif; font-size: 26px; font-weight: 700; letter-spacing: .14em; color: #777; }
.page .hrow b { display: flex; align-items: center; gap: 12px; margin-top: 4px; font-size: 44px; font-weight: 800; }
.page .hrow i { width: 12px; height: 44px; border-radius: 3px; }
.page .collage { top: 60px; width: 520px; height: 420px; }
.page .collage img { position: absolute; width: 340px; height: 240px; object-fit: cover; border-radius: 14px; border: 6px solid #fff; box-shadow: 0 12px 30px rgba(0,0,0,.45); }
.page .collage img:nth-child(1) { right: 0; top: 0; transform: rotate(4deg); }
.page .collage img:nth-child(2) { left: 0; top: 110px; transform: rotate(-5deg); }
.page .collage img:nth-child(3) { right: 30px; top: 190px; transform: rotate(2deg); }
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
const manifest = { _readme: 'Generated by scripts/make_og.mjs (workflow "Make Report Slides"). Don\'t hand-edit.', ...Object.fromEntries(Object.keys(KINDS).map((k) => [k, {}])) };
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
			await el.screenshot({ path: batch[k].file, type: "jpeg", quality: 88 });
		}
	}
	await browser.close();
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, "\t") + "\n");
console.log(`og cards: ${todo.length} drawn, ${jobs.length - todo.length} unchanged`);
