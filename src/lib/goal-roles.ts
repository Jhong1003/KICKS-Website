// What a player's goals did to the score, for the "Goals that mattered" block
// on a player page. The roles are worked out once in the pipeline
// (`_tag_goal_roles` in scripts/update_data.py) and travel on each row of
// goal_events.json; this file only picks out one player's and says them.
//
// **One line per goal, never a count per role.** A goal can hold two roles — a
// 1-0 match's only goal is both the opener and the winner. Counting every role
// made a player who scored twice read as three goals; counting one role per
// goal then hid that another player's three goals were all openers. Both were
// shipped and both were spotted from the site within the hour. A goal per line
// with its roles beside it has neither problem: the lines count the goals, and
// nothing is dropped.

export const GOAL_ROLE_KEYS = ["opener", "equalizer", "comeback", "winner"] as const;
export type GoalRoleKey = (typeof GOAL_ROLE_KEYS)[number];

export const GOAL_ROLE_LABELS: Record<GoalRoleKey, { en: string; ko: string }> = {
	opener: { en: "Opening goal", ko: "선제골" },
	equalizer: { en: "Equalizer", ko: "동점골" },
	comeback: { en: "Comeback goal", ko: "역전골" },
	winner: { en: "Winning goal", ko: "결승골" },
};

/** One row of goal_events.json, as this block needs it. */
export interface RoleGoal {
	league: string;
	week: number;
	minute: number | null;
	scorer_id: string;
	own_goal: boolean;
	roles: string[];
}

export interface KeyGoal {
	week: number;
	minute: number | null;
	roles: GoalRoleKey[];
}

/**
 * One player's goals in one league that did something to the score, oldest
 * first. A goal that only extended a lead did nothing and is left out, so this
 * is usually shorter than their goal total and never longer. Own goals never
 * appear: they move the score, but not for the player who put one in.
 *
 * Empty for a league recorded without per-goal minutes (all of FA26-L1), which
 * is how the page knows to leave the block out rather than print a heading
 * over nothing.
 */
export function keyGoals(goals: RoleGoal[], leagueId: string, playerId: string): KeyGoal[] {
	return goals
		.filter((goal) => goal.league === leagueId && goal.scorer_id === playerId && !goal.own_goal)
		.map((goal) => ({
			week: goal.week,
			minute: goal.minute,
			// GOAL_ROLE_KEYS order, so a goal that was both always reads the
			// same way round.
			roles: GOAL_ROLE_KEYS.filter((key) => goal.roles.includes(key)),
		}))
		.filter((goal) => goal.roles.length > 0)
		.sort((a, b) => a.week - b.week || (a.minute ?? 0) - (b.minute ?? 0));
}
