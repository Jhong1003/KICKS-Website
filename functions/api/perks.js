// Member perks: a members-only coupon screen for partner restaurants
// (see docs/member-perks.md).
//
// - POST /api/perks/verify  {code, player_id}          -> checks the shared member code
// - POST /api/perks/redeem  {code, player_id, perk_id} -> logs one use, returns server time
// - GET  /api/perks/log     Authorization: Bearer <admin key> -> usage for staff
//
// Secrets (Cloudflare dashboard or `wrangler secret put`), never in this repo:
//   PERKS_CODE       the one code shared with members
//   PERKS_ADMIN_KEY  the staff key for the usage log
//
// Stored per use: perk, player_id and time only. No IP, device or name.
import perks from '../../src/data/perks.json' with { type: 'json' };
import profiles from '../../src/data/player_profiles.json' with { type: 'json' };
import { chicagoDate } from './visits.js';

/** Opening the coupon again within this window reuses the same log row. */
export const REPEAT_WINDOW_MS = 30 * 60 * 1000;

export const memberIds = new Set(
  profiles.filter((p) => p.status !== 'inactive').map((p) => p.player_id),
);

export function findPerk(perkId, list = perks) {
  return list.find((p) => p.perk_id === perkId) ?? null;
}

/** Active and not past its last valid day (Chicago date). */
export function perkIsOpen(perk, date) {
  return Boolean(perk && perk.active && (!perk.valid_until || date <= perk.valid_until));
}

async function digest(text) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

/** Constant-time comparison of two secrets (compares SHA-256 digests). */
export async function secretMatches(given, expected) {
  if (typeof given !== 'string' || typeof expected !== 'string' || !expected) return false;
  const [a, b] = await Promise.all([digest(given.trim()), digest(expected.trim())]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const respond = (body, status = 200) => Response.json(body, { status, headers });

function sameOrigin(request) {
  const site = request.headers.get('Sec-Fetch-Site');
  return request.headers.get('Origin') === new URL(request.url).origin &&
    (!site || site === 'same-origin');
}

async function readJson(request) {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? body : null;
  } catch {
    return null;
  }
}

export async function onRequest({ request, env, now = Date.now() }) {
  const path = new URL(request.url).pathname.replace(/\/+$/, '');
  try {
    if (path === '/api/perks/log') {
      if (request.method !== 'GET') return respond({ error: 'method' }, 405);
      return await handleLog(request, env);
    }
    if (path === '/api/perks/verify' || path === '/api/perks/redeem') {
      if (request.method !== 'POST') return respond({ error: 'method' }, 405);
      if (!sameOrigin(request)) return respond({ error: 'origin' }, 403);
      if (!env.PERKS_CODE || !env.VISITS_DB) return respond({ error: 'unavailable' }, 503);
      const body = await readJson(request);
      if (!body) return respond({ error: 'bad_request' }, 400);
      if (!(await secretMatches(body.code, env.PERKS_CODE))) return respond({ error: 'code' }, 401);
      if (!memberIds.has(body.player_id)) return respond({ error: 'member' }, 404);
      if (path === '/api/perks/verify') return respond({ ok: true });
      return await handleRedeem(body, env, now);
    }
    return respond({ error: 'not_found' }, 404);
  } catch {
    return respond({ error: 'unavailable' }, 503);
  }
}

export const recentSQL = `SELECT redeemed_at FROM perk_redemptions
  WHERE player_id = ?1 AND perk_id = ?2 AND redeemed_at >= ?3
  ORDER BY redeemed_at DESC LIMIT 1`;
export const insertSQL = `INSERT INTO perk_redemptions (perk_id, player_id, redeemed_at, chicago_date)
  VALUES (?1, ?2, ?3, ?4)`;

async function handleRedeem(body, env, now) {
  const date = chicagoDate(new Date(now));
  const perk = findPerk(body.perk_id);
  if (!perkIsOpen(perk, date)) return respond({ error: 'perk' }, 404);
  const since = new Date(now - REPEAT_WINDOW_MS).toISOString();
  const recent = await env.VISITS_DB.prepare(recentSQL)
    .bind(body.player_id, perk.perk_id, since).first();
  if (recent) return respond({ ok: true, redeemed_at: recent.redeemed_at, repeat: true, now });
  const redeemedAt = new Date(now).toISOString();
  await env.VISITS_DB.prepare(insertSQL).bind(perk.perk_id, body.player_id, redeemedAt, date).run();
  return respond({ ok: true, redeemed_at: redeemedAt, repeat: false, now });
}

export const totalsSQL = `SELECT perk_id, COUNT(*) AS uses, COUNT(DISTINCT player_id) AS members
  FROM perk_redemptions GROUP BY perk_id`;
export const listSQL = `SELECT perk_id, player_id, redeemed_at FROM perk_redemptions
  ORDER BY redeemed_at DESC LIMIT 1000`;

async function handleLog(request, env) {
  if (!env.PERKS_ADMIN_KEY || !env.VISITS_DB) return respond({ error: 'unavailable' }, 503);
  const auth = request.headers.get('Authorization') ?? '';
  const key = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!(await secretMatches(key, env.PERKS_ADMIN_KEY))) return respond({ error: 'key' }, 401);
  const [totals, list] = await Promise.all([
    env.VISITS_DB.prepare(totalsSQL).all(),
    env.VISITS_DB.prepare(listSQL).all(),
  ]);
  return respond({ totals: totals.results ?? [], redemptions: list.results ?? [] });
}
