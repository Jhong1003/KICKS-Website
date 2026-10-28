import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.js';
import { addSQL, removeSQL, listSQL } from '../functions/api/reactions.js';

// A tiny in-memory stand-in for D1 that understands exactly the three statements.
function fakeDB() {
  const rows = new Map();
  const key = (m, r) => `${m}|${r}`;
  return {
    rows,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              const [m, r] = args;
              if (sql === addSQL) { rows.set(key(m, r), (rows.get(key(m, r)) ?? 0) + 1); return { count: rows.get(key(m, r)) }; }
              if (sql === removeSQL) { if (!rows.has(key(m, r))) return null; rows.set(key(m, r), Math.max(rows.get(key(m, r)) - 1, 0)); return { count: rows.get(key(m, r)) }; }
              throw Error('unexpected first');
            },
            async all() {
              assert.equal(sql, listSQL);
              const prefix = args[0].replace('%', '');
              return { results: [...rows].filter(([k, c]) => k.startsWith(prefix) && c > 0)
                .map(([k, count]) => { const [match_id, reaction] = k.split('|'); return { match_id, reaction, count }; }) };
            },
          };
        },
      };
    },
  };
}
const ASSETS = { fetch() { throw Error('API must not fall through to assets'); } };
const post = (body, headers = {}) => new Request('https://kicksuiuc.com/api/reactions', {
  method: 'POST', body: JSON.stringify(body),
  headers: { Origin: 'https://kicksuiuc.com', 'X-Kicks-Reaction': '1', 'Content-Type': 'application/json', ...headers },
});
const get = (league) => new Request(`https://kicksuiuc.com/api/reactions?league=${league}`);

test('add, take back and list per league', async () => {
  const env = { ASSETS, VISITS_DB: fakeDB() };
  const m = 'FA26-L2-W04-M01';
  assert.deepEqual(await (await worker.fetch(post({ match: m, reaction: 'fire', delta: 1 }), env)).json(), { match: m, reaction: 'fire', count: 1 });
  await worker.fetch(post({ match: m, reaction: 'fire', delta: 1 }), env);
  await worker.fetch(post({ match: m, reaction: 'clap', delta: 1 }), env);
  await worker.fetch(post({ match: 'FA26-L1-W01-M01', reaction: 'cry', delta: 1 }), env);
  assert.equal((await (await worker.fetch(post({ match: m, reaction: 'clap', delta: -1 }), env)).json()).count, 0);
  const { counts } = await (await worker.fetch(get('FA26-L2'), env)).json();
  assert.deepEqual(counts, { [m]: { fire: 2 } });
});

test('never goes below zero or creates rows when taking back', async () => {
  const env = { ASSETS, VISITS_DB: fakeDB() };
  const res = await worker.fetch(post({ match: 'FA26-L2-W01-M02', reaction: 'laugh', delta: -1 }), env);
  assert.equal((await res.json()).count, 0);
  assert.equal(env.VISITS_DB.rows.size, 0);
});

test('rejects bad input and cross-site posts', async () => {
  const env = { ASSETS, VISITS_DB: fakeDB() };
  for (const body of [
    { match: 'FA26-L2-W04', reaction: 'fire', delta: 1 },
    { match: 'FA26-L2-W04-M01', reaction: 'heart', delta: 1 },
    { match: 'FA26-L2-W04-M01', reaction: 'fire', delta: 5 },
    { match: "x' OR 1=1", reaction: 'fire', delta: 1 },
  ]) assert.equal((await worker.fetch(post(body), env)).status, 400);
  assert.equal((await worker.fetch(post({ match: 'FA26-L2-W04-M01', reaction: 'fire', delta: 1 }, { Origin: 'https://evil.example' }), env)).status, 403);
  assert.equal((await worker.fetch(post({ match: 'FA26-L2-W04-M01', reaction: 'fire', delta: 1 }, { 'X-Kicks-Reaction': '' }), env)).status, 403);
  assert.equal((await worker.fetch(get('nope'), env)).status, 400);
  assert.equal(env.VISITS_DB.rows.size, 0);
});

test('no database binding answers 503', async () => {
  const res = await worker.fetch(get('FA26-L2'), { ASSETS });
  assert.equal(res.status, 503);
});
