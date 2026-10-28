// "Title scenarios" (우승 경우의 수): what each team needs from the matches
// that are left. Exact and points-only — every win/draw/loss combination of the
// remaining matches is checked, with no model and no randomness, so it never
// disagrees with titleStatus() in championship-simulator.ts.
//
// Scores are never guessed: a scenario is only a W/D/L per match, and two teams
// level on points are reported as "tied" (decided by participation, then goal
// difference, then goals scored). Participation still moves with the final
// week's attendance, so a points tie is left open rather than settled with
// today's participation numbers.
//
// Only offered when every remaining match is in the league's final week
// (at most MAX_SCENARIO_MATCHES of them, 3^9 = 19,683 for a normal week). Once
// the league is finished the page keeps the picture from the eve of the final
// week (scenarioSetup's "archive" mode), with the real results filled in.
import type { League, LeagueRules } from "./leagues";
import { buildSimulationModel, matchPoints, type FutureMatch, type MatchRecord } from "./championship-simulator.ts";
import type { TeamStanding } from "./standings.ts";

export type Outcome = "H" | "D" | "A";
export const OUTCOMES: Outcome[] = ["H", "D", "A"];
export const MAX_SCENARIO_MATCHES = 12;

export interface ScenarioModel {
	rules: LeagueRules;
	/** Points before the remaining matches; participation is shown, never used to decide. */
	base: { team_id: string; points: number; participation_rate: number }[];
	remaining: FutureMatch[];
}
export type FixedOutcomes = Record<string, Outcome>;

export interface TeamOutlook {
	team_id: string;
	/** Remaining matches this team plays (fixed ones included). */
	games: number;
	minPoints: number;
	maxPoints: number;
	/** Completions where the team is alone on top on points. */
	outright: number;
	/** Completions where it is level on top points with another team. */
	shared: number;
	/** clinched: alone on top in every completion. eliminated: never on top, not even level. */
	status: "clinched" | "eliminated" | "open";
	/** Fewest own wins that guarantee being alone on top, whatever else happens. */
	clinchWins: number | null;
	/** Fewest own wins in any completion that leaves it alone on top. */
	minWins: number | null;
	/** Can only ever finish level on points, never alone on top. */
	tieOnly: boolean;
}

export interface ScenarioAnalysis {
	completions: number;
	teams: Record<string, TeamOutlook>;
	/** Set once every match is fixed: the team(s) on top and their points. */
	final: { leaders: string[]; points: Record<string, number> } | null;
}

const outcomePoints = (outcome: Outcome, week: number, rules: LeagueRules): [number, number] =>
	outcome === "H"
		? [matchPoints(1, 0, week, rules), 0]
		: outcome === "A"
			? [0, matchPoints(1, 0, week, rules)]
			: [rules.draw_points, rules.draw_points];

export function scenarioAvailable(model: ScenarioModel): boolean {
	const { remaining, rules } = model;
	return remaining.length > 0 && remaining.length <= MAX_SCENARIO_MATCHES &&
		remaining.every((match) => match.week === rules.weeks);
}

