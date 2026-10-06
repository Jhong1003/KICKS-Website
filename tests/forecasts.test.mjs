// Published forecasts (forecasts/*.csv) and the script that makes them
// (scripts/make_forecasts.mjs). Run: node --test tests/forecasts.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const root = new URL('../', import.meta.url);
const csv = (path) => {
  const [header, ...lines] = readFileSync(new URL(path, root), 'utf8').trim().split(/\r?\n/);
  const cols = header.split(',');
  return lines.filter(Boolean).map((line) => Object.fromEntries(line.split(',').map((v, i) => [cols[i], v])));
};
const run = (...args) => execFileSync(process.execPath, ['scripts/make_forecasts.mjs', ...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

test('match forecasts: probabilities sum to 1, one published row per (league, week, pairing, model)', () => {
  const rows = csv('forecasts/forecasts.csv');
  const seen = new Set();
  for (const r of rows) {
    assert.ok(Math.abs(Number(r.p_a) + Number(r.p_draw) + Number(r.p_b) - 1) < 1e-9, JSON.stringify(r));
    assert.ok(r.team_a < r.team_b, 'team_a is the smaller team_id');
    if (r.status !== 'published') continue;
    const key = [r.league, r.week, r.team_a, r.team_b, r.model].join('|');
    assert.ok(!seen.has(key), `duplicate published forecast ${key}`);
    seen.add(key);
  }
});

test('title forecasts: each published (league, week, model) sums to 1, one row per team', () => {
  const rows = csv('forecasts/title_forecasts.csv').filter((r) => r.status === 'published');
  const groups = new Map();
  for (const r of rows) {
    const key = [r.league, r.week, r.model].join('|');
    const g = groups.get(key) ?? [];
    assert.ok(!g.some((x) => x.team === r.team), `duplicate ${key} ${r.team}`);
    g.push(r);
    groups.set(key, g);
  }
  for (const [key, g] of groups) assert.ok(Math.abs(g.reduce((s, r) => s + Number(r.p_title), 0) - 1) < 1e-9, key);
});

test('script: a replayed week is reproducible (seeded) and probabilities are sane', () => {
  const a = run('--league', 'FA26-L1', '--week', '2', '--dry-run', '--replay');
  const b = run('--league', 'FA26-L1', '--week', '2', '--dry-run', '--replay');
  assert.equal(a, b);
  assert.match(a, /poisson-v1\s+T1 v T2/);
  assert.match(a, /poisson-v1-title T2/);
  assert.match(a, /Dry run — nothing written/);
});

test('script: refuses to forecast a week whose previous week is not scored', () => {
  assert.throws(() => run('--league', 'FA26-L2', '--week', '3', '--dry-run'), /aren't fully scored|Expected/);
});
