#!/usr/bin/env node
// Evaluates the private bet slip against the live data + Monte-Carlo market board.
// For each bet it reports: settlement (won/lost/open), and for open bets the model
// probability vs the odds' implied probability (edge, EV) with a Monte-Carlo ± band;
// for settled bets the realised profit/loss. Then a portfolio summary.
//
//   node scripts/evaluate_bets.mjs                  # reads origin/bets-private:bets.json
//   node scripts/evaluate_bets.mjs --bets slip.json # read a local file instead
//   node scripts/evaluate_bets.mjs --json           # machine output
//
// The slip is NEVER served publicly (it lives on the bets-private branch). This is
// the on-demand evaluator any session / the routine can run.
import {readFileSync} from 'fs';
import {execFileSync} from 'child_process';
import {parseD,readData} from './datafile.mjs';
import {fifaStandings,fifaBestThirds} from './standings.mjs';
import {statusDelta} from './teamstatus.mjs';

const D=parseD(), data=readData();
const RES=data.results||{}, PENS=data.pens||{}, MK=data.markets||null, STATS=data.matchStats||{}, PROF=data.profiles||{};
const effE=t=>D.elo[t]+statusDelta(PROF[t]); // match-level effective Elo (rating + current status)
const GL=Object.keys(D.groups), FX=[[0,1],[2,3],[0,2],[1,3],[0,3],[1,2]];
const nm=t=>D.short[t]||t, conf=t=>D.conf[t];
// Robust player-name match for scorer bets — token bag, accent/suffix/surname-only tolerant.
// MUST stay in sync with nameEq/scorerEq in index.html so browser and node settle identically.
const _nsuf=new Set(['jr','junior','sr','snr','filho','neto','ii','iii']);
const _ntok=s=>(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/[^a-z ]/g,' ').replace(/\s+/g,' ').trim().split(' ').filter(t=>t&&!_nsuf.has(t));
const _tmatch=(t,other)=>t.length===1?other.some(o=>o[0]===t):other.includes(t); // single-letter token = initial
const scorerEq=(a,b)=>{const A=_ntok(a),B=_ntok(b);if(!A.length||!B.length)return false;
 if(A.every(t=>_tmatch(t,B))||B.every(t=>_tmatch(t,A)))return true; // subset, initial-tolerant ("V. Dijk"→"Virgil van Dijk")
 return A.join('')===B.join('');}; // joined signature: "Hwang In-Beom" == "Hwang Inbeom" (Korean romanisation)
const rcode=(arr,home,sel)=>{const h=arr[0]>arr[1]?'1':arr[0]<arr[1]?'2':'X';return home===sel?h:(h==='1'?'2':h==='2'?'1':'X');};
const rword=c=>c==='1'?'W':c==='2'?'L':'D';

const argv=process.argv.slice(2);
const bi=argv.indexOf('--bets');
// slip source: --bets file, else data.json's published "bets", else the bets-private branch
let slip;
try{
 if(bi>=0)slip=JSON.parse(readFileSync(argv[bi+1],'utf8'));
 else if(Array.isArray(data.bets)&&data.bets.length)slip={bets:data.bets};
 else slip=JSON.parse(execFileSync('git',['show','origin/bets-private:bets.json'],{encoding:'utf8'}));
}catch(e){console.error('could not load bet slip (data.json "bets", --bets <file>, or origin/bets-private):',e.message);process.exit(1);}

