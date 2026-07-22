#!/usr/bin/env node
// Daily results updater for WC2026 Lab's data.json.
//
// GROUP STAGE:
//   node scripts/update_data.mjs --asof "14 Jun 2026" g_C_0=2-1 g_C_1=0-0 g_D_4=1-3
//
// Each "g_X_i=H-A" sets results[id] = [H, A] oriented [goals FX[i][0], goals
// FX[i][1]] — the two teams in the order shown by scripts/fixtures (FIXTURES.md).
// It validates the id exists in the schedule and rewrites data.json in the
// repo's compact format. It never touches the "sched" block.
//
// KNOCKOUT STAGE (R32 M73-M88, R16 M89-M96, QF M97-M100, SF M200/M201, Final M300):
//   node scripts/update_data.mjs 73=2-1 89=0-3
//
// A knockout id is the bare match NUMBER (no g_ prefix). The score is oriented
// [goals for side A, goals for side B], where A is the LEFT team and B the RIGHT
// team as printed by scripts/resolve_bracket.mjs ("M73 [R32] A  vs  B").
// resolve_bracket reads these to fill the R16 -> Final matchups.
//
// PENALTIES: when a knockout match ends LEVEL, the score alone can't say who went
// through, so resolve_bracket leaves it undecided. Record the shoot-out winner:
//   node scripts/update_data.mjs 73=1-1 --pens 73=A   # side A (left) won on pens
//   node scripts/update_data.mjs --clear-pens 73      # undo
// --pens takes A or B (the left/right side in resolve_bracket's output).
//
// To record the full shoot-out SEQUENCE (order, taker, scored/missed/saved) so the
// match sheet can show it kick-by-kick, use --pso instead of --pens. The winner is
// derived from the tally, so you don't also pass --pens:
//   node scripts/update_data.mjs 73=1-1 --pso "73=A:Virgil van Dijk:scored; B:Kaoru Mitoma:missed; A:Cody Gakpo:scored"
// Each kick is "<side>:<taker>:<result>" (side A|B, result scored|missed|saved),
// kicks separated by ";", in the order taken. --clear-pens also clears a --pso entry.
//
// Flags:
//   --asof "DD Mon YYYY"   update the as-of label (optional but recommended)
//   --clear <id>           remove a result (group id g_X_i or KO number)
//   --pens <id>=A|B        record the shoot-out winner of a level KO match
//   --pso "<id>=A:taker:scored; B:taker:missed; …"   record the full shoot-out sequence
//   --clear-pens <id>      remove a recorded shoot-out winner / sequence
//   --ht <id>=H-A          record the half-time score (HT / HT-FT markets)
//   --goal "<id>|min:12; team:Netherlands; scorer:Name; assist:Name; pen:1; og:1"
//                          append a goal event (scorer/assist/order → scorer markets)
//   --card "<id>|team:Germany; type:y; player:Name"   record a card (y/2y/r/yr)
//                          for the fair-play group tiebreaker
//   --stat "<id>|poss:55-45; sh:14-9; sot:6-3; cor:7-4; xg:1.8-0.9; foul:11-13; off:2-1"
//                          team box-score, oriented [A-side, B-side] like the result.
//                          Keys are free-form so routines can add metrics without code
//                          changes (poss/sh/sot/cor/off/foul/xg/sav/pass/pacc/da/…);
//                          each value is "A-B". Repeated --stat merges. Stored at
//                          matchStats[id].stats. Known keys get nice labels in the app.
//   --clear-stats <id>     remove recorded half-time score + goal events + cards + box-score
//   --dry                  print the resulting JSON without writing
import {readData,writeData,serialize,parseD} from './datafile.mjs';
import {statusBreakdown} from './teamstatus.mjs';
import {knockoutIds} from './tournament-engine.mjs';
import {WC2026} from './formats/wc2026.mjs';

const d=readData();
if(!d.pens)d.pens={};