/** Every completion of the remaining matches consistent with `fixed`. */
export function analyseScenarios(model: ScenarioModel, fixed: FixedOutcomes = {}): ScenarioAnalysis {
	const { rules, base, remaining } = model;
	if (remaining.length > MAX_SCENARIO_MATCHES) throw new Error("Too many remaining matches to list every scenario.");
	for (const [key, outcome] of Object.entries(fixed)) {
		if (!remaining.some((match) => match.key === key) || !OUTCOMES.includes(outcome)) throw new Error(`Unknown scenario entry: ${key}`);
	}
	const ids = base.map((row) => row.team_id);
	const index = new Map(ids.map((id, i) => [id, i]));
	const free = remaining.filter((match) => !fixed[match.key]);
	const start = base.map((row) => row.points);
	const startWins = ids.map(() => 0);
	for (const match of remaining) {
		const outcome = fixed[match.key];
		if (!outcome) continue;
		const [h, a] = outcomePoints(outcome, match.week, rules);
		start[index.get(match.home)!] += h;
		start[index.get(match.away)!] += a;
		if (outcome === "H") startWins[index.get(match.home)!]++;
		if (outcome === "A") startWins[index.get(match.away)!]++;
	}
	const games = ids.map((id) => remaining.filter((match) => match.home === id || match.away === id).length);

	// Per team, per own-win count: [completions, of which on top alone, on top at all].
	const byWins = ids.map((_, i) => Array.from({ length: games[i] + 1 }, () => ({ total: 0, outright: 0, top: 0 })));
	const minPoints = ids.map(() => Infinity);
	const maxPoints = ids.map(() => -Infinity);
	const outright = ids.map(() => 0);
	const shared = ids.map(() => 0);
	let lastPoints = start;

	const points = start.slice();
	const wins = startWins.slice();
	let completions = 0;
	const visit = (depth: number) => {
		if (depth === free.length) {
			completions++;
			const top = Math.max(...points);
			const leaders = points.filter((value) => value === top).length;
			points.forEach((value, i) => {
				minPoints[i] = Math.min(minPoints[i], value);
				maxPoints[i] = Math.max(maxPoints[i], value);
				const cell = byWins[i][wins[i]];
				cell.total++;
				if (value === top) {
					cell.top++;
					if (leaders === 1) { outright[i]++; cell.outright++; } else shared[i]++;
				}
			});
			lastPoints = points.slice();
			return;
		}
		const match = free[depth];
		const h = index.get(match.home)!;
		const a = index.get(match.away)!;
		for (const outcome of OUTCOMES) {
			const [ph, pa] = outcomePoints(outcome, match.week, rules);
			points[h] += ph; points[a] += pa;
			if (outcome === "H") wins[h]++;
			if (outcome === "A") wins[a]++;
			visit(depth + 1);
			points[h] -= ph; points[a] -= pa;
			if (outcome === "H") wins[h]--;
			if (outcome === "A") wins[a]--;
		}
	};
	visit(0);

	const teams = Object.fromEntries(ids.map((id, i) => {
		const cells = byWins[i];
		let clinchWins: number | null = null;
		for (let k = cells.length - 1; k >= 0; k--) {
			const rest = cells.slice(k).filter((cell) => cell.total > 0);
			if (rest.length > 0 && rest.every((cell) => cell.outright === cell.total)) clinchWins = k;
			else break;
		}
		const minWinsIndex = cells.findIndex((cell) => cell.outright > 0);
		const status: TeamOutlook["status"] = outright[i] === completions ? "clinched" : outright[i] + shared[i] === 0 ? "eliminated" : "open";
		return [id, {
			team_id: id, games: games[i], minPoints: minPoints[i], maxPoints: maxPoints[i],
			outright: outright[i], shared: shared[i], status,
			clinchWins: status === "open" ? clinchWins : null,
			minWins: minWinsIndex < 0 ? null : minWinsIndex,
			tieOnly: outright[i] === 0 && shared[i] > 0,
		} satisfies TeamOutlook];
	}));

	let final: ScenarioAnalysis["final"] = null;
	if (free.length === 0) {
		const top = Math.max(...lastPoints);
		final = {
			leaders: ids.filter((_, i) => lastPoints[i] === top),
			points: Object.fromEntries(ids.map((id, i) => [id, lastPoints[i]])),
		};
	}
	return { completions, teams, final };
}

