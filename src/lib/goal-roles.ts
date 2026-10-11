// What a goal did to the score. The counts are computed once in the pipeline
// (`_tag_goal_roles` / `_goal_role_counts` in scripts/update_data.py) and land
// on each profile section as `goal_roles`; this file only decides how to say
// them.
//
// **One role per goal.** A goal can hold several — a 1-0 match's only goal is
// both the opener and the winner — and counting each of them made a player who
// scored twice read as three goals on their own profile, which is exactly how
// it was reported. The pipeline picks the most consequential role each goal
// held (ROLE_PRIORITY: winner, comeback, equalizer, opener) and counts it once,
// so these never add up to more goals than the player scored. They can add up
// to fewer: a goal that only extends a lead did nothing to the score and is
// counted under none of them.
//
// They exist only where a league has per-goal records with minutes (FA26-L2
// onward). A league without them has every count at 0, which `hasGoalRoles`
// treats as "nothing to show" rather than printing a row of noughts.

import type { GoalRoles } from "./players";

export const GOAL_ROLE_KEYS = ["opener", "equalizer", "comeback", "winner"] as const;
export type GoalRoleKey = (typeof GOAL_ROLE_KEYS)[number];

export const GOAL_ROLE_LABELS: Record<GoalRoleKey, { en: string; ko: string; title: string; titleKo: string }> = {
	opener: {
		en: "Opening goal",
		ko: "선제골",
		title: "The first goal of a match",
		titleKo: "경기의 첫 골",
	},
	equalizer: {
		en: "Equalizer",
		ko: "동점골",
		title: "Levelled the score after falling behind",
		titleKo: "지고 있다가 동점을 만든 골",
	},
	comeback: {
		en: "Comeback goal",
		ko: "역전골",
		title: "Put the team in front after trailing",
		titleKo: "지고 있던 팀을 앞서게 만든 골",
	},
	winner: {
		en: "Winning goal",
		ko: "결승골",
		title: "The goal the winning team was never caught after",
		titleKo: "이긴 팀이 다시 따라잡히지 않은 골",
	},
};

/** Whether this player has anything worth printing (any role above zero). */
export function hasGoalRoles(roles: GoalRoles | undefined): roles is GoalRoles {
	return !!roles && GOAL_ROLE_KEYS.some((key) => (roles[key] ?? 0) > 0);
}

/** The roles this player actually has, in GOAL_ROLE_KEYS order, zeros dropped. */
export function listGoalRoles(roles: GoalRoles): { key: GoalRoleKey; count: number }[] {
	return GOAL_ROLE_KEYS.filter((key) => (roles[key] ?? 0) > 0).map((key) => ({ key, count: roles[key] }));
}
