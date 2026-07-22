#!/usr/bin/env node
// Group-stage end-game analysis (one-off, not part of the routine):
//   1. Current standings per group (proper 2026 FIFA tiebreaks)
//   2. Monte-Carlo finishing-position probabilities (1st/2nd/3rd/4th) per team,
//      holding played results fixed and sampling the rest with the status-adjusted
//      Dixon-Coles model (same mapping as value_scan / thirds_odds)
//   3. Best-third (top 8 of 12) qualification probability per current/likely 3rd team
//   4. Must-win read for the remaining final-round matches
//
//   node scripts/qualify_analysis.mjs [--n 100000]
import {parseD, readData} from './datafile.mjs';
import {fifaStandings, fifaBestThirds} from './standings.mjs';
import {statusDelta} from './teamstatus.mjs';

const D = parseD(), data = readData();
const RES = data.results || {}, PROF = data.profiles || {}, STATS = data.matchStats || {}, RANK = data.fifaRank || {};
const GL = Object.keys(D.groups), FX = [[0,1],[2,3],[0,2],[1,3],[0,3],[1,2]];
const nm = t => D.short?.[t] || t;
const argv = process.argv.slice(2);
const N = (() => { const i = argv.indexOf('--n'); return i >= 0 ? +argv[i+1] : 100000; })();

// status-adjusted elo (injuries + form) — the "adjusted Elo" the user asked about
const effE = t => D.elo[t] + statusDelta(PROF[t]);

// ---- Dixon-Coles sampler (cached by rounded elo gap) ----
const fac=[1]; for(let i=1;i<14;i++) fac[i]=fac[i-1]*i;
const pois=(k,l)=>Math.exp(-l)*Math.pow(l,k)/fac[k];
const cache=new Map();
function model(diff){const key=Math.round(diff/4); if(cache.has(key))return cache.get(key);
 const c=0.0058,T=2.65,rho=-0.14,S=c*(key*4),lh=Math.max(.12,(T+S)/2),la=Math.max(.12,(T-S)/2);
 let tot=0;const cells=[];
 for(let i=0;i<11;i++)for(let j=0;j<11;j++){let p=pois(i,lh)*pois(j,la);
  if(i==0&&j==0)p*=(1-lh*la*rho);else if(i==0&&j==1)p*=(1+lh*rho);
  else if(i==1&&j==0)p*=(1+la*rho);else if(i==1&&j==1)p*=(1-rho);
  cells.push([i,j,p]);tot+=p;}
 let cum=0;const cumArr=cells.map(([i,j,p])=>{cum+=p/tot;return[i,j,cum];});
 const r={cumArr};cache.set(key,r);return r;}
function sample(a,b){const arr=model(effE(a)-effE(b)).cumArr,r=Math.random();
 for(let k=0;k<arr.length;k++)if(r<=arr[k][2])return[arr[k][0],arr[k][1]];
 return[arr.at(-1)[0],arr.at(-1)[1]];}
// W/D/L probabilities for the must-win read
function wdl(a,b){const m=model(effE(a)-effE(b)).cumArr;let pw=0,pd=0,pl=0,prev=0;
 for(const[i,j,c] of m){const p=c-prev;prev=c;if(i>j)pw+=p;else if(i===j)pd+=p;else pl+=p;}
 return{w:pw,d:pd,l:pl};}

// ---- 1. current standings ----
const curStand = {};
for(const g of GL) curStand[g] = fifaStandings(g,{groups:D.groups,results:RES,matchStats:STATS,elo:D.elo,fifaRank:RANK});

// remaining matches per group
const remaining = {};
for(const g of GL){remaining[g]=[];for(let i=0;i<6;i++){const id='g_'+g+'_'+i;if(!RES[id])remaining[g].push(i);}}

// ---- 2/3. Monte-Carlo finishing positions + best-third qualification ----
const pos = {};            // team -> [p1,p2,p3,p4] counts
const thirdQual = {};      // team -> times qualified as a best-third
const thirdAppear = {};    // team -> times finished 3rd
for(const g of GL) for(const t of D.groups[g]){pos[t]=[0,0,0,0];thirdQual[t]=0;thirdAppear[t]=0;}

function simGroupOrder(g){
 const T=D.groups[g], st=T.map((t,i)=>({t,GF:0,GA:0,Pts:0,seed:i}));
 FX.forEach((pr,i)=>{let sc=RES['g_'+g+'_'+i];if(!sc)sc=sample(T[pr[0]],T[pr[1]]);
  const A=st[pr[0]],B=st[pr[1]],[h,a]=sc;A.GF+=h;A.GA+=a;B.GF+=a;B.GA+=h;
  if(h>a)A.Pts+=3;else if(h<a)B.Pts+=3;else{A.Pts++;B.Pts++;}});
 st.forEach(x=>x.GD=x.GF-x.GA);
 // simplified tiebreak for the sim (pts, overall GD, GF, then elo) — H2H rarely flips
 // the 3rd slot at the margins and exact H2H per-sim is expensive; good enough for odds
 st.sort((a,b)=>b.Pts-a.Pts||b.GD-a.GD||b.GF-a.GF||effE(b.t)-effE(a.t));
 return st;
}

