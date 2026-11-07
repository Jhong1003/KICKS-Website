import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../worker/index.js';
import {
  VERSION, MAX_SHOTS, SAVE_WINDOW, PERFECT_WINDOW, shotsFor, judge, replay, validInputs,
} from '../src/lib/keeper/rules.js';

// D1's API over a real in-memory SQLite, with the actual migration applied,
// so the Worker's SQL (upsert, RETURNING, rank) runs for real.
function sqliteD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0004_keeper_arcade.sql', import.meta.url), 'utf8'));
  const statement = (sql, args = []) => ({
    bind: (...next) => statement(sql, next),
    async first() { return db.prepare(sql).get(...args) ?? null; },
    async all() { return { results: db.prepare(sql).all(...args) }; },
    async run() { const { changes } = db.prepare(sql).run(...args); return { meta: { changes: Number(changes) } }; },
  });
  return { raw: db, prepare: (sql) => statement(sql), async batch(list) { return Promise.all(list.map((s) => s.run())); } };
}

const ORIGIN = 'https://kicksuiuc.com';
const ASSETS = { fetch() { throw Error('API must not fall through to assets'); } };
function client(env) {
  let cookie = '';
  const call = async (body, headers = {}) => {
    const response = await worker.fetch(new Request(`${ORIGIN}/api/keeper`, body ? {
      method: 'POST', body: JSON.stringify(body),
      headers: { Origin: ORIGIN, 'X-Kicks-Keeper': '1', 'Content-Type': 'application/json', Cookie: cookie, ...headers },
    } : { headers: { Cookie: cookie } }), env);
    const set = response.headers.get('Set-Cookie');
    if (set) cookie = set.split(';')[0];
    return { status: response.status, data: await response.json(), set };
  };
  return { call, get cookie() { return cookie; } };
}

// Freeze the server clock so timing rules can be tested.
function clock(start = 1_800_000_000_000) {
  const real = Date.now;
  let now = start;
  Date.now = () => now;
  return { advance(ms) { now += ms; }, restore() { Date.now = real; } };
}

const perfectInputs = (seed) => shotsFor(seed).map((s) => ({ at: s.impact, direction: s.direction }));
const firstShot = (direction) => ({ ...shotsFor(1)[0], direction });

test('shots are deterministic, get faster and never overlap', () => {
  const a = shotsFor(42), b = shotsFor(42);
  assert.deepEqual(a, b);
  assert.equal(a.length, MAX_SHOTS);
  for (let i = 1; i < a.length; i++) {
    assert.ok(a[i].flight <= a[i - 1].flight);
    assert.ok(a[i].start >= a[i - 1].impact + SAVE_WINDOW, 'input windows must not overlap');
  }
  assert.notDeepEqual(shotsFor(1).map((s) => s.direction), shotsFor(2).map((s) => s.direction));
});

test('corner shots: the right corner saves, timing it makes it perfect', () => {
  const shot = firstShot('tl');
  assert.equal(judge(shot, { at: shot.impact, direction: 'tl' }).kind, 'perfect');
  assert.equal(judge(shot, { at: shot.impact + PERFECT_WINDOW, direction: 'tl' }).kind, 'perfect');
  assert.equal(judge(shot, { at: shot.impact - PERFECT_WINDOW - 1, direction: 'tl' }).kind, 'save');
  assert.equal(judge(shot, { at: shot.impact + SAVE_WINDOW, direction: 'tl' }).kind, 'save');
  // Diving the right way early still puts the gloves on the ball.
  assert.equal(judge(shot, { at: shot.start, direction: 'tl' }).kind, 'save');
  assert.deepEqual(judge(shot, { at: shot.impact, direction: 'tr' }), { kind: 'goal', reason: 'direction', points: 0 });
  assert.deepEqual(judge(shot, { at: shot.impact, direction: 'center' }), { kind: 'goal', reason: 'direction', points: 0 });
  assert.deepEqual(judge(shot, undefined), { kind: 'goal', reason: 'late', points: 0 });
});

test('center shots: standing still saves, a timed tap is perfect, diving away concedes', () => {
  const shot = firstShot('center');
  assert.deepEqual(judge(shot, undefined), { kind: 'save', reason: 'stay', points: 100 });
  assert.equal(judge(shot, { at: shot.impact, direction: 'center' }).kind, 'perfect');
  assert.equal(judge(shot, { at: shot.start, direction: 'center' }).kind, 'save');
  assert.equal(judge(shot, { at: shot.impact, direction: 'bl' }).kind, 'goal');
});

test('replay scores combos, stops at three goals and only once a window has closed', () => {
  const seed = 7, shots = shotsFor(seed);
  const all = replay(seed, perfectInputs(seed));
  assert.equal(all.finished, true);
  assert.equal(all.resolved, MAX_SHOTS);
  assert.equal(all.perfect, MAX_SHOTS);
  assert.equal(all.lives, 3);
  // 200 per perfect save + 10 per three-save streak step, capped at 100.
  const expected = shots.reduce((sum, _, i) => sum + 200 + Math.min(100, Math.floor((i + 1) / 3) * 10), 0);
  assert.equal(all.score, expected);

  // Wrong corner every time: center shots are still saved by standing still,
  // so the run lasts until the third corner shot.
  const wrong = shots.map((s) => s.direction === 'center' ? null : { at: s.impact, direction: s.direction === 'tl' ? 'br' : 'tl' }).filter(Boolean);
  const lost = replay(seed, wrong);
  assert.equal(lost.lives, 0);
  assert.equal(lost.finished, true);
  assert.equal(lost.outcomes.filter((o) => o.kind === 'goal').length, 3);
  assert.equal(lost.finishedAt, shots[lost.resolved - 1].impact + SAVE_WINDOW);

  assert.equal(replay(seed, [], shots[0].impact + SAVE_WINDOW - 1).resolved, 0);
  assert.equal(replay(seed, [], shots[0].impact + SAVE_WINDOW).resolved, 1);
});

