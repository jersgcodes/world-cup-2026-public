#!/usr/bin/env node
// Monte-Carlo tournament simulator for the WC2026 Lab.
//
// Simulates the whole tournament many times from the SAME calibrated Dixon–Coles
// model the app uses (seeded by Elo), holding REAL results fixed and sampling the
// rest, then tallies probabilities for the markets actually offered by Singapore
// Pools: group winner, finalist, champion, runner-up, stage of elimination,
// winning continent, and the tournament total-goals band.
//
//   node scripts/simulate.mjs                 # human-readable market board
//   node scripts/simulate.mjs --json          # machine output (the market board)
//   node scripts/simulate.mjs --write         # write the board into data.json's "markets"
//   node scripts/simulate.mjs --n 20000       # sim count (default 10000)
//
// It pulls D (teams/groups/bracket) straight out of index.html and reads results
// from data.json, so it can't drift from the app. Caveats it inherits: 3rd-place
// R32 allocation approximates FIFA's table; knockout draws are decided ~50/50 on
// penalties; ratings are pre-tournament Elo (no in-tournament re-rating here).
import {parseD,readData} from './datafile.mjs';
import {fifaStandings,fifaBestThirds} from './standings.mjs';

const D=parseD();
const data=readData();
const RES=data.results||{}, PENS=data.pens||{};
const GL=Object.keys(D.groups);
const FX=[[0,1],[2,3],[0,2],[1,3],[0,3],[1,2]];
const argv=process.argv.slice(2);
const N=(()=>{const i=argv.indexOf('--n');return i>=0?+argv[i+1]:10000;})();

// ---- model: Dixon–Coles scoreline matrix, memoised by rounded Elo diff ----
const fac=[1];for(let i=1;i<14;i++)fac[i]=fac[i-1]*i;
const pois=(k,l)=>Math.exp(-l)*Math.pow(l,k)/fac[k];
const cache=new Map();
function model(diff){const key=Math.round(diff/4);if(cache.has(key))return cache.get(key);
 const c=0.0058,T=2.65,rho=-0.14,S=c*(key*4);
 const lh=Math.max(.12,(T+S)/2),la=Math.max(.12,(T-S)/2);
 let tot=0;const cells=[];
 for(let i=0;i<11;i++)for(let j=0;j<11;j++){let p=pois(i,lh)*pois(j,la);
  if(i==0&&j==0)p*=(1-lh*la*rho);else if(i==0&&j==1)p*=(1+lh*rho);
  else if(i==1&&j==0)p*=(1+la*rho);else if(i==1&&j==1)p*=(1-rho);
  cells.push([i,j,p]);tot+=p;}
 let cum=0;const cumArr=cells.map(([i,j,p])=>{cum+=p/tot;return [i,j,cum];});
 const r={cumArr};cache.set(key,r);return r;}
const elo=t=>D.elo[t];
function sample(a,b){const m=model(elo(a)-elo(b));const r=Math.random();
 const arr=m.cumArr;for(let k=0;k<arr.length;k++)if(r<=arr[k][2])return [arr[k][0],arr[k][1]];
 return [arr[arr.length-1][0],arr[arr.length-1][1]];}

