// "Career" on a player's page: one timeline of the moments of their own KICKS
// career, across every league they've played, plus their career totals.
// Pure functions; the page feeds them the generated JSON. Tested by
// tests/career.test.mjs.
//
// This is the second deliberate exception to "nothing is summed across
// leagues" (the first is the homepage goal counter). It passes the same test
// for the same reason: it is about one player and compares them with no one.
// It appears only on that player's own page — never in a list, a table or a
// ranking — and nothing here ever says where a total stands next to anyone
// else's.

/** One week of a player's league section (player_profiles.json weekly_stats). */
export interface CareerWeek {
	week: number;
	team_id: string | null;
	games: number;
	goals: number;
	assists: number;
	/** Own goals that week (missing in data generated before the field existed = 0). */
	own_goals?: number;
}

export interface CareerSection {
	league: string;
	current_team_id: string | null;
	weekly_stats: CareerWeek[];
}

export interface CareerContext {
	/** League ids, oldest first (leagues.json order). */
	leagueOrder: string[];
	/** Finished leagues (every fixture scored) where this player was on the
	 * champion team at the end — i.e. they hold the Champion badge there. */
	championLeagues: string[];
	/** Finished leagues where this player won (or shared) the Golden Boot. */
	goldenBootLeagues: string[];
	/** Finished leagues where this player won (or shared) the Playmaker Award. */
	playmakerLeagues: string[];
	/** Last week of each finished league, for dating the honours above. */
	finalWeeks: Record<string, number>;
	/** The most goals this player scored in a single match, per league and week
	 * (goal_events, own goals left out). Leagues recorded as weekly totals
	 * (FA26-L1) have no entries, so their braces/hat-tricks can't be dated. */
	matchGoals: { league: string; week: number; goals: number }[];
}

export type CareerEventKind =
	| "debut"
	| "new_league"
	| "transfer"
	| "first_goal"
	| "first_assist"
	| "first_own_goal"
	| "brace"
	| "hat_trick"
	| "poker"
	| "goals"
	| "assists"
	| "weeks"
	| "champion"
	| "golden_boot"
	| "playmaker_award";

export interface CareerEvent {
	kind: CareerEventKind;
	league: string;
	week: number;
	/** The team, for debut / new_league / transfer / champion. */
	teamId?: string | null;
	/** The milestone reached, for goals / assists / weeks. */
	count?: number;
}

export interface CareerTotals {
	leagues: number;
	goals: number;
	assists: number;
	weeksPlayed: number;
	titles: number;
}

export interface Career {
	totals: CareerTotals;
	/** Oldest first. */
	events: CareerEvent[];
}

/** Career-goal milestones; past the list, every 50. */
export const GOAL_MILESTONES = [5, 10, 20, 30, 50, 75, 100];
export const ASSIST_MILESTONES = [5, 10, 20, 30, 50, 75, 100];
/** Weeks played (a week with at least one game). A league is four weeks. */
export const WEEK_MILESTONES = [10, 20, 30, 40, 50];

/** The highest milestone in `steps` (extended by 50s past its end) that the
 * running total crossed going from `before` to `after`, or null. Only the
 * highest is kept, so a big week doesn't stack 5, 10 and 20 on one line. */
export function crossedMilestone(steps: number[], before: number, after: number, every = 50): number | null {
	let best: number | null = null;
	const last = steps[steps.length - 1];
	for (const step of steps) if (before < step && after >= step) best = step;
	for (let step = last + every; step <= after; step += every) if (before < step) best = step;
	return best;
}

/** Order of moments within one week, oldest first, so that read newest-first the
 * honours sit on top and the arrival at the bottom. */
const ORDER: CareerEventKind[] = [
	"debut",
	"new_league",
	"transfer",
	"first_goal",
	"first_assist",
	"first_own_goal",
	"brace",
	"hat_trick",
	"poker",
	"goals",
	"assists",
	"weeks",
	"champion",
	"golden_boot",
	"playmaker_award",
];

