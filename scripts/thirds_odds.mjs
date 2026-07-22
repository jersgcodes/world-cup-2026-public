#!/usr/bin/env node
// Best-third qualification odds: how likely is a 3rd-placed team to take one of
// the 8 spots (of 12 groups), broken down by final POINTS and GOAL DIFFERENCE.
// Reuses the app's Dixon–Coles model (same as simulate.mjs), holding real group
// results fixed and sampling the rest. Pools all 12 third-placed teams per sim.
//
//   node scripts/thirds_odds.mjs            # default 150k sims
//   node scripts/thirds_odds.mjs --n 50000
import {parseD,readData} from './datafile.mjs';
const D=parseD(), data=readData(), RES=data.results||{};
const GL=Object.keys(D.groups), FX=[[0,1],[2,3],[0,2],[1,3],[0,3],[1,2]];
const argv=process.argv.slice(2);
const N=(()=>{const i=argv.indexOf('--n');return i>=0?+argv[i+1]:150000;})();

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
function sample(a,b){const arr=model(elo(a)-elo(b)).cumArr,r=Math.random();
 for(let k=0;k<arr.length;k++)if(r<=arr[k][2])return [arr[k][0],arr[k][1]];
 return [arr[arr.length-1][0],arr[arr.length-1][1]];}

const byPG={}, byGD={}, byPts={};
const add=(o,k,win)=>{(o[k]=o[k]||{q:0,n:0}).n++;if(win)o[k].q++;};
for(let s=0;s<N;s++){
 const thirds=[];
 GL.forEach(g=>{const T=D.groups[g], st=T.map((t,i)=>({t,GF:0,GA:0,Pts:0,seed:i}));
  FX.forEach((pr,i)=>{let sc=RES['g_'+g+'_'+i];if(!sc)sc=sample(T[pr[0]],T[pr[1]]);
   const A=st[pr[0]],B=st[pr[1]],[h,a]=sc;A.GF+=h;A.GA+=a;B.GF+=a;B.GA+=h;
   if(h>a)A.Pts+=3;else if(h<a)B.Pts+=3;else{A.Pts++;B.Pts++;}});
  st.forEach(x=>x.GD=x.GF-x.GA);
  st.sort((a,b)=>b.Pts-a.Pts||b.GD-a.GD||b.GF-a.GF||a.seed-b.seed);
  thirds.push({Pts:st[2].Pts,GD:st[2].GD,GF:st[2].GF,seed:D.elo[st[2].t]});});
 thirds.sort((a,b)=>b.Pts-a.Pts||b.GD-a.GD||b.GF-a.GF||b.seed-a.seed);
 thirds.forEach((x,rank)=>{const win=rank<8;
  add(byPts,String(x.Pts),win);add(byGD,String(x.GD),win);add(byPG,x.Pts+'|'+x.GD,win);});
}
const M=12*N, pc=o=>(100*o.q/o.n).toFixed(1)+'%', fr=o=>(100*o.n/M).toFixed(1)+'%';
const gds=g=>(g>=0?'+'+g:String(g));
console.log(`Best-third qualification (top 8 of 12) · ${N.toLocaleString()} sims · results asof ${data.asof}\n`);
console.log('By POINTS (any GD):');
Object.keys(byPts).map(Number).sort((a,b)=>a-b).forEach(p=>{const o=byPts[p];
 console.log(`  ${p} pt${p===1?' ':'s'}:  qualifies ${pc(o).padStart(6)}   (${fr(o).padStart(5)} of all thirds)`);});
console.log('\nBy GOAL DIFFERENCE (any points):');
Object.keys(byGD).map(Number).sort((a,b)=>b-a).forEach(g=>{const o=byGD[g];if(o.n/M<0.003)return;
 console.log(`  GD ${gds(g).padStart(3)}:  qualifies ${pc(o).padStart(6)}   (${fr(o).padStart(5)})`);});
console.log('\nBy POINTS × GD  (GD is the first tiebreak among equal points):');
const rows=Object.keys(byPG).map(k=>{const[p,g]=k.split('|').map(Number);return{p,g,o:byPG[k]};})
 .filter(x=>x.o.n/M>=0.004).sort((a,b)=>b.p-a.p||b.g-a.g);
let lp=null;rows.forEach(x=>{if(x.p!==lp){console.log(`  — ${x.p} points —`);lp=x.p;}
 console.log(`     GD ${gds(x.g).padStart(3)}:  ${pc(x.o).padStart(6)}   (${fr(x.o).padStart(5)})`);});