// ---- one simulation → market outcomes ----
function simOnce(){
 let goals=0; const exit={}; // team -> stage at which eliminated
 // group stage
 const first={},second={};
 // sample every group match, then rank with the shared FIFA tiebreakers (head-to-head etc.)
 const simScores={};
 GL.forEach(g=>{const T=D.groups[g];FX.forEach((pr,i)=>{let sc=RES['g_'+g+'_'+i];if(!sc)sc=sample(T[pr[0]],T[pr[1]]);goals+=sc[0]+sc[1];simScores['g_'+g+'_'+i]=sc;});});
 GL.forEach(g=>{const s=fifaStandings(g,{groups:D.groups,results:simScores,elo:D.elo,fifaRank:data.fifaRank,fx:FX});
  first[g]=s[0].t;second[g]=s[1].t;s.slice(3).forEach(x=>exit[x.t]='Groups');}); // 4th place out
 // best thirds: top 8 qualify, allocate to slots per elig (first-fit)
 const thirdInfo=fifaBestThirds({groups:D.groups,results:simScores,elo:D.elo,fifaRank:data.fifaRank,fx:FX});
 const qualG=thirdInfo.slice(0,8).map(x=>x.g), thirdByG={};thirdInfo.forEach(x=>thirdByG[x.g]=x.t);
 thirdInfo.slice(8).forEach(x=>exit[x.t]='Groups');
 const used={},slot={};
 D.R32.forEach(e=>[e.a,e.b].forEach(sd=>{if(sd.t!=='T')return;const pk=qualG.find(g=>sd.elig.includes(g)&&!used[g]);if(pk){slot[sd.slot]=pk;used[pk]=1;}}));
 // fallback: never leave a third-place slot empty (mirrors the app's autoThirds)
 D.R32.forEach(e=>[e.a,e.b].forEach(sd=>{if(sd.t!=='T'||slot[sd.slot]!=null)return;const pk=sd.elig.find(g=>!used[g])||sd.elig[0];slot[sd.slot]=pk;used[pk]=1;}));
 const side=sd=>sd.t==='W'?first[sd.g]:sd.t==='R'?second[sd.g]:thirdByG[slot[sd.slot]];
 // knockout helper: returns winner, records loser's exit stage, accrues goals
 function ko(a,b,id,stage){
  let sc=RES[String(id)];let w;
  if(sc){goals+=sc[0]+sc[1];const pv=PENS[String(id)],pw=typeof pv==='string'?pv:(pv&&pv.w);w=sc[0]>sc[1]?a:sc[1]>sc[0]?b:(pw==='A'?a:pw==='B'?b:(Math.random()<.5?a:b));}
  else{sc=sample(a,b);goals+=sc[0]+sc[1];w=sc[0]>sc[1]?a:sc[1]>sc[0]?b:(Math.random()<.5?a:b);}
  exit[w===a?b:a]=stage;return w;}
 const r32=D.R32.map(e=>ko(side(e.a),side(e.b),e.m,'R32'));
 const r16=D.r16.map((p,k)=>ko(r32[p[0]],r32[p[1]],D.r16m[k],'R16'));
 const qf=D.qf.map((p,k)=>ko(r16[p[0]],r16[p[1]],D.qfm[k],'QF'));
 const sf=D.sf.map((p,k)=>ko(qf[p[0]],qf[p[1]],200+k,'SF'));
 // 3rd-place playoff (total-goals only) between the two SF losers
 const sfLosers=[qf[D.sf[0][0]]===sf[0]?qf[D.sf[0][1]]:qf[D.sf[0][0]], qf[D.sf[1][0]]===sf[1]?qf[D.sf[1][1]]:qf[D.sf[1][0]]];
 {let sc=sample(sfLosers[0],sfLosers[1]);goals+=sc[0]+sc[1];}
 const champ=ko(sf[0],sf[1],300,'RunnerUp'); // loser of final exits as RunnerUp
 exit[champ]='Winner';
 return {first,champ,finalists:sf,exit,goals};
}

// ---- run ----
const T=[].concat(...GL.map(g=>D.groups[g]));
const z=()=>Object.fromEntries(T.map(t=>[t,0]));
const groupWin=z(),finalist=z(),winner=z(),runnerUp=z();
const exitDist=Object.fromEntries(T.map(t=>[t,{Groups:0,R32:0,R16:0,QF:0,SF:0,RunnerUp:0,Winner:0}]));
const continent={},finalPair={};let goalsSum=0,goalsSq=0;const goalsHist={};
for(let n=0;n<N;n++){const r=simOnce();
 GL.forEach(g=>groupWin[r.first[g]]++);
 r.finalists.forEach(t=>finalist[t]++);
 const fp=[...r.finalists].sort().join(' & ');finalPair[fp]=(finalPair[fp]||0)+1;
 winner[r.champ]++;r.finalists.forEach(t=>{if(t!==r.champ)runnerUp[t]++;});
 for(const t in r.exit)exitDist[t][r.exit[t]]++;
 const cf=D.conf[r.champ];continent[cf]=(continent[cf]||0)+1;
 goalsSum+=r.goals;goalsSq+=r.goals*r.goals;goalsHist[r.goals]=(goalsHist[r.goals]||0)+1;}