// valid knockout match ids — derived from the WC2026 FORMAT descriptor, the single
// source of truth for tournament shape. validateFormat() (in selftest) proves the
// descriptor matches the live D, so this can't drift. A round in the descriptor is
// a round ingest includes by construction; that is what makes the M301-style silent
// omission impossible. See docs/adr/0001-generalising-to-a-tournament-engine.md.
const D=parseD();
const FX=[[0,1],[2,3],[0,2],[1,3],[0,3],[1,2]];
const KO=new Set(knockoutIds(WC2026).map(String));

const args=process.argv.slice(2);
const clears=[],clearPens=[],sets=[],pens=[],psos=[],h2hs=[],hts=[],goals=[],cards=[],stats=[],clearStats=[];let asof=null;
for(let i=0;i<args.length;i++){const a=args[i];
 if(a==='--asof'){asof=args[++i];continue;}
 if(a==='--clear'){clears.push(args[++i]);continue;}
 if(a==='--clear-pens'){clearPens.push(args[++i]);continue;}
 if(a==='--clear-stats'){clearStats.push(args[++i]);continue;}
 if(a==='--pens'){const p=args[++i];const m=p&&p.match(/^(\d+)=([AB])$/);
  if(!m){console.error('bad --pens (expected <koId>=A|B):',p);process.exit(1);}pens.push([m[1],m[2]]);continue;}
 if(a==='--pso'){const p=args[++i]||'';const eq=p.indexOf('=');
  if(eq<1){console.error('bad --pso (expected "<koId>=A:taker:scored; B:taker:missed; …"):',p);process.exit(1);}
  const id=p.slice(0,eq).trim();
  const kicks=p.slice(eq+1).split(';').map(s=>s.trim()).filter(Boolean).map(tok=>{
   const parts=tok.split(':');
   if(parts.length<3){console.error('bad --pso kick (expected <side>:<taker>:<result>):',tok);process.exit(1);}
   const team=parts[0].trim().toUpperCase(),r=parts[parts.length-1].trim().toLowerCase(),taker=parts.slice(1,-1).join(':').trim();
   if(team!=='A'&&team!=='B'){console.error('bad --pso side (expected A|B):',tok);process.exit(1);}
   if(!['scored','missed','saved'].includes(r)){console.error('bad --pso result (expected scored|missed|saved):',tok);process.exit(1);}
   if(!taker){console.error('bad --pso kick — empty taker:',tok);process.exit(1);}
   return {team,taker,r};});
  if(!kicks.length){console.error('bad --pso — no kicks:',p);process.exit(1);}
  psos.push([id,kicks]);continue;}
 if(a==='--h2h'){const p=args[++i]||'';const eq=p.indexOf('=');if(eq<1){console.error('bad --h2h (expected <id>=text, or <id>= to clear):',p);process.exit(1);}h2hs.push([p.slice(0,eq).trim(),p.slice(eq+1).trim()]);continue;}
 // --ht <id>=H-A  records the half-time score (for first-half / HT-FT markets)
 if(a==='--ht'){const p=args[++i]||'';const m=p.match(/^(g_[A-L]_[0-5]|\d+)=(\d+)-(\d+)$/);
  if(!m){console.error('bad --ht (expected <id>=H-A):',p);process.exit(1);}hts.push([m[1],[+m[2],+m[3]]]);continue;}
 // --goal "<id>|min:12; team:Netherlands; scorer:Name; assist:Name; pen:1; og:1" appends one goal event
 if(a==='--goal'){const p=args[++i]||'';const bar=p.indexOf('|');if(bar<1){console.error('bad --goal (expected "<id>|min:..;team:..;scorer:..;.."):',p);process.exit(1);}
  const id=p.slice(0,bar).trim();const ev={};p.slice(bar+1).split(';').forEach(kv=>{const c=kv.indexOf(':');if(c<1)return;const k=kv.slice(0,c).trim(),v=kv.slice(c+1).trim();
   if(k==='min')ev.min=parseInt(v,10);else if(k==='pen'||k==='og')ev[k]=(v==='1'||v.toLowerCase()==='true');else if(k&&v)ev[k]=v;});
  if(!ev.scorer&&!ev.og){console.error('bad --goal (needs scorer: or og:1):',p);process.exit(1);}goals.push([id,ev]);continue;}
 // --card "<id>|team:Germany; type:y; player:Name" records a card (type y=yellow, 2y=2nd yellow, r=red, yr=yellow+red) for fair-play points
 if(a==='--card'){const p=args[++i]||'';const bar=p.indexOf('|');if(bar<1){console.error('bad --card (expected "<id>|team:..;type:y|2y|r|yr;player:.."):',p);process.exit(1);}
  const id=p.slice(0,bar).trim();const ev={};p.slice(bar+1).split(';').forEach(kv=>{const c=kv.indexOf(':');if(c<1)return;const k=kv.slice(0,c).trim(),v=kv.slice(c+1).trim();if(k&&v)ev[k]=v;});
  if(!ev.team||!['y','2y','r','yr'].includes(ev.type)){console.error('bad --card (needs team: and type: one of y|2y|r|yr):',p);process.exit(1);}cards.push([id,ev]);continue;}
 // --stat "<id>|poss:55-45; sh:14-9; .." records the team box-score (oriented [A,B] like the result)
 if(a==='--stat'){const p=args[++i]||'';const bar=p.indexOf('|');if(bar<1){console.error('bad --stat (expected "<id>|poss:55-45; sh:14-9; .."):',p);process.exit(1);}
  const id=p.slice(0,bar).trim();const st={};p.slice(bar+1).split(';').forEach(kv=>{const c=kv.indexOf(':');if(c<1)return;const k=kv.slice(0,c).trim().toLowerCase(),v=kv.slice(c+1).trim();if(!k)return;
   const mm=v.match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/);if(!mm){console.error('bad --stat value for '+k+' (expected A-B numbers):',v);process.exit(1);}st[k]=[+mm[1],+mm[2]];});
  if(!Object.keys(st).length){console.error('bad --stat (no key:A-B pairs):',p);process.exit(1);}stats.push([id,st]);continue;}
 if(a==='--dry'){continue;}
 let m=a.match(/^(g_[A-L]_[0-5])=(\d+)-(\d+)$/);
 if(m){sets.push([m[1],[+m[2],+m[3]]]);continue;}
 m=a.match(/^(\d+)=(\d+)-(\d+)$/);
 if(m){sets.push([m[1],[+m[2],+m[3]]]);continue;}
 console.error('bad arg (expected g_X_i=H-A, <koId>=H-A, or a flag):',a);process.exit(1);}
