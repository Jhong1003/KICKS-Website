// Emoji reactions on match results: /api/reactions
//   GET  ?league=FA26-L2          -> { counts: { "<match_id>": { fire: 3, ... } } }
//   POST { match, reaction, delta } (delta 1 = add, -1 = take back)
// Aggregate only, like visits.js: no visitor identifiers, IP addresses or
// request logging. One reaction per browser is kept client-side
// (WeeklyResults.astro); the server only counts.
export const REACTIONS = ['fire', 'laugh', 'cry', 'clap'];
export const LEAGUE_ID = /^[A-Z]{2}\d{2}-L\d{1,2}$/;
export const MATCH_ID = /^[A-Z]{2}\d{2}-L\d{1,2}-W\d{2}-M\d{2}$/;

export const addSQL = `INSERT INTO match_reactions (match_id, reaction, count) VALUES (?1, ?2, 1)
  ON CONFLICT(match_id, reaction) DO UPDATE SET count = match_reactions.count + 1
  RETURNING count`;
export const removeSQL = `UPDATE match_reactions SET count = MAX(count - 1, 0)
  WHERE match_id = ?1 AND reaction = ?2 RETURNING count`;
export const listSQL = `SELECT match_id, reaction, count FROM match_reactions
  WHERE match_id LIKE ?1 AND count > 0`;

export async function onRequest({ request, env }) {
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  const respond = (body, status = 200) => Response.json(body, { status, headers });
  if (!['GET', 'POST'].includes(request.method)) return respond({ unavailable: true }, 405);
  if (!env.VISITS_DB) return respond({ unavailable: true }, 503);
  try {
    if (request.method === 'GET') {
      const league = new URL(request.url).searchParams.get('league') ?? '';
      if (!LEAGUE_ID.test(league)) return respond({ error: 'league' }, 400);
      const { results = [] } = await env.VISITS_DB.prepare(listSQL).bind(`${league}-W%`).all();
      const counts = {};
      for (const row of results) {
        if (!MATCH_ID.test(row.match_id) || !REACTIONS.includes(row.reaction)) continue;
        (counts[row.match_id] ??= {})[row.reaction] = row.count;
      }
      return respond({ counts });
    }
    // Blocks cross-site forms/fetches, not a determined caller forging HTTP headers.
    const site = request.headers.get('Sec-Fetch-Site');
    if (request.headers.get('Origin') !== new URL(request.url).origin ||
        request.headers.get('X-Kicks-Reaction') !== '1' || (site && site !== 'same-origin')) {
      return respond({ unavailable: true }, 403);
    }
    let body;
    try { body = await request.json(); } catch { return respond({ error: 'body' }, 400); }
    const { match, reaction, delta } = body ?? {};
    if (typeof match !== 'string' || !MATCH_ID.test(match) || !REACTIONS.includes(reaction) || ![1, -1].includes(delta)) {
      return respond({ error: 'input' }, 400);
    }
    const row = await env.VISITS_DB.prepare(delta === 1 ? addSQL : removeSQL).bind(match, reaction).first();
    return respond({ match, reaction, count: row?.count ?? 0 });
  } catch {
    return respond({ unavailable: true }, 503);
  }
}
