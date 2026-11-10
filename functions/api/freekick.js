import { VERSION, KICKS, replay, validSwipe } from '../../src/lib/freekick/rules.js';
// Free kick leaderboard. The browser gets a seed on start and sends only its
// ten swipes on finish; the Worker replays them with the shared rules, so a
// typed-in score never reaches the board. Mirrors functions/api/keeper.js.
const MIN_RUN = 20000; // ms: ten kicks can't be taken faster (run-up, flight, result)
const MAX_RUN = 30 * 60000; // ms: a run older than this is refused
const BEST_PER_NAME = `WITH ranked AS (SELECT *, ROW_NUMBER() OVER (PARTITION BY lower(trim(name))
  ORDER BY score DESC, goals DESC, updated_at ASC) AS rn FROM freekick_scores)
  SELECT * FROM ranked WHERE rn = 1`;
export const boardSQL = `${BEST_PER_NAME} ORDER BY score DESC, goals DESC, updated_at ASC LIMIT 20`;
export const rankSQL = `WITH best AS (${BEST_PER_NAME})
  SELECT me.score, (SELECT COUNT(*) FROM best o WHERE lower(trim(o.name)) <> lower(trim(me.name)) AND (o.score > me.score
  OR (o.score = me.score AND o.goals > me.goals)
  OR (o.score = me.score AND o.goals = me.goals AND o.updated_at < me.updated_at))) + 1 AS rank
  FROM freekick_scores me WHERE me.player_id = ?1`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function validSwipes(swipes) {
  return Array.isArray(swipes) && swipes.length === KICKS && swipes.every((s) => validSwipe(s) && s.every((p) => p.every(Number.isInteger)));
}
export async function onRequest({ request, env }) {
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  const respond = (data, status = 200, extra = {}) => Response.json(data, { status, headers: { ...headers, ...extra } });
  const url = new URL(request.url);
  const cookie = request.headers.get('Cookie')?.match(/(?:^|;\s*)kicks-freekick=([^;]+)/)?.[1];
  const player = cookie && UUID.test(cookie) ? cookie : null;
  if (request.method !== 'GET' && request.method !== 'POST') return respond({ error: 'method' }, 405);
  if (request.method === 'POST' && (request.headers.get('Origin') !== url.origin || request.headers.get('X-Kicks-Freekick') !== '1')) return respond({ error: 'origin' }, 403);
  try {
    const db = env.VISITS_DB;
    if (!db) return respond({ error: 'unavailable' }, 503);
    if (request.method === 'GET') {
      const rows = await db.prepare(boardSQL).all();
      const best = player ? await db.prepare(rankSQL).bind(player).first() : null;
      return respond({ entries: rows.results.map(({ name, score, goals, best_kick }) => ({ name, score, goals, best_kick })), best: best?.score ?? null, rank: best?.rank ?? null, version: VERSION });
    }
    const raw = await request.text();
    if (raw.length > 40000) return respond({ error: 'size' }, 413);
    let body; try { body = JSON.parse(raw); } catch { return respond({ error: 'input' }, 400); }
    const now = Date.now();
    if (body.action === 'start') {
      const name = typeof body.name === 'string' ? body.name.normalize('NFKC').trim().replace(/\s+/gu, ' ') : '';
      if (!/^[\p{L}\p{N} ._-]{1,16}$/u.test(name)) return respond({ error: 'name' }, 400);
      const playerId = player || crypto.randomUUID();
      const recent = await db.prepare('SELECT started_at FROM freekick_runs WHERE player_id = ?1 ORDER BY started_at DESC LIMIT 1').bind(playerId).first();
      if (recent && now - recent.started_at < 2500) return respond({ error: 'rate' }, 429);
      const id = crypto.randomUUID(), seed = crypto.getRandomValues(new Uint32Array(1))[0];
      await db.batch([
        db.prepare('DELETE FROM freekick_runs WHERE started_at < ?1').bind(now - 2 * MAX_RUN),
        db.prepare('INSERT INTO freekick_runs (id, player_id, name, seed, started_at) VALUES (?1, ?2, ?3, ?4, ?5)').bind(id, playerId, name, seed, now),
      ]);
      return respond({ id, seed, version: VERSION }, 200, { 'Set-Cookie': `kicks-freekick=${playerId}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=31536000` });
    }
    if (body.action !== 'finish' || !player || !UUID.test(body.id ?? '')) return respond({ error: 'input' }, 400);
    const run = await db.prepare('SELECT * FROM freekick_runs WHERE id = ?1 AND player_id = ?2').bind(body.id, player).first();
    if (!run || run.used || now - run.started_at > MAX_RUN) return respond({ error: 'expired' }, 409);
    if (body.version !== VERSION || !validSwipes(body.swipes)) return respond({ error: 'input' }, 400);
    if (now - run.started_at < MIN_RUN) return respond({ error: 'timing' }, 400);
    const result = replay(run.seed, body.swipes);
    if (!result.finished) return respond({ error: 'input' }, 400);
    // One-use run: claim it before updating the personal best.
    const claim = await db.prepare('UPDATE freekick_runs SET used = 1 WHERE id = ?1 AND used = 0 RETURNING id').bind(run.id).first();
    if (!claim) return respond({ error: 'used' }, 409);
    const saved = await db.prepare(`INSERT INTO freekick_scores (player_id, name, score, goals, best_kick, updated_at)
      VALUES (?1, ?2, ?3, ?4, ?5, ?6)
      ON CONFLICT(player_id) DO UPDATE SET name=excluded.name, score=excluded.score, goals=excluded.goals,
      best_kick=excluded.best_kick, updated_at=excluded.updated_at
      WHERE excluded.score > freekick_scores.score OR (excluded.score = freekick_scores.score AND excluded.goals > freekick_scores.goals)`)
      .bind(player, run.name, result.score, result.goals, result.bestKick, now).run();
    return respond({ score: result.score, goals: result.goals, bestKick: result.bestKick, newBest: (saved.meta?.changes ?? 0) > 0 });
  } catch { return respond({ error: 'unavailable' }, 503); }
}
