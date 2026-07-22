// Mathematical clinch status per group: for each team, the BEST (min) and WORST
// (max) finishing position reachable across every remaining final-round scoreline,
// evaluated through the real 2026 FIFA tiebreaks. Shared by value_scan (rotation
// flag) and mirrored inline in index.html (green "confirmed" spots).
import {fifaStandings} from './standings.mjs';
const FX=[[0,1],[2,3],[0,2],[1,3],[0,3],[1,2]];

// ctx: { groups, results, matchStats, elo, fifaRank }
// returns { team: {min,max} } where 1=1st … 4=4th. min===max===1 ⇒ clinched 1st.
export function clinchPositions(g, ctx, MAXG=6){
 const {groups,results}=ctx, T=groups[g];
 const rem=[]; for(let i=0;i<6;i++) if(!results['g_'+g+'_'+i]) rem.push(i);
 const out={}; T.forEach(t=>out[t]={min:4,max:1});
 if(!rem.length){ fifaStandings(g,ctx).forEach((x,i)=>out[x.t]={min:i+1,max:i+1}); return out; }
 // brute force is exponential in remaining matches (MAXG^2 per match). With >3 left
 // nothing can be mathematically clinched yet anyway, so skip and report wide bounds.
 if(rem.length>3) return out;
 const grid=[]; for(let h=0;h<=MAXG;h++) for(let a=0;a<=MAXG;a++) grid.push([h,a]);
 const r={...results};
 const rec=idx=>{
  if(idx===rem.length){ const st=fifaStandings(g,{...ctx,results:r});
   st.forEach((x,i)=>{const o=out[x.t]; if(i+1<o.min)o.min=i+1; if(i+1>o.max)o.max=i+1;}); return; }
  for(const sc of grid){ r['g_'+g+'_'+rem[idx]]=sc; rec(idx+1); }
 };
 rec(0);
 return out;
}

// team guaranteed 1st (and thus advanced + group locked) — null if none
export function clinchedFirst(g,ctx){ const c=clinchPositions(g,ctx);
 for(const t in c) if(c[t].min===1&&c[t].max===1) return t; return null; }