const dry=args.includes('--dry');

const known=id=>id in d.sched||KO.has(id);
for(const id of clears){if(!known(id)){console.error('unknown id:',id);process.exit(1);}delete d.results[id];console.log('cleared',id);}
for(const id of clearPens){delete d.pens[id];console.log('cleared pens',id);}
for(const [id,sc] of sets){
 if(!known(id)){console.error('unknown match id (not a fixture or KO match):',id);process.exit(1);}
 d.results[id]=sc;console.log('set',id,'=',sc.join('-'));}
// snapshot each played GROUP match's AS-OF-KICKOFF team status (injuries/form) the first
// time its result is recorded — captured before step 7 updates form, so it's leakage-free
// and lets scripts/backtest.mjs validate the status-delta weights on clean data later.
for(const [id] of sets){const m=id.match(/^g_([A-L])_([0-5])$/);if(!m)continue;
 const teams=[D.groups[m[1]][FX[+m[2]][0]],D.groups[m[1]][FX[+m[2]][1]]];
 d.matchStats=d.matchStats||{};const ms=d.matchStats[id]=d.matchStats[id]||{};
 if(!ms.status){ms.status={};for(const t of teams){const bd=statusBreakdown((d.profiles||{})[t]);ms.status[t]={d:bd.delta,why:bd.parts.map(p=>p.label).join('; ')};}
  console.log('status-snap',id,teams.map(t=>t+' '+ms.status[t].d).join(' / '));}}
for(const [id,side] of pens){
 if(!KO.has(id)){console.error('pens id is not a knockout match:',id);process.exit(1);}
 d.pens[id]=side;console.log('set pens',id,'=',side);}
