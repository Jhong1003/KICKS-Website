// Poisson v1 strengths (src/lib/poisson-model.ts), shared by the published
// forecasts and the Title Chances simulator. Run: node --test tests/poisson-model.test.mjs
// (Node 22.18+, or 22.12+ with --experimental-strip-types).
import test from 'node:test';
import assert from 'node:assert/strict';
import { teamStrengths, expectedGoals, outcomeProbabilities, SHRINKAGE_K } from '../src/lib/poisson-model.ts';

const close = (a, b, eps = 1e-12) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);

test('k is the protocol value 6', () => assert.equal(SHRINKAGE_K, 6));

test('no matches: mu null, everyone zero, no goals expected', () => {
  const s = teamStrengths(['T1', 'T2', 'T3'], []);
  assert.equal(s.mu, null);
  assert.equal(expectedGoals(s, 'T1', 'T2'), 0);
});

test('formula matches the protocol by hand', () => {
  // T1 3-0 T2, T2 1-1 T3: 5 goals, 4 team-games -> mu = 1.25
  const s = teamStrengths(['T1', 'T2', 'T3'], [
    { home: 'T1', away: 'T2', homeGoals: 3, awayGoals: 0 },
    { home: 'T2', away: 'T3', homeGoals: 1, awayGoals: 1 },
  ]);
  close(s.mu, 1.25);
  close(s.attack.T1, (3 + 6 * 1.25) / (1 + 6));
  close(s.defense.T2, (4 + 6 * 1.25) / (2 + 6));
  close(s.attack.T3, (1 + 6 * 1.25) / (1 + 6));
  close(expectedGoals(s, 'T1', 'T2'), (s.attack.T1 * s.defense.T2) / 1.25);
});

test('equal records give equal strengths and a symmetric forecast', () => {
  const s = teamStrengths(['T1', 'T2'], [
    { home: 'T1', away: 'T2', homeGoals: 2, awayGoals: 2 },
  ]);
  close(s.attack.T1, s.attack.T2);
  const p = outcomeProbabilities(expectedGoals(s, 'T1', 'T2'), expectedGoals(s, 'T2', 'T1'));
  close(p.pA, p.pB);
  close(p.pA + p.pDraw + p.pB, 1);
});

test('stronger attack -> higher win chance; zero lambdas -> certain draw', () => {
  const p = outcomeProbabilities(2, 0.5);
  assert.ok(p.pA > p.pB);
  close(p.pA + p.pDraw + p.pB, 1);
  const z = outcomeProbabilities(0, 0);
  close(z.pDraw, 1);
});
