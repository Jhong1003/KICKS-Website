// The numbers behind the weekly Instagram report (/report/<league>/<week>).
// Pure functions over the generated JSON — the page only lays them out, so a
// week's post is whatever the Sheet already says and nothing is retyped.

export interface ReportMatch {
	round: number;
	home: string;
	away: string;
	homeColor: string;
	awayColor: string;
	homeScore: number;
	awayScore: number;
	goals: { minute: number; scorer: string; color: string }[];
}

export interface ReportRow {
	rank: number;
	team: string;
	color: string;
	played: number;
	wins: number;
	draws: number;
	losses: number;
	points: number;
}

export interface ReportLeader {
	name: string;
	color: string;
	value: number;
}

/** A colour's name, for the small label under a team in the table. */
const COLOR_NAMES: Record<string, string> = {
	"#e03131": "RED",
	"#1c7ed6": "BLUE",
	"#b8860b": "GOLD",
};

export const colorName = (hex: string) => COLOR_NAMES[hex.toLowerCase()] ?? "";

/**
 * Top `limit` by `value`, ties broken by name so the order never wobbles
 * between runs. Players on 0 are left out: a leaderboard of noughts says
 * nothing. Seven is what fills a column of the slide — five left the panel
 * looking half empty, and more than seven starts crowding the names.
 */
export function topBy<T extends { name: string; color: string }>(
	rows: (T & { value: number })[],
	limit = 7,
): (T & { value: number; rank: number })[] {
	const ranked = rows
		.filter((row) => row.value > 0)
		.sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
		.slice(0, limit);
	// Competition ranks: equal values share a number, the next one skips.
	let rank = 0;
	let previous: number | null = null;
	return ranked.map((row, index) => {
		if (row.value !== previous) {
			rank = index + 1;
			previous = row.value;
		}
		return { ...row, rank };
	});
}

/** Goals per minute of the match, for the goal-times slide. */
export function minuteCounts(minutes: number[], matchMinutes: number) {
	const counts = Array.from({ length: matchMinutes }, (_, i) => ({ minute: i + 1, goals: 0 }));
	for (const minute of minutes) {
		if (minute >= 1 && minute <= matchMinutes) counts[minute - 1].goals += 1;
	}
	return counts;
}