for(const [id,kicks] of psos){
 if(!KO.has(id)){console.error('pso id is not a knockout match:',id);process.exit(1);}
 let ca=0,cb=0;for(const k of kicks)if(k.r==='scored'){if(k.team==='A')ca++;else cb++;}
 if(ca===cb){console.error('pso has no winner (equal scored kicks) for',id,`— ${ca}-${cb}`);process.exit(1);}
 const w=ca>cb?'A':'B';d.pens[id]={w,kicks};
 console.log('set pso',id,'=',w,`(${ca}-${cb}, ${kicks.length} kicks)`);}
for(const [id,txt] of h2hs){
 if(!known(id)){console.error('unknown h2h match id:',id);process.exit(1);}
 d.h2h=d.h2h||{};if(txt)d.h2h[id]=txt;else delete d.h2h[id];console.log('h2h',id,txt?'set':'cleared');}
// post-match stats (half-time score + goal events + cards) for scorer/HT markets + fair-play tiebreaker
if(clearStats.length||hts.length||goals.length||cards.length||stats.length)d.matchStats=d.matchStats||{};
for(const id of clearStats){if(d.matchStats)delete d.matchStats[id];console.log('cleared stats',id);}
for(const [id,sc] of hts){
 if(!known(id)){console.error('unknown --ht match id:',id);process.exit(1);}
 (d.matchStats[id]=d.matchStats[id]||{}).ht=sc;console.log('ht',id,'=',sc.join('-'));}
for(const [id,ev] of goals){
 if(!known(id)){console.error('unknown --goal match id:',id);process.exit(1);}
 const ms=d.matchStats[id]=d.matchStats[id]||{};ms.goals=ms.goals||[];ms.goals.push(ev);
 ms.goals.sort((a,b)=>(a.min||0)-(b.min||0));console.log('goal',id,'·',(ev.min!=null?ev.min+"' ":''),ev.og?'(OG) ':'',ev.scorer||'');}
for(const [id,ev] of cards){
 if(!known(id)){console.error('unknown --card match id:',id);process.exit(1);}
 const ms=d.matchStats[id]=d.matchStats[id]||{};ms.cards=ms.cards||[];ms.cards.push(ev);console.log('card',id,'·',ev.team,ev.type,ev.player||'');}
for(const [id,st] of stats){
 if(!known(id)){console.error('unknown --stat match id:',id);process.exit(1);}
 const ms=d.matchStats[id]=d.matchStats[id]||{};ms.stats={...(ms.stats||{}),...st};console.log('stats',id,'·',Object.entries(st).map(([k,v])=>k+' '+v.join('-')).join(', '));}
if(asof)d.asof=asof;

// sanity: every result key is a known fixture or KO match; scores are sane ints
for(const [id,sc] of Object.entries(d.results)){
 if(!known(id)){console.error('orphan result (no such fixture/KO match):',id);process.exit(1);}
 if(!Array.isArray(sc)||sc.length!==2||!sc.every(n=>Number.isInteger(n)&&n>=0&&n<=99)){console.error('bad score for',id,sc);process.exit(1);}}
for(const [id,v] of Object.entries(d.pens)){
 if(!KO.has(id)){console.error('orphan pens (no such KO match):',id);process.exit(1);}
 const w=typeof v==='string'?v:(v&&v.w);
 if(w!=='A'&&w!=='B'){console.error('bad pens winner for',id,v);process.exit(1);}
 if(v&&typeof v==='object'){
  if(!Array.isArray(v.kicks)){console.error('bad pens kicks (not an array) for',id);process.exit(1);}
  for(const k of v.kicks)if((k.team!=='A'&&k.team!=='B')||!['scored','missed','saved'].includes(k.r)||!k.taker){
   console.error('bad pens kick for',id,k);process.exit(1);}}}

// write back via the shared serialiser — preserves the profiles/markets blocks
const out=serialize(d);
if(dry){process.stdout.write(out);}else{writeData(d);console.log(`\nwrote data.json — asof "${d.asof}", ${Object.keys(d.results).length} results, ${Object.keys(d.pens).length} pens`);}
