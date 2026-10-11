// Goals laid out on the clock: the per-match timeline under each result, and
// the league's goal clock (how the league's goals spread across the 12
// minutes). Both read goal_events.json, which only has rows for leagues
// recorded goal by goal, with minutes (FA26-L2 onward) — see AGENTS.md's
// "Goal events". Everything here is per league, like the rest of the site.

/** One row of goal_events.json, as these two views need it. */
export interface TimelineGoal {
	league: string;
	match_id: string;
	minute: number | null;
	scorer_id: string;
	assist_id: string | null;
	own_goal: boolean;
	team_id: string | null;
	roles: string[];
}

/** One goal on a match's timeline, ready to render. */
export interface TimelineEntry {
	minute: number;
	/** 0..1 across the match, for placing the dot. */
	at: number;
	scorer: string;
	assist: string | null;
	ownGoal: boolean;
	teamId: string | null;
	/** Shown as a small mark next to the scorer; "" when the goal was routine. */
	role: "winner" | "equalizer" | "comeback" | null;
}

/**
 * Goals per match for one league, keyed by match_id, in minute order.
 *
 * Untimed goals are dropped rather than placed at minute 0 — a match recorded
 * without minutes simply has no timeline, which is what `matchTimelines`
 * leaving it out of the map means.
 *
 * `role` keeps only the one worth a mark on a crowded row. Opener is left out
 * on purpose: the first goal is already obvious from its position, and in this
 * league most goals are openers, so marking them would mark almost everything.
 */
export function matchTimelines(goals: TimelineGoal[], leagueId: string, matchMinutes: number, playerName: (id: string) => string): Map<string, TimelineEntry[]> {
	const byMatch = new Map<string, TimelineEntry[]>();
	for (const goal of goals) {
		if (goal.league !== leagueId || goal.minute === null) continue;
		const role = (["winner", "comeback", "equalizer"] as const).find((key) => goal.roles.includes(key)) ?? null;
		const entries = byMatch.get(goal.match_id) ?? [];
		entries.push({
			minute: goal.minute,
			at: Math.min(1, Math.max(0, goal.minute / matchMinutes)),
			scorer: playerName(goal.scorer_id),
			assist: goal.assist_id ? playerName(goal.assist_id) : null,
			ownGoal: goal.own_goal,
			teamId: goal.team_id,
			role,
		});
		byMatch.set(goal.match_id, entries);
	}
	for (const entries of byMatch.values()) entries.sort((a, b) => a.minute - b.minute);
	return byMatch;
}
