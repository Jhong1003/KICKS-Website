import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../worker/index.js';
import {
  VERSION, KICKS, BALL_R, V_REF, BONUS, kicksFor, camera, project, validSwipe, shotFromSwipe, judgeKick, replay,
} from '../src/lib/freekick/rules.js';
import { validSwipes } from '../functions/api/freekick.js';

// A swipe from the ball to a point on the goal plane: n steps of `step` ms,
// bowed sideways by `bow` (share of its length), integer canvas units.
function swipeTo(kick, x, y, { step = 9, bow = 0, n = 14 } = {}) {
  const cam = camera(kick);
  const [bx, by] = project(cam, kick.x0, BALL_R, kick.D);
  const [ex, ey] = project(cam, x, y, 0);
  const len = Math.hypot(ex - bx, ey - by);
  return Array.from({ length: n + 1 }, (_, i) => {
    const p = i / n, b = bow * len * Math.sin(Math.PI * p);
    return [i * step, Math.round(bx + (ex - bx) * p + b * (ey - by) / len), Math.round(by + (ey - by) * p - b * (ex - bx) / len)];
  });
}
// The far top corner, away from the wall.
const farCorner = (kick) => [-kick.side * 1.3, 1.7];

test('kicks are deterministic and get harder', () => {
  assert.deepEqual(kicksFor(9), kicksFor(9));
  assert.notDeepEqual(kicksFor(1), kicksFor(2));
  const kicks = kicksFor(5);
  assert.equal(kicks.length, KICKS);
  assert.equal(kicks[0].wall.length, 2);
  assert.equal(kicks.at(-1).wall.length, 4);
  assert.ok(kicks.at(-1).keeper.speed > kicks[0].keeper.speed);
  assert.ok(kicks.at(-1).keeper.react < kicks[0].keeper.react);
  assert.equal(kicks[0].jump, false);
  assert.ok(kicks.every((k) => !k.golden || (k.index > 0 && !k.last)));
  assert.ok(kicks.at(-1).last);
  assert.ok(kicks.slice(0, 3).every((k) => k.wind === 0));
});

test('swipes must go up from the ball, in time order, and not too long', () => {
  const kick = kicksFor(1)[0];
  const ok = swipeTo(kick, ...farCorner(kick));
  assert.equal(validSwipe(ok), true);
  assert.equal(validSwipe(ok.slice(0, 2)), false, 'too few points');
  assert.equal(validSwipe([[0, 320, 400], [10, 320, 410], [20, 320, 420]]), false, 'downward');
  assert.equal(validSwipe([[0, 320, 490], [20, 320, 400], [10, 320, 300]]), false, 'time going back');
  assert.equal(validSwipe([[0, 320, 490], [900, 320, 400], [1600, 320, 300]]), false, 'too slow');
  assert.equal(validSwipe([[0, 320, 490], [10, 320, 400], [20, NaN, 300]]), false);
  assert.equal(validSwipes([ok]), false, 'a finished run has ten swipes');
});

test('the swipe end is the aim; a short flick carries on toward the goal', () => {
  const kick = kicksFor(1)[0];
  const shot = shotFromSwipe(kick, swipeTo(kick, 1.2, 1.5));
  assert.ok(Math.abs(shot.aim[0] - 1.2) < 0.05 && Math.abs(shot.aim[1] - 1.5) < 0.05);
  // a short flick stopping far below the goal still aims at its upper half
  const short = swipeTo(kick, 1.2, 1.5).slice(0, 6);
  assert.ok(shotFromSwipe(kick, short).aim[1] > 1.4);
});

test('a soft shot arrives lower than a hard one aimed at the same spot', () => {
  const kick = kicksFor(1)[0];
  const hard = judgeKick(kick, swipeTo(kick, -kick.side * 1.3, 1.6, { step: 5 }));
  const soft = judgeKick(kick, swipeTo(kick, -kick.side * 1.3, 1.6, { step: 22 }));
  assert.ok(hard.shot.v > soft.shot.v);
  const height = (r) => r.at[1];
  assert.ok(height(hard) > height(soft) + 0.3, `${height(hard)} vs ${height(soft)}`);
  assert.ok(soft.shot.v < V_REF);
});

test('a curled swipe bends the ball the way it bows, and the bonuses add up', () => {
  const kick = kicksFor(1)[0];
  const straight = shotFromSwipe(kick, swipeTo(kick, 1.2, 1.6));
  const bowed = shotFromSwipe(kick, swipeTo(kick, 1.2, 1.6, { bow: 0.25 }));
  assert.equal(Math.abs(straight.curl), 0, 'a nearly straight line has no curl');
  assert.ok(Math.abs(bowed.curl) >= 0.13);
  // find a corner goal and check its points
  let found = null;
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const k = kicksFor(seed)[0];
    const r = judgeKick(k, swipeTo(k, ...farCorner(k)));
    if (r.kind === 'goal') { found = r; break; }
  }
  assert.ok(found, 'a far top-corner shot scores on the first kick');
  assert.ok(found.bonuses.some(([key, pts]) => key === 'top' && pts === BONUS.top));
});

