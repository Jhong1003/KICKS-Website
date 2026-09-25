import type { League, LeagueRules } from "./leagues";
import { championshipCredits, type TeamStanding } from "./standings.ts";

export interface MatchRecord {
	league: string;
	match_id: string;
	week: number;
	home_team_id: string | null;
	away_team_id: string | null;
	home_score: number | null;
	away_score: number | null;
	status: string;
}
export interface FutureMatch {
	key: string;
	week: number;
	home: string;
	away: string;
	virtual: boolean;
}
export interface SimulationModel {
	league: League;
	base: TeamStanding[];
	remaining: FutureMatch[];
	completed: number;
	lambda: number | null;
}
export type FixedScores = Record<string, [number, number]>;

export function matchPoints(goals: number, against: number, week: number, rules: LeagueRules): number {
	return goals > against ? (week >= rules.final_week ? rules.final_win_points : rules.win_points)
		: goals === against ? rules.draw_points : 0;
}

function addResult(rows: TeamStanding[], home: string, away: string, h: number, a: number, week: number, rules: LeagueRules) {
	for (const [id, goals, against] of [[home, h, a], [away, a, h]] as const) {
		const row = rows.find((entry) => entry.team_id === id)!;
		row.points += matchPoints(goals, against, week, rules);
		row.goals_for += goals;
		row.goal_difference += goals - against;
	}
}

const validScore = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) >= 0;

/** Reconstruct totals from completed matches once; only participation comes from standings.
 * Unknown fixtures are assigned to compatible round-robin slots in memory only.
 * No match id is attached to a guessed pairing and no generated data is written.
 */
export function buildSimulationModel(
	league: League, allMatches: MatchRecord[], standings: (TeamStanding & { league: string })[],
): SimulationModel {
	const ids = league.teams.map((team) => team.team_id);
	const rules = league.rules;
	const pairs = ids.flatMap((home, i) => ids.slice(i + 1).map((away) => ({ home, away })));
	if (ids.length !== 3 || new Set(ids).size !== 3 || !Number.isInteger(rules.weeks) || rules.weeks < 1 ||
		!Number.isInteger(rules.matches_per_pair_per_week) || rules.matches_per_pair_per_week < 1 ||
		pairs.length * rules.matches_per_pair_per_week !== rules.matches_per_week) {
		throw new Error("리그의 3팀 라운드로빈 설정을 확인해주세요.");
	}
	const matches = allMatches.filter((match) => match.league === league.id);
	const knownIds = new Set<string>();
	const base = ids.map((id) => ({ team_id: id, points: 0, goals_for: 0, goal_difference: 0,
		participation_rate: standings.find((row) => row.league === league.id && row.team_id === id)?.participation_rate ?? 0 }));
	let completed = 0;
	let goals = 0;
	for (const match of matches) {
		if (knownIds.has(match.match_id) || !Number.isInteger(match.week) || match.week < 1 || match.week > rules.weeks ||
			(match.home_team_id !== null && !ids.includes(match.home_team_id)) ||
			(match.away_team_id !== null && !ids.includes(match.away_team_id)) ||
			(match.home_team_id !== null && match.home_team_id === match.away_team_id)) {
			throw new Error("경기 ID, 주차 또는 팀 정보가 리그 설정과 맞지 않습니다.");
		}
		knownIds.add(match.match_id);
		if (match.status === "completed") {
			if (!match.home_team_id || !match.away_team_id || !validScore(match.home_score) || !validScore(match.away_score)) {
				throw new Error("완료 경기의 팀 또는 스코어가 누락되었습니다.");
			}
			addResult(base, match.home_team_id, match.away_team_id, match.home_score, match.away_score, match.week, rules);
			completed++;
			goals += match.home_score + match.away_score;
		} else if (match.status !== "scheduled" || match.home_score !== null || match.away_score !== null) {
			throw new Error("미완료 경기의 상태 또는 스코어를 확인해주세요.");
		}
	}
	const remaining: FutureMatch[] = [];
	for (let week = 1; week <= rules.weeks; week++) {
		const weekly = matches.filter((match) => match.week === week);
		if (weekly.length > rules.matches_per_week) throw new Error(`Week ${week}: 경기 수가 설정을 초과합니다.`);
		const slots = pairs.flatMap(({ home, away }) => Array.from({ length: rules.matches_per_pair_per_week }, (_, i) => ({
			home, away, week, virtual: true, key: `${league.id}:virtual:${week}:${home}:${away}:${i}`,
		})));
		const unknown: MatchRecord[] = [];
		for (const match of weekly) {
			if (!match.home_team_id || !match.away_team_id) { unknown.push(match); continue; }
			const slot = slots.findIndex((s) => (s.home === match.home_team_id && s.away === match.away_team_id) ||
				(s.home === match.away_team_id && s.away === match.home_team_id));
			if (slot < 0) throw new Error(`Week ${week}: 팀 조합별 경기 수가 설정을 초과합니다.`);
			slots.splice(slot, 1);
			if (match.status === "scheduled") remaining.push({ key: match.match_id, week,
				home: match.home_team_id, away: match.away_team_id, virtual: false });
		}
		// Check partial TBD entries can fit the remaining slots without discarding known teams.
		unknown.sort((a, b) => Number(Boolean(b.home_team_id || b.away_team_id)) - Number(Boolean(a.home_team_id || a.away_team_id)));
		function fits(index: number, available: FutureMatch[]): boolean {
			if (index === unknown.length) return true;
			const match = unknown[index];
			return available.some((slot, i) => {
				const known = match.home_team_id ?? match.away_team_id;
				return (!known || slot.home === known || slot.away === known) && fits(index + 1, available.filter((_, j) => j !== i));
			});
		}
		if (!fits(0, slots)) throw new Error(`Week ${week}: 미정 대진과 남은 팀 조합이 일치하지 않습니다.`);
		remaining.push(...slots);
	}
	return { league, base, remaining: remaining.sort((a, b) => a.week - b.week), completed,
		lambda: completed ? goals / (2 * completed) : null };
}