// ---- decided picture from recorded results ----
function groupComplete(g){for(let k=0;k<6;k++)if(!RES['g_'+g+'_'+k])return false;return true;}
const allGroupsDone=GL.every(groupComplete);
const standings=g=>fifaStandings(g,{groups:D.groups,results:RES,matchStats:STATS,elo:D.elo,fifaRank:data.fifaRank,fx:FX});
const bestThirds=()=>fifaBestThirds({groups:D.groups,results:RES,matchStats:STATS,elo:D.elo,fifaRank:data.fifaRank,fx:FX});
function thirds(){if(!allGroupsDone)return{};const as={};
 const pre=(data.thirds&&Object.keys(data.thirds).length)?data.thirds:null; // official FIFA slotting
 if(pre){D.R32.forEach(e=>[e.a,e.b].forEach(s=>{if(s.t==='T'&&pre[e.m]!=null)as[s.slot]=pre[e.m];}));return as;}
 const q=bestThirds().slice(0,8).map(x=>x.g),u={};
 D.R32.forEach(e=>[e.a,e.b].forEach(s=>{if(s.t!=='T')return;const p=q.find(g=>s.elig.includes(g)&&!u[g]);if(p){as[s.slot]=p;u[p]=1;}}));return as;}
const TH=thirds();
function gside(s){if(s.t==='W')return groupComplete(s.g)?standings(s.g)[0].t:null;
 if(s.t==='R')return groupComplete(s.g)?standings(s.g)[1].t:null;
 if(s.t==='T'){const g=TH[s.slot];return g?standings(g)[2].t:null;}return null;}
const M={}, exitStage={};
function setExit(t,st){if(t&&!exitStage[t])exitStage[t]=st;}
GL.forEach(g=>{if(groupComplete(g)){const s=standings(g);setExit(s[2].t,'Groups');setExit(s[3].t,'Groups');}});
D.R32.forEach(e=>{M[e.m]={round:'R32',a:gside(e.a),b:gside(e.b)};});
function winnerOf(m){const t=M[m],sc=RES[String(m)];if(!t||t.a==null||t.b==null||!sc)return null;
 if(sc[0]>sc[1]){setExit(t.b,roundName(m));return t.a;}if(sc[1]>sc[0]){setExit(t.a,roundName(m));return t.b;}
 const pv=PENS[String(m)],p=typeof pv==='string'?pv:(pv&&pv.w); // pens: legacy 'A'|'B' or {w,kicks}
 if(p==='A'){setExit(t.b,roundName(m));return t.a;}if(p==='B'){setExit(t.a,roundName(m));return t.b;}return null;}
function roundName(m){m=+m;return m<89?'R32':m<97?'R16':m<200?'QF':m<300?'SF':'RunnerUp';}
const r32=D.R32.map(e=>e.m);
D.r16.forEach((p,k)=>{M[D.r16m[k]]={round:'R16',a:winnerOf(r32[p[0]]),b:winnerOf(r32[p[1]])};});
D.qf.forEach((p,k)=>{M[D.qfm[k]]={round:'QF',a:winnerOf(D.r16m[p[0]]),b:winnerOf(D.r16m[p[1]])};});
D.sf.forEach((p,k)=>{M[200+k]={round:'SF',a:winnerOf(D.qfm[p[0]]),b:winnerOf(D.qfm[p[1]])};});
M[300]={round:'F',a:winnerOf(200),b:winnerOf(201)};
{const l0=M[200]&&M[200].a&&RES['200']?(winnerOf(200)===M[200].a?M[200].b:M[200].a):null; // third-place playoff feeders (SF losers)
 const l1=M[201]&&M[201].a&&RES['201']?(winnerOf(201)===M[201].a?M[201].b:M[201].a):null;
 M[301]={round:'3P',a:l0,b:l1};}
const champ=winnerOf(300);if(champ){exitStage[champ]='Winner';}
const finalists=(M[300].a&&M[300].b)?[M[300].a,M[300].b]:null;

