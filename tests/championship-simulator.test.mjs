import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { rankTeams, championshipCredits } from '../src/lib/standings.ts';
import { buildSimulationModel, matchPoints, poisson, simulate } from '../src/lib/championship-simulator.ts';
const read = path => JSON.parse(fs.readFileSync(new URL(path, import.meta.url), 'utf8'));
const rules = read('../src/data/league-config.json')._default;
const league = { id: 'A', rules, teams: ['T1','T2','T3'].map(team_id => ({team_id, name:team_id})) };
const standing = (id, participation = 1) => ({ league: 'A', team_id: id, points:0, goals_for:0, goal_difference:0, participation_rate:participation });
const standings = league.teams.map(t => standing(t.team_id));
const match = (overrides = {}) => ({league:'A', match_id:'a', week:1, home_team_id:'T1',away_team_id:'T2',home_score:1,away_score:0,status:'completed', ...overrides});
function rng(seed = 12345) { return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296); }
for (const c of read('./standings-cases.json')) test(`shared ranking: ${c.name}`, () => {
 const result = rankTeams(c.rows, rules.ranking_criteria);
 assert.deepEqual(result.map(r=>r.team_id), c.order);
 assert.deepEqual(result.map(r=>r.rank), c.ranks);
 const credits = championshipCredits(c.rows, rules.ranking_criteria);
 const winners = c.ranks.filter(rank=>rank===1).length;
 c.order.forEach((id, i) => assert.equal(credits[id], c.ranks[i]===1 ? 1/winners : 0));
});
test('week-specific points', () => {
 assert.equal(matchPoints(2,1,3,rules),2); assert.equal(matchPoints(2,1,4,rules),3);
 assert.equal(matchPoints(1,1,4,rules),1); assert.equal(matchPoints(0,1,4,rules),0);
});
test('round robin, null placeholders and league isolation', () => {
 const placeholders = Array.from({length:9},(_,i)=>match({match_id:`tbd${i}`, week:4, home_team_id:null,away_team_id:null,home_score:null,away_score:null,status:'scheduled'}));
 const model = buildSimulationModel(league, [match(), ...placeholders, match({league:'B',home_score:99})], [...standings, {...standing('T1',.2), league:'B'}]);
 assert.equal(model.completed,1); assert.equal(model.lambda,.5); assert.equal(model.remaining.length,35);
 assert.equal(model.base[0].points,2); assert.equal(model.base[0].participation_rate,1);
 for(const id of ['T1','T2','T3']) assert.equal(model.remaining.filter(m=>m.home===id||m.away===id).length + Number(id!=='T3'),24);
 assert.equal(model.remaining.filter(m=>m.week===4).length,9);
 assert.ok(model.remaining.filter(m=>m.week===4).every(m=>m.virtual));
});
test('known scheduled pairing is counted only once', () => {
 const m = match({home_score:null,away_score:null,status:'scheduled'});
 const model = buildSimulationModel(league,[m],standings);
 assert.equal(model.remaining.length,36);
 assert.equal(model.remaining.filter(m=>m.key==='a').length,1);
 assert.equal(model.remaining.filter(m=>m.week===1 && m.home==='T1' && m.away==='T2').length,3);
});
test('reject duplicate, impossible, partial score and inconsistent TBD data', () => {
 assert.throws(()=>buildSimulationModel(league,[match(),match()],standings));
 assert.throws(()=>buildSimulationModel(league,Array.from({length:4},(_,i)=>match({match_id:String(i)})),standings));
 assert.throws(()=>buildSimulationModel(league,[match({status:'scheduled',away_score:null})],standings));
 const tbd = Array.from({length:7},(_,i)=>match({match_id:String(i),home_team_id:'T1',away_team_id:null,home_score:null,away_score:null,status:'scheduled'}));
 assert.throws(()=>buildSimulationModel(league,tbd,standings));
});
test('Poisson mean, variance, symmetry and unseen scores with seeded sampling', () => {
 const random=rng(); let sum=0,square=0, wins=0,losses=0,max=0; const n=60000;
 for(let i=0;i<n;i++) {const h=poisson(1.2,random),a=poisson(1.2,random);sum+=h;square+=h*h;max=Math.max(max,h);wins+=Number(h>a);losses+=Number(h<a);}
 assert.ok(Math.abs(sum/n-1.2)<.025);
 assert.ok(Math.abs(square/n-(sum/n)**2-1.2)<.04);
 assert.ok(Math.abs(wins-losses)/n<.015); assert.ok(max>3);
 assert.equal(poisson(0,random),0);
});
test('zero lambda, exact ties, fixed results and no mutation', async () => {
 const model=buildSimulationModel(league,[match({home_score:0,away_score:0})],standings);
 const before=JSON.stringify(model);
 const fixed=Object.fromEntries(model.remaining.map(m=>[m.key,[0,0]]));
 const result=await simulate(model,fixed);
 assert.deepEqual(result.credits,{T1:1/3,T2:1/3,T3:1/3}); assert.equal(result.exact,true);
 assert.deepEqual((await simulate(model)).credits,result.credits);
 assert.equal(JSON.stringify(model),before); assert.equal(model.lambda,0);
 fixed[model.remaining.find(m=>m.week===4 && m.home==='T1').key]=[2,0];
 assert.equal((await simulate(model,fixed)).credits.T1,1);
 await assert.rejects(simulate(model,{bad:[1,0]}));
 await assert.rejects(simulate(model,{[model.remaining[0].key]:[-1,0]}));
});
test('no observations block random simulation; fixed full scenario works', async () => {
 const model=buildSimulationModel(league,[],standings);
 assert.equal(model.lambda,null); await assert.rejects(simulate(model));
 assert.equal((await simulate(model,Object.fromEntries(model.remaining.map(m=>[m.key,[0,0]])))).exact,true);
});
test('finished league shares championship credit without random sampling', async () => {
 const empty=buildSimulationModel(league,[],standings);
 const all=empty.remaining.map((m,i)=>match({match_id:String(i),week:m.week,home_team_id:m.home,away_team_id:m.away,home_score:0,away_score:0}));
 const model=buildSimulationModel(league,all,standings);
 assert.equal(model.remaining.length,0);
 const result=await simulate(model,{},10000,()=>{throw Error('Should not sample');});
 assert.equal(result.trials,1); assert.deepEqual(result.credits,{T1:1/3,T2:1/3,T3:1/3});
});
test('Monte Carlo conserves credit and freezes participation', async () => {
 const model=buildSimulationModel(league,[match()],standings);
 const before=JSON.stringify(model);
 const result=await simulate(model,{},2000,rng());
 assert.ok(Math.abs(Object.values(result.credits).reduce((a,b)=>a+b,0)-1)<1e-10);
 assert.equal(result.trials,2000); assert.equal(JSON.stringify(model),before);
});
test('checked-in data totals match simulator base without double counting', () => {
 const leagues=read('../src/data/leagues.json'), matches=read('../src/data/matches.json'), table=read('../src/data/league_table.json');
 for(const l of leagues) {
  const model=buildSimulationModel(l,matches,table);
  for(const row of table.filter(r=>r.league===l.id)) {
   const base=model.base.find(r=>r.team_id===row.team_id);
   for(const field of rules.ranking_criteria) assert.equal(base[field],row[field]);
  }
  assert.equal(model.completed+model.remaining.length,l.rules.weeks*l.rules.matches_per_week);
 }
});

test('one random trial is still an estimate, not an exact scenario', async () => {
 const model=buildSimulationModel(league,[match()],standings);
 assert.equal((await simulate(model,{},1,rng())).exact,false);
});
