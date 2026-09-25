const KEY = 'kicks-last-visit';
const WINDOW_MS = 30 * 60 * 1000;
interface Report { date: string; visits: number; now: number }
interface Visit { date: string; at: number }
const chicagoDay = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
});

export function visibleFor(report: Report): number {
  let low = 0;
  let high = 60_000;
  // Hide at Chicago midnight even if the next refresh has not finished yet.
  if (chicagoDay.format(new Date(report.now + high)) !== report.date) {
    while (high - low > 1) {
      const middle = Math.floor((low + high) / 2);
      if (chicagoDay.format(new Date(report.now + middle)) === report.date) low = middle;
      else high = middle;
    }
  }
  return high;
}

export function needsVisit(last: Visit | null, report: Report): boolean {
  return !last || last.date !== report.date || !Number.isFinite(last.at) ||
    last.at > report.now || report.now - last.at >= WINDOW_MS;
}

async function readReport(method: 'GET' | 'POST'): Promise<Report> {
  const response = await fetch('/api/visits', {
    method, cache: 'no-store', credentials: 'omit',
    headers: method === 'POST' ? { 'X-Kicks-Visit': '1' } : {},
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error('Counter unavailable');
  const data = await response.json();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date) || !Number.isSafeInteger(data.visits) ||
      data.visits < 0 || !Number.isSafeInteger(data.now)) throw new Error('Invalid counter');
  return data;
}

export function startVisitCounter(element: HTMLElement) {
  let busy = false;
  let expires: ReturnType<typeof setTimeout> | undefined;
  const hide = () => { element.hidden = true; clearTimeout(expires); };
  const display = (report: Report) => {
    hide();
    if (report.visits === 0) return;
    element.querySelectorAll('[data-visit-count]').forEach(count => {
      count.textContent = String(report.visits);
    });
    element.hidden = false;
    // Do not leave an old date/count visible when the page is left open or offline.
    expires = setTimeout(hide, visibleFor(report));
  };
  const refresh = async (allowIncrement: boolean) => {
    if (busy || document.visibilityState === 'hidden') return;
    busy = true;
    const update = async () => {
      let report = await readReport('GET');
      if (allowIncrement) {
        // Without persistent storage or cross-tab locks, use read-only mode rather
        // than inflate the total on every refresh or simultaneous tab opening.
        const raw = localStorage.getItem(KEY);
        let last: Visit | null = null;
        try { last = raw ? JSON.parse(raw) : null; } catch { /* Treat corrupt state as a new visit. */ }
        if (needsVisit(last, report)) {
          // Reserve this window before POST. A lost response must not trigger an
          // automatic second increment. Failed attempts can undercount for 30 min.
          localStorage.setItem(KEY, JSON.stringify({ date: report.date, at: report.now }));
          report = await readReport('POST');
          localStorage.setItem(KEY, JSON.stringify({ date: report.date, at: report.now }));
        }
      }
      display(report);
    };
    try {
      if (allowIncrement && navigator.locks) await navigator.locks.request(KEY, update);
      else {
        const report = await readReport('GET');
        display(report);
      }
    } catch { hide(); } finally { busy = false; }
  };
  void refresh(true);
  // Polling refreshes the public total, but never starts a visit for an idle tab.
  setInterval(() => { void refresh(false); }, 60_000);
  document.addEventListener('visibilitychange', () => {
    hide();
    if (document.visibilityState === 'visible') void refresh(true);
  });
  window.addEventListener('pageshow', event => { if (event.persisted) void refresh(true); });
  window.addEventListener('pagehide', hide);
}