/** One team's line under "What each team needs", in both languages. */
export function conditionText(outlook: TeamOutlook): { en: string; ko: string }[] {
	const { games, status, clinchWins, minWins, tieOnly } = outlook;
	if (status === "clinched") return [{ en: "Title clinched.", ko: "우승 확정이에요." }];
	if (status === "eliminated") return [{ en: "Can no longer finish top.", ko: "더 이상 1위가 될 수 없어요." }];
	const lines: { en: string; ko: string }[] = [];
	if (tieOnly) {
		lines.push({
			en: `Even ${games} wins from ${games} only gets level on points at best — then participation decides.`,
			ko: `${games}경기 전승해도 최대 승점 동점까지만 가능해요 — 그때는 참여율로 결정돼요.`,
		});
		return lines;
	}
	if (clinchWins !== null) {
		lines.push(clinchWins === games
			? { en: `Win all ${games} and the title is yours, whatever else happens.`, ko: `${games}경기 전승하면 다른 결과와 상관없이 자력 우승이에요.` }
			: { en: `${clinchWins}+ wins from ${games} clinches it, whatever else happens.`, ko: `${games}경기 중 ${clinchWins}승 이상이면 다른 결과와 상관없이 자력 우승이에요.` });
		if (minWins !== null && minWins < clinchWins) {
			lines.push(minWins === 0
				? { en: "With help from other results it could finish top even without a win.", ko: "다른 경기 결과에 따라서는 1승도 못 해도 1위가 될 수 있어요." }
				: { en: `With help from other results, ${minWins} win${minWins === 1 ? "" : "s"} could be enough.`, ko: `다른 경기 결과에 따라서는 ${minWins}승으로도 가능해요.` });
		}
	} else {
		lines.push({
			en: `Can't do it alone — even ${games} wins needs help from the other match-up.`,
			ko: `자력 우승은 안 돼요 — 전승해도 다른 팀 경기 결과가 도와줘야 해요.`,
		});
		if (minWins !== null) lines.push(minWins === 0
			? { en: "With the right results elsewhere, even no wins could be enough.", ko: "결과가 잘 맞으면 1승도 못 해도 가능해요." }
			: { en: `Needs at least ${minWins} win${minWins === 1 ? "" : "s"}.`, ko: `최소 ${minWins}승은 해야 해요.` });
	}
	if (outlook.shared > 0) lines.push({ en: "Could also end level on points — then participation decides.", ko: "승점 동점으로 끝날 수도 있어요 — 그때는 참여율로 결정돼요." });
	return lines;
}

export type ScenarioSetup =
	| { mode: "live" | "archive"; model: ScenarioModel; actual: FixedOutcomes }
	| { mode: "unavailable"; reason: "not-final-week" | "error" };

/**
 * live: the league's remaining matches are all in the final week.
 * archive: the league is finished — rebuild the eve of the final week from
 *   completed matches before it and standings_history's participation at
 *   week (final − 1); `actual` holds what really happened.
 */
export function scenarioSetup(
	league: League,
	matches: MatchRecord[],
	standings: (TeamStanding & { league: string })[],
	history: (TeamStanding & { league: string; week: number })[],
): ScenarioSetup {
	try {
		const own = matches.filter((match) => match.league === league.id);
		const finalWeek = league.rules.weeks;
		const finished = own.length > 0 && own.every((match) => match.status === "completed");
		const toModel = (sim: ReturnType<typeof buildSimulationModel>): ScenarioModel => ({
			rules: league.rules,
			base: sim.base.map(({ team_id, points, participation_rate }) => ({ team_id, points, participation_rate })),
			remaining: sim.remaining,
		});
		if (!finished) {
			const model = toModel(buildSimulationModel(league, matches, standings));
			return scenarioAvailable(model) ? { mode: "live", model, actual: {} } : { mode: "unavailable", reason: "not-final-week" };
		}
		const eve = own.map((match) => match.week === finalWeek ? { ...match, status: "scheduled", home_score: null, away_score: null } : match);
		const eveStandings = history.filter((row) => row.league === league.id && row.week === finalWeek - 1);
		const model = toModel(buildSimulationModel(league, eve, eveStandings));
		if (!scenarioAvailable(model)) return { mode: "unavailable", reason: "not-final-week" };
		const actual: FixedOutcomes = {};
		for (const match of own.filter((entry) => entry.week === finalWeek)) {
			const h = match.home_score!, a = match.away_score!;
			actual[match.match_id] = h > a ? "H" : h < a ? "A" : "D";
		}
		return { mode: "archive", model, actual };
	} catch {
		return { mode: "unavailable", reason: "error" };
	}
}

/** The ?s= share code: one letter per remaining match in model order, "-" for open. */
export function encodeScenario(model: ScenarioModel, fixed: FixedOutcomes): string {
	return model.remaining.map((match) => fixed[match.key] ?? "-").join("");
}
export function decodeScenario(model: ScenarioModel, code: string | null): FixedOutcomes {
	if (!code || code.length !== model.remaining.length) return {};
	const fixed: FixedOutcomes = {};
	model.remaining.forEach((match, i) => {
		const letter = code[i] as Outcome;
		if (OUTCOMES.includes(letter)) fixed[match.key] = letter;
	});
	return fixed;
}
