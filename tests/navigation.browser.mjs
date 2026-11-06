// Build first. PLAYWRIGHT_MODULE can point to an external playwright-core installation.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
import http from 'node:http';import fs from 'node:fs';import path from 'node:path';
const root=fileURLToPath(new URL('../dist/',import.meta.url));
const server=http.createServer((req,res)=>{let f=path.join(root,decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(fs.existsSync(f)&&fs.statSync(f).isDirectory())f=path.join(f,'index.html');if(!fs.existsSync(f)){res.writeHead(404).end();return;}res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.webp':'image/webp'})[path.extname(f)]||'application/octet-stream');res.end(fs.readFileSync(f));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;const issues=[];
try {
 browser=await chromium.launch({channel:'chrome',headless:true,args:['--disable-features=BackForwardCache']});const page=await browser.newPage({viewport:{width:390,height:844}});await page.route(/google-analytics|googletagmanager/,r=>r.abort());
 const base=`http://127.0.0.1:${server.address().port}`;
 await page.goto(base+'/players/?league=FA26-L1');await page.evaluate(()=>scrollTo(0,650));await page.waitForTimeout(100);
 const rosterY=await page.evaluate(()=>scrollY);await page.locator('.player-card:visible').first().evaluate(e=>e.click());await page.waitForURL(/\/players\/[^/?]+\//);await page.goBack();await page.waitForTimeout(200);
 assert.equal(await page.locator('[aria-pressed="true"][data-league-button]').getAttribute('data-league-button'),'FA26-L1');assert.ok(Math.abs(await page.evaluate(()=>scrollY)-rosterY)<5);
 console.log('Roster league and scroll survive back navigation without BFCache');
 await page.goto(base+'/league/FA26-L2/');await page.locator('.week-tab[data-week="2"]').click();assert.equal(new URL(page.url()).searchParams.get('week'),'2');
 await page.evaluate(()=>scrollTo(0,900));await page.waitForTimeout(100);const weekY=await page.evaluate(()=>scrollY);
 await page.goto(base+'/about/');await page.goBack();await page.waitForTimeout(200);assert.equal(await page.locator('.week-tab[aria-selected="true"]').getAttribute('data-week'),'2');assert.ok(Math.abs(await page.evaluate(()=>scrollY)-weekY)<5);
 console.log('Week selection and scroll survive back navigation');
 assert.equal(await page.locator('#site-nav a[href="/league/"]').getAttribute('aria-current'),'page');
 await page.locator('.nav-toggle').click();await page.keyboard.press('Escape');assert.equal(await page.locator('.nav-toggle').getAttribute('aria-expanded'),'false');assert.ok(await page.locator('.nav-toggle').evaluate(e=>e===document.activeElement));
 await page.locator('.nav-toggle').click();await page.locator('.site-footer-name').click();assert.equal(await page.locator('.nav-toggle').getAttribute('aria-expanded'),'false');
 await page.locator('.nav-toggle').click();await page.locator('#site-nav a[href="/gallery/"] span').first().click();await page.waitForURL('**/gallery/');assert.equal(await page.locator('.nav-toggle').getAttribute('aria-expanded'),'false');
 console.log('Menu closes on Escape, outside click, and nested link text; active league is marked');
 await page.evaluate(()=>scrollTo(0,450));await page.waitForTimeout(100);const galleryY=await page.evaluate(()=>scrollY);await page.locator('.album-card').first().evaluate(e=>e.click());await page.waitForURL(/\/gallery\/[^/?]+\//);await page.goBack();await page.waitForTimeout(200);assert.ok(Math.abs(await page.evaluate(()=>scrollY)-galleryY)<5);
 console.log('Gallery scroll survives album navigation');
 await page.locator('.album-card').first().click();await page.waitForURL(/\/gallery\/[^/?]+\//);
 const thumbnail=page.locator('.gallery-item').nth(3);await thumbnail.click();
 assert.ok(await page.locator('.lightbox-close').evaluate(e=>e===document.activeElement));
 for(const key of ['Tab','Tab','Tab','Tab','Shift+Tab','Shift+Tab','Shift+Tab','Shift+Tab']) {
  await page.keyboard.press(key);
  assert.ok(await page.evaluate(()=>document.getElementById('lightbox').contains(document.activeElement)),'Focus must stay inside the photo viewer');
 }
 const counter=await page.locator('.lightbox-counter').innerText();await page.keyboard.press('ArrowRight');await page.waitForTimeout(400);
 assert.notEqual(await page.locator('.lightbox-counter').innerText(),counter);
 await page.keyboard.press('Escape');await page.waitForTimeout(100);assert.ok(!await page.locator('#lightbox').isVisible());
 assert.ok(await thumbnail.evaluate(e=>e===document.activeElement));
 console.log('Photo viewer traps forward/reverse Tab and restores thumbnail focus');

}finally{await browser?.close();server.close();}
