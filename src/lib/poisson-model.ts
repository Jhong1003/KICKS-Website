// Poisson v1 team strengths, exactly as fixed in docs/forecast-protocol-v1.md
// §4.2. Shared by the published match forecasts (scripts/make_forecasts.mjs)
// and the League page's Title Chances simulator, so the two never disagree on
// how strong a team is.
//
//   μ        = pooled goals per team per game in this league so far
//   attack   = (goals scored   + k·μ) / (games + k)
//   defense  = (goals conceded + k·μ) / (games + k)
//   λ(a vs b) = attack_a · defense_b / μ
//
// k = 6 (one league week of games for a team), fixed in advance.

export const SHRINKAGE_K = 6;

export interface ScoredMatch {
	home: string;
	away: string;
	homeGoals: number;
	awayGoals: number;
}

export interface TeamStrengths {
	/** Pooled goals per team per game; null when no match has been played. */
	mu: number | null;
	attack: Record<string, number>;
	defense: Record<string, number>;
	games: Record<string, number>;
}

export function teamStrengths(teamIds: string[], matches: ScoredMatch[], k: number = SHRINKAGE_K): TeamStrengths {
	const scored = Object.fromEntries(teamIds.map((id) => [id, 0]));
	const conceded = Object.fromEntries(teamIds.map((id) => [id, 0]));
	const games = Object.fromEntries(teamIds.map((id) => [id, 0]));
	let goals = 0;
	for (const match of matches) {
		scored[match.home] += match.homeGoals;
		conceded[match.home] += match.awayGoals;
		scored[match.away] += match.awayGoals;
		conceded[match.away] += match.homeGoals;
		games[match.home] += 1;
		games[match.away] += 1;
		goals += match.homeGoals + match.awayGoals;
	}
	const mu = matches.length ? goals / (2 * matches.length) : null;
	const attack: Record<string, number> = {};
	const defense: Record<string, number> = {};
	for (const id of teamIds) {
		attack[id] = mu === null ? 0 : (scored[id] + k * mu) / (games[id] + k);
		defense[id] = mu === null ? 0 : (conceded[id] + k * mu) / (games[id] + k);
	}
	return { mu, attack, defense, games };
}

/** Expected goals for team a against team b (0 when the league has scored no goals yet). */
export function expectedGoals(strengths: TeamStrengths, a: string, b: string): number {
	if (!strengths.mu) return 0;
	return (strengths.attack[a] * strengths.defense[b]) / strengths.mu;
}

function poissonPmf(lambda: number, maxGoals: number): number[] {
	const pmf = [Math.exp(-lambda)];
	for (let n = 1; n <= maxGoals; n++) pmf.push((pmf[n - 1] * lambda) / n);
	return pmf;
}

/**
 * P(a wins), P(draw), P(b wins) for one match with independent Poisson goals,
 * summing 0..maxGoals per team and renormalising the (negligible) rest away.
 */
export function outcomeProbabilities(lambdaA: number, lambdaB: number, maxGoals = 20): { pA: number; pDraw: number; pB: number } {
	const a = poissonPmf(lambdaA, maxGoals);
	const b = poissonPmf(lambdaB, maxGoals);
	let pA = 0;
	let pDraw = 0;
	let pB = 0;
	for (let i = 0; i <= maxGoals; i++) {
		for (let j = 0; j <= maxGoals; j++) {
			const p = a[i] * b[j];
			if (i > j) pA += p;
			else if (i === j) pDraw += p;
			else pB += p;
		}
	}
	const total = pA + pDraw + pB;
	return { pA: pA / total, pDraw: pDraw / total, pB: pB / total };
}
