// Build first. Requires playwright-core and an installed Chrome; no project dependency changes.
// PLAYWRIGHT_MODULE may point to an external playwright-core/index.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const root = fileURLToPath(new URL('../dist/', import.meta.url));
const server = http.createServer((req, res) => {
 let file = path.join(root, decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
 if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
 if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
 if (!fs.existsSync(file)) { res.writeHead(404).end(); return; }
 res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.svg': 'image/svg+xml' })[path.extname(file)] || 'application/octet-stream');
 res.end(fs.readFileSync(file));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
 browser = await chromium.launch({ channel: 'chrome', headless: true });
 const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
 const errors = [];
 page.on('pageerror', error => errors.push(error.message));
 await page.addInitScript(() => {
  const original = Math.random; window.randomCalls = 0;
  Math.random = () => { window.randomCalls++; return original(); };
 });
 const origin = `http://127.0.0.1:${server.address().port}`;
 const sim = page.locator('.championship-simulator');
 const credits = () => sim.locator('[data-credit]').allTextContents();
 const order = () => sim.locator('[data-team-id]').evaluateAll(rows => rows.map(r => r.dataset.teamId));
 const waitResult = () => page.waitForFunction(() => document.querySelector('[data-simulator-meta]')?.textContent.includes('10,000 simulations') && !document.querySelector('.championship-simulator')?.hasAttribute('aria-busy'));
 await page.goto(origin + '/league/'); await waitResult();
 assert.equal(await page.locator('#overview').isVisible(), true);
 assert.equal(await page.locator('#player-stats').isVisible(), false);
 assert.deepEqual(await page.locator('#overview h2').allTextContents(), ['League Table', 'Match Results', 'TITLE RACE']);
 const expected = JSON.parse(fs.readFileSync(new URL('../src/data/league_table.json', import.meta.url))).filter(r => r.league === 'FA26-L1').map(r => r.team_id);
 assert.deepEqual(await order(), expected);
 const baseline = await credits(); const calls = await page.evaluate(() => window.randomCalls);
 assert.ok(Math.abs(baseline.reduce((sum, value) => sum + parseFloat(value), 0) - 100) <= .2);
 assert.equal(await sim.locator('details, form, input, button').count(), 0);
 assert.doesNotMatch(await sim.innerText(), /Try scenarios|How it works|Championship Simulator|λ|Participation/);
 assert.equal(await sim.locator('.title-race-model').innerText(), 'Equal team strength · Poisson model');
 assert.equal(await sim.locator('[data-simulator-meta]').innerText(), '10,000 simulations · 9 matches remaining');
 await page.getByRole('tab', {name:'PLAYER STATS',exact:true}).click();
 assert.ok(page.url().endsWith('#player-stats')); assert.equal(await page.locator('#overview').isVisible(), false);
 const ranks = await page.locator('.player-stats-table tbody tr td:first-child').allTextContents();
 assert.deepEqual(ranks.map(Number), Array.from({length:ranks.length},(_,i)=>i+1));
 await page.goBack(); assert.equal(await page.locator('#overview').isVisible(), true);
 await page.goForward(); assert.equal(await page.locator('#player-stats').isVisible(), true);
 await page.getByRole('tab',{name:'OVERVIEW',exact:true}).click();
 assert.deepEqual(await credits(), baseline); assert.equal(await page.evaluate(()=>window.randomCalls), calls);
 for(const base of ['/league/','/league/FA26-L1/']) {
  await page.goto(origin+base+'#player-stats'); assert.equal(await page.locator('#player-stats').isVisible(),true);
  await page.reload(); assert.equal(await page.locator('#player-stats').isVisible(),true);
  await page.goto(origin+base+'?week=2#results');
  assert.equal(await page.locator('#overview').isVisible(),true);
  assert.equal(await page.locator('.week-tab[aria-selected="true"]').getAttribute('data-week'),'2');
  await page.getByRole('tab',{name:'PLAYER STATS',exact:true}).click(); assert.ok(page.url().includes('?week=2#player-stats'));
  await page.goBack(); assert.equal(await page.locator('#overview').isVisible(),true);
  await page.goForward(); assert.equal(await page.locator('#player-stats').isVisible(),true);
  await page.reload(); assert.equal(await page.locator('#player-stats').isVisible(),true);
 }
 await page.goto(origin+'/league/#player-stats-title'); assert.equal(await page.locator('#player-stats').isVisible(),true);
 await page.getByRole('tab',{name:'PLAYER STATS',exact:true}).focus(); await page.keyboard.press('ArrowLeft');
 assert.equal(await page.locator('#overview').isVisible(),true);
 await waitResult();
 for(const width of [320,375,768]) {
  await page.setViewportSize({width,height:900});
  assert.equal(await sim.evaluate(el=>el.scrollWidth>el.clientWidth),false);
  assert.equal(await sim.evaluate(el=>el.scrollWidth>el.clientWidth),false);
  await page.getByRole('tab',{name:'PLAYER STATS',exact:true}).click();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.getByRole('tab',{name:'OVERVIEW',exact:true}).click();
 }
 if(process.env.UI_SCREENSHOT) await sim.screenshot({path:process.env.UI_SCREENSHOT});
 const nojs=await browser.newContext({javaScriptEnabled:false}); const fallback=await nojs.newPage();
 await fallback.goto(origin+'/league/#player-stats');
 assert.equal(await fallback.locator('#overview').isVisible(),true); assert.equal(await fallback.locator('#player-stats').isVisible(),true);
 assert.match(await fallback.locator('noscript').innerText(),/JavaScript/);
 assert.deepEqual(errors,[]);
 console.log('PASS: tabs, direct links, refresh, back/forward, week deep links, keyboard, single automatic simulation, fixed team order, read-only UI and minimal copy, mobile 320/375/768, no-JS fallback, no runtime errors.');
} finally { await browser?.close(); await new Promise(resolve=>server.close(resolve)); }