// ---- model probability (same mapping as the app's Bets tab) ----
const fac=[1];for(let i=1;i<14;i++)fac[i]=fac[i-1]*i;const pois=(k,l)=>Math.exp(-l)*Math.pow(l,k)/fac[k];
function dc(diff){const c=0.0058,T=2.65,rho=-0.14,S=c*diff,lh=Math.max(.12,(T+S)/2),la=Math.max(.12,(T-S)/2);
 let pw=0,pd=0,pl=0,tot=0,mat=[];for(let i=0;i<11;i++){mat[i]=[];for(let j=0;j<11;j++){let p=pois(i,lh)*pois(j,la);
  if(i==0&&j==0)p*=(1-lh*la*rho);else if(i==0&&j==1)p*=(1+lh*rho);else if(i==1&&j==0)p*=(1+la*rho);else if(i==1&&j==1)p*=(1-rho);
  mat[i][j]=p;tot+=p;if(i>j)pw+=p;else if(i==j)pd+=p;else pl+=p;}}return{pa:pw/tot,pd:pd/tot,pb:pl/tot,mat:mat.map(r=>r.map(x=>x/tot))};}
function modelProb(b){const m=MK;switch(b.type){
 case 'match1x2':{const r=dc(effE(b.sel)-effE(b.sel2));return b.out==='1'?r.pa:b.out==='X'?r.pd:r.pb;}
 case 'score':{const r=dc(effE(b.sel)-effE(b.sel2));const p=b.out.split('-').map(Number);return (r.mat[p[0]]&&r.mat[p[0]][p[1]])||0;} // guard scorelines beyond the 11x11 grid
 case 'groupWinner':return m?(m.groupWinner[b.sel]||0):null;
 case 'finalistPair':return m?(m.finalistPair[[b.sel,b.sel2].sort().join(' & ')]||0):null;
 case 'finalistSingle':return m?(m.finalist[b.sel]||0):null;
 case 'winner':return m?(m.winner[b.sel]||0):null;
 case 'runnerUp':return m?(m.runnerUp[b.sel]||0):null;
 case 'exit':return m?((m.exit[b.sel]||{})[b.out]||0):null;
 case 'continent':return m?(m.continent[b.sel]||0):null;
 case 'totalGoals':return m?m.totalGoalsBand['265-279']:null;
 case 'matchTotal':{const r=dc(effE(b.sel)-effE(b.sel2));let s=0;for(let i=0;i<11;i++)for(let j=0;j<11;j++)if(totalHit(b.out,i+j))s+=r.mat[i][j];return s;}}return null;}
// parse a match-total selection ("9+", "Over 8.5", "Under 2.5", "2-3") → did `tot` goals hit it? null if unparseable
function totalHit(out,tot){const s=String(out||'').toLowerCase();let m;
 if(m=s.match(/(\d+)\s*\+/))return tot>=+m[1];
 if(m=s.match(/over\s*(\d+(?:\.\d+)?)/))return tot>+m[1];
 if(m=s.match(/under\s*(\d+(?:\.\d+)?)/))return tot<+m[1];
 if(m=s.match(/(\d+)\s*-\s*(\d+)/))return tot>=+m[1]&&tot<=+m[2];
 return null;}

// ---- settlement (won / lost / open) from recorded results ----
function findFx(t1,t2){for(const g of GL)for(let i=0;i<6;i++){const h=D.groups[g][FX[i][0]],a=D.groups[g][FX[i][1]];
 if((h===t1&&a===t2)||(h===t2&&a===t1))return{id:'g_'+g+'_'+i,home:h,away:a};}
 for(const id in M){const t=M[id];if(t&&t.a&&t.b&&((t.a===t1&&t.b===t2)||(t.a===t2&&t.b===t1)))return{id:String(id),home:t.a,away:t.b};} // KO ties: scores stored [a,b]
 return null;}
