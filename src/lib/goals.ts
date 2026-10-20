// KICKS all-time goal counter for the homepage hero: every completed match's
// score summed across *all* leagues (the one place on the site that
// deliberately does cross leagues — it's a club-wide number, not a stat any
// team or player is ranked on), plus how far it is to the next milestone.
//
// Computed from matches.json rather than in update_data.py: it's a plain sum
// of data that's already generated, and whether the "milestone reached"
// message is still fresh depends on the visitor's date, which has to be
// checked client-side anyway (same reason as the "Next up" card).

export const GOAL_MILESTONE_STEP = 100;
/** How many days after the match that crossed a milestone to keep celebrating it. */
export const MILESTONE_CELEBRATION_DAYS = 7;

export interface MatchScore {
	match_id: string;
	status: string;
	date: string | null;
	home_score: number | null;
	away_score: number | null;
}

export interface GoalCountdown {
	total: number;
	nextMilestone: number;
	remaining: number;
	/** The most recent milestone passed (e.g. 100), or null below the first one. */
	lastMilestone: number | null;
	/** Date of the match whose goals crossed lastMilestone. */
	lastMilestoneDate: string | null;
}

/** One goal from goal_events.json, as the milestone lookup reads it. */
export interface MilestoneGoalEvent {
	match_id: string;
	minute: number | null;
	scorer_id: string | null;
	own_goal: boolean;
}

const isScored = (m: MatchScore) =>
	m.status === "completed" && typeof m.home_score === "number" && typeof m.away_score === "number";

// Chronological order, so the running total finds the match that actually
// crossed each milestone. match_id (league-week-match) breaks same-day ties.
function chronological(matches: MatchScore[]): MatchScore[] {
	return matches.filter(isScored).sort((a, b) => {
		const byDate = (a.date ?? "9999").localeCompare(b.date ?? "9999");
		return byDate !== 0 ? byDate : a.match_id.localeCompare(b.match_id);
	});
}

export function buildGoalCountdown(matches: MatchScore[]): GoalCountdown {
	const completed = chronological(matches);

	const total = completed.reduce((sum, m) => sum + m.home_score! + m.away_score!, 0);
	const passed = Math.floor(total / GOAL_MILESTONE_STEP) * GOAL_MILESTONE_STEP;
	const nextMilestone = passed + GOAL_MILESTONE_STEP;

	let lastMilestoneDate: string | null = null;
	if (passed > 0) {
		let running = 0;
		for (const m of completed) {
			running += m.home_score! + m.away_score!;
			if (running >= passed) {
				lastMilestoneDate = m.date;
				break;
			}
		}
	}

	return {
		total,
		nextMilestone,
		remaining: nextMilestone - total,
		lastMilestone: passed > 0 ? passed : null,
		lastMilestoneDate,
	};
}

/** True while the latest milestone was reached within MILESTONE_CELEBRATION_DAYS of `today`. */
export function isCelebratingMilestone(countdown: GoalCountdown, today: Date = new Date()): boolean {
	if (!countdown.lastMilestone || !countdown.lastMilestoneDate) return false;
	// Local midnight on both sides, so the count is in whole calendar days.
	const reached = new Date(`${countdown.lastMilestoneDate}T00:00:00`);
	const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
	const days = Math.round((start.getTime() - reached.getTime()) / 86_400_000);
	return days >= 0 && days <= MILESTONE_CELEBRATION_DAYS;
}

/**
 * Who scored goal number `milestone` (e.g. the 100th), or null when that can't
 * be told for certain: the match that crossed it needs goal_events with a
 * minute on every goal (weekly-total leagues have none), the event count has
 * to match the official score, and an own goal has no scorer to credit.
 */
export function milestoneScorer(matches: MatchScore[], goals: MilestoneGoalEvent[], milestone: number): string | null {
	let before = 0;
	for (const m of chronological(matches)) {
		const inMatch = m.home_score! + m.away_score!;
		if (before + inMatch < milestone) {
			before += inMatch;
			continue;
		}
		const events = goals.filter((goal) => goal.match_id === m.match_id);
		if (events.length !== inMatch || events.some((goal) => goal.minute === null)) return null;
		const goal = [...events].sort((a, b) => a.minute! - b.minute!)[milestone - before - 1];
		// Two goals in the same minute can't be put in order.
		if (events.filter((other) => other.minute === goal.minute).length > 1) return null;
		return goal.own_goal ? null : goal.scorer_id;
	}
	return null;
}
