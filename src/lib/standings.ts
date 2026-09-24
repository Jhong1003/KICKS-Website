import type { RankingCriterion } from "./leagues";

export interface TeamStanding {
	team_id: string;
	points: number;
	participation_rate: number;
	goal_difference: number;
	goals_for: number;
}

export function compareTeams(a: TeamStanding, b: TeamStanding, criteria: RankingCriterion[]): number {
	for (const key of criteria) {
		const difference = b[key] - a[key];
		if (difference !== 0) return difference;
	}
	return 0;
}

export function rankTeams<T extends TeamStanding>(rows: T[], criteria: RankingCriterion[]): (T & { rank: number })[] {
	const ordered = [...rows].sort((a, b) => compareTeams(a, b, criteria));
	let rank = 0;
	return ordered.map((row, index) => {
		if (index === 0 || compareTeams(ordered[index - 1], row, criteria) !== 0) rank = index + 1;
		return { ...row, rank };
	});
}

export function championshipCredits(rows: TeamStanding[], criteria: RankingCriterion[]): Record<string, number> {
	const ranked = rankTeams(rows, criteria);
	const winners = ranked.filter((row) => row.rank === 1);
	return Object.fromEntries(ranked.map((row) => [row.team_id, row.rank === 1 ? 1 / winners.length : 0]));
}
