// Winning goals on a player page — the stat K League, MLS and the rest keep as
// GWG, next to goals and assists.
//
// A winning goal is the one the winning team was never caught after: their
// (loser's final score + 1)-th. In a 2-0 that is the *first* goal, not the
// second — the match was decided when it went in and the rest padded the
// score. `_tag_goal_roles` in scripts/update_data.py works that out when it
// replays each match, and tags it on the row in goal_events.json.
//
// The pipeline also tags openers, equalizers and comeback goals, and those are
// kept in the data, but **they don't go on a profile**. Two ways of counting
// them were shipped and both were wrong: counting every role a goal held made
// a two-goal player read as three (a 1-0's only goal is both the opener and
// the winner), and counting one role per goal then hid that another player's
// three goals had all been openers. The official leagues count the winner and
// nothing else, which has neither problem.

/** One row of goal_events.json, as this needs it. */
export interface RoleGoal {
	league: string;
	scorer_id: string;
	own_goal: boolean;
	roles: string[];
}

/**
 * How many winning goals a player scored in one league.
 *
 * 0 for a league recorded without per-goal minutes (all of FA26-L1), since
 * nothing can be replayed there — which is also 0 for most players in a league
 * that does have them, so the page leaves the line out rather than printing it.
 */
export function winningGoals(goals: RoleGoal[], leagueId: string, playerId: string): number {
	return goals.filter(
		(goal) =>
			goal.league === leagueId && goal.scorer_id === playerId && !goal.own_goal && goal.roles.includes("winner"),
	).length;
}