const pct=o=>Object.fromEntries(Object.entries(o).map(([k,v])=>[k,v/N]));
const goalsMean=goalsSum/N, goalsSd=Math.sqrt(goalsSq/N-goalsMean*goalsMean);
function band(lo,hi){let c=0;for(const k in goalsHist)if(+k>=lo&&+k<=hi)c+=goalsHist[k];return c/N;}
const out={asof:data.asof,n:N,
 groupWinner:pct(groupWin),finalist:pct(finalist),finalistPair:pct(finalPair),winner:pct(winner),runnerUp:pct(runnerUp),
 totalGoalsBand:{'265-279':band(265,279)},
 exit:Object.fromEntries(Object.entries(exitDist).map(([t,d])=>[t,pct2(d,N)])),
 continent:pct(continent),totalGoals:{mean:+goalsMean.toFixed(1),sd:+goalsSd.toFixed(1)}};
function pct2(d,n){return Object.fromEntries(Object.entries(d).map(([k,v])=>[k,v/n]));}

// round + prune to keep data.json lean (drop near-zero finalist pairs)
function tidy(o,floor=0){const r={};for(const[k,v]of Object.entries(o)){if(v<floor)continue;r[k]=Math.round(v*1e4)/1e4;}return r;}
out.groupWinner=tidy(out.groupWinner);out.finalist=tidy(out.finalist);out.winner=tidy(out.winner);
out.runnerUp=tidy(out.runnerUp);out.continent=tidy(out.continent);out.finalistPair=tidy(out.finalistPair,5e-4);
for(const t in out.exit)out.exit[t]=tidy(out.exit[t]);
out.totalGoalsBand={'265-279':Math.round(band(265,279)*1e4)/1e4};

if(argv.includes('--write')){const {readData,writeData}=await import('./datafile.mjs');
 const d=readData();d.markets=out;writeData(d);
 console.log(`wrote markets into data.json — ${N.toLocaleString()} sims, asof ${data.asof}`);process.exit(0);}
if(argv.includes('--json')){console.log(JSON.stringify(out));process.exit(0);}
// human board
const top=(o,k=8)=>Object.entries(o).sort((a,b)=>b[1]-a[1]).slice(0,k).map(([t,p])=>`${(p*100).toFixed(1).padStart(5)}%  ${t}`).join('\n');
const sh=t=>D.short[t]||t;
console.log(`WC2026 Monte-Carlo · ${N.toLocaleString()} sims · results asof ${data.asof}\n`);
console.log('— CHAMPION —\n'+top(out.winner));
console.log('\n— REACH FINAL —\n'+top(out.finalist));
console.log('\n— WINNING CONTINENT —\n'+Object.entries(out.continent).sort((a,b)=>b[1]-a[1]).map(([c,p])=>`${(p*100).toFixed(1).padStart(5)}%  ${c}`).join('\n'));
console.log(`\n— TOTAL GOALS —\n  mean ${out.totalGoals.mean} ± ${out.totalGoals.sd}   P(265–279)=${(band(265,279)*100).toFixed(1)}%`);
console.log('\n— GROUP WINNERS (top picks) —');
GL.forEach(g=>{const e=Object.entries(out.groupWinner).filter(([t])=>D.groups[g].includes(t)).sort((a,b)=>b[1]-a[1]);
 console.log(`  ${g}: `+e.map(([t,p])=>`${sh(t)} ${(p*100).toFixed(0)}%`).join(' · '));});
console.log('\n— SAMPLE ELIMINATION STAGES —');
['Spain','Korea Republic','Ecuador'].forEach(t=>{const d=out.exit[t];if(d)console.log(`  ${t}: `+Object.entries(d).filter(([,p])=>p>0).map(([s,p])=>`${s} ${(p*100).toFixed(0)}%`).join(' · '));});
