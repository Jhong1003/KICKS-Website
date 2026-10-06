// Team page numbers (/league/<league>/team/<team_id>), all within one league:
// teams are re-drawn every league, so nothing here crosses leagues. Pure
// functions over already-generated data (matches.json, player_profiles.json
// weekly_stats); the points/ranking rules stay in scripts/update_data.py.

export interface TeamMatch {
	league: string;
	match_id: string;
	week: number;
	round: number;
	home_team_id: string | null;
	away_team_id: string | null;
	home_score: number | null;
	away_score: number | null;
}

export type Result = "W" | "D" | "L";

export interface TeamResult {
	match_id: string;
	week: number;
	round: number;
	opponentId: string | null;
	ours: number;
	theirs: number;
	result: Result;
}

/** This team's scored matches in one league, oldest first (week, round, match id). */
export function teamResults(matches: TeamMatch[], leagueId: string, teamId: string): TeamResult[] {
	return matches
		.filter((m) => m.league === leagueId && (m.home_team_id === teamId || m.away_team_id === teamId))
		.filter((m) => m.home_score !== null && m.away_score !== null)
		.sort((a, b) => a.week - b.week || a.round - b.round || a.match_id.localeCompare(b.match_id))
		.map((m) => {
			const home = m.home_team_id === teamId;
			const ours = (home ? m.home_score : m.away_score) as number;
			const theirs = (home ? m.away_score : m.home_score) as number;
			return {
				match_id: m.match_id,
				week: m.week,
				round: m.round,
				opponentId: home ? m.away_team_id : m.home_team_id,
				ours,
				theirs,
				result: ours > theirs ? "W" : ours < theirs ? "L" : "D",
			};
		});
}

/** The last `count` results, oldest first (so it reads left to right). */
export function recentForm(results: TeamResult[], count = 6): TeamResult[] {
	return results.slice(-count);
}

export interface HeadToHead {
	opponentId: string;
	played: number;
	W: number;
	D: number;
	L: number;
	goalsFor: number;
	goalsAgainst: number;
}

/** Record against each opponent this league, in the given opponent order. */
export function headToHead(results: TeamResult[], opponentIds: string[]): HeadToHead[] {
	return opponentIds.map((opponentId) => {
		const games = results.filter((r) => r.opponentId === opponentId);
		return {
			opponentId,
			played: games.length,
			W: games.filter((r) => r.result === "W").length,
			D: games.filter((r) => r.result === "D").length,
			L: games.filter((r) => r.result === "L").length,
			goalsFor: games.reduce((sum, r) => sum + r.ours, 0),
			goalsAgainst: games.reduce((sum, r) => sum + r.theirs, 0),
		};
	});
}

export interface TeamRecords {
	cleanSheets: number;
	/** Largest winning margin; every match sharing it (ties shown together). Empty without a win. */
	biggestWins: TeamResult[];
	/** Longest run of consecutive wins (0 without a win). */
	longestWinStreak: number;
	/** Longest run without a loss (0 if every match was lost). */
	longestUnbeaten: number;
}

function longestRun(results: TeamResult[], keep: (r: TeamResult) => boolean): number {
	let best = 0;
	let current = 0;
	for (const r of results) {
		current = keep(r) ? current + 1 : 0;
		best = Math.max(best, current);
	}
	return best;
}

export function teamRecords(results: TeamResult[]): TeamRecords {
	const wins = results.filter((r) => r.result === "W");
	const margin = Math.max(0, ...wins.map((r) => r.ours - r.theirs));
	return {
		cleanSheets: results.filter((r) => r.theirs === 0).length,
		biggestWins: wins.filter((r) => r.ours - r.theirs === margin),
		longestWinStreak: longestRun(results, (r) => r.result === "W"),
		longestUnbeaten: longestRun(results, (r) => r.result !== "L"),
	};
}

export interface WeeklyStatLike {
	week: number;
	team_id: string;
	goals: number;
	assists: number;
}

export interface LeaderCandidate {
	playerId: string;
	weekly: WeeklyStatLike[];
}

export interface TeamLeaders {
	goals: { value: number; playerIds: string[] };
	assists: { value: number; playerIds: string[] };
}

/**
 * Most goals / assists *for this team*: only weeks a player spent on it
 * count, so someone who moved mid-league is credited to each team for their
 * own weeks. Ties share the spot; nobody leads at 0.
 */
export function teamLeaders(candidates: LeaderCandidate[], teamId: string): TeamLeaders {
	const totals = candidates.map(({ playerId, weekly }) => {
		const here = weekly.filter((w) => w.team_id === teamId);
		return {
			playerId,
			goals: here.reduce((sum, w) => sum + w.goals, 0),
			assists: here.reduce((sum, w) => sum + w.assists, 0),
		};
	});
	const lead = (key: "goals" | "assists") => {
		const value = Math.max(0, ...totals.map((t) => t[key]));
		return { value, playerIds: value > 0 ? totals.filter((t) => t[key] === value).map((t) => t.playerId) : [] };
	};
	return { goals: lead("goals"), assists: lead("assists") };
}
