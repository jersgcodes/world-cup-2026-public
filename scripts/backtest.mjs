#!/usr/bin/env node
// Backtests the match model against results recorded so far. Reports calibration
// (Brier + log-loss vs a naive 1/3-1/3-1/3 baseline) and favourite accuracy for the
// BASE Elo model, then — on the subset of played matches where a current-status
// delta would apply — whether the status-adjusted model fits better or worse.
//
// CAVEAT: profiles carry CURRENT status (today's injuries/form), not the state as of
// each past kickoff, and the played sample is small. So the status comparison is
// indicative, not conclusive — treat it as a sanity check, not a fit.
//   node scripts/backtest.mjs
import {parseD, readData} from './datafile.mjs';
import {statusDelta} from './teamstatus.mjs';

const D = parseD(), data = readData();
const RES = data.results || {}, PROF = data.profiles || {}, MS = data.matchStats || {};
const GL = Object.keys(D.groups), FX = [[0,1],[2,3],[0,2],[1,3],[0,3],[1,2]];
const nm = t => D.short[t] || t;

const fac=[1]; for(let i=1;i<14;i++) fac[i]=fac[i-1]*i;
const pois=(k,l)=>Math.exp(-l)*Math.pow(l,k)/fac[k];
function dc(diff){const c=0.0058,T=2.65,rho=-0.14,S=c*diff,lh=Math.max(.12,(T+S)/2),la=Math.max(.12,(T-S)/2);
 let pw=0,pd=0,pl=0,tot=0;for(let i=0;i<11;i++)for(let j=0;j<11;j++){let p=pois(i,lh)*pois(j,la);
  if(i==0&&j==0)p*=(1-lh*la*rho);else if(i==0&&j==1)p*=(1+lh*rho);else if(i==1&&j==0)p*=(1+la*rho);else if(i==1&&j==1)p*=(1-rho);
  tot+=p;if(i>j)pw+=p;else if(i==j)pd+=p;else pl+=p;}return[pw/tot,pd/tot,pl/tot];}

// collect played group matches
const games=[];
for (const g of GL) for (let i=0;i<6;i++){
  const id='g_'+g+'_'+i, sc=RES[id]; if(!sc) continue;
  const a=D.groups[g][FX[i][0]], b=D.groups[g][FX[i][1]];
  const outcome = sc[0]>sc[1]?0 : sc[0]<sc[1]?2 : 1;     // 0=A win, 1=draw, 2=B win
  const snap=(MS[id]||{}).status;                        // leakage-free as-of-kickoff snapshot, if recorded
  const sda = snap && snap[a] ? snap[a].d : statusDelta(PROF[a]);
  const sdb = snap && snap[b] ? snap[b].d : statusDelta(PROF[b]);
  games.push({id,a,b,sc,outcome,base:dc(D.elo[a]-D.elo[b]),adj:dc((D.elo[a]+sda)-(D.elo[b]+sdb)),hasStatus:(sda||sdb)?1:0,clean:snap?1:0});
}

const onehot=o=>[o===0?1:0,o===1?1:0,o===2?1:0];
const brier=(p,o)=>{const h=onehot(o);return (p[0]-h[0])**2+(p[1]-h[1])**2+(p[2]-h[2])**2;};
const logloss=(p,o)=>-Math.log(Math.max(1e-9,p[o]));
const hit=(p,o)=>(p.indexOf(Math.max(...p))===o)?1:0;
const mean=a=>a.reduce((s,x)=>s+x,0)/a.length;

function score(rows,key){
  return {n:rows.length,
    brier:mean(rows.map(r=>brier(r[key],r.outcome))),
    logloss:mean(rows.map(r=>logloss(r[key],r.outcome))),
    acc:mean(rows.map(r=>hit(r[key],r.outcome)))};
}

console.log(`\nBACKTEST — ${games.length} played group matches`);
if(!games.length){console.log('  no results recorded yet.');process.exit(0);}
const NAIVE_LL=-Math.log(1/3), NAIVE_BR=3*(1/3-0)**2 - 2*(1/3)**2 + (1-1/3)**2; // not used directly
console.log('\nBASE model (raw Elo):');
const b=score(games,'base');
console.log(`  matches ${b.n} | Brier ${b.brier.toFixed(3)} | log-loss ${b.logloss.toFixed(3)} | favourite hit-rate ${(b.acc*100).toFixed(0)}%`);
console.log(`  baseline (1/3 each): log-loss ${NAIVE_LL.toFixed(3)}  (lower than baseline = model adds signal)`);

const statusRows=games.filter(g=>g.hasStatus);
const cleanN=statusRows.filter(g=>g.clean).length;
console.log(`\nSTATUS-adjusted vs base, on the ${statusRows.length} played match(es) where a status delta applies (${cleanN} from leakage-free kickoff snapshots):`);
if(!statusRows.length){
  console.log('  none — the teams with current injuries/form data have not played yet,');
  console.log('  so the status-delta cannot be validated on past results. (Expected: status is a');
  console.log('  current snapshot, and the previews we populate are for UPCOMING teams.)');
} else {
  const sb=score(statusRows,'base'), sa=score(statusRows,'adj');
  console.log(`  base : Brier ${sb.brier.toFixed(3)} | log-loss ${sb.logloss.toFixed(3)} | hit ${(sb.acc*100).toFixed(0)}%`);
  console.log(`  adj  : Brier ${sa.brier.toFixed(3)} | log-loss ${sa.logloss.toFixed(3)} | hit ${(sa.acc*100).toFixed(0)}%`);
  console.log(`  -> status delta ${sa.logloss<sb.logloss?'IMPROVED':'WORSENED'} log-loss by ${Math.abs(sa.logloss-sb.logloss).toFixed(3)} (n=${statusRows.length}, indicative only).`);
}
console.log('\nNote: profiles hold CURRENT status, not as-of-kickoff; to truly backtest the delta,');
console.log('snapshot each team outs/form at match time going forward.');
