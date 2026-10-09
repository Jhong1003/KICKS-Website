// The strip at the top of the homepage follows the league by itself:
//
//   kickoff  — the newest league has rosters but no result yet:
//              "FA26-L2 kickoff D-1" + its teams
//   week     — it has results: "Week N results · 1st <team> (<pts>) · top
//              scorer that week". During the 7 days up to a Halloween final
//              the page swaps in a "Halloween Final D-n" variant client-side.
//   finale   — the league is finished: the existing gold results banner
//              (LeagueFinaleBanner.astro / src/lib/finale.ts).
//
// Pure functions over already-generated data; tests in
// tests/league-banner.test.mjs. Dates are compared client-side against the
// visitor's own date (D-n), like the homepage's "Next up".

export type BannerMode = "kickoff" | "week" | "finale";

export interface BannerMatch {
	league: string;
	week: number;
	home_score: number | null;
	away_score: number | null;
}

export interface BannerTableRow {
	league: string;
	team_id: string;
	rank: number;
	points: number;
}

export interface BannerProfile {
	id: string;
	name: string;
	status: string;
	leagues: { league: string; weekly_stats: { week: number; goals: number }[] }[];
}

const scored = (m: BannerMatch) => m.home_score !== null && m.away_score !== null;

/**
 * kickoff: no scored match in the league yet. finale: every fixture scored.
 * Otherwise week. (A league with no fixtures at all counts as kickoff.)
 */
export function bannerMode(leagueId: string, matches: BannerMatch[]): BannerMode {
	const own = matches.filter((m) => m.league === leagueId);
	if (!own.some(scored)) return "kickoff";
	return own.every(scored) ? "finale" : "week";
}

export interface WeekSummary {
	week: number;
	/** Rank-1 team(s) of the league table (shared on a full tie). */
	leaders: { teamId: string; points: number }[];
	/** Most goals in that week, shared on a tie; null if nobody scored. */
	topScorers: { players: { id: string; name: string }[]; goals: number } | null;
}

/** The latest week with a scored match, the current leader(s), and that week's top scorer(s). */
export function weekSummary(
	leagueId: string,
	matches: BannerMatch[],
	table: BannerTableRow[],
	profiles: BannerProfile[],
): WeekSummary | null {
	const weeks = matches.filter((m) => m.league === leagueId && scored(m)).map((m) => m.week);
	if (weeks.length === 0) return null;
	const week = Math.max(...weeks);
	const leaders = table
		.filter((row) => row.league === leagueId && row.rank === 1)
		.map((row) => ({ teamId: row.team_id, points: row.points }));

	const goalsThatWeek = profiles
		.filter((p) => p.status !== "inactive")
		.map((p) => {
			const section = p.leagues.find((s) => s.league === leagueId);
			const goals = section?.weekly_stats.filter((w) => w.week === week).reduce((sum, w) => sum + w.goals, 0) ?? 0;
			return { id: p.id, name: p.name, goals };
		});
	const best = Math.max(0, ...goalsThatWeek.map((p) => p.goals));
	const topScorers =
		best > 0
			? {
					goals: best,
					players: goalsThatWeek
						.filter((p) => p.goals === best)
						.map(({ id, name }) => ({ id, name }))
						.sort((a, b) => a.name.localeCompare(b.name, "ko")),
				}
			: null;
	return { week, leaders, topScorers };
}

/** Whole days from `today` to `date` (both "YYYY-MM-DD"); negative once it's past. */
export function daysUntil(date: string, today: string): number {
	const toUtc = (iso: string) => {
		const [y, m, d] = iso.split("-").map(Number);
		return Date.UTC(y, m - 1, d);
	};
	return Math.round((toUtc(date) - toUtc(today)) / 86_400_000);
}

/** "D-3", "D-DAY", or null once the day has passed. */
export function dDayLabel(date: string, today: string): string | null {
	const days = daysUntil(date, today);
	if (days < 0) return null;
	return days === 0 ? "D-DAY" : `D-${days}`;
}

/** How many days before a Halloween final the homepage switches to the Halloween banner. */
export const HALLOWEEN_BANNER_DAYS = 6;