test('replay: streak, golden and last-kick multipliers', () => {
  // seed whose first kicks score with a far-corner shot
  let seed = 1;
  for (; seed < 200; seed++) {
    const ks = kicksFor(seed);
    if ([0, 1].every((i) => judgeKick(ks[i], swipeTo(ks[i], ...farCorner(ks[i]))).kind === 'goal')) break;
  }
  const ks = kicksFor(seed);
  const res = replay(seed, ks.slice(0, 2).map((k) => swipeTo(k, ...farCorner(k))));
  const [a, b] = res.outcomes;
  assert.equal(a.kind, 'goal'); assert.equal(b.kind, 'goal');
  assert.equal(a.points, Math.round(a.base * (ks[0].golden ? 2 : 1)));
  assert.equal(b.points, Math.round(b.base * 1.5 * (ks[1].golden ? 2 : 1)), 'second in a row is ×1.5');
  assert.equal(res.score, a.points + b.points);
  assert.equal(res.finished, false);
});

// ---------- API, against real SQLite with the migration applied ----------
function sqliteD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0005_freekick.sql', import.meta.url), 'utf8'));
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
    const response = await worker.fetch(new Request(`${ORIGIN}/api/freekick`, body ? {
      method: 'POST', body: JSON.stringify(body),
      headers: { Origin: ORIGIN, 'X-Kicks-Freekick': '1', 'Content-Type': 'application/json', Cookie: cookie, ...headers },
    } : { headers: { Cookie: cookie } }), env);
    const set = response.headers.get('Set-Cookie');
    if (set) cookie = set.split(';')[0];
    return { status: response.status, data: await response.json(), set };
  };
  return { call };
}
function clock(start = 1_800_000_000_000) {
  const real = Date.now;
  let now = start;
  Date.now = () => now;
  return { advance(ms) { now += ms; }, restore() { Date.now = real; } };
}
const allCorners = (seed) => kicksFor(seed).map((k) => swipeTo(k, ...farCorner(k)));

test('API: start → finish replays the swipes, keeps the best, one row per name', async () => {
  const time = clock();
  try {
    const env = { ASSETS, VISITS_DB: sqliteD1() };
    const me = client(env);
    const start = await me.call({ action: 'start', name: ' 킥스  회장 ' });
    assert.equal(start.status, 200);
    assert.match(start.set, /kicks-freekick=.*HttpOnly; Secure; SameSite=Strict/);
    const swipes = allCorners(start.data.seed);
    const expected = replay(start.data.seed, swipes);
    time.advance(5000);
    assert.deepEqual((await me.call({ action: 'finish', id: start.data.id, version: VERSION, swipes })).data, { error: 'timing' });
    time.advance(30000);
    const done = await me.call({ action: 'finish', id: start.data.id, version: VERSION, swipes });
    assert.deepEqual(done.data, { score: expected.score, goals: expected.goals, bestKick: expected.bestKick, newBest: true });
    assert.equal((await me.call({ action: 'finish', id: start.data.id, version: VERSION, swipes })).status, 409, 'a run counts once');

    // the same name from another browser with a lower score: still one row
    const other = client(env);
    time.advance(3000);
    const s2 = await other.call({ action: 'start', name: '킥스 회장' });
    time.advance(30000);
    const low = kicksFor(s2.data.seed).map((k) => swipeTo(k, 0, 0.3));
    await other.call({ action: 'finish', id: s2.data.id, version: VERSION, swipes: low });
    const board = await me.call();
    assert.equal(board.data.entries.length, 1);
    assert.equal(board.data.entries[0].name, '킥스 회장');
    assert.equal(board.data.entries[0].score, expected.score);
    assert.deepEqual(Object.keys(board.data.entries[0]), ['name', 'score', 'goals', 'best_kick']);
    assert.equal(board.data.rank, 1);
  } finally { time.restore(); }
});

test('API: refuses bad names, bad swipes, cross-site posts and rapid restarts', async () => {
  const time = clock();
  try {
    const env = { ASSETS, VISITS_DB: sqliteD1() };
    const me = client(env);
    for (const name of ['', 'x'.repeat(17), '<b>', 'a;b']) assert.deepEqual((await me.call({ action: 'start', name })).data, { error: 'name' });
    assert.equal((await me.call({ action: 'start', name: 'ok' }, { Origin: 'https://evil.example' })).status, 403);
    assert.equal((await me.call({ action: 'start', name: 'ok' }, { 'X-Kicks-Freekick': '' })).status, 403);
    const start = await me.call({ action: 'start', name: 'ok' });
    assert.equal((await me.call({ action: 'start', name: 'ok' })).status, 429);
    time.advance(30000);
    const swipes = allCorners(start.data.seed);
    const nine = swipes.slice(0, 9);
    assert.equal((await me.call({ action: 'finish', id: start.data.id, version: VERSION, swipes: nine })).data.error, 'input');
    const fractional = swipes.map((s, i) => (i ? s : s.map(([t, x, y]) => [t, x + 0.5, y])));
    assert.equal((await me.call({ action: 'finish', id: start.data.id, version: VERSION, swipes: fractional })).data.error, 'input');
    assert.equal((await me.call({ action: 'finish', id: start.data.id, version: VERSION + 1, swipes })).data.error, 'input');
    assert.equal((await client(env).call({ action: 'finish', id: start.data.id, version: VERSION, swipes })).status, 400, 'another browser cannot finish it');
    assert.equal(env.VISITS_DB.raw.prepare('SELECT COUNT(*) n FROM freekick_scores').get().n, 0);
    time.advance(31 * 60000);
    assert.equal((await me.call({ action: 'finish', id: start.data.id, version: VERSION, swipes })).status, 409, 'expired');
  } finally { time.restore(); }
});

test('API without a database answers 503', async () => {
  const response = await worker.fetch(new Request(`${ORIGIN}/api/freekick`), { ASSETS });
  assert.equal(response.status, 503);
});
