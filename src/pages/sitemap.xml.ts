// /sitemap.xml for Google Search Console: every public page, built from the
// same data the pages are built from, so new leagues, teams, players and
// gallery albums appear here by themselves. Member-only/link-only pages
// (/benefits, /benefits/admin) are left out and also disallowed in
// public/robots.txt. Paths end in "/" to match the built URLs.
import type { APIRoute } from "astro";
import profiles from "../data/player_profiles.json";
import { leagues } from "../lib/leagues";
import { albums } from "../lib/gallery";

const STATIC_PATHS = [
	"/",
	"/about/",
	"/league/",
	"/players/",
	"/schedule/",
	"/gallery/",
	"/full-matches/",
	"/hall-of-fame/",
	"/partners/",
	"/join/",
	"/dream-team/",
];

export const GET: APIRoute = ({ site }) => {
	const paths = [
		...STATIC_PATHS,
		...leagues.flatMap((league) => [`/league/${league.id}/`, ...league.teams.map((team) => `/league/${league.id}/team/${team.team_id}/`)]),
		...profiles.map((player) => `/players/${player.id}/`),
		...albums.map((album) => `/gallery/${album.id}/`),
	];
	const base = site ?? new URL("https://kicksuiuc.com");
	const urls = paths.map((path) => `  <url><loc>${new URL(path, base).toString()}</loc></url>`).join("\n");
	const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
	return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8" } });
};
