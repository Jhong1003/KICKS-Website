// Forecast scoring (scripts/score_forecasts.mjs, Forecast Protocol v2 §8).
// Run: node --test tests/score-forecasts.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  rps, brier, logLoss, outcomeFor, linkForecasts, rowProblems, appendOnlyHistory,
  deadlineFor, toChicago, titleSummary, paired, score,
} from '../scripts/score_forecasts.mjs';

const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-12, `${msg ?? ''} ${a} vs ${b}`);

// ---------------------------------------------------------------- the scores, by hand

test('RPS matches hand calculation (p = 0.5 / 0.3 / 0.2)', () => {
  const p = [0.5, 0.3, 0.2];
  // team_a won: ½[(0.5 − 1)² + (0.8 − 1)²] = ½[0.25 + 0.04] = 0.145
  close(rps(p, 0), 0.145);
  // draw: ½[(0.5 − 0)² + (0.8 − 1)²] = ½[0.25 + 0.04] = 0.145
  close(rps(p, 1), 0.145);
  // team_b won: ½[(0.5 − 0)² + (0.8 − 0)²] = ½[0.25 + 0.64] = 0.445
  close(rps(p, 2), 0.445);
});

test('RPS: 0 when certain and right, 1 when certain on the far wrong end', () => {
  close(rps([1, 0, 0], 0), 0);
  close(rps([0, 0, 1], 0), 1);
});

test('RPS respects the outcome order; Brier does not', () => {
  // team_a won. Calling a draw is "nearer" than calling a team_b win.
  close(rps([0, 1, 0], 0), 0.5);
  close(rps([0, 0, 1], 0), 1);
  // Brier treats both misses the same.
  close(brier([0, 1, 0], 0), 2);
  close(brier([0, 0, 1], 0), 2);
});

test('Brier and log loss match hand calculation', () => {
  const p = [0.5, 0.3, 0.2];
  // team_a won: (0.5 − 1)² + 0.3² + 0.2² = 0.25 + 0.09 + 0.04 = 0.38
  close(brier(p, 0), 0.38);
  close(logLoss(p, 0), -Math.log(0.5));
  close(logLoss(p, 2), -Math.log(0.2));
});

test('the published baseline scores what the protocol implies', () => {
  const d = 8 / 36, w = (1 - d) / 2; // §4.1
  const p = [w, d, w];
  close(rps(p, 0), 0.5 * ((w - 1) ** 2 + (w + d - 1) ** 2));
  close(rps(p, 1), 0.5 * (w ** 2 + (w + d - 1) ** 2));
});

// ---------------------------------------------------------------- linking

test('outcome is read from team_a, not from home', () => {
  // Real FA26-L2 week 1 match 1: home T3 1–0 away T2. Forecast pairing is T2 v T3.
  const m = { match_id: 'x', home_team_id: 'T3', away_team_id: 'T2', home_score: 1, away_score: 0 };
  assert.equal(outcomeFor(m, 'T2', 'T3'), 2); // team_b (T3) won
  const flipped = { ...m, home_team_id: 'T2', away_team_id: 'T3', home_score: 0, away_score: 1 };
  assert.equal(outcomeFor(flipped, 'T2', 'T3'), 2); // same result, other way round
  assert.equal(outcomeFor({ ...m, away_score: 1 }, 'T2', 'T3'), 1);
});

test('outcomeFor refuses a forecast for a different pairing', () => {
  const m = { match_id: 'x', home_team_id: 'T1', away_team_id: 'T2', home_score: 1, away_score: 0 };
  assert.throws(() => outcomeFor(m, 'T1', 'T3'), /not T1 v T3/);
});

const row = (week, a, b, model, p) => ({
  league: 'L', week: String(week), team_a: a, team_b: b, model,
  p_a: String(p[0]), p_draw: String(p[1]), p_b: String(p[2]),
  data_through_week: String(week - 1), status: 'published',
});
const match = (id, week, home, away, hs, as) => ({
  league: 'L', match_id: id, week, home_team_id: home, away_team_id: away,
  home_score: hs, away_score: as, status: hs === null ? 'scheduled' : 'completed',
});

