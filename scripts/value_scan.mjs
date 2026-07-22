#!/usr/bin/env node
// Ad-hoc value scan: prints the model's FAIR odds (1 / model probability, no margin)
// for upcoming group matches and the tournament/stage markets, so they can be
// compared against the Singapore Pools price. Value = book price HIGHER than fair.
// Reuses the app's exact Dixon-Coles mapping (see scripts/evaluate_bets.mjs).
//   node scripts/value_scan.mjs [--n 16]   (n = how many upcoming matches to show)
import {execFileSync} from 'child_process';
import {readFileSync} from 'fs';
import {parseD, readData, ROOT} from './datafile.mjs';
import {statusDelta, statusBreakdown, ROTATION_PEN} from './teamstatus.mjs';
import {clinchedFirst} from './clinch.mjs';
import {resolveBracket} from './bracket.mjs';
import {join} from 'path';

const D = parseD(), data = readData();
const RES = data.results || {}, MK = data.markets || null, SCHED = data.sched || {}, PROF = data.profiles || {};
const GL = Object.keys(D.groups), FX = [[0,1],[2,3],[0,2],[1,3],[0,3],[1,2]];
const nm = t => D.short[t] || t;
const effE = t => D.elo[t] + statusDelta(PROF[t]);   // match-level: rating + current-status delta

// rotation flag: a team that has CLINCHED 1st (nothing to play for) likely rests
// starters in its remaining group game → weaken it. Auto-detected from results.
const CLINCH1 = {}; for (const g of GL) CLINCH1[g] = clinchedFirst(g, {groups:D.groups,results:RES,matchStats:data.matchStats||{},elo:D.elo,fifaRank:data.fifaRank||{}});
// signed delta added to (effE(a)-effE(b)) for a group match: negative weakens home a, positive weakens away b
const rotDelta = (g,a,b,id) => RES[id] ? 0 : (CLINCH1[g]===a ? -ROTATION_PEN : CLINCH1[g]===b ? ROTATION_PEN : 0);
const argv = process.argv.slice(2);
const N = (() => { const i = argv.indexOf('--n'); return i >= 0 ? +argv[i+1] : 16; })();

// ---- model (identical to evaluate_bets.mjs) ----
const fac=[1]; for(let i=1;i<14;i++) fac[i]=fac[i-1]*i;
const pois=(k,l)=>Math.exp(-l)*Math.pow(l,k)/fac[k];
function dc(diff){const c=0.0058,T=2.65,rho=-0.14,S=c*diff,lh=Math.max(.12,(T+S)/2),la=Math.max(.12,(T-S)/2);
 let pw=0,pd=0,pl=0,tot=0,mat=[];for(let i=0;i<11;i++){mat[i]=[];for(let j=0;j<11;j++){let p=pois(i,lh)*pois(j,la);
  if(i==0&&j==0)p*=(1-lh*la*rho);else if(i==0&&j==1)p*=(1+lh*rho);else if(i==1&&j==0)p*=(1+la*rho);else if(i==1&&j==1)p*=(1-rho);
  mat[i][j]=p;tot+=p;if(i>j)pw+=p;else if(i==j)pd+=p;else pl+=p;}}
 return {pa:pw/tot,pd:pd/tot,pb:pl/tot,mat:mat.map(r=>r.map(x=>x/tot)),lh,la};}

const fair = p => (p > 0 ? (1/p).toFixed(2) : '—');
const MON = {Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8};
const dval = d => { const m = (d||'').match(/([A-Za-z]+)\s+(\d+)/); return m ? MON[m[1].slice(0,3)]*100 + +m[2] : 9999; };

// ---- upcoming group matches ----
const upcoming = [];
for (const g of GL) for (let i=0;i<6;i++){
  const id='g_'+g+'_'+i; if(RES[id]) continue;
  const a=D.groups[g][FX[i][0]], b=D.groups[g][FX[i][1]];
  const da=statusDelta(PROF[a]), db=statusDelta(PROF[b]);
  const rot=rotDelta(g,a,b,id);  // squad-rotation discount if one side has clinched 1st
  const r=dc(effE(a)-effE(b)+rot);   // status-adjusted (injuries/form) + rotation, not raw Elo
  let over=0,btts=0; for(let x=0;x<11;x++)for(let y=0;y<11;y++){if(x+y>=3)over+=r.mat[x][y];if(x>=1&&y>=1)btts+=r.mat[x][y];}
  // most likely scoreline
  let best=[0,0],bp=0; for(let x=0;x<6;x++)for(let y=0;y<6;y++)if(r.mat[x][y]>bp){bp=r.mat[x][y];best=[x,y];}
  const sc=(SCHED[id]||{}); const lean = r.pa>=r.pd&&r.pa>=r.pb?nm(a)+' win':r.pb>=r.pd?nm(b)+' win':'Draw';
  upcoming.push({id,g,a,b,d:sc.d||'?',t:sc.t||'',dv:dval(sc.d),r,over,btts,best,bp,lean,da,db,rot});
}
const nGroup = upcoming.length;

