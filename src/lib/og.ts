// Per-page link-preview images drawn by scripts/make_og.mjs (see that file).
// src/data/og.json lists which cards exist, each with a short hash that goes
// into the URL, so a redrawn card gets a new address and KakaoTalk & co. don't
// keep showing a cached old one. No entry → undefined → BaseLayout's default.
import og from "../data/og.json";

const manifest = og as { players?: Record<string, string>; leagues?: Record<string, string> };

export function playerOgImage(id: string): string | undefined {
	const v = manifest.players?.[id];
	return v ? `/og/players/${id}.jpg?v=${v}` : undefined;
}

export function leagueOgImage(id: string): string | undefined {
	const v = manifest.leagues?.[id];
	return v ? `/og/league/${id}.jpg?v=${v}` : undefined;
}
