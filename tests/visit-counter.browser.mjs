// Build first. Requires playwright-core and an installed Chrome; no project dependency changes.
// PLAYWRIGHT_MODULE may point to an external playwright-core/index.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const root = fileURLToPath(new URL('../dist/', import.meta.url));
let visits=0, posts=0, failed=false, now=Date.parse('2026-09-25T17:00:00Z'), date='2026-09-25';
const server = http.createServer((req, res) => {
 if(req.url==='/api/visits') {
  res.setHeader('Content-Type','application/json');res.setHeader('Cache-Control','no-store');
  if(failed){res.writeHead(503).end('{}');return;}
  if(req.method==='POST'){visits++;posts++;}
  res.end(JSON.stringify({date,now,visits}));return;
 }
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
 browser=await chromium.launch({channel:'chrome',headless:true});
 const origin=`http://127.0.0.1:${server.address().port}`;
 const ctx=await browser.newContext({viewport:{width:1440,height:1000}});
 const page=await ctx.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const wait=()=>page.waitForFunction(()=>document.querySelector('#daily-visits [data-visit-count]')?.textContent&&!document.querySelector('#daily-visits').hidden);
 await page.goto(origin+'/about');await wait();assert.equal(posts,1);assert.match(await page.locator('#daily-visits').innerText(),/TODAY\s+👀 1 visitors/);
 await page.reload();await wait();assert.equal(posts,1);
 await page.goto(origin+'/schedule');await wait();assert.equal(posts,1);
 now+=29*60_000;await page.goto(origin+'/players');await wait();assert.equal(posts,1);
 const tab=await ctx.newPage();await tab.goto(origin+'/about');await tab.waitForFunction(()=>!document.querySelector('#daily-visits').hidden);assert.equal(posts,1);await tab.close();await page.bringToFront();
 now+=60_000;await page.reload();await wait();assert.equal(posts,2);assert.match(await page.locator('#daily-visits').innerText(),/TODAY\s+👀 2 visitors/);
 // Force day change before 30 minutes have elapsed; server date is authoritative.
 date='2026-09-26';now=Date.parse('2026-09-26T05:00:00Z');visits=0;
 await page.evaluate(value=>localStorage.setItem('kicks-last-visit',JSON.stringify({date:'2026-09-25',at:value-1000})),now);
 await page.reload();await wait();assert.equal(visits,1);assert.equal(posts,3);
 for(const width of [1440,390,320]) {
  await page.setViewportSize({width,height:900});await page.locator('footer').scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  const b=await page.locator('#daily-visits').boundingBox();assert.ok(b.x>=0&&b.x+b.width<=width);
  if(width!==320)await page.locator('footer').screenshot({path:`/tmp/kicks-visits-footer-${width}.png`});
 }
 visits=0;await page.reload();await page.waitForTimeout(300);assert.equal(await page.locator('#daily-visits').isVisible(),false);
 failed=true;await page.reload();await page.waitForTimeout(300);assert.equal(await page.locator('#daily-visits').isVisible(),false);assert.equal(await page.locator('h1').isVisible(),true);failed=false;
 const blocked=await browser.newContext();const bp=await blocked.newPage();await bp.addInitScript(()=>{Storage.prototype.setItem=()=>{throw Error('blocked')};});
 const before=posts;await bp.goto(origin+'/about');await bp.waitForTimeout(300);assert.equal(posts,before);assert.equal(await bp.locator('#daily-visits').isVisible(),false);await blocked.close();
 // Two simultaneous loads in one browser profile serialize through Web Locks.
 const tabs=await browser.newContext();const a=await tabs.newPage();const b=await tabs.newPage();
 const count=posts;await Promise.all([a.goto(origin+'/about'),b.goto(origin+'/schedule')]);await new Promise(r=>setTimeout(r,500));assert.equal(posts,count+1);await tabs.close();
 assert.deepEqual(errors,[]);
 console.log('PASS first/refresh/navigation/revisit, new tab, 30min, Chicago day rollover, count display, zero/failure/blocked storage, concurrent tabs, desktop/mobile footer, no runtime errors');
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
