// Shared 2026 FIFA World Cup group standings + best-thirds ranking. Single source of
// truth mirrored by index.html so the app, bracket resolver, simulator and bet
// evaluator all agree.
//
// 2026 order for teams LEVEL ON POINTS (changed from every previous World Cup —
// head-to-head now comes BEFORE overall goal difference, UEFA-style):
//   1) head-to-head points        among the tied teams
//   2) head-to-head goal diff      "
//   3) head-to-head goals scored   "
//      (recursive: if head-to-head separates some teams, it is re-applied to any
//       group still tied; FIFA Regulations art. on ranking)
//   4) overall goal difference
//   5) overall goals scored
//   6) team conduct score (fair-play points from cards)
//   7) FIFA World Ranking (replaced the old "drawing of lots"; approximated here by
//      the Elo rating, which is our strength ranking)
const FXD=[[0,1],[2,3],[0,2],[1,3],[0,3],[1,2]];
const CARD={y:-1,'2y':-3,r:-4,yr:-5};
export const fairPlay=(ms,g,t)=>{let fp=0;for(let i=0;i<6;i++){const m=ms['g_'+g+'_'+i];if(!m||!m.cards)continue;for(const c of m.cards){if(c.team===t)fp+=CARD[c.type]||0;}}return fp;};

// head-to-head mini-table among `teams` only (matches between them)
function mini(teams,g,results,fx,gT){const set=new Set(teams),m={};teams.forEach(t=>m[t]={Pts:0,GF:0,GA:0});
 fx.forEach((pr,i)=>{const A=gT[pr[0]],B=gT[pr[1]];if(!set.has(A)||!set.has(B))return;const sc=results['g_'+g+'_'+i];if(!sc)return;const[h,a]=sc;
  m[A].GF+=h;m[A].GA+=a;m[B].GF+=a;m[B].GA+=h;if(h>a)m[A].Pts+=3;else if(h<a)m[B].Pts+=3;else{m[A].Pts++;m[B].Pts++;}});
 teams.forEach(t=>m[t].GD=m[t].GF-m[t].GA);return m;}

// final step (7): FIFA World Ranking — lower position is better; fall back to Elo (higher better) if a rank is missing
const rankCmp=(a,b,rank,elo)=>(rank&&rank[a]!=null&&rank[b]!=null)?(rank[a]-rank[b]):(elo[b]-elo[a]);

// order a set of teams already level on points (recursive head-to-head, then overall, conduct, ranking)
function breakTie(teams,ctx){if(teams.length<=1)return teams;
 const {g,results,fx,gT,overall,matchStats,elo,fifaRank}=ctx,hh=mini(teams,g,results,fx,gT);
 const sorted=[...teams].sort((a,b)=>hh[b].Pts-hh[a].Pts||hh[b].GD-hh[a].GD||hh[b].GF-hh[a].GF);
 const blocks=[];let cur=[sorted[0]];
 for(let i=1;i<sorted.length;i++){const p=sorted[i-1],q=sorted[i];
  (hh[q].Pts===hh[p].Pts&&hh[q].GD===hh[p].GD&&hh[q].GF===hh[p].GF)?cur.push(q):(blocks.push(cur),cur=[q]);}
 blocks.push(cur);
 if(blocks.length===1) // head-to-head couldn't split them → overall GD, overall goals, conduct, FIFA ranking
  return [...teams].sort((a,b)=>overall[b].GD-overall[a].GD||overall[b].GF-overall[a].GF||fairPlay(matchStats,g,b)-fairPlay(matchStats,g,a)||rankCmp(a,b,fifaRank,elo));
 return blocks.flatMap(blk=>blk.length>1?breakTie(blk,ctx):blk); // re-apply head-to-head within any still-tied block
}

// opts: { groups, results, matchStats={}, elo, fifaRank, fx=FXD }
export function fifaStandings(g,{groups,results,matchStats={},elo,fifaRank,fx=FXD}){
 const T=groups[g];const s=T.map((t,i)=>({t,P:0,W:0,Dr:0,L:0,GF:0,GA:0,Pts:0,seed:i}));
 fx.forEach((pr,i)=>{const sc=results['g_'+g+'_'+i];if(!sc)return;const[h,a]=sc;const A=s[pr[0]],B=s[pr[1]];
  A.P++;B.P++;A.GF+=h;A.GA+=a;B.GF+=a;B.GA+=h;if(h>a){A.W++;B.L++;A.Pts+=3;}else if(h<a){B.W++;A.L++;B.Pts+=3;}else{A.Dr++;B.Dr++;A.Pts++;B.Pts++;}});
 s.forEach(x=>x.GD=x.GF-x.GA);
 const overall={};s.forEach(x=>overall[x.t]={GD:x.GD,GF:x.GF});
 const byT=Object.fromEntries(s.map(x=>[x.t,x]));
 s.sort((a,b)=>b.Pts-a.Pts);
 const ctx={g,results,fx,gT:T,overall,matchStats,elo,fifaRank},out=[];
 for(let i=0;i<s.length;){let j=i+1;while(j<s.length&&s[j].Pts===s[i].Pts)j++;
  const names=s.slice(i,j).map(x=>x.t);
  (j-i>1?breakTie(names,ctx):names).forEach(t=>out.push(byT[t]));i=j;}
 return out;}

// best 3rd-placed across groups — no head-to-head (different groups): points, overall GD, goals, conduct, FIFA ranking
export function fifaBestThirds({groups,results,matchStats={},elo,fifaRank,fx=FXD}){
 const GL=Object.keys(groups);
 const arr=GL.map(g=>{const x=fifaStandings(g,{groups,results,matchStats,elo,fifaRank,fx})[2];return {g,t:x.t,Pts:x.Pts,GD:x.GD,GF:x.GF,fp:fairPlay(matchStats,g,x.t)};});
 arr.sort((a,b)=>b.Pts-a.Pts||b.GD-a.GD||b.GF-a.GF||b.fp-a.fp||rankCmp(a.t,b.t,fifaRank,elo));
 return arr;}
