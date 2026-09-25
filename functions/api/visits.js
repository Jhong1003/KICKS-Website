// Aggregate only: no visitor identifiers, IP addresses, or request logging.
export function chicagoDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

export const incrementSQL = `INSERT INTO daily_visits (date, visits) VALUES (?1, 1)
  ON CONFLICT(date) DO UPDATE SET visits = daily_visits.visits + 1
  RETURNING visits`;

export async function onRequest({ request, env }) {
  const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  const respond = (body, status = 200) => Response.json(body, { status, headers });
  if (!['GET', 'POST'].includes(request.method)) return respond({ unavailable: true }, 405);
  if (request.method === 'POST') {
    // Blocks cross-site forms/fetches, not a determined caller forging HTTP headers.
    const site = request.headers.get('Sec-Fetch-Site');
    if (request.headers.get('Origin') !== new URL(request.url).origin ||
        request.headers.get('X-Kicks-Visit') !== '1' || (site && site !== 'same-origin')) {
      return respond({ unavailable: true }, 403);
    }
  }
  try {
    if (!env.VISITS_DB) return respond({ unavailable: true }, 503);
    const now = Date.now();
    const date = chicagoDate(new Date(now));
    const row = await env.VISITS_DB.prepare(request.method === 'POST'
      ? incrementSQL : 'SELECT visits FROM daily_visits WHERE date = ?1').bind(date).first();
    const visits = row?.visits ?? 0;
    if (!Number.isSafeInteger(visits) || visits < 0) return respond({ unavailable: true }, 503);
    return respond({ date, visits, now });
  } catch {
    return respond({ unavailable: true }, 503);
  }
}
