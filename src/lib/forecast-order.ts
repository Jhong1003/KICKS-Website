// Show a week's match forecasts in the same order (and the same home/away
// way round) as that week's fixtures on the Sheet, e.g. 노·파 / 파·빨 / 빨·노.
// Display only: forecasts/forecasts.csv stores each pairing once with the
// team ids in id order, and stays exactly as published.

export interface OrderableRow {
	pA: number;
	pB: number;
}

export interface OrderablePairing<R extends OrderableRow> {
	teamA: string;
	teamB: string;
	rows: R[];
}

export interface Fixture {
	league: string;
	week: number;
	round: number;
	match_id: string;
	home_team_id: string | null;
	away_team_id: string | null;
}

/**
 * Pairings sorted by where they first appear in the league week's fixtures
 * (round, then match id), each turned so teamA is that fixture's home team
 * (pA/pB swapped with it). Pairings with no fixture keep their order at the end.
 */
export function orderLikeFixtures<R extends OrderableRow>(
	pairings: OrderablePairing<R>[],
	fixtures: Fixture[],
	leagueId: string,
	week: number,
): OrderablePairing<R>[] {
	const ordered = fixtures
		.filter((f) => f.league === leagueId && f.week === week && f.home_team_id && f.away_team_id)
		.sort((a, b) => a.round - b.round || a.match_id.localeCompare(b.match_id));
	const placed = pairings.map((pairing, original) => {
		const index = ordered.findIndex(
			(f) =>
				(f.home_team_id === pairing.teamA && f.away_team_id === pairing.teamB) ||
				(f.home_team_id === pairing.teamB && f.away_team_id === pairing.teamA),
		);
		if (index === -1) return { pairing, index: Number.POSITIVE_INFINITY, original };
		if (ordered[index].home_team_id === pairing.teamA) return { pairing, index, original };
		const flipped: OrderablePairing<R> = {
			teamA: pairing.teamB,
			teamB: pairing.teamA,
			rows: pairing.rows.map((row) => ({ ...row, pA: row.pB, pB: row.pA })),
		};
		return { pairing: flipped, index, original };
	});
	return placed.sort((a, b) => a.index - b.index || a.original - b.original).map((entry) => entry.pairing);
}
