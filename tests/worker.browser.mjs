// Start `npm run build`, initialize local D1, then `npx wrangler dev --local --port 8791`.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const origin = process.env.WORKER_TEST_URL || 'http://localhost:8791';
assert.ok(['localhost', '127.0.0.1'].includes(new URL(origin).hostname), 'Only local Workers may be tested');
const report = async () => {
  const response = await fetch(origin + '/api/visits');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /json/);
  return response.json();
};
const initial = await report();
await Promise.all(Array.from({ length: 20 }, async () => {
  const response = await fetch(origin + '/api/visits', {
    method: 'POST', headers: { Origin: origin, 'X-Kicks-Visit': '1' },
  });
  assert.equal(response.status, 200);
}));
assert.equal((await report()).visits, initial.visits + 20);
assert.equal((await fetch(origin + '/api/visits', { method: 'POST' })).status, 403);
for (const route of ['/', '/about/', '/league/', '/schedule/', '/players/']) {
  const response = await fetch(origin + route);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /html/);
}
assert.equal((await fetch(origin + '/nonexistent-worker-test')).status, 404);
assert.equal((await fetch(origin + '/_routes.json')).status, 404);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const width of [1440, 390]) {
    for (const locale of ['en-US', 'ko-KR']) {
      const context = await browser.newContext({ locale, viewport: { width, height: 900 } });
      await context.route(/google-analytics\.com|googletagmanager\.com/, route => route.abort());
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const before = (await report()).visits;
      await page.goto(origin + '/about/');
      const counter = page.locator('#daily-visits');
      await counter.waitFor({ state: 'visible' });
      const expected = before + 1;
      assert.equal((await report()).visits, expected);
      const text = (await counter.innerText()).trim();
      if (locale === 'en-US') assert.match(text, new RegExp(`^TODAY\\s+👀 ${expected} visitors$`));
      else assert.equal(text, `👀 오늘 방문자 · ${expected}`);
      await page.locator('footer').scrollIntoViewIfNeeded();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.locator('footer').screenshot({ path: `/tmp/kicks-worker-${locale}-${width}.png` });
      await page.reload(); await counter.waitFor({ state: 'visible' });
      assert.equal((await report()).visits, expected);
      await page.goto(origin + '/league/'); await counter.waitFor({ state: 'visible' });
      assert.equal((await report()).visits, expected);
      const stats = page.locator('[role="tab"][aria-controls="player-stats"]');
      await stats.click(); assert.equal(await page.locator('#player-stats').isVisible(), true);
      await page.locator('[role="tab"][aria-controls="overview"]').click();
      assert.equal(await page.locator('#overview').isVisible(), true);
      // Existing language setter updates both counter text variants without new detection.
      await page.evaluate(() => window.kicksSetLang(document.documentElement.lang === 'ko' ? 'en' : 'ko', true));
      assert.ok((await counter.innerText()).includes(locale === 'ko-KR' ? 'TODAY' : '오늘 방문자'));
      const current = await report();
      await page.route('**/api/visits', route => route.fulfill({ json: { ...current, visits: 0 } }));
      await page.reload(); await page.waitForTimeout(200); assert.equal(await counter.isVisible(), false);
      await page.unroute('**/api/visits');
      await page.route('**/api/visits', route => route.fulfill({ status: 503, json: { unavailable: true } }));
      await page.reload(); await page.waitForTimeout(200); assert.equal(await counter.isVisible(), false);
      assert.equal(await page.locator('h1').isVisible(), true);
      await page.unroute('**/api/visits');
      await page.goto(origin + '/');
      const popup = page.locator('#welcome-popup'); await popup.waitFor({ state: 'visible' });
      await page.keyboard.press('Escape'); assert.equal(await popup.isVisible(), false);
      assert.equal(await page.locator('.hero').isVisible(), true);
      assert.deepEqual(errors, []);
      await context.close();
      console.log(`PASS local Worker/D1 + assets ${width} ${locale}: counter, navigation, tabs, language, 0/error hidden, popup/hero`);
    }
  }
  console.log('PASS concurrent atomic D1 increments, exact API route, HTML fallback, 404 and removal of Pages config');
} finally { await browser.close(); }