function settle(b){switch(b.type){
 case 'match1x2':{const f=findFx(b.sel,b.sel2);if(!f)return 'open';const sc=RES[f.id];if(!sc)return 'open';
  const home=sc[0]>sc[1]?'1':sc[0]<sc[1]?'2':'X';const rel=(f.home===b.sel)?home:(home==='1'?'2':home==='2'?'1':'X');return rel===b.out?'won':'lost';}
 case 'score':{const f=findFx(b.sel,b.sel2);if(!f)return 'open';const sc=RES[f.id];if(!sc)return 'open';
  const p=b.out.split('-').map(Number);const exp=(f.home===b.sel)?p:[p[1],p[0]];return (sc[0]===exp[0]&&sc[1]===exp[1])?'won':'lost';}
 case 'groupWinner':{const g=GL.find(g=>D.groups[g].includes(b.sel));if(!groupComplete(g))return 'open';return standings(g)[0].t===b.sel?'won':'lost';}
 case 'finalistPair':{if(finalists)return (finalists.includes(b.sel)&&finalists.includes(b.sel2))?'won':'lost';
  if(exitStage[b.sel]||exitStage[b.sel2])return 'lost';return 'open';}
 case 'finalistSingle':{if(finalists)return finalists.includes(b.sel)?'won':'lost';if(exitStage[b.sel])return 'lost';return 'open';}
 case 'winner':{if(champ)return champ===b.sel?'won':'lost';if(exitStage[b.sel])return 'lost';return 'open';}
 case 'runnerUp':{if(finalists&&champ)return (finalists.includes(b.sel)&&champ!==b.sel)?'won':'lost';if(exitStage[b.sel]&&exitStage[b.sel]!=='RunnerUp'&&exitStage[b.sel]!=='Winner')return 'lost';return 'open';}
 case 'exit':{const e=exitStage[b.sel];if(!e)return 'open';return e===b.out?'won':'lost';}
 case 'continent':{if(champ)return conf(champ)===b.sel?'won':'lost';return 'open';}
 case 'totalGoals':return 'open'; // tournament total-goals needs every match incl. 3rd place; settle at the end only
 case 'topScorer':return 'open'; // Golden Boot — tournament-long outright; settle at the end only
 case 'matchTotal':{const f=findFx(b.sel,b.sel2);if(!f)return 'open';const sc=RES[f.id];if(!sc)return 'open';const hit=totalHit(b.out,sc[0]+sc[1]);return hit==null?'open':hit?'won':'lost';}
 case 'htScore':{const f=findFx(b.sel,b.sel2);if(!f)return 'open';const ht=(STATS[f.id]||{}).ht;if(!ht)return 'open';
  const p=(b.out||'').split('-').map(Number);const exp=(f.home===b.sel)?p:[p[1],p[0]];return (ht[0]===exp[0]&&ht[1]===exp[1])?'won':'lost';}
 case 'htft':{const f=findFx(b.sel,b.sel2);if(!f)return 'open';const ht=(STATS[f.id]||{}).ht,ft=RES[f.id];if(!ht||!ft)return 'open';
  return (rcode(ht,f.home,b.sel)===b.htOut&&rcode(ft,f.home,b.sel)===b.ftOut)?'won':'lost';}
 case 'firstScorer':{const f=findFx(b.sel,b.sel2);if(!f)return 'open';const g=((STATS[f.id]||{}).goals||[]).filter(x=>!x.og).slice().sort((a,b)=>(a.min||0)-(b.min||0));
  if(g.length)return scorerEq(g[0].scorer,b.player)?'won':'lost';const sc=RES[f.id];if(sc&&sc[0]+sc[1]===0)return 'lost';return 'open';} // 0-0 → no scorer; goals scored but unrecorded → stay open
 case 'anytimeScorer':{const f=findFx(b.sel,b.sel2);if(!f)return 'open';const g=((STATS[f.id]||{}).goals||[]).filter(x=>!x.og);
  if(g.some(x=>scorerEq(x.scorer,b.player)))return 'won';const sc=RES[f.id];if(sc&&sc[0]+sc[1]===0)return 'lost';if(sc&&g.length)return 'lost';return 'open';}
 case 'teamFirstGoal':{const f=findFx(b.sel,b.sel2);if(!f)return 'open';const g=((STATS[f.id]||{}).goals||[]).slice().sort((a,b)=>(a.min||0)-(b.min||0));
  if(g.length)return g[0].team===b.sel?'won':'lost';const sc=RES[f.id];if(sc&&sc[0]+sc[1]===0)return 'lost';return 'open';} // first goal (incl. OG, by ev.team); 0-0 → lost; goals unrecorded → open
 }
 return 'open';}