test('linking keeps p_a with team_a when the match lists team_a away', () => {
  const p = [0.6, 0.3, 0.1]; // T1 strong favourite
  const { scored } = linkForecasts(
    [row(2, 'T1', 'T2', 'm', p)],
    [match('M1', 2, 'T2', 'T1', 2, 0)], // T2 at home beat T1
    { league: 'L', matchesPerPair: 1 },
  );
  assert.equal(scored.length, 1);
  assert.equal(scored[0].outcome, 'team_b');
  assert.deepEqual(scored[0].p, p); // not swapped
  close(scored[0].rps, rps(p, 2));
  assert.deepEqual([scored[0].goals_a, scored[0].goals_b], [0, 2]);
});

test('unplayed matches are pending, never scored or filled in', () => {
  const r = linkForecasts(
    [row(1, 'T1', 'T2', 'm', [0.4, 0.2, 0.4])],
    [match('M1', 1, 'T1', 'T2', 1, 0), match('M2', 1, 'T1', 'T2', null, null)],
    { league: 'L', matchesPerPair: 2 },
  );
  assert.equal(r.scored.length, 1);
  assert.deepEqual(r.pending, ['M2']);
});

test('a model that forecast a week but skipped a pairing is reported missing', () => {
  const r = linkForecasts(
    [row(2, 'T1', 'T2', 'm', [0.4, 0.2, 0.4])],
    [match('M1', 2, 'T1', 'T2', 1, 0), match('M2', 2, 'T1', 'T3', 1, 0)],
    { league: 'L', matchesPerPair: 1 },
  );
  assert.deepEqual(r.missing, [{ match_id: 'M2', model: 'm' }]);
  // A model that published nothing for week 1 is simply not scored there (e.g. poisson-v1 in week 1).
  const r1 = linkForecasts([row(2, 'T1', 'T2', 'm', [0.4, 0.2, 0.4])], [match('M0', 1, 'T1', 'T2', 1, 0)], { league: 'L', matchesPerPair: 1 });
  assert.deepEqual(r1.missing, []);
  assert.equal(r1.scored.length, 0);
});

test('fixture counts that do not match the league rules are flagged', () => {
  const r = linkForecasts([], [match('M1', 1, 'T1', 'T2', 1, 0)], { league: 'L', matchesPerPair: 3 });
  assert.equal(r.fixtureProblems.length, 1);
});

test('rowProblems catches bad sums, swapped ids and wrong data_through_week', () => {
  assert.deepEqual(rowProblems(row(2, 'T1', 'T2', 'm', [0.4, 0.2, 0.4])), []);
  assert.match(rowProblems(row(2, 'T1', 'T2', 'm', [0.5, 0.2, 0.4])).join(), /sum to 1/);
  assert.match(rowProblems(row(2, 'T2', 'T1', 'm', [0.4, 0.2, 0.4])).join(), /smaller/);
  assert.match(rowProblems({ ...row(2, 'T1', 'T2', 'm', [0.4, 0.2, 0.4]), data_through_week: '2' }).join(), /week − 1/);
});

test('paired comparison uses only matches both models scored', () => {
  const s = (id, model, r) => ({ match_id: id, week: 2, model, rps: r, brier: r, log_loss: r });
  const c = paired([s('a', 'baseline', 0.3), s('a', 'poisson-v1', 0.2), s('b', 'baseline', 0.9)], 'poisson-v1');
  assert.equal(c.overall.n, 1);
  close(c.overall.diff_rps, -0.1);
  close(c.overall.baseline_rps, 0.3); // match b is not in the comparison
});

// ---------------------------------------------------------------- integrity

