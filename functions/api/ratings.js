// Staff player ratings for team balancing: /api/ratings (see AGENTS.md, "Player ratings").
//
// Staff (Authorization: Bearer <PERKS_ADMIN_KEY>):
//   GET  ?list=1                       -> { sessions: [{ id, title, players, raters, created_at }] }
//   GET  ?s=<id>&results=1             -> { id, title, players, results: [{ who, s, c, updated_at }] }
//   POST { action: 'create', title, players: [[name, newbie 0|1], ...] } -> { id }
//   POST { action: 'delete', s }        -> { ok }
// Raters (no account; same-origin + X-Kicks-Rate: 1):
//   GET  ?s=<id>                       -> { id, title, players }
//   POST { action: 'submit', s, token, who, scores: { "<index>": 1..5 }, comps: [[a, b, 0|1|2], ...] }
//        one row per (session, browser token); sending again replaces it.
//
// Ratings are private: nothing here is public and results need the staff key.
// The session id is the only thing a rater gets, so it is long and random.
import { secretMatches } from './perks.js';

export const SESSION_ID = /^[a-z0-9]{16}$/;
export const TOKEN = /^[A-Za-z0-9_-]{16,64}$/;
export const MAX_PLAYERS = 80;
export const MAX_COMPS = 3000;
export const SESSION_DAYS = 180;
const MAX_BODY = 200_000;

export const insertSessionSQL = 'INSERT INTO rating_sessions (id, title, players, created_at) VALUES (?1, ?2, ?3, ?4)';
export const sessionSQL = 'SELECT id, title, players, created_at FROM rating_sessions WHERE id = ?1 AND created_at >= ?2';
export const listSQL = `SELECT s.id, s.title, s.players, s.created_at, COUNT(r.rater_token) AS raters
  FROM rating_sessions s LEFT JOIN rating_results r ON r.session_id = s.id
  WHERE s.created_at >= ?1 GROUP BY s.id ORDER BY s.created_at DESC`;
export const resultsSQL = `SELECT rater, scores, comparisons, updated_at FROM rating_results
  WHERE session_id = ?1 ORDER BY updated_at`;
export const upsertSQL = `INSERT INTO rating_results (session_id, rater_token, rater, scores, comparisons, updated_at)
  VALUES (?1, ?2, ?3, ?4, ?5, ?6)
  ON CONFLICT(session_id, rater_token) DO UPDATE SET
    rater = excluded.rater, scores = excluded.scores, comparisons = excluded.comparisons, updated_at = excluded.updated_at`;
export const deleteResultsSQL = 'DELETE FROM rating_results WHERE session_id = ?1';
export const deleteSessionSQL = 'DELETE FROM rating_sessions WHERE id = ?1';

const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const respond = (body, status = 200) => Response.json(body, { status, headers });

const cleanText = (value, max) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '').slice(0, max);

/** [[name, 0|1], ...] with 2..MAX_PLAYERS unique, non-empty names, or null. */
export function validPlayers(players) {
  if (!Array.isArray(players) || players.length < 2 || players.length > MAX_PLAYERS) return null;
  const out = [], seen = new Set();
  for (const p of players) {
    if (!Array.isArray(p)) return null;
    const name = cleanText(p[0], 30);
    if (!name || seen.has(name)) return null;
    seen.add(name);
    out.push([name, p[1] ? 1 : 0]);
  }
  return out;
}

/** Scores keyed by player index, each 1..5 in steps of 0.5. Unknown players are simply absent. */
export function validScores(scores, n) {
  if (scores == null) return {};
  if (typeof scores !== 'object' || Array.isArray(scores)) return null;
  const out = {};
  for (const [k, v] of Object.entries(scores)) {
    const i = Number(k);
    if (!Number.isInteger(i) || i < 0 || i >= n) return null;
    if (typeof v !== 'number' || v < 1 || v > 5 || !Number.isInteger(v * 2)) return null;
    out[i] = v;
  }
  return out;
}

/** [[a, b, result], ...]: a != b player indices; result 0 = a better, 1 = b better, 2 = about the same. */
export function validComps(comps, n) {
  if (comps == null) return [];
  if (!Array.isArray(comps) || comps.length > MAX_COMPS) return null;
  for (const c of comps) {
    if (!Array.isArray(c) || c.length !== 3) return null;
    const [a, b, r] = c;
    if (![a, b].every((x) => Number.isInteger(x) && x >= 0 && x < n) || a === b || ![0, 1, 2].includes(r)) return null;
  }
  return comps.map(([a, b, r]) => [a, b, r]);
}