// ---- validatability: can this bet be auto-settled, and is the needed data present? ----
const AUTO=new Set(['match1x2','score','groupWinner','finalistPair','finalistSingle','winner','runnerUp','exit','continent','totalGoals','topScorer','matchTotal','htScore','htft','firstScorer','anytimeScorer','teamFirstGoal']);
function missingData(b){ // when a bet is open, what recorded stat (if any) is it blocked on for a FINISHED match
 if(!['htScore','htft','firstScorer','anytimeScorer','teamFirstGoal'].includes(b.type))return '';
 const f=findFx(b.sel,b.sel2);if(!f||!RES[f.id])return ''; // unplayed → genuinely pending, not blocked
 if(b.type==='htScore'||b.type==='htft'){if(!(STATS[f.id]||{}).ht)return 'half-time score';}
 if(b.type==='firstScorer'||b.type==='anytimeScorer'||b.type==='teamFirstGoal'){const sc=RES[f.id],g=(STATS[f.id]||{}).goals;
  if(sc&&(sc[0]+sc[1])>0&&!(g&&g.length))return 'goal scorers';}
 return '';}
function classify(b,st){if(!AUTO.has(b.type))return {cls:'manual',need:'no settlement rule for this market'};
 if(st==='won'||st==='lost')return {cls:'auto',need:''};
 const m=missingData(b);return m?{cls:'needs-data',need:'record '+m}:{cls:'pending',need:''};}

// ---- report ----
const lab=b=>({match1x2:`${nm(b.sel)} ${b.out==='X'?'draw':b.out==='1'?'win':'lose'} v ${nm(b.sel2)}`,score:`${nm(b.sel)} ${b.out} v ${nm(b.sel2)}`,
 groupWinner:`${nm(b.sel)} group winner`,finalistPair:`${nm(b.sel)} & ${nm(b.sel2)} finalists`,finalistSingle:`${nm(b.sel)} reach final`,
 winner:`${nm(b.sel)} champion`,runnerUp:`${nm(b.sel)} runner-up`,exit:`${nm(b.sel)} out in ${b.out}`,continent:`${b.sel} continent`,totalGoals:`total goals ${b.lo}-${b.hi}`,
 htScore:`${nm(b.sel)} ${b.out} HT v ${nm(b.sel2)}`,htft:`${nm(b.sel)} ${rword(b.htOut)}/${rword(b.ftOut)} HT-FT v ${nm(b.sel2)}`,
 firstScorer:`${b.player} 1st goal · ${nm(b.sel)} v ${nm(b.sel2)}`,anytimeScorer:`${b.player} to score · ${nm(b.sel)} v ${nm(b.sel2)}`,
 teamFirstGoal:`${nm(b.sel)} to score 1st goal · v ${nm(b.sel2)}`}[b.type]||b.label||b.type);
const n=MK?MK.n:0;
const rows=slip.bets.map(b=>{const forced=b.status==='lost'||b.status==='won';const st=forced?b.status:settle(b);
 const p=modelProb(b),imp=b.odds?1/b.odds:null,stake=+b.stake||0;
 const se=(p!=null&&n)?1.96*Math.sqrt(p*(1-p)/n):0;
 let realized=null;if(st==='won')realized=stake*(b.odds-1);else if(st==='lost')realized=-stake;
 const ev=(st==='open'&&p!=null)?p*b.odds-1:null;
 const v=forced?{cls:'manual',need:'settled by hand (status pinned)'}:classify(b,st);
 return {b,st,p,imp,se,stake,realized,ev,v};});
