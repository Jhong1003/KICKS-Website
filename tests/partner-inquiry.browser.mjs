// Build first. PLAYWRIGHT_MODULE can point to an external playwright-core installation.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
import http from 'node:http';import fs from 'node:fs';import path from 'node:path';
const root=fileURLToPath(new URL('../dist/',import.meta.url));
const server=http.createServer((req,res)=>{let f=path.join(root,decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(fs.existsSync(f)&&fs.statSync(f).isDirectory())f=path.join(f,'index.html');if(!fs.existsSync(f)){res.writeHead(404).end();return;}res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.webp':'image/webp'})[path.extname(f)]||'application/octet-stream');res.end(fs.readFileSync(f));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;const issues=[];
try {
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:390,height:844}});await page.route(/google-analytics|googletagmanager/,r=>r.abort());const base=`http://127.0.0.1:${server.address().port}`;let outcome='failure',calls=0;
 await page.route('https://formspree.io/f/xvkkyerv',async route=>{calls++;const req=route.request();assert.equal(req.method(),'POST');assert.equal(req.headers()['accept'],'application/json');const body=req.postData();for(const key of ['brand-name','name','email','message','subject'])assert.ok(body.includes(`name="${key}"`));assert.ok(!body.includes('_next'));if(outcome==='network'){await route.abort();return;}await new Promise(r=>setTimeout(r,300));await route.fulfill({status:outcome==='success'?200:422,contentType:'application/json',body:outcome==='success'?'{"ok":true}':'{"errors":[{"message":"Validation failed"}]}'});});
 for(const lang of ['en','ko']){
 await page.goto(base+'/partners/');await page.evaluate(l=>window.kicksSetLang(l,true),lang);calls=0;
 await page.locator('.form-submit').click();assert.equal(calls,0);
 await page.locator('#brand-name').fill('KICKS test');await page.locator('#contact-name').fill('Test contact');await page.locator('#email').fill('invalid');await page.locator('#proposal').fill('Local intercepted test only');assert.equal(await page.locator('form').evaluate(f=>f.checkValidity()),false);await page.locator('#email').fill('test@example.com');
 outcome='failure';await page.locator('.form-submit').click();await page.waitForSelector('[data-inquiry-error]:not([hidden])');assert.equal(await page.locator('#proposal').inputValue(),'Local intercepted test only');assert.equal(await page.locator('.form-submit').isEnabled(),true);
 outcome='network';await page.locator('.form-submit').click();await page.waitForSelector('[data-inquiry-error]:not([hidden])');assert.equal(await page.locator('#email').inputValue(),'test@example.com');
 outcome='success';const before=calls;await page.locator('.form-submit').click();assert.equal(await page.locator('.form-submit').isDisabled(),true);await page.locator('form').evaluate(f=>f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));await page.waitForSelector('[data-inquiry-success]:not([hidden])');assert.equal(calls,before+1);assert.equal(await page.locator('#proposal').inputValue(),'');assert.equal(await page.locator('[data-inquiry-error]').isVisible(),false);assert.equal(await page.locator('.form-submit').isEnabled(),true);assert.equal(await page.locator('html').getAttribute('lang'),lang);
 console.log(lang+': validation, HTTP/network failures, preserved input, duplicate prevention, and success passed without sending email');
 }
}finally{await browser?.close();server.close();}