for(let s=0;s<N;s++){
 const thirds=[];
 for(const g of GL){const st=simGroupOrder(g);
  st.forEach((x,r)=>pos[x.t][r]++);
  const th=st[2];thirdAppear[th.t]++;
  thirds.push({t:th.t,Pts:th.Pts,GD:th.GD,GF:th.GF,elo:effE(th.t)});}
 thirds.sort((a,b)=>b.Pts-a.Pts||b.GD-a.GD||b.GF-a.GF||b.elo-a.elo);
 thirds.slice(0,8).forEach(x=>thirdQual[x.t]++);
}

const pct=x=>(100*x/N);
const f1=x=>x.toFixed(1)+'%';

// ---- OUTPUT ----
console.log(`\n2026 WORLD CUP — GROUP END-GAME ANALYSIS  ·  asof ${data.asof}  ·  ${N.toLocaleString()} sims`);
console.log(`Model: status-adjusted Elo (injuries + recent form) → Dixon-Coles. 20 group games unplayed.\n`);

console.log('============================================================');
console.log(' 1. CURRENT STANDINGS  (▣ = clinched advance, ✗ = eliminated, by sim)');
console.log('============================================================');
for(const g of GL){
 const rem=remaining[g];
 console.log(`\nGroup ${g}${rem.length?'':'  (COMPLETE)'}   pos  team             P  Pts  GD  GF`);
 curStand[g].forEach((x,i)=>{
  const adv = pct(pos[x.t][0]+pos[x.t][1])>=99.95;
  const thirdSafe = pct(pos[x.t][0]+pos[x.t][1])+ (thirdAppear[x.t]?100*thirdQual[x.t]/N:0);
  const elim = (pos[x.t][0]+pos[x.t][1]+thirdQual[x.t])===0;
  const flag = adv?'▣':elim?'✗':' ';
  console.log(`   ${flag} ${i+1}.  ${nm(x.t).padEnd(16)} ${x.P}  ${String(x.Pts).padStart(2)}  ${String(x.GD>=0?'+'+x.GD:x.GD).padStart(3)} ${String(x.GF).padStart(3)}`);
 });
}

console.log('\n============================================================');
console.log(' 2. FINISHING-POSITION PROBABILITIES (per team)');
console.log('============================================================');
for(const g of GL){
 console.log(`\nGroup ${g}        1st     2nd     3rd     4th    | advance(1/2)  3rd→qualify`);
 const rows=D.groups[g].map(t=>({t,p:pos[t].map(c=>pct(c))}));
 rows.sort((a,b)=>(b.p[0]+b.p[1])-(a.p[0]+a.p[1])||b.p[0]-a.p[0]);
 for(const{t,p} of rows){
  const adv=p[0]+p[1];
  const q3 = thirdAppear[t]? 100*thirdQual[t]/N : 0; // unconditional P(finish 3rd AND qualify)
  const condQ = thirdAppear[t]? 100*thirdQual[t]/thirdAppear[t] : 0; // P(qualify | finished 3rd)
  console.log(`  ${nm(t).padEnd(14)} ${f1(p[0]).padStart(6)} ${f1(p[1]).padStart(6)} ${f1(p[2]).padStart(6)} ${f1(p[3]).padStart(6)}  | ${f1(adv).padStart(7)}     ${p[2]>=0.05?(condQ.toFixed(0)+'% if 3rd'):'—'}`);
 }
}

console.log('\n============================================================');
console.log(' 3. BEST-THIRD RACE — teams that may finish 3rd, ranked by P(qualify in top 8)');
console.log('============================================================');
const thirdRows=[];
for(const g of GL) for(const t of D.groups[g]){
 const p3=pct(pos[t][2]); if(p3<1) continue;
 thirdRows.push({g,t,p3,qual:thirdAppear[t]?100*thirdQual[t]/N:0,cond:thirdAppear[t]?100*thirdQual[t]/thirdAppear[t]:0});
}
thirdRows.sort((a,b)=>b.cond-a.cond);
console.log('  team            grp   P(3rd)   P(qualify|3rd)   P(finish 3rd & qualify)');
for(const r of thirdRows){
 console.log(`  ${nm(r.t).padEnd(14)}  ${r.g}    ${f1(r.p3).padStart(6)}      ${r.cond.toFixed(0).padStart(3)}%           ${f1(r.qual).padStart(6)}`);
}

console.log('\n============================================================');
console.log(' 4. MUST-WIN / SCENARIO READ — remaining final-round matches');
console.log('============================================================');
console.log('(For each unplayed match: model W/D/L and what each side needs. Read with §2 above.)');
for(const g of GL){
 if(!remaining[g].length) continue;
 console.log(`\n── Group ${g} ──`);
 for(const i of remaining[g]){
  const a=D.groups[g][FX[i][0]], b=D.groups[g][FX[i][1]];
  const p=wdl(a,b);
  const line=`  ${nm(a)} v ${nm(b)}`;
  console.log(`${line.padEnd(30)}  W ${(100*p.w).toFixed(0)}% / D ${(100*p.d).toFixed(0)}% / L ${(100*p.l).toFixed(0)}%`);
  for(const t of [a,b]){
   const win=pct(pos[t][0]+pos[t][1]);
   const q=thirdAppear[t]?100*thirdQual[t]/N:0;
   const total=win+q;
   let tag;
   if(total>=99.95) tag='through already (any result)';
   else if(total<=0.05) tag='eliminated';
   else tag=`advance ${total.toFixed(0)}%  (top2 ${win.toFixed(0)}% + 3rd-qual ${q.toFixed(0)}%)`;
   console.log(`       ${nm(t).padEnd(14)} → ${tag}`);
  }
 }
}
console.log('');
