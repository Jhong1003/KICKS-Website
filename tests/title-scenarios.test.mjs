import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { titleStatus } from '../src/lib/championship-simulator.ts';
import { analyseScenarios, conditionText, decodeScenario, encodeScenario, scenarioAvailable, scenarioSetup } from '../src/lib/title-scenarios.ts';
const read = path => JSON.parse(fs.readFileSync(new URL(path, import.meta.url), 'utf8'));
const rules = read('../src/data/league-config.json')._default;
const ids = ['T1', 'T2', 'T3'];
const pairs = [['T1', 'T2'], ['T1', 'T3'], ['T2', 'T3']];
// A final week: three matches per pair, nine in all.
const finalWeek = pairs.flatMap(([home, away]) => [0, 1, 2].map(i => ({ key: `${home}${away}${i}`, week: rules.weeks, home, away, virtual: false })));
const model = (points, remaining = finalWeek) => ({ rules, base: ids.map((id, i) => ({ team_id: id, points: points[i], participation_rate: 1 })), remaining });

test('enumerates every completion of the final week', () => {
 const a = analyseScenarios(model([20, 19, 15]));
 assert.equal(a.completions, 3 ** 9);
 for (const t of Object.values(a.teams)) assert.ok(t.outright + t.shared <= a.completions);
 assert.equal(a.final, null);
});

test('clinch condition: k wins guarantees the title, k-1 does not', () => {
 const m = model([20, 19, 15]);
 const a = analyseScenarios(m);
 const k = a.teams.T1.clinchWins;
 assert.ok(k !== null && k > 0);
 // Any fixed set of k T1 wins (rest losses) must leave T1 alone on top.
 const t1 = m.remaining.filter(x => x.home === 'T1' || x.away === 'T1');
 const fixed = Object.fromEntries(t1.map((x, i) => [x.key, i < k ? (x.home === 'T1' ? 'H' : 'A') : (x.home === 'T1' ? 'A' : 'H')]));
 assert.equal(analyseScenarios(m, fixed).teams.T1.status, 'clinched');
});

test('agrees with titleStatus on settled teams', () => {
 for (const points of [[40, 10, 10], [30, 29, 1], [12, 12, 12], [25, 7, 20]]) {
  const m = model(points);
  const a = analyseScenarios(m);
  const sim = titleStatus({ league: { rules, teams: ids.map(team_id => ({ team_id })) }, base: m.base, remaining: m.remaining });
  for (const id of ids) {
   if (sim[id] === 'eliminated') assert.equal(a.teams[id].status, 'eliminated', `${points} ${id}`);
   if (sim[id] === 'clinched') assert.equal(a.teams[id].status, 'clinched', `${points} ${id}`);
  }
 }
});

test('a fully fixed scenario reports the leaders, ties included', () => {
 const m = model([10, 10, 0]);
 const draws = Object.fromEntries(m.remaining.map(x => [x.key, 'D']));
 const a = analyseScenarios(m, draws);
 assert.equal(a.completions, 1);
 assert.deepEqual(a.final.leaders, ['T1', 'T2']);
 assert.equal(a.final.points.T1, 10 + 6 * rules.draw_points);
});

test('tie-only teams and their wording', () => {
 // T3 can at best draw level: 0 + 6*3 = 18 vs T1 on 18 who cannot lose points.
 const a = analyseScenarios(model([18, 0, 0]));
 assert.equal(a.teams.T3.tieOnly, true);
 assert.equal(a.teams.T3.minWins, null);
 assert.match(conditionText(a.teams.T3)[0].ko, /동점/);
});

test('share code round-trips and ignores junk', () => {
 const m = model([20, 19, 15]);
 const fixed = { [m.remaining[0].key]: 'H', [m.remaining[4].key]: 'D' };
 const code = encodeScenario(m, fixed);
 assert.equal(code, 'H---D----');
 assert.deepEqual(decodeScenario(m, code), fixed);
 assert.deepEqual(decodeScenario(m, 'HHH'), {});
 assert.deepEqual(decodeScenario(m, 'X--------'), {});
});

test('only offered when the final week is all that is left', () => {
 assert.equal(scenarioAvailable(model([0, 0, 0])), true);
 assert.equal(scenarioAvailable(model([0, 0, 0], finalWeek.map(x => ({ ...x, week: rules.weeks - 1 })))), false);
 assert.equal(scenarioAvailable(model([0, 0, 0], [])), false);
});

test('real data: live league and finished league archive', () => {
 const leagues = read('../src/data/leagues.json');
 const matches = read('../src/data/matches.json');
 const table = read('../src/data/league_table.json');
 const history = read('../src/data/standings_history.json');
 for (const league of leagues) {
  const own = matches.filter(m => m.league === league.id);
  const setup = scenarioSetup(league, matches, table, history);
  if (own.length && own.every(m => m.status === 'completed')) {
   assert.equal(setup.mode, 'archive', league.id);
   assert.equal(Object.keys(setup.actual).length, setup.model.remaining.length);
   // The real results must land on the real champion's points.
   const final = analyseScenarios(setup.model, setup.actual).final;
   const champions = table.filter(r => r.league === league.id && r.rank === 1).map(r => r.team_id);
   for (const id of champions) assert.ok(final.leaders.includes(id), league.id);
   for (const row of table.filter(r => r.league === league.id)) assert.equal(final.points[row.team_id], row.points);
  }
 }
});