test('append-only history: edits are caught, first commit of each line is recorded', () => {
  const v = (sha, time, ...lines) => ({ sha, time, text: lines.join('\n') + '\n' });
  const ok = appendOnlyHistory([v('aaa', 't1', 'h', 'r1'), v('bbb', 't2', 'h', 'r1', 'r2')]);
  assert.deepEqual(ok.violations, []);
  assert.equal(ok.firstSeen.get('r1').sha, 'aaa');
  assert.equal(ok.firstSeen.get('r2').sha, 'bbb');
  const edited = appendOnlyHistory([v('aaa', 't1', 'h', 'r1'), v('ccc', 't2', 'h', 'r1-changed', 'r2')]);
  assert.equal(edited.violations.length, 1);
  const deleted = appendOnlyHistory([v('aaa', 't1', 'h', 'r1', 'r2'), v('ddd', 't2', 'h', 'r2')]);
  assert.equal(deleted.violations.length, 1);
});

test('deadline is Friday 23:59:59 Chicago, compared in Chicago time', () => {
  const schedule = [{ type: 'league', league: 'L', week: 2, date: '2026-10-17' }];
  const deadline = deadlineFor(schedule, 'L', 2);
  assert.equal(deadline, '2026-10-16T23:59:59');
  // October is CDT (UTC−5): 04:59:59Z is 23:59:59 Friday, 05:00:00Z is past it.
  assert.ok(toChicago('2026-10-17T04:59:59Z') <= deadline);
  assert.ok(toChicago('2026-10-17T05:00:00Z') > deadline);
});

test('title summary: probability on the champion and multi-class Brier; shared title split', () => {
  const t = (week, team, p) => ({ week: String(week), team, model: 'm', p_title: String(p) });
  const [w] = titleSummary([t(2, 'T1', 0.5), t(2, 'T2', 0.3), t(2, 'T3', 0.2)], ['T1'], ['T1', 'T2', 'T3']);
  close(w.p_champion, 0.5);
  close(w.brier, 0.25 + 0.09 + 0.04);
  const [s] = titleSummary([t(2, 'T1', 0.5), t(2, 'T2', 0.5), t(2, 'T3', 0)], ['T1', 'T2'], ['T1', 'T2', 'T3']);
  close(s.p_champion, 1);
  close(s.brier, 0); // exactly the equal split
});

// ---------------------------------------------------------------- the real data

const shallow = (() => {
  try { return execFileSync('git', ['rev-parse', '--is-shallow-repository'], { encoding: 'utf8' }).trim() === 'true'; } catch { return true; }
})();

test('FA26-L2: every completed match is scored once per model that forecast its week', () => {
  const r = score('FA26-L2', { skipHistory: true });
  assert.deepEqual(r.linked.missing, []);
  assert.deepEqual(r.linked.duplicates, []);
  assert.deepEqual(r.linked.fixtureProblems, []);
  assert.deepEqual(r.excluded, []);
  // A fully played week has 9 matches (3 pairings × 3), each scored once per model.
  for (const w of r.weekly) if (w.n === w.fixtures) assert.equal(w.n, 9);
  // Week 1 has the baseline only (§4.1).
  assert.ok(!r.weekly.some((w) => w.week === 1 && w.model === 'poisson-v1'));
  // Spot check against the published CSV, by hand: FA26-L2-W03-M01, T1 v T2 1–0, poisson-v1
  // p = 0.2357 / 0.3661 / 0.3982 → RPS = ½[(0.2357 − 1)² + (0.6018 − 1)²].
  const s = r.linked.scored.find((x) => x.match_id === 'FA26-L2-W03-M01' && x.model === 'poisson-v1');
  assert.equal(s.outcome, 'team_a');
  close(s.rps, 0.5 * ((s.p[0] - 1) ** 2 + (s.p[0] + s.p[1] - 1) ** 2));
});

test('FA26-L2: forecasts.csv is append-only and every row was on time', { skip: shallow && 'shallow clone' }, () => {
  const r = score('FA26-L2');
  assert.deepEqual(r.history.violations, []);
  assert.deepEqual(r.excluded, []);
});