// ---- upcoming knockout matches (decided matchup, not yet played) ----
// Group games run out once the group stage ends, so the knockout bracket (resolved
// from RESULTS the same way resolve_bracket.mjs does — never the Elo projection)
// has to feed this list too, or the scan goes silent for the rest of the tournament.
let THIRDS_TABLE = {}; try { THIRDS_TABLE = JSON.parse(readFileSync(join(ROOT,'thirds_combinations.json'),'utf8')); } catch {}
const KOM = resolveBracket(D, data, THIRDS_TABLE);
const koschedM = readFileSync(join(ROOT,'index.html'),'utf8').match(/const KOSCHED=(\{[\s\S]*?\});/);
const KOSCHED = koschedM ? new Function('return ' + koschedM[1])() : {};
const roundShort = m => m<89?'R32':m<97?'R16':m<200?'QF':m<300?'SF':'Final';
for (const mid of Object.keys(KOM)) {
  const mt = KOM[mid];
  if (!mt.a || !mt.b || RES[mid]) continue;   // undecided matchup, or already played
  const da=statusDelta(PROF[mt.a]), db=statusDelta(PROF[mt.b]);
  const r=dc(effE(mt.a)-effE(mt.b));          // no rotation penalty — nothing left to rest for
  let over=0,btts=0; for(let x=0;x<11;x++)for(let y=0;y<11;y++){if(x+y>=3)over+=r.mat[x][y];if(x>=1&&y>=1)btts+=r.mat[x][y];}
  let best=[0,0],bp=0; for(let x=0;x<6;x++)for(let y=0;y<6;y++)if(r.mat[x][y]>bp){bp=r.mat[x][y];best=[x,y];}
  const sc=KOSCHED[mid]||{}; const lean=r.pa>=r.pd&&r.pa>=r.pb?nm(mt.a)+' win':r.pb>=r.pd?nm(mt.b)+' win':'Draw';
  upcoming.push({id:mid,g:roundShort(+mid),a:mt.a,b:mt.b,d:sc.d||'?',t:sc.t||'',dv:dval(sc.d),r,over,btts,best,bp,lean,da,db,rot:0,ko:true});
}
upcoming.sort((x,y)=>x.dv-y.dv);

console.log(`\n=== UPCOMING MATCHES — model fair odds (compare to Singapore Pools; value = book pays MORE) ===`);
console.log(`(${nGroup} group + ${upcoming.length-nGroup} knockout match(es) unplayed; showing the next ${Math.min(N,upcoming.length)} by date)\n`);
console.log('DATE   '.padEnd(8)+'MATCH'.padEnd(34)+'  HOME  DRAW  AWAY  | O2.5  U2.5  BTTS | MODEL LEAN');
for (const m of upcoming.slice(0,N)){
  const match=(m.ko?'['+m.g+'] ':'')+(nm(m.a)+' v '+nm(m.b));
  console.log(
    (m.d||'?').padEnd(7)+' '+match.padEnd(33)+' '+
    fair(m.r.pa).padStart(5)+' '+fair(m.r.pd).padStart(5)+' '+fair(m.r.pb).padStart(5)+' | '+
    fair(m.over).padStart(4)+' '+fair(1-m.over).padStart(4)+' '+fair(m.btts).padStart(4)+' | '+
    m.lean+' ('+(Math.max(m.r.pa,m.r.pd,m.r.pb)*100).toFixed(0)+'%), likely '+m.best[0]+'-'+m.best[1]
    +((m.da||m.db)?`  [status: ${nm(m.a)} ${m.da>=0?'+':''}${m.da} / ${nm(m.b)} ${m.db>=0?'+':''}${m.db}]`:'')
    +(m.rot?`  [REST RISK: ${nm(m.rot<0?m.a:m.b)} clinched 1st −${ROTATION_PEN}]`:''));
}

// why the status deltas were applied (each adjusted team once)
{
  const seen=new Set(), rows=[];
  for (const m of upcoming.slice(0,N)) for (const t of [m.a,m.b]){
    if (seen.has(t)) continue; seen.add(t);
    const bd=statusBreakdown(PROF[t]); if(!bd.delta && !bd.parts.length) continue;
    if (bd.parts.length) rows.push([t,bd]);
  }
  if (rows.length){
    console.log('\nWHY (status adjustments to match odds):');
    for (const [t,bd] of rows){const s=(bd.delta>=0?'+':'')+bd.delta;console.log('  '+nm(t).padEnd(14)+s.padStart(5)+'  '+bd.parts.map(p=>p.label).join('; '));}
    console.log('  (* = a listed key player. Tune magnitudes in scripts/teamstatus.mjs.)');
  }
}

