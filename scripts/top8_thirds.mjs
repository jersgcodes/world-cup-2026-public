#!/usr/bin/env node
// The single MOST LIKELY set of 8 qualifying best-thirds: which 8 groups supply a
// qualifying 3rd, and the most likely team to be that 3rd in each. Uses the same
// status-adjusted Dixon-Coles sampler as qualify_analysis.mjs.
import {parseD, readData} from './datafile.mjs';
import {statusDelta} from './teamstatus.mjs';
const D=parseD(), data=readData();
const RES=data.results||{}, PROF=data.profiles||{};
const GL=Object.keys(D.groups), FX=[[0,1],[2,3],[0,2],[1,3],[0,3],[1,2]];
const nm=t=>D.short?.[t]||t;
const N=+(process.argv.includes('--n')?process.argv[process.argv.indexOf('--n')+1]:200000);
const effE=t=>D.elo[t]+statusDelta(PROF[t]);
const fac=[1];for(let i=1;i<14;i++)fac[i]=fac[i-1]*i;
const pois=(k,l)=>Math.exp(-l)*Math.pow(l,k)/fac[k];
const cache=new Map();
function model(diff){const key=Math.round(diff/4);if(cache.has(key))return cache.get(key);
 const c=0.0058,T=2.65,rho=-0.14,S=c*(key*4),lh=Math.max(.12,(T+S)/2),la=Math.max(.12,(T-S)/2);
 let tot=0;const cells=[];for(let i=0;i<11;i++)for(let j=0;j<11;j++){let p=pois(i,lh)*pois(j,la);
  if(i==0&&j==0)p*=(1-lh*la*rho);else if(i==0&&j==1)p*=(1+lh*rho);else if(i==1&&j==0)p*=(1+la*rho);else if(i==1&&j==1)p*=(1-rho);
  cells.push([i,j,p]);tot+=p;}let cum=0;const cumArr=cells.map(([i,j,p])=>{cum+=p/tot;return[i,j,cum];});
 const r={cumArr};cache.set(key,r);return r;}
function sample(a,b){const arr=model(effE(a)-effE(b)).cumArr,r=Math.random();
 for(let k=0;k<arr.length;k++)if(r<=arr[k][2])return[arr[k][0],arr[k][1]];return[arr.at(-1)[0],arr.at(-1)[1]];}
function simGroup(g){const T=D.groups[g],st=T.map((t,i)=>({t,GF:0,GA:0,Pts:0,seed:i}));
 FX.forEach((pr,i)=>{let sc=RES['g_'+g+'_'+i];if(!sc)sc=sample(T[pr[0]],T[pr[1]]);
  const A=st[pr[0]],B=st[pr[1]],[h,a]=sc;A.GF+=h;A.GA+=a;B.GF+=a;B.GA+=h;
  if(h>a)A.Pts+=3;else if(h<a)B.Pts+=3;else{A.Pts++;B.Pts++;}});
 st.forEach(x=>x.GD=x.GF-x.GA);st.sort((a,b)=>b.Pts-a.Pts||b.GD-a.GD||b.GF-a.GF||effE(b.t)-effE(a.t));return st;}

const setFreq={};                       // which set of 8 groups qualifies (modal set)
const groupThirdName={};                // g -> {team: count finished 3rd}
GL.forEach(g=>groupThirdName[g]={});
for(let s=0;s<N;s++){
 const thirds=GL.map(g=>{const st=simGroup(g);const th=st[2];
  groupThirdName[g][th.t]=(groupThirdName[g][th.t]||0)+1;
  return{g,t:th.t,Pts:th.Pts,GD:th.GD,GF:th.GF,elo:effE(th.t)};});
 thirds.sort((a,b)=>b.Pts-a.Pts||b.GD-a.GD||b.GF-a.GF||b.elo-a.elo);
 const qualGroups=thirds.slice(0,8).map(x=>x.g).sort().join('');
 setFreq[qualGroups]=(setFreq[qualGroups]||0)+1;
}
const topSet=Object.entries(setFreq).sort((a,b)=>b[1]-a[1])[0];
const groupQualPct={};GL.forEach(g=>groupQualPct[g]=0);
for(const[set,c] of Object.entries(setFreq))for(const g of set)groupQualPct[g]+=c;

console.log(`\nMOST LIKELY TOP-8 BEST-THIRDS  ·  asof ${data.asof}  ·  ${N.toLocaleString()} sims\n`);
console.log(`Most likely SET of qualifying groups: {${topSet[0].split('').join(', ')}}  (${(100*topSet[1]/N).toFixed(1)}% of sims — modal)\n`);
console.log('P(this group\'s 3rd-placed team qualifies)  +  most likely identity of that 3rd:');
GL.map(g=>({g,p:100*groupQualPct[g]/N})).sort((a,b)=>b.p-a.p).forEach(({g,p})=>{
 const ents=Object.entries(groupThirdName[g]).sort((a,b)=>b[1]-a[1]);
 const who=ents.slice(0,2).map(([t,c])=>`${nm(t)} ${(100*c/N).toFixed(0)}%`).join(', ');
 const inOut=p>=50?'✓ IN ':'  out';
 console.log(`  ${inOut} Group ${g}: ${p.toFixed(0).padStart(3)}%   3rd likely: ${who}`);
});
console.log(`\nSingle most-likely top-8 line-up (modal group set, modal 3rd in each):`);
topSet[0].split('').forEach(g=>{const best=Object.entries(groupThirdName[g]).sort((a,b)=>b[1]-a[1])[0];
 console.log(`  ${g}: ${nm(best[0])}`);});
console.log('');
