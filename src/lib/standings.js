const POINTS_WIN = 3;
const POINTS_DRAW = 1;
const POINTS_LOSS = 0;

// matches: raw match results (src/data/matches.json)
// teams: team list (src/data/teams.json)
// Returns one ranked row per team, computed only from completed matches.
export function computeStandings(matches, teams) {
	const rows = new Map(
		teams.map((team) => [
			team.id,
			{
				team_id: team.id,
				team_name: team.name,
				played: 0,
				wins: 0,
				draws: 0,
				losses: 0,
				goals_for: 0,
				goals_against: 0,
				goal_difference: 0,
				points: 0,
			},
		])
	);

	for (const match of matches) {
		if (match.status !== "completed") continue;

		const home = rows.get(match.home_team_id);
		const away = rows.get(match.away_team_id);
		if (!home || !away) continue;

		home.played += 1;
		away.played += 1;
		home.goals_for += match.home_score;
		home.goals_against += match.away_score;
		away.goals_for += match.away_score;
		away.goals_against += match.home_score;

		if (match.home_score > match.away_score) {
			home.wins += 1;
			home.points += POINTS_WIN;
			away.losses += 1;
			away.points += POINTS_LOSS;
		} else if (match.home_score < match.away_score) {
			away.wins += 1;
			away.points += POINTS_WIN;
			home.losses += 1;
			home.points += POINTS_LOSS;
		} else {
			home.draws += 1;
			away.draws += 1;
			home.points += POINTS_DRAW;
			away.points += POINTS_DRAW;
		}
	}

	const standings = Array.from(rows.values()).map((row) => ({
		...row,
		goal_difference: row.goals_for - row.goals_against,
	}));

	standings.sort((a, b) => {
		if (b.points !== a.points) return b.points - a.points;
		if (b.goal_difference !== a.goal_difference) return b.goal_difference - a.goal_difference;
		if (b.goals_for !== a.goals_for) return b.goals_for - a.goals_for;
		return a.team_name.localeCompare(b.team_name);
	});

	return standings.map((row, index) => ({ rank: index + 1, ...row }));
}
