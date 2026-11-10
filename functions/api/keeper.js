import { VERSION, MAX_DURATION, replay, validInputs } from '../../src/lib/keeper/rules.js';
// A player's best and their place in the same order as the leaderboard.
export const rankSQL = `SELECT me.score, (SELECT COUNT(*) FROM keeper_scores o WHERE o.score > me.score
  OR (o.score = me.score AND o.perfect > me.perfect)
  OR (o.score = me.score AND o.perfect = me.perfect AND o.updated_at < me.updated_at)) + 1 AS rank
  FROM keeper_scores me WHERE me.player_id = ?1`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function onRequest({ request, env }) {
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  const respond = (data, status = 200, extra = {}) => Response.json(data, { status, headers: { ...headers, ...extra } });
  const url = new URL(request.url);
  const cookie = request.headers.get('Cookie')?.match(/(?:^|;\s*)kicks-keeper=([^;]+)/)?.[1];
  const player = cookie && UUID.test(cookie) ? cookie : null;
  if (request.method !== 'GET' && request.method !== 'POST') return respond({ error: 'method' }, 405);
  if (request.method === 'POST' && (request.headers.get('Origin') !== url.origin || request.headers.get('X-Kicks-Keeper') !== '1')) return respond({ error: 'origin' }, 403);
  try {
    const db = env.VISITS_DB;
    if (!db) return respond({ error: 'unavailable' }, 503);
    if (request.method === 'GET') {
      const rows = await db.prepare('SELECT name, score, saves, perfect, best_combo FROM keeper_scores ORDER BY score DESC, perfect DESC, updated_at ASC LIMIT 20').all();
      const best = player ? await db.prepare(rankSQL).bind(player).first() : null;
      return respond({ entries: rows.results, best: best?.score ?? null, rank: best?.rank ?? null, version: VERSION });
    }
    const raw = await request.text();
    if (raw.length > 12000) return respond({ error: 'size' }, 413);
    let body; try { body = JSON.parse(raw); } catch { return respond({ error: 'input' }, 400); }
    const now = Date.now();
    if (body.action === 'start') {
      const name = typeof body.name === 'string' ? body.name.normalize('NFKC').trim().replace(/\s+/gu, ' ') : '';
      if (!/^[\p{L}\p{N} ._-]{1,16}$/u.test(name)) return respond({ error: 'name' }, 400);
      const playerId = player || crypto.randomUUID();
      const recent = await db.prepare('SELECT started_at FROM keeper_runs WHERE player_id = ?1 ORDER BY started_at DESC LIMIT 1').bind(playerId).first();
      if (recent && now - recent.started_at < 2500) return respond({ error: 'rate' }, 429);
      const id = crypto.randomUUID(), seed = crypto.getRandomValues(new Uint32Array(1))[0];
      await db.batch([
        db.prepare('DELETE FROM keeper_runs WHERE started_at < ?1').bind(now - 3600000),
        db.prepare('INSERT INTO keeper_runs (id, player_id, name, seed, started_at) VALUES (?1, ?2, ?3, ?4, ?5)').bind(id, playerId, name, seed, now),
      ]);
      return respond({ id, seed, version: VERSION }, 200, { 'Set-Cookie': `kicks-keeper=${playerId}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=31536000` });
    }
    if (body.action !== 'finish' || !player || !UUID.test(body.id ?? '')) return respond({ error: 'input' }, 400);
    const run = await db.prepare('SELECT * FROM keeper_runs WHERE id = ?1 AND player_id = ?2').bind(body.id, player).first();
    if (!run || run.used || now - run.started_at > MAX_DURATION + 30000) return respond({ error: 'expired' }, 409);
    if (body.version !== VERSION || !validInputs(run.seed, body.inputs)) return respond({ error: 'input' }, 400);
    const result = replay(run.seed, body.inputs);
    if (!result.finished || now - run.started_at < result.finishedAt - 150) return respond({ error: 'timing' }, 400);
    // One-use run: claim it before updating the personal best.
    const claim = await db.prepare('UPDATE keeper_runs SET used = 1 WHERE id = ?1 AND used = 0 RETURNING id').bind(run.id).first();
    if (!claim) return respond({ error: 'used' }, 409);
    const saved = await db.prepare(`INSERT INTO keeper_scores (player_id, name, score, saves, perfect, best_combo, updated_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
      ON CONFLICT(player_id) DO UPDATE SET name=excluded.name, score=excluded.score, saves=excluded.saves,
      perfect=excluded.perfect, best_combo=excluded.best_combo, updated_at=excluded.updated_at
      WHERE excluded.score > keeper_scores.score OR (excluded.score = keeper_scores.score AND excluded.perfect > keeper_scores.perfect)`)
      .bind(player, run.name, result.score, result.saves, result.perfect, result.bestCombo, now).run();
    return respond({ score: result.score, saves: result.saves, perfect: result.perfect, bestCombo: result.bestCombo, newBest: (saved.meta?.changes ?? 0) > 0 });
  } catch { return respond({ error: 'unavailable' }, 503); }
}