// ---- tournament / stage markets (from the Monte-Carlo board) ----
if (MK){
  const top=(o,k)=>Object.entries(o||{}).sort((a,b)=>b[1]-a[1]).slice(0,k);
  console.log(`\n=== STAGE / OUTRIGHT — model fair odds (${MK.n?.toLocaleString?.()||MK.n} sims, asof ${MK.asof}) ===`);
  console.log('\nCHAMPION (top 10 fair):');
  top(MK.winner,10).forEach(([t,p])=>console.log('  '+nm(t).padEnd(20)+fair(p).padStart(7)+'   ('+(p*100).toFixed(1)+'%)'));
  console.log('\nGROUP WINNER (model favourite per group):');
  for(const g of GL){const e=Object.entries(MK.groupWinner||{}).filter(([t])=>D.groups[g].includes(t)).sort((a,b)=>b[1]-a[1])[0];
    if(e)console.log('  '+g+': '+nm(e[0]).padEnd(20)+fair(e[1]).padStart(7)+'   ('+(e[1]*100).toFixed(0)+'%)');}
  if(MK.continent){console.log('\nWINNING CONTINENT:');
    Object.entries(MK.continent).sort((a,b)=>b[1]-a[1]).forEach(([c,p])=>console.log('  '+c.padEnd(20)+fair(p).padStart(7)+'   ('+(p*100).toFixed(0)+'%)'));}
  if(MK.totalGoalsBand){console.log('\nTOTAL GOALS BANDS:');
    Object.entries(MK.totalGoalsBand).sort((a,b)=>b[1]-a[1]).slice(0,6).forEach(([band,p])=>console.log('  '+band.padEnd(20)+fair(p).padStart(7)+'   ('+(p*100).toFixed(0)+'%)'));}
  if(MK.finalistPair){console.log('\nBOTH FINALISTS (top 6 pairs):');
    top(MK.finalistPair,6).forEach(([pair,p])=>console.log('  '+pair.padEnd(28)+fair(p).padStart(7)+'   ('+(p*100).toFixed(1)+'%)'));}
}

// ---- which of the existing slip's OPEN bets the model still likes (real edge: model% × odds − 1) ----
let slip; try{ slip=JSON.parse(execFileSync('git',['show','origin/bets-private:bets.json'],{encoding:'utf8'})); }catch{ slip=null; }
if (slip && Array.isArray(slip.bets)){
  const findFx=(t1,t2)=>{for(const g of GL)for(let i=0;i<6;i++){const h=D.groups[g][FX[i][0]],a=D.groups[g][FX[i][1]];if((h===t1&&a===t2)||(h===t2&&a===t1))return 'g_'+g+'_'+i;}return null;};
  const rotFor=(t1,t2)=>{const f=findFx(t1,t2);if(!f||RES[f])return 0;const g=f.split('_')[1];return CLINCH1[g]===t1?-ROTATION_PEN:CLINCH1[g]===t2?ROTATION_PEN:0;};
  const mProb=b=>{switch(b.type){
    case 'match1x2':{const r=dc(effE(b.sel)-effE(b.sel2)+rotFor(b.sel,b.sel2));return b.out==='1'?r.pa:b.out==='X'?r.pd:r.pb;}
    case 'score':{const r=dc(effE(b.sel)-effE(b.sel2)+rotFor(b.sel,b.sel2));const p=(b.out||'').split('-').map(Number);return r.mat[p[0]]?.[p[1]]??null;}
    case 'groupWinner':return MK?.groupWinner?.[b.sel]??null;
    case 'finalistPair':return MK?.finalistPair?.[[b.sel,b.sel2].sort().join(' & ')]??null;
    case 'finalistSingle':return MK?.finalist?.[b.sel]??null;
    case 'winner':return MK?.winner?.[b.sel]??null;
    case 'runnerUp':return MK?.runnerUp?.[b.sel]??null;
    case 'exit':return MK?.exit?.[b.sel]?.[b.out]??null;
    case 'continent':return MK?.continent?.[b.sel]??null;
    case 'totalGoals':return MK?.totalGoalsBand?.['265-279']??null;
    default:return null;}};
  const live=b=>{ // still bettable (not already settled by a recorded result)
    if(['match1x2','score','htScore','htft','firstScorer','anytimeScorer','teamFirstGoal'].includes(b.type)){const f=findFx(b.sel,b.sel2);return !(f&&RES[f]);}
    return true;};
  const rows=[];
  for(const b of slip.bets){ if(!live(b))continue; const p=mProb(b); if(p==null||!b.odds)continue;
    rows.push({b,p,edge:p*b.odds-1}); }
  rows.sort((a,b)=>b.edge-a.edge);
  console.log('\n=== YOUR OPEN BETS, ranked by model edge (model% × your odds − 1) ===');
  for(const {b,p,edge} of rows){
    const desc=b.player?`${b.player} ${b.type}`:`${nm(b.sel||'')}${b.sel2?' v '+nm(b.sel2):''} ${b.out||b.type}`;
    console.log('  '+(edge>=0?'+':'')+(edge*100).toFixed(0)+'%'.padEnd(2)+'  @'+b.odds+'  model '+(p*100).toFixed(1)+'%   '+desc.trim());
  }
}
