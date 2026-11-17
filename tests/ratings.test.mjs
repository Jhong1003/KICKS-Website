import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '../worker/index.js';
import { SESSION_DAYS, validComps, validPlayers, validScores } from '../functions/api/ratings.js';

// D1's API over a real in-memory SQLite with the migration applied (same helper as keeper.test.mjs).
function sqliteD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0006_player_ratings.sql', import.meta.url), 'utf8'));
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
const KEY = 'staff-secret';
const env = () => ({ VISITS_DB: sqliteD1(), PERKS_ADMIN_KEY: KEY, ASSETS });

async function call(e, { query = '', body, staff = false, rater = false, headers = {} } = {}) {
  const h = { ...headers };
  if (staff) h.Authorization = `Bearer ${KEY}`;
  if (rater) Object.assign(h, { Origin: ORIGIN, 'X-Kicks-Rate': '1' });
  if (body) h['Content-Type'] = 'application/json';
  const response = await worker.fetch(new Request(`${ORIGIN}/api/ratings${query}`, body ? { method: 'POST', body: JSON.stringify(body), headers: h } : { headers: h }), e);
  return { status: response.status, data: await response.json() };
}

const PLAYERS = [['홍지환', 0], ['김철수', 1], ['이영희', 0]];

test('validators', () => {
  assert.deepEqual(validPlayers([[' a ', 0], ['b', 'x']]), [['a', 0], ['b', 1]]);
  assert.equal(validPlayers([['a', 0]]), null, 'needs two');
  assert.equal(validPlayers([['a', 0], ['a', 1]]), null, 'unique names');
  assert.deepEqual(validScores({ 0: 3.5, 2: 5 }, 3), { 0: 3.5, 2: 5 });
  assert.equal(validScores({ 3: 3 }, 3), null);
  assert.equal(validScores({ 0: 3.2 }, 3), null, 'halves only');
  assert.equal(validScores({ 0: 6 }, 3), null);
  assert.deepEqual(validComps([[0, 1, 2]], 3), [[0, 1, 2]]);
  assert.equal(validComps([[0, 0, 1]], 3), null);
  assert.equal(validComps([[0, 3, 1]], 3), null);
  assert.equal(validComps([[0, 1, 3]], 3), null);
});

test('staff create → raters submit → staff read results', async () => {
  const e = env();
  assert.equal((await call(e, { body: { action: 'create', players: PLAYERS } })).status, 401, 'create needs the staff key');
  const made = await call(e, { body: { action: 'create', title: 'SP27 L1', players: PLAYERS }, staff: true });
  assert.equal(made.status, 200);
  const id = made.data.id;
  assert.match(id, /^[a-z0-9]{16}$/);

  const open = await call(e, { query: `?s=${id}` });
  assert.deepEqual(open.data, { id, title: 'SP27 L1', players: PLAYERS });

  const submit = (token, who, scores, comps, extra = {}) =>
    call(e, { body: { action: 'submit', s: id, token, who, scores, comps }, rater: true, ...extra });
  assert.equal((await submit('tok-aaaaaaaaaaaaaaaa', 'A', { 0: 4 }, [], { rater: false })).status, 403, 'same-origin header check');
  assert.equal((await submit('tok-aaaaaaaaaaaaaaaa', '', { 0: 4 }, [])).status, 400, 'name required');
  assert.equal((await submit('tok-aaaaaaaaaaaaaaaa', 'A', {}, [])).status, 400, 'empty refused');
  assert.equal((await submit('tok-aaaaaaaaaaaaaaaa', 'A', { 0: 9 }, [])).status, 400);
  assert.equal((await submit('tok-aaaaaaaaaaaaaaaa', 'A', { 0: 4 }, [[0, 1, 0]])).status, 200);
  assert.equal((await submit('tok-aaaaaaaaaaaaaaaa', 'A', { 0: 4.5 }, [[0, 1, 0], [1, 2, 2]])).status, 200, 'resend replaces');
  assert.equal((await submit('tok-bbbbbbbbbbbbbbbb', 'B', {}, [[2, 0, 1]])).status, 200);
  assert.equal((await call(e, { body: { action: 'submit', s: 'zzzzzzzzzzzzzzzz', token: 'tok-aaaaaaaaaaaaaaaa', who: 'A', scores: { 0: 3 } }, rater: true })).status, 404);

  assert.equal((await call(e, { query: `?s=${id}&results=1` })).status, 401, 'results need the staff key');
  const res = await call(e, { query: `?s=${id}&results=1`, staff: true });
  assert.equal(res.data.results.length, 2);
  const a = res.data.results.find((r) => r.who === 'A');
  assert.deepEqual(a.s, { 0: 4.5 });
  assert.deepEqual(a.c, [[0, 1, 0], [1, 2, 2]]);

  const list = await call(e, { query: '?list=1', staff: true });
  assert.deepEqual(list.data.sessions.map((s) => [s.id, s.players, s.raters]), [[id, 3, 2]]);

  assert.equal((await call(e, { body: { action: 'delete', s: id }, staff: true })).status, 200);
  assert.equal((await call(e, { query: `?s=${id}` })).status, 404);
  assert.equal(e.VISITS_DB.raw.prepare('SELECT COUNT(*) AS n FROM rating_results').get().n, 0, 'results deleted with the session');
});

test('old sessions close', async () => {
  const e = env();
  const { data: { id } } = await call(e, { body: { action: 'create', players: PLAYERS }, staff: true });
  e.VISITS_DB.raw.prepare('UPDATE rating_sessions SET created_at = ?').run(Date.now() - (SESSION_DAYS + 1) * 86_400_000);
  assert.equal((await call(e, { query: `?s=${id}` })).status, 404);
  assert.deepEqual((await call(e, { query: '?list=1', staff: true })).data.sessions, []);
});