test('validInputs: one move per shot, in order, inside a shot window', () => {
  const seed = 3, shots = shotsFor(seed);
  assert.equal(validInputs(seed, perfectInputs(seed)), true);
  assert.equal(validInputs(seed, []), true);
  assert.equal(validInputs(seed, [{ at: shots[0].impact, direction: 'tl' }, { at: shots[0].impact + 1, direction: 'tr' }]), false);
  assert.equal(validInputs(seed, [{ at: shots[0].impact + SAVE_WINDOW + 1, direction: 'tl' }]), false, 'gap between shots');
  assert.equal(validInputs(seed, [{ at: shots[1].impact, direction: 'tl' }, { at: shots[0].impact, direction: 'tl' }]), false);
  assert.equal(validInputs(seed, [{ at: shots[0].impact, direction: 'up' }]), false);
  assert.equal(validInputs(seed, [{ at: Number.NaN, direction: 'tl' }]), false);
  assert.equal(validInputs(seed, 'nope'), false);
});

test('API: start → finish ranks a replayed score, keeps only the personal best', async () => {
  const time = clock();
  try {
    const env = { ASSETS, VISITS_DB: sqliteD1() };
    const me = client(env);
    const start = await me.call({ action: 'start', name: '  골키퍼   Jihwan ' });
    assert.equal(start.status, 200);
    assert.match(start.set, /HttpOnly; Secure; SameSite=Strict/);
    assert.equal(start.data.version, VERSION);

    const inputs = perfectInputs(start.data.seed);
    const expected = replay(start.data.seed, inputs);
    // Finishing faster than the run could be played is refused.
    time.advance(1000);
    assert.deepEqual((await me.call({ action: 'finish', id: start.data.id, version: VERSION, inputs })).data, { error: 'timing' });
    time.advance(expected.finishedAt);
    const done = await me.call({ action: 'finish', id: start.data.id, version: VERSION, inputs });
    assert.equal(done.status, 200);
    assert.deepEqual(done.data, { score: expected.score, saves: 30, perfect: 30, bestCombo: 30, newBest: true });
    // A run counts once.
    assert.equal((await me.call({ action: 'finish', id: start.data.id, version: VERSION, inputs })).status, 409);

    // A worse second run is accepted but doesn't replace the best.
    time.advance(5000);
    const second = await me.call({ action: 'start', name: 'Other name' });
    const none = replay(second.data.seed, []);
    time.advance(none.finishedAt + 10);
    const worse = await me.call({ action: 'finish', id: second.data.id, version: VERSION, inputs: [] });
    assert.equal(worse.data.newBest, false);

    const other = client(env);
    time.advance(3000);
    const theirs = await other.call({ action: 'start', name: 'Rival' });
    time.advance(replay(theirs.data.seed, []).finishedAt + 10);
    await other.call({ action: 'finish', id: theirs.data.id, version: VERSION, inputs: [] });

    const board = await me.call();
    assert.equal(board.status, 200);
    assert.equal(board.data.entries[0].name, '골키퍼 Jihwan');
    assert.equal(board.data.entries[0].score, expected.score);
    assert.equal(board.data.best, expected.score);
    assert.equal(board.data.rank, 1);
    assert.equal((await other.call()).data.rank, 2);
    assert.equal((await client(env).call()).data.best, null);
  } finally { time.restore(); }
});

test('API: refuses bad names, tampered inputs, cross-site posts and rapid restarts', async () => {
  const time = clock();
  try {
    const env = { ASSETS, VISITS_DB: sqliteD1() };
    const me = client(env);
    for (const name of ['', ' ', 'x'.repeat(17), '<script>', 'a;b']) {
      assert.deepEqual((await me.call({ action: 'start', name })).data, { error: 'name' });
    }
    assert.equal((await me.call({ action: 'start', name: 'ok' }, { Origin: 'https://evil.example' })).status, 403);
    assert.equal((await me.call({ action: 'start', name: 'ok' }, { 'X-Kicks-Keeper': '' })).status, 403);
    const start = await me.call({ action: 'start', name: 'ok' });
    assert.equal((await me.call({ action: 'start', name: 'ok' })).status, 429);

    time.advance(131000); // past MAX_DURATION + 30 s grace
    const twice = [{ at: shotsFor(start.data.seed)[0].impact, direction: 'tl' }, { at: shotsFor(start.data.seed)[0].impact + 5, direction: 'tr' }];
    assert.equal((await me.call({ action: 'finish', id: start.data.id, version: VERSION, inputs: twice })).status, 409, 'expired after the run limit');

    time.advance(3000);
    const fresh = await me.call({ action: 'start', name: 'ok' });
    time.advance(90000);
    assert.equal((await me.call({ action: 'finish', id: fresh.data.id, version: VERSION, inputs: twice })).data.error, 'input');
    assert.equal((await me.call({ action: 'finish', id: fresh.data.id, version: VERSION + 1, inputs: [] })).data.error, 'input');
    assert.equal((await client(env).call({ action: 'finish', id: fresh.data.id, version: VERSION, inputs: [] })).status, 400, 'another browser cannot finish it');
    assert.equal(env.VISITS_DB.raw.prepare('SELECT COUNT(*) n FROM keeper_scores').get().n, 0);
    assert.equal((await worker.fetch(new Request(`${ORIGIN}/api/keeper`, { method: 'PUT' }), env)).status, 405);
  } finally { time.restore(); }
});

test('API without a database answers 503 instead of falling through', async () => {
  const response = await worker.fetch(new Request(`${ORIGIN}/api/keeper`), { ASSETS });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});