export function newSessionId() {
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => abc[b % 36]).join('');
}

const parse = (text, fallback) => { try { return JSON.parse(text); } catch { return fallback; } };

async function isStaff(request, env) {
  const auth = request.headers.get('Authorization') ?? '';
  return auth.startsWith('Bearer ') && secretMatches(auth.slice(7), env.PERKS_ADMIN_KEY);
}

function sameOrigin(request) {
  const site = request.headers.get('Sec-Fetch-Site');
  return request.headers.get('Origin') === new URL(request.url).origin &&
    request.headers.get('X-Kicks-Rate') === '1' && (!site || site === 'same-origin');
}

export async function onRequest({ request, env }) {
  if (!['GET', 'POST'].includes(request.method)) return respond({ error: 'method' }, 405);
  if (!env.VISITS_DB) return respond({ error: 'unavailable' }, 503);
  const db = env.VISITS_DB;
  const now = Date.now();
  const oldest = now - SESSION_DAYS * 86_400_000;
  try {
    if (request.method === 'GET') {
      const params = new URL(request.url).searchParams;
      if (params.has('list')) {
        if (!(await isStaff(request, env))) return respond({ error: 'key' }, 401);
        const { results = [] } = await db.prepare(listSQL).bind(oldest).all();
        return respond({
          sessions: results.map((r) => ({ id: r.id, title: r.title, players: parse(r.players, []).length, raters: Number(r.raters), created_at: r.created_at })),
        });
      }
      const id = params.get('s') ?? '';
      if (!SESSION_ID.test(id)) return respond({ error: 'session' }, 404);
      const row = await db.prepare(sessionSQL).bind(id, oldest).first();
      if (!row) return respond({ error: 'session' }, 404);
      const base = { id: row.id, title: row.title, players: parse(row.players, []) };
      if (!params.has('results')) return respond(base);
      if (!(await isStaff(request, env))) return respond({ error: 'key' }, 401);
      const { results = [] } = await db.prepare(resultsSQL).bind(id).all();
      return respond({
        ...base,
        results: results.map((r) => ({ who: r.rater, s: parse(r.scores, {}), c: parse(r.comparisons, []), updated_at: r.updated_at })),
      });
    }

    if (Number(request.headers.get('Content-Length') ?? 0) > MAX_BODY) return respond({ error: 'size' }, 413);
    let body;
    try {
      const text = await request.text();
      if (text.length > MAX_BODY) return respond({ error: 'size' }, 413);
      body = JSON.parse(text);
    } catch { return respond({ error: 'body' }, 400); }
    const action = body?.action;

    if (action === 'create' || action === 'delete') {
      if (!(await isStaff(request, env))) return respond({ error: 'key' }, 401);
      if (action === 'create') {
        const players = validPlayers(body.players);
        if (!players) return respond({ error: 'players' }, 400);
        const id = newSessionId();
        const title = cleanText(body.title, 40) || '선수 평가';
        await db.prepare(insertSessionSQL).bind(id, title, JSON.stringify(players), now).run();
        return respond({ id });
      }
      const id = body.s;
      if (typeof id !== 'string' || !SESSION_ID.test(id)) return respond({ error: 'session' }, 400);
      await db.batch([db.prepare(deleteResultsSQL).bind(id), db.prepare(deleteSessionSQL).bind(id)]);
      return respond({ ok: true });
    }

    if (action === 'submit') {
      if (!sameOrigin(request)) return respond({ error: 'origin' }, 403);
      const { s: id, token } = body;
      if (typeof id !== 'string' || !SESSION_ID.test(id)) return respond({ error: 'session' }, 404);
      if (typeof token !== 'string' || !TOKEN.test(token)) return respond({ error: 'token' }, 400);
      const who = cleanText(body.who, 20);
      if (!who) return respond({ error: 'who' }, 400);
      const row = await db.prepare(sessionSQL).bind(id, oldest).first();
      if (!row) return respond({ error: 'session' }, 404);
      const n = parse(row.players, []).length;
      const scores = validScores(body.scores, n);
      const comps = validComps(body.comps, n);
      if (!scores || !comps) return respond({ error: 'input' }, 400);
      if (!Object.keys(scores).length && !comps.length) return respond({ error: 'empty' }, 400);
      await db.prepare(upsertSQL).bind(id, token, who, JSON.stringify(scores), JSON.stringify(comps), now).run();
      return respond({ ok: true, updated_at: now });
    }

    return respond({ error: 'action' }, 400);
  } catch {
    return respond({ error: 'unavailable' }, 503);
  }
}
