// "Duos" on the team page (/league/<league>/team/<team_id>): the pairs inside a
// team who have combined for the most goals — one assisted, the other scored.
// Pure functions over goal_events.json, tested by tests/duos.test.mjs.
//
// Direction is deliberately ignored: A setting up B and B setting up A are the
// same duo. Splitting them would file FA26-L2 week 1's 홍지환/이시온 — who scored
// one for each other in the same week — as two separate one-goal pairs, which
// is the opposite of what a "duo" is meant to show, and it halves every count
// so the numbers take twice as long to mean anything.
//
// Everything is per league, like the rest of the site: teams are re-drawn every
// league, so a pair's goals never carry across one.

/** One goal from goal_events.json, as this file reads it. */
export interface DuoGoal {
	league: string;
	team_id: string | null;
	scorer_id: string | null;
	assist_id: string | null;
	own_goal: boolean;
}

export interface Duo {
	/** The two players' ids, in a stable order (sorted), not scorer-then-assister. */
	playerIds: [string, string];
	goals: number;
}

/**
 * A pair needs this many goals together before it is a duo rather than a
 * coincidence. Two is the lowest number that can mean anything: at one goal
 * every assisted goal in the league would be a "duo".
 */
export const DUO_MIN_GOALS = 2;

/**
 * And the team needs this many assisted goals before any pair is shown at all.
 * A team with four assisted goals will have a pair on two, and calling that
 * their best combination says more about the sample than about the players —
 * the same reason the style hexagon waits for MIN_MATCHES. Eight is roughly
 * two weeks of a team's assisted goals.
 */
export const DUO_MIN_TEAM_GOALS = 8;

/** At most this many pairs are shown: the point is the top of the list. */
export const DUO_LIMIT = 3;

/**
 * The team's best duos, most goals first, or an empty list while the team is
 * still under DUO_MIN_TEAM_GOALS — which is also what a league recorded as
 * weekly totals (FA26-L1, no goal_events rows at all) returns for ever.
 *
 * Only goals credited to this team count, and own goals are left out: an own
 * goal moves the score of the team the scorer was playing against, so the pair
 * it would create is not a pair at all. For every other goal the assister is on
 * the same team as the scorer — you cannot assist the other side — so filtering
 * on the credited team is enough to keep a duo inside one team.
 */
export function teamDuos(goals: DuoGoal[], leagueId: string, teamId: string, limit = DUO_LIMIT): Duo[] {
	const assisted = goals.filter(
		(goal) =>
			goal.league === leagueId &&
			goal.team_id === teamId &&
			!goal.own_goal &&
			goal.scorer_id !== null &&
			goal.assist_id !== null &&
			goal.assist_id !== goal.scorer_id,
	);
	if (assisted.length < DUO_MIN_TEAM_GOALS) return [];

	const counts = new Map<string, Duo>();
	for (const goal of assisted) {
		const pair = [goal.scorer_id!, goal.assist_id!].sort() as [string, string];
		const key = pair.join("|");
		const found = counts.get(key);
		if (found) found.goals += 1;
		else counts.set(key, { playerIds: pair, goals: 1 });
	}

	// Ties keep a stable order by player id, so a regeneration never reshuffles
	// two pairs that are level.
	return [...counts.values()]
		.filter((duo) => duo.goals >= DUO_MIN_GOALS)
		.sort((a, b) => b.goals - a.goals || a.playerIds[0].localeCompare(b.playerIds[0]) || a.playerIds[1].localeCompare(b.playerIds[1]))
		.slice(0, limit);
}