export function buildCareer(sections: CareerSection[], ctx: CareerContext): Career {
	const leagueIndex = new Map(ctx.leagueOrder.map((id, index) => [id, index]));
	const ordered = [...sections]
		.filter((section) => leagueIndex.has(section.league))
		.sort((a, b) => leagueIndex.get(a.league)! - leagueIndex.get(b.league)!);

	const events: CareerEvent[] = [];
	let goals = 0;
	let assists = 0;
	let weeksPlayed = 0;
	let leaguesPlayed = 0;
	let hadGoal = false;
	let hadAssist = false;
	// Only the first one, never a count: a single own goal is a funny memory
	// (the club runs an own-goal award), a running total would read as a jab.
	// Not in the totals either.
	let hadOwnGoal = false;
	let bestMatch = 1; // most goals in one match reached so far (1 = nothing yet)

	for (const section of ordered) {
		const weeks = [...section.weekly_stats].sort((a, b) => a.week - b.week);
		let arrived = false;
		let team: string | null = null;
		for (const w of weeks) {
			const played = w.games > 0;
			if (played && !arrived) {
				arrived = true;
				team = w.team_id;
				events.push({ kind: leaguesPlayed === 0 ? "debut" : "new_league", league: section.league, week: w.week, teamId: w.team_id });
				leaguesPlayed += 1;
			} else if (arrived && played && w.team_id && w.team_id !== team) {
				team = w.team_id;
				events.push({ kind: "transfer", league: section.league, week: w.week, teamId: w.team_id });
			}

			if (w.goals > 0 && !hadGoal) {
				hadGoal = true;
				events.push({ kind: "first_goal", league: section.league, week: w.week });
			}
			if (w.assists > 0 && !hadAssist) {
				hadAssist = true;
				events.push({ kind: "first_assist", league: section.league, week: w.week });
			}
			if ((w.own_goals ?? 0) > 0 && !hadOwnGoal) {
				hadOwnGoal = true;
				events.push({ kind: "first_own_goal", league: section.league, week: w.week });
			}

			const most = Math.max(0, ...ctx.matchGoals.filter((m) => m.league === section.league && m.week === w.week).map((m) => m.goals));
			if (most > bestMatch) {
				// Only the first time each level is reached; a hat-trick week
				// doesn't also claim a "first brace".
				const kind: CareerEventKind = most >= 4 ? "poker" : most === 3 ? "hat_trick" : "brace";
				events.push({ kind, league: section.league, week: w.week });
				bestMatch = Math.min(most, 4);
			}

			const g = crossedMilestone(GOAL_MILESTONES, goals, goals + w.goals);
			if (g) events.push({ kind: "goals", league: section.league, week: w.week, count: g });
			const a = crossedMilestone(ASSIST_MILESTONES, assists, assists + w.assists);
			if (a) events.push({ kind: "assists", league: section.league, week: w.week, count: a });
			const p = crossedMilestone(WEEK_MILESTONES, weeksPlayed, weeksPlayed + (played ? 1 : 0));
			if (p) events.push({ kind: "weeks", league: section.league, week: w.week, count: p });

			goals += w.goals;
			assists += w.assists;
			if (played) weeksPlayed += 1;
		}

		const finalWeek = ctx.finalWeeks[section.league];
		if (finalWeek !== undefined) {
			if (ctx.championLeagues.includes(section.league)) {
				events.push({ kind: "champion", league: section.league, week: finalWeek, teamId: section.current_team_id });
			}
			if (ctx.goldenBootLeagues.includes(section.league)) events.push({ kind: "golden_boot", league: section.league, week: finalWeek });
			if (ctx.playmakerLeagues.includes(section.league)) events.push({ kind: "playmaker_award", league: section.league, week: finalWeek });
		}
	}

	events.sort(
		(a, b) =>
			leagueIndex.get(a.league)! - leagueIndex.get(b.league)! ||
			a.week - b.week ||
			ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind),
	);

	return {
		totals: { leagues: leaguesPlayed, goals, assists, weeksPlayed, titles: ctx.championLeagues.filter((id) => sections.some((s) => s.league === id)).length },
		events,
	};
}
