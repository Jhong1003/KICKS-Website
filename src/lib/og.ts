// Per-page link-preview images drawn by scripts/make_og.mjs (see that file).
// src/data/og.json lists which cards exist, each with a short hash that goes
// into the URL, so a redrawn card gets a new address and KakaoTalk & co. don't
// keep showing a cached old one. No entry → undefined → BaseLayout's default.
import og from "../data/og.json";

type Kind = "players" | "leagues" | "teams" | "wrapped" | "albums" | "pages";
const manifest = og as Partial<Record<Kind | "home", Record<string, string>>>;
const DIRS: Record<Kind, string> = { players: "players", leagues: "league", teams: "team", wrapped: "wrapped", albums: "album", pages: "page" };

function card(kind: Kind, id: string): string | undefined {
	const v = manifest[kind]?.[id];
	return v ? `/og/${DIRS[kind]}/${id}.jpg?v=${v}` : undefined;
}

export const playerOgImage = (id: string) => card("players", id);
/** The league table while it runs; the CHAMPIONS banner once it's finished. */
export const leagueOgImage = (id: string) => card("leagues", id);
export const teamOgImage = (league: string, team: string) => card("teams", `${league}-${team}`);
export const wrappedOgImage = (league: string, id: string) => card("wrapped", `${league}-${id}`);
export const albumOgImage = (id: string) => card("albums", id);
/** Keys: about, schedule, players, join, partners, hall-of-fame, gallery, full-matches, dream-team, app, keeper, freekick. */
export const pageOgImage = (key: string) => card("pages", key);
/** The homepage card (public/og-image.png), with its hash so a redraw gets a new URL. */
export const homeOgImage = () => `/og-image.png${manifest.home?.home ? `?v=${manifest.home.home}` : ""}`;
