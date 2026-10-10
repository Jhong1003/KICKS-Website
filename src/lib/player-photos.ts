// Optional real player photos, from hand-edited src/data/player-photos.json,
// keyed by the player's URL slug (`id`, not the Sheet's P001 player_id).
// A value is either a path ("/players/x.jpg": the small square photo in the
// avatar circle) or { "card": ..., "portrait": ... }, where "portrait" is a
// tall 4:5 photo shown big on that player's own page instead of the circle.
// Files live in public/players/. Missing = initials on the team color.
import photosData from "../data/player-photos.json";

export interface PlayerPhotos {
	card?: string;
	portrait?: string;
}

type Entry = string | PlayerPhotos;

const photos = photosData as unknown as Record<string, Entry>;

export function getPlayerPhotos(id: string): PlayerPhotos {
	const entry = id.startsWith("_") ? undefined : photos[id];
	if (!entry) return {};
	return typeof entry === "string" ? { card: entry } : entry;
}