/** Exponential waiting times avoid exp(-lambda) underflow; no goal cap or rounding of lambda. */
export function poisson(lambda: number, random: () => number = Math.random): number {
	if (!Number.isFinite(lambda) || lambda < 0) throw new Error("Invalid Poisson mean");
	let elapsed = 0;
	let goals = 0;
	while (lambda > 0) {
		elapsed -= Math.log(1 - random());
		if (elapsed >= lambda) break;
		goals++;
	}
	return goals;
}

/** Runs in batches so the browser can paint progress and keep controls responsive. */
export async function simulate(
	model: SimulationModel, fixed: FixedScores = {}, trials = 10000,
	random: () => number = Math.random, progress: (fraction: number) => void = () => {},
) {
	if (!Number.isInteger(trials) || trials < 1) throw new Error("Invalid trial count");
	for (const [key, scores] of Object.entries(fixed)) {
		if (!model.remaining.some((match) => match.key === key) || scores.length !== 2 || !scores.every(validScore)) {
			throw new Error("각 경기의 양 팀 스코어를 0 이상의 정수로 입력해주세요.");
		}
	}
	const stochastic = model.remaining.some((match) => !fixed[match.key]);
	if (stochastic && model.lambda === null) throw new Error("완료 경기 데이터가 없어 λ를 추정할 수 없습니다.");
	const exact = !stochastic || model.lambda === 0;
	const count = exact ? 1 : trials;
	const credits = Object.fromEntries(model.base.map((row) => [row.team_id, 0]));
	for (let trial = 0; trial < count; trial++) {
		const rows = model.base.map((row) => ({ ...row }));
		for (const match of model.remaining) {
			const [h, a] = fixed[match.key] ?? [poisson(model.lambda!, random), poisson(model.lambda!, random)];
			addResult(rows, match.home, match.away, h, a, match.week, model.league.rules);
		}
		const credit = championshipCredits(rows, model.league.rules.ranking_criteria);
		for (const id of Object.keys(credits)) credits[id] += credit[id] / count;
		if ((trial + 1) % 250 === 0) {
			progress((trial + 1) / count);
			await new Promise((resolve) => setTimeout(resolve, 0));
		}
	}
	progress(1);
	return { credits, trials: count, exact };
}

export type TitleStatus = "clinched" | "eliminated" | "open";

/**
 * Settled by points alone, with no randomness: "eliminated" if the team can't
 * reach another team's *current* points even by winning every remaining
 * match; "clinched" if the team's current points are already beyond every
 * other team's maximum. A possible tie on points is left "open", because
 * the tiebreakers (participation first) can still change.
 */
export function titleStatus(model: SimulationModel): Record<string, TitleStatus> {
	const rules = model.league.rules;
	const winPoints = (week: number) => (week >= rules.final_week ? rules.final_win_points : rules.win_points);
	const maxPoints = Object.fromEntries(model.base.map((row) => [row.team_id, row.points]));
	for (const match of model.remaining) {
		maxPoints[match.home] += winPoints(match.week);
		maxPoints[match.away] += winPoints(match.week);
	}
	return Object.fromEntries(model.base.map((row) => {
		const others = model.base.filter((other) => other.team_id !== row.team_id);
		if (others.some((other) => other.points > maxPoints[row.team_id])) return [row.team_id, "eliminated"];
		if (others.every((other) => maxPoints[other.team_id] < row.points)) return [row.team_id, "clinched"];
		return [row.team_id, "open"];
	}));
}

/**
 * The Title Race cell text. Settled teams get a word instead of a number;
 * otherwise tiny or near-certain simulated shares are shown as "<0.1%" /
 * ">99.9%", so a 10,000-run 0.0% (or 100.0%) is never mistaken for a
 * mathematical certainty.
 */
export function formatTitleChance(percentage: number, status: TitleStatus): { en: string; ko: string } {
	if (status === "clinched") return { en: "Clinched", ko: "우승 확정" };
	if (status === "eliminated") return { en: "Eliminated", ko: "탈락" };
	if (percentage < 0.1) return { en: "<0.1%", ko: "<0.1%" };
	if (percentage > 99.9) return { en: ">99.9%", ko: ">99.9%" };
	const text = `${percentage.toFixed(1)}%`;
	return { en: text, ko: text };
}
