import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import worker from '../worker/index.js';
import {
  onRequest, perkIsOpen, secretMatches, memberIds, REPEAT_WINDOW_MS,
} from '../functions/api/perks.js';

// Minimal D1 stand-in on top of Node's built-in SQLite.
function d1(db) {
  return {
    prepare(sql) {
      const stmt = db.prepare(sql);
      return {
        bind: (...args) => ({
          first: async () => stmt.get(...args) ?? null,
          all: async () => ({ results: stmt.all(...args) }),
          run: async () => stmt.run(...args),
        }),
        all: async () => ({ results: stmt.all() }),
      };
    },
  };
}

function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0002_perk_redemptions.sql', import.meta.url), 'utf8'));
  return { db, env: { VISITS_DB: d1(db), PERKS_CODE: 'kicks-2026', PERKS_ADMIN_KEY: 'staff-key' } };
}

const ORIGIN = 'https://kicksuiuc.com';
const member = [...memberIds][0];
const post = (path, body, headers = { Origin: ORIGIN, 'Sec-Fetch-Site': 'same-origin' }) =>
  new Request(`${ORIGIN}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
const openPerks = [{ perk_id: 'sgd', active: true, valid_until: '2026-12-31' }];

test('secrets compare exactly (trimmed), and an unset secret never matches', async () => {
  assert.equal(await secretMatches('kicks-2026', 'kicks-2026'), true);
  assert.equal(await secretMatches(' kicks-2026 ', 'kicks-2026'), true);
  assert.equal(await secretMatches('kicks-2025', 'kicks-2026'), false);
  assert.equal(await secretMatches('', ''), false);
  assert.equal(await secretMatches(undefined, 'x'), false);
});

test('a perk is open only while active and on/before its last day (Chicago date)', () => {
  assert.equal(perkIsOpen(openPerks[0], '2026-12-31'), true);
  assert.equal(perkIsOpen(openPerks[0], '2027-01-01'), false);
  assert.equal(perkIsOpen({ ...openPerks[0], active: false }, '2026-10-02'), false);
  assert.equal(perkIsOpen(null, '2026-10-02'), false);
});

test('inactive players are not members', () => {
  const profiles = JSON.parse(readFileSync(new URL('../src/data/player_profiles.json', import.meta.url), 'utf8'));
  for (const p of profiles) assert.equal(memberIds.has(p.player_id), p.status !== 'inactive');
});

test('non-player board members are members, with unique non-player ids', () => {
  const read = (file) => JSON.parse(readFileSync(new URL(`../src/data/${file}`, import.meta.url), 'utf8'));
  const playerIds = new Set(read('player_profiles.json').map((p) => p.player_id));
  const board = read('board.json');
  const extra = board.filter((m) => m.member_id);
  for (const m of board) {
    assert.ok(Boolean(m.player_id) !== Boolean(m.member_id), `${m.name}: needs exactly one of player_id / member_id`);
    if (m.player_id) assert.ok(playerIds.has(m.player_id), `${m.name}: unknown player_id ${m.player_id}`);
  }
  const ids = extra.map((m) => m.member_id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate member_id in board.json');
  for (const m of extra) {
    assert.ok(m.member_id && m.name, 'every entry needs member_id and name');
    assert.ok(!playerIds.has(m.member_id), `${m.member_id} clashes with a player_id`);
    assert.ok(memberIds.has(m.member_id));
  }
});

test('verify: right code + member only, same-origin POST only, never logs', async () => {
  const { db, env } = setup();
  const ok = await onRequest({ request: post('/api/perks/verify', { code: 'kicks-2026', player_id: member }), env });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('Cache-Control'), 'no-store');
  assert.equal((await onRequest({ request: post('/api/perks/verify', { code: 'nope', player_id: member }), env })).status, 401);
  assert.equal((await onRequest({ request: post('/api/perks/verify', { code: 'kicks-2026', player_id: 'P999' }), env })).status, 404);
  assert.equal((await onRequest({ request: post('/api/perks/verify', { code: 'kicks-2026', player_id: member }, { Origin: 'https://evil.test' }), env })).status, 403);
  assert.equal((await onRequest({ request: new Request(`${ORIGIN}/api/perks/verify`), env })).status, 405);
  assert.equal((await onRequest({ request: post('/api/perks/verify', { code: 'kicks-2026', player_id: member }), env: {} })).status, 503);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM perk_redemptions').get().n, 0);
  db.close();
});

test('redeem: unknown or closed perks are refused', async () => {
  const { db, env } = setup();
  const r = await onRequest({ request: post('/api/perks/redeem', { code: 'kicks-2026', player_id: member, perk_id: 'no-such-place' }), env });
  assert.equal(r.status, 404);
  assert.equal((await r.json()).error, 'perk');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM perk_redemptions').get().n, 0);
  db.close();
});

test('redeem logs once per 30 minutes per member and restaurant; log needs the staff key', async (t) => {
  const perks = JSON.parse(readFileSync(new URL('../src/data/perks.json', import.meta.url), 'utf8'));
  // Temporarily open the first perk in the imported config for this test.
  const mod = await import('../src/data/perks.json', { with: { type: 'json' } });
  const target = mod.default.find((p) => p.perk_id === perks[0].perk_id);
  const wasActive = target.active;
  target.active = true;
  t.after(() => { target.active = wasActive; });

  const { db, env } = setup();
  const now = Date.parse('2026-10-20T23:00:00Z');
  const body = { code: 'kicks-2026', player_id: member, perk_id: target.perk_id };
  const first = await (await onRequest({ request: post('/api/perks/redeem', body), env, now })).json();
  assert.equal(first.repeat, false);
  const again = await (await onRequest({ request: post('/api/perks/redeem', body), env, now: now + 60_000 })).json();
  assert.deepEqual([again.repeat, again.redeemed_at], [true, first.redeemed_at]);
  const later = await (await onRequest({ request: post('/api/perks/redeem', body), env, now: now + REPEAT_WINDOW_MS + 1 })).json();
  assert.equal(later.repeat, false);
  const row = db.prepare('SELECT * FROM perk_redemptions ORDER BY id LIMIT 1').get();
  assert.deepEqual([row.player_id, row.chicago_date], [member, '2026-10-20']);

  const log = (auth) => new Request(`${ORIGIN}/api/perks/log`, { headers: auth ? { Authorization: auth } : {} });
  assert.equal((await onRequest({ request: log(), env })).status, 401);
  assert.equal((await onRequest({ request: log('Bearer wrong'), env })).status, 401);
  const data = await (await onRequest({ request: log('Bearer staff-key'), env })).json();
  assert.deepEqual(data.totals, [{ perk_id: target.perk_id, uses: 2, members: 1 }]);
  assert.equal(data.redemptions.length, 2);
  assert.equal((await onRequest({ request: log('Bearer staff-key'), env: { VISITS_DB: env.VISITS_DB } })).status, 503);
  db.close();
});

test('Worker sends /api/perks/* to the perks handler and leaves other paths alone', async () => {
  const env = { ASSETS: { fetch() { throw Error('perks API must not fall through to assets'); } } };
  const response = await worker.fetch(new Request(`${ORIGIN}/api/perks/unknown`), env);
  assert.equal(response.status, 404);
  const asset = new Response('page');
  const request = new Request(`${ORIGIN}/perks/`);
  assert.equal(await worker.fetch(request, { ASSETS: { fetch: () => asset } }), asset);
});