const out={asof:data.asof,n,bets:rows.map(r=>({label:lab(r.b),odds:r.b.odds,stake:r.stake,status:r.st,validation:r.v.cls,needs:r.v.need||undefined,model:r.p,edge:(r.p!=null&&r.imp!=null)?r.p-r.imp:null,ev:r.ev,realized:r.realized}))};
const staked=rows.filter(r=>r.st!=='lost'||r.stake).reduce((s,r)=>s+r.stake,0);
const realizedPL=rows.reduce((s,r)=>s+(r.realized||0),0);
const openEV=rows.filter(r=>r.st==='open').reduce((s,r)=>s+(r.ev!=null?r.stake*r.ev:0),0);
out.summary={openStake:rows.filter(r=>r.st==='open').reduce((s,r)=>s+r.stake,0),realizedPL:+realizedPL.toFixed(2),openExpectedPL:+openEV.toFixed(2)};
// validation coverage: how many bets settle automatically vs need data vs need a hand-settle
const cov={auto:0,pending:0,'needs-data':0,manual:0};rows.forEach(r=>cov[r.v.cls]++);
const needs=rows.filter(r=>r.v.cls==='needs-data'),manual=rows.filter(r=>r.v.cls==='manual'&&r.st==='open');
out.coverage={...cov,blocked:needs.map(r=>({label:lab(r.b),need:r.v.need})),manualOpen:manual.map(r=>lab(r.b))};

if(argv.includes('--json')){console.log(JSON.stringify(out,null,1));process.exit(0);}
const pc=x=>(x*100).toFixed(1)+'%';
const vtag={auto:'auto',pending:'auto·pending',['needs-data']:'⚠ NEEDS DATA',manual:'✋ manual'};
if(argv.includes('--coverage')){ // validatability-only view: what can and can't be auto-checked
 console.log(`Bet validation coverage · asof ${data.asof}\n`);
 for(const r of rows)console.log(`${vtag[r.v.cls].padEnd(13)} ${lab(r.b).padEnd(40)} ${r.st.padEnd(5)}${r.v.need?'  — '+r.v.need:''}`);
 console.log(`\n${cov.auto} settled · ${cov.pending} auto-pending · ${cov['needs-data']} need data · ${cov.manual} hand-settled`);
 if(needs.length)console.log('ACTION — record stats so these settle:\n'+needs.map(r=>'  · '+lab(r.b)+' → '+r.v.need).join('\n'));
 process.exit(needs.length?2:0);}
console.log(`Bet evaluation · results asof ${data.asof}${n?` · board ${n} sims`:' · NO market board'}\n`);
for(const r of rows){const tag=r.st==='won'?'✓ WON ':r.st==='lost'?'✗ LOST':'· open';
 let tail;
 if(r.st==='open'){const edge=(r.p!=null&&r.imp!=null)?r.p-r.imp:null;tail=r.p!=null?`model ${pc(r.p)}±${(r.se*100).toFixed(1)}  edge ${(edge>=0?'+':'')+(edge*100).toFixed(1)}%  EV ${(r.ev>=0?'+':'')+r.ev.toFixed(2)}`:(r.v.cls==='needs-data'?'⚠ '+r.v.need:r.v.cls==='manual'?'✋ hand-settle':'model n/a');}
 else tail=`P/L ${r.realized>=0?'+':''}$${r.realized.toFixed(2)}`;
 console.log(`${tag}  ${lab(r.b).padEnd(32)} @${String(r.b.odds).padStart(5)} $${String(r.stake).padStart(3)}  ${tail}`);}
console.log(`\nrealised P/L so far: ${realizedPL>=0?'+':''}$${realizedPL.toFixed(2)}   ·   open stake $${out.summary.openStake} → model-expected ${openEV>=0?'+':''}$${openEV.toFixed(2)}`);
console.log(`validation: ${cov.auto} settled · ${cov.pending} auto-pending · ${cov['needs-data']} need data · ${cov.manual} hand-settled`);
if(needs.length)console.log('⚠ record stats so these settle: '+needs.map(r=>lab(r.b)+' ('+r.v.need+')').join('; '));
console.log('Model view only; Monte-Carlo ± shown for open bets. Not advice.');
