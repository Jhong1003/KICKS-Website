import test from 'node:test';
import assert from 'node:assert/strict';
import { chicagoDate, onRequest, incrementSQL } from '../functions/api/visits.js';
import { needsVisit, visibleFor } from '../src/lib/visit-counter.ts';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
const now = Date.parse('2026-09-25T17:00:00Z');
const report = { now, date: '2026-09-25', visits: 1 };

test('first visit, 30-minute boundary, next day, invalid state', () => {
  assert.equal(needsVisit(null, report), true);
  for (const delta of [0, 60_000, 1_799_999]) assert.equal(needsVisit({date:report.date,at:now-delta},report),false);
  assert.equal(needsVisit({date:report.date,at:now-1_800_000},report),true);
  assert.equal(needsVisit({date:'2026-09-24',at:now-1000},report),true);
  assert.equal(needsVisit({date:report.date,at:now+1},report),true);
});

test('Chicago midnight, DST spring/fall and stale display expiry', () => {
  for (const [instant, date] of [
    ['2026-09-26T04:59:59Z','2026-09-25'], ['2026-09-26T05:00:00Z','2026-09-26'],
    ['2026-01-02T05:59:59Z','2026-01-01'], ['2026-01-02T06:00:00Z','2026-01-02'],
    ['2026-03-08T08:00:00Z','2026-03-08'], ['2026-11-01T07:00:00Z','2026-11-01'],
  ]) assert.equal(chicagoDate(new Date(instant)),date);
  assert.equal(visibleFor(report),60_000);
  assert.equal(visibleFor({...report,now:Date.parse('2026-09-26T04:59:59Z')}),1000);
});

test('atomic SQL increments, isolated dates, API guards and failures', async () => {
  const db=new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../migrations/0001_daily_visits.sql',import.meta.url),'utf8'));
  const env={VISITS_DB:{prepare:sql=>({bind:date=>({first:async()=>db.prepare(sql).get(date)})})}};
  const req=(method='GET',headers={})=>new Request('https://kicksuiuc.com/api/visits',{method,headers});
  const post=()=>req('POST',{'Origin':'https://kicksuiuc.com','X-Kicks-Visit':'1','Sec-Fetch-Site':'same-origin'});
  assert.equal((await (await onRequest({request:req(),env})).json()).visits,0);
  await Promise.all(Array.from({length:100},()=>onRequest({request:post(),env})));
  const response=await onRequest({request:req(),env});
  assert.equal((await response.json()).visits,100);
  assert.equal(response.headers.get('Cache-Control'),'no-store');
  assert.equal(db.prepare(incrementSQL).get('2026-01-01').visits,1);
  assert.equal((await onRequest({request:req('POST'),env})).status,403);
  assert.equal((await onRequest({request:req('POST',{'Origin':'https://evil.test','X-Kicks-Visit':'1'}),env})).status,403);
  assert.equal((await onRequest({request:req('PUT'),env})).status,405);
  assert.equal((await onRequest({request:req(),env:{}})).status,503);
  assert.equal((await onRequest({request:req(),env:{VISITS_DB:{prepare(){throw Error('offline')}}}})).status,503);
  db.close();
});
