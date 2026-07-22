#!/usr/bin/env node
// Regression checks for the whole pipeline. Run: node scripts/selftest.mjs
// Exits non-zero if any check fails. Mutating-script tests back up data.json and
// restore it (try/finally), so a passing run leaves the working tree unchanged.
import {execFileSync} from 'child_process';
import {readFileSync,writeFileSync,copyFileSync,unlinkSync,existsSync} from 'fs';
import {join} from 'path';
import {parseD,readData,serialize,ROOT,FILE} from './datafile.mjs';
import {fifaStandings,fifaBestThirds} from './standings.mjs';
import {clinchPositions,clinchedFirst} from './clinch.mjs';
import {statusDelta} from './teamstatus.mjs';
import {classifyBet,parseSGP} from './ocr_parse.mjs';
import {overdueFixtures,schedToUTC,fmtSGT,parseOFtime,makeCanon} from './fdmap.mjs';
import {resolveBracket,findKo,mapKnockoutMatch,thirdAssignment} from './bracket.mjs';
import {validateFormat,roundNameFor,knockoutIds} from './tournament-engine.mjs';
import {WC2026} from './formats/wc2026.mjs';
import {parseESPNScoreboard,normRound,espnDates,parseESPNLineups,parseESPNSubs,parseESPNCards,posGroup} from './espn.mjs';
import {applyLineup,normName,sameName,applyGoals,computeForm,computeMinutes} from './lineups.mjs';

let fail=0;const ok=(n,c)=>{console.log((c?'PASS':'FAIL')+'  '+n);if(!c)fail++;};
const run=a=>execFileSync('node',a,{encoding:'utf8'});
const runOk=a=>{try{execFileSync('node',a,{encoding:'utf8',stdio:'pipe'});return true;}catch{return false;}};
const here=new URL('.',import.meta.url).pathname;

// ---- D parsing + data round-trip ----
try{const D=parseD();ok('parseD: 48 teams in 12 groups',Object.keys(D.groups).length===12&&[].concat(...Object.values(D.groups)).length===48);
 ok('parseD: R32 ids 73-88',JSON.stringify(D.R32.map(e=>e.m))==='[73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88]');}catch(e){ok('parseD throws: '+e.message,false);}

try{const d=readData();ok('data.json round-trips through serialize',JSON.stringify(JSON.parse(serialize(d)))===JSON.stringify(d));}catch(e){ok('serialize: '+e.message,false);}

// ---- 2026 FIFA group tiebreakers (shared standings.mjs) ----
try{const groups={A:['A','B','C','D']},elo={A:1500,B:1500,C:1500,D:1500};
 // A & B level on points; A won the head-to-head 1-0 but B has a much better OVERALL goal difference.
 // 2026 rule: head-to-head outranks overall GD, so A must finish above B.
 const res={g_A_0:[1,0],g_A_1:[0,0],g_A_2:[0,3],g_A_3:[5,0],g_A_4:[1,1],g_A_5:[1,1]};
 const o=fifaStandings('A',{groups,results:res,elo}).map(x=>x.t);
 ok('2026 tiebreaker: head-to-head outranks overall goal difference (A over B)',o.indexOf('A')<o.indexOf('B'));
 // when head-to-head is level (a draw), overall GD then decides
 const groups2={A:['A','B','C','D']};
 const res2={g_A_0:[1,1],g_A_1:[0,0],g_A_2:[3,0],g_A_3:[0,0],g_A_4:[0,0],g_A_5:[0,0]}; // A&B draw h2h; A bigger overall GD
 const o2=fifaStandings('A',{groups:groups2,results:res2,elo}).map(x=>x.t);
 ok('2026 tiebreaker: level head-to-head falls to overall goal difference',o2.indexOf('A')<o2.indexOf('B'));
 // final step is FIFA ranking; falls back to Elo when no rank is supplied
 const o3=fifaStandings('A',{groups:groups2,results:{g_A_0:[1,1]},elo:{A:1400,B:1700,C:1500,D:1500}}).map(x=>x.t);
 ok('2026 tiebreaker: Elo is the fallback when no FIFA rank',o3.indexOf('B')<o3.indexOf('A'));
 // real FIFA ranking overrides Elo (A ranked #1 beats higher-Elo B ranked #5)
 const o4=fifaStandings('A',{groups:groups2,results:{g_A_0:[1,1]},elo:{A:1400,B:1700,C:1500,D:1500},fifaRank:{A:1,B:5,C:9,D:9}}).map(x=>x.t);
 ok('2026 tiebreaker: FIFA World Ranking overrides Elo at the final step',o4.indexOf('A')<o4.indexOf('B'));
}catch(e){ok('2026 tiebreaker: '+e.message,false);}

// ---- mathematical clinch (scripts/clinch.mjs — powers app green markers + rotation flag) ----
try{const groups={A:['A','B','C','D']},elo={A:1500,B:1500,C:1500,D:1500};
 // A won all three (9 pts); no remaining game (all among B/C/D) can reach 9 → A locked into 1st.
 const res={g_A_0:[1,0],g_A_2:[1,0],g_A_4:[1,0]}; // A beat B, C and D; g_A_1/3/5 (among B/C/D) still open
 const c=clinchPositions('A',{groups,results:res,elo});
 ok('clinch: a team that won all 3 is locked into 1st (min===max===1)',c.A.min===1&&c.A.max===1);
 ok('clinch: clinchedFirst returns that team',clinchedFirst('A',{groups,results:res,elo})==='A');
 // a wide-open group clinches nobody
 const c2=clinchPositions('A',{groups,results:{g_A_0:[1,1]},elo});
 ok('clinch: open group locks no one into 1st',clinchedFirst('A',{groups,results:{g_A_0:[1,1]},elo})===null);
 ok('clinch: a completed group reports exact final positions',(()=>{const r={g_A_0:[3,0],g_A_1:[0,1],g_A_2:[2,0],g_A_3:[0,1],g_A_4:[1,0],g_A_5:[0,2]};const cc=clinchPositions('A',{groups,results:r,elo});return Object.values(cc).every(o=>o.min===o.max);})());
 // matches the live data: Mexico has clinched Group A; an unfinished open group has not
 const D=parseD(),dd=readData(),ctx={groups:D.groups,results:dd.results||{},matchStats:dd.matchStats||{},elo:D.elo,fifaRank:dd.fifaRank||{}};
 ok('clinch: live data — Mexico has clinched Group A 1st',clinchedFirst('A',ctx)==='Mexico');
 ok('clinch: live data — Spain has clinched Group H 1st',clinchedFirst('H',ctx)==='Spain');
}catch(e){ok('clinch: '+e.message,false);}

// serialize must preserve every optional block it manages (compare blocks, not key order)
try{const d=readData();const d2={...d,h2h:{g_A_0:'won 2 of last 3'},betsEnc:{v:1,salt:'a',iv:'b',ct:'c'},bets:[{type:'score',sel:'x'}],thirds:{74:'D',77:'F'},matchStats:{g_A_0:{ht:[1,0],goals:[{min:10,team:'x',scorer:'y'}]}}};const r=JSON.parse(serialize(d2));
 ok('serialize round-trips h2h + betsEnc + bets + matchStats + thirds',JSON.stringify(r.h2h)===JSON.stringify(d2.h2h)&&JSON.stringify(r.betsEnc)===JSON.stringify(d2.betsEnc)&&JSON.stringify(r.bets)===JSON.stringify(d2.bets)&&JSON.stringify(r.matchStats)===JSON.stringify(d2.matchStats)&&JSON.stringify(r.thirds)===JSON.stringify(d2.thirds));}catch(e){ok('serialize blocks: '+e.message,false);}

// ---- app (index.html) script parses ----
try{const html=readFileSync(join(ROOT,'index.html'),'utf8');const s=html.indexOf('<script>')+8,e=html.lastIndexOf('</script>');
 const tmp=join(ROOT,'.selftest.app.mjs');writeFileSync(tmp,html.slice(s,e));const good=runOk(['--check',tmp]);unlinkSync(tmp);
 ok('index.html app script parses',good);}catch(e){ok('app syntax: '+e.message,false);}

// backfill + dedupe scripts must stay syntactically valid (they run in the results cron)
ok('backfill_lineups.mjs parses',runOk(['--check',here+'backfill_lineups.mjs']));
ok('dedupe_squads.mjs parses',runOk(['--check',here+'dedupe_squads.mjs']));

// ---- resolver + simulator ----
try{const M=JSON.parse(run([here+'resolve_bracket.mjs','--json']));ok('resolver emits 32 knockout matches (incl. 3rd-place playoff M301)',Object.keys(M).length===32);}catch(e){ok('resolver: '+e.message,false);}

// ---- tournament-format descriptor (generalisation proof) ----
// The WC2026 FORMAT descriptor must faithfully describe the live D object; if the
// two ever drift, a future engine driven by the descriptor would be wrong.
try{const errs=validateFormat(WC2026,parseD());ok('validateFormat: WC2026 descriptor matches the live tournament'+(errs.length?' — '+errs[0]:''),errs.length===0);}catch(e){ok('validateFormat: '+e.message,false);}
ok('format: knockoutIds covers all 32 knockout matches',knockoutIds(WC2026).length===32);
ok('format: roundNameFor derives round labels from the descriptor',roundNameFor(WC2026,73)==='Round of 32'&&roundNameFor(WC2026,301)==='Third-place playoff'&&roundNameFor(WC2026,300)==='Final'&&roundNameFor(WC2026,200,true)==='SF');
// index.html carries a browser-side mirror of the knockout rounds (const KROUNDS,
// since it can't import the Node descriptor). Assert the mirror matches WC2026 so a
// hand edit to one can't silently diverge from the other.
try{
 const html=readFileSync(join(ROOT,'index.html'),'utf8');
 const blk=html.match(/const\s+KROUNDS\s*=\s*(\[[\s\S]*?\]);/);
 const rows=blk?[...blk[1].matchAll(/\{\s*lo:\s*(\d+)\s*,\s*hi:\s*(\d+)\s*,\s*name:\s*'([^']*)'\s*,\s*short:\s*'([^']*)'\s*\}/g)].map(x=>({lo:+x[1],hi:+x[2],name:x[3],short:x[4]})):[];
 const want=WC2026.knockout.rounds.map(r=>({lo:r.ids[0],hi:r.ids[1],name:r.name,short:r.short}));
 const byLo=Object.fromEntries(rows.map(r=>[r.lo,r]));
 const match=blk&&rows.length===want.length&&want.every(w=>{const g=byLo[w.lo];return g&&g.hi===w.hi&&g.name===w.name&&g.short===w.short;});
 ok('format: index.html KROUNDS mirror matches the WC2026 descriptor',match);
}catch(e){ok('format: KROUNDS mirror check — '+e.message,false);}
try{const s=JSON.parse(run([here+'simulate.mjs','--json','--n','1500']));
 ok('simulate: champion probs sum ~1',Math.abs(Object.values(s.winner).reduce((a,b)=>a+b,0)-1)<0.02);
 ok('simulate: total-goals mean in 230-320',s.totalGoals.mean>230&&s.totalGoals.mean<320);}catch(e){ok('simulate: '+e.message,false);}

// ---- update_data (dry; no writes) — strip the leading log lines before the JSON ----
const dryJSON=out=>JSON.parse(out.slice(out.indexOf('{')));
try{const j=dryJSON(run([here+'update_data.mjs','--dry','g_A_0=2-1']));ok('update_data --dry sets a result',j.results.g_A_0&&j.results.g_A_0[0]===2);}catch(e){ok('update_data dry: '+e.message,false);}
try{const j=dryJSON(run([here+'update_data.mjs','--dry','--h2h','g_A_0=foo']));ok('update_data --h2h applies',j.h2h&&j.h2h.g_A_0==='foo');}catch(e){ok('update_data h2h: '+e.message,false);}
try{const j=dryJSON(run([here+'update_data.mjs','--dry','--stat','g_A_0|poss:55-45; sot:6-3; xg:1.8-0.9']));const s=j.matchStats&&j.matchStats.g_A_0&&j.matchStats.g_A_0.stats;ok('update_data --stat records team box-score',!!s&&s.poss[0]===55&&s.sot[1]===3&&s.xg[0]===1.8);}catch(e){ok('update_data stat: '+e.message,false);}
ok('update_data --stat rejects a non-numeric value',!runOk([here+'update_data.mjs','--dry','--stat','g_A_0|poss:lots-few']));
try{const j=dryJSON(run([here+'update_data.mjs','--dry','g_A_0=1-0']));const st=j.matchStats&&j.matchStats.g_A_0&&j.matchStats.g_A_0.status;
 ok('update_data snapshots as-of-kickoff team status when a group result is set',!!st&&Object.keys(st).length===2&&typeof Object.values(st)[0].d==='number');}catch(e){ok('update_data status-snap: '+e.message,false);}
ok('update_data rejects an unknown match id',!runOk([here+'update_data.mjs','--dry','g_ZZ_9=1-0']));

// ---- update_profiles mutators (backup/restore) ----
const BAK=FILE+'.selftest.bak';
try{copyFileSync(FILE,BAK);
 run([here+'update_profiles.mjs','Australia','--xi','g_D_4|Mathew Ryan; Connor Metcalfe','--subs','g_D_4|Awer Mabil','--clubmins','Connor Metcalfe:1800/2880','--outs','Harry Souttar:knock']);
 const p=readData().profiles.Australia,f=n=>p.squad.find(x=>x.name===n);
 ok('update_profiles --xi tallies a start + sets natXI',(f('Mathew Ryan').xiM||[]).includes('g_D_4')&&f('Mathew Ryan').natXI===true);
 ok('update_profiles --subs tallies a sub',(f('Awer Mabil').subM||[]).includes('g_D_4'));
 ok('starts/subs are mutually exclusive',!(f('Awer Mabil').xiM||[]).includes('g_D_4'));
 ok('update_profiles --clubmins sets minutes',f('Connor Metcalfe').clubMin===1800&&f('Connor Metcalfe').clubAvail===2880);
 ok('update_profiles --outs records an absence',(p.outs||[]).some(o=>o.name==='Harry Souttar'));
 // idempotency: re-run --xi for same match keeps the count at 1
 run([here+'update_profiles.mjs','Australia','--xi','g_D_4|Mathew Ryan']);
 ok('update_profiles --xi is idempotent per match',readData().profiles.Australia.squad.find(x=>x.name==='Mathew Ryan').xiM.length===1);
 ok('update_profiles rejects an unknown country',!runOk([here+'update_profiles.mjs','Atlantis','--style','x']));
 ok('update_profiles --log rejects an unknown player (no phantom squad entry)',!runOk([here+'update_profiles.mjs','Australia','--log','Nobody McGhost | vs X | min:90; g:1']));
}catch(e){ok('update_profiles: '+e.message,false);}finally{if(existsSync(BAK)){copyFileSync(BAK,FILE);unlinkSync(BAK);}}

// ---- bet-slip crypto scheme (encrypt_bets ⇄ app decBets): PBKDF2 100k → AES-GCM ----
try{const enc=new TextEncoder(),dec=new TextDecoder(),pass='correct horse';
 const b64=u=>Buffer.from(u).toString('base64'),ub=s=>new Uint8Array(Buffer.from(s,'base64'));
 const dk=async(p,salt,use)=>crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:100000,hash:'SHA-256'},await crypto.subtle.importKey('raw',enc.encode(p),'PBKDF2',false,['deriveKey']),{name:'AES-GCM',length:256},false,[use]);
 const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
 const payload={bets:[{type:'score'}],reads:{Brazil:'-2'},teams:['Spain']};
 const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv},await dk(pass,salt,'encrypt'),enc.encode(JSON.stringify(payload)));
 const blob={salt:b64(salt),iv:b64(iv),ct:b64(new Uint8Array(ct))}; // exactly what the app stores
 const back=JSON.parse(dec.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:ub(blob.iv)},await dk(pass,ub(blob.salt),'decrypt'),ub(blob.ct))));
 ok('bet-slip crypto round-trips {bets,reads,teams}',JSON.stringify(back)===JSON.stringify(payload));
 let rejected=false;try{await crypto.subtle.decrypt({name:'AES-GCM',iv:ub(blob.iv)},await dk('wrong',ub(blob.salt),'decrypt'),ub(blob.ct));}catch{rejected=true;}
 ok('bet-slip crypto rejects a wrong passphrase',rejected);}catch(e){ok('crypto: '+e.message,false);}

// ---- encrypt_bets end-to-end (backup/restore) ----
try{copyFileSync(FILE,BAK);const d=readData();d.bets=[{type:'score',sel:'a',odds:2,stake:1}];delete d.betsEnc;writeFileSync(FILE,serialize(d));
 execFileSync('node',[here+'encrypt_bets.mjs','--pass','testpass'],{encoding:'utf8',stdio:'pipe'});
 const after=readData();ok('encrypt_bets writes betsEnc and removes plaintext',!!after.betsEnc&&!after.bets);
}catch(e){ok('encrypt_bets: '+e.message,false);}finally{if(existsSync(BAK)){copyFileSync(BAK,FILE);unlinkSync(BAK);}}

// ---- post-match stats capture (--ht/--goal) + scorer/HT settlement + validatability ----
try{copyFileSync(FILE,BAK);const slip=join(ROOT,'.selftest.slip.json');
 const scorerSlip=[{type:'firstScorer',player:'Virgil van Dijk',sel:'Netherlands',sel2:'Japan',odds:15}];
 // (1) finished match, NO stats recorded yet → scorer bet must flag as needs-data
 // (clear any real stats first so the check is deterministic regardless of live data)
 run([here+'update_data.mjs','g_F_0=2-2','--clear-stats','g_F_0']);
 writeFileSync(slip,JSON.stringify({bets:scorerSlip}));
 let ev=JSON.parse(run([here+'evaluate_bets.mjs','--bets',slip,'--json']));
 ok('scorer bet on finished match w/o goals → needs-data',ev.bets[0].validation==='needs-data');
 // (2) record HT score + ordered goal events
 run([here+'update_data.mjs','--ht','g_F_0=1-0','--goal','g_F_0|min:10; team:Netherlands; scorer:Virgil van Dijk','--goal','g_F_0|min:80; team:Japan; scorer:Kaoru Mitoma']);
 const ms=readData().matchStats.g_F_0;
 ok('update_data --ht records half-time score',JSON.stringify(ms.ht)==='[1,0]');
 ok('update_data --goal appends ordered goal events',ms.goals.length===2&&ms.goals[0].scorer==='Virgil van Dijk');
 // (3) settlement of the new structured markets
 writeFileSync(slip,JSON.stringify({bets:[
  {type:'htScore',sel:'Netherlands',sel2:'Japan',out:'1-0',odds:8},
  {type:'htft',sel:'Netherlands',sel2:'Japan',htOut:'1',ftOut:'X',odds:9},
  {type:'firstScorer',player:'Virgil van Dijk',sel:'Netherlands',sel2:'Japan',odds:15},
  {type:'firstScorer',player:'Someone Else',sel:'Netherlands',sel2:'Japan',odds:15},
  {type:'anytimeScorer',player:'Kaoru Mitoma',sel:'Netherlands',sel2:'Japan',odds:3},
  {type:'teamFirstGoal',sel:'Netherlands',sel2:'Japan',odds:4},
  {type:'teamFirstGoal',sel:'Japan',sel2:'Netherlands',odds:4},
  {type:'firstScorer',player:'V. Dijk',sel:'Netherlands',sel2:'Japan',odds:15},
  {type:'firstScorer',player:'X. Dijk',sel:'Netherlands',sel2:'Japan',odds:15}]}));
 ev=JSON.parse(run([here+'evaluate_bets.mjs','--bets',slip,'--json']));const S=ev.bets.map(x=>x.status);
 ok('htScore settles from half-time score',S[0]==='won');
 ok('htft settles from HT + FT result',S[1]==='won');
 ok('firstScorer won for the scorer / lost for a non-scorer',S[2]==='won'&&S[3]==='lost');
 ok('firstScorer initial+surname "V. Dijk" settles won vs "Virgil van Dijk" / wrong initial lost',S[7]==='won'&&S[8]==='lost');
 ok('anytimeScorer settles won',S[4]==='won');
 ok('teamFirstGoal won for first-scoring team / lost for the other',S[5]==='won'&&S[6]==='lost');
 ok('coverage reports auto-settled scorer/HT markets',ev.coverage.auto>=4&&ev.coverage['needs-data']===0);
 // (3b) scorer bets must settle on a robust name match, not exact string equality — a correct
 // pick shouldn't grade as a loss just because the slip spells it without accents, with a suffix,
 // or by surname only (the "picked Mexico, mismatched on name" bug). Record an accented scorer,
 // then settle picks spelled differently.
 run([here+'update_data.mjs','g_A_0=1-0','--clear-stats','g_A_0']);
 run([here+'update_data.mjs','--goal','g_A_0|min:23; team:Mexico; scorer:Raúl Jiménez']);
 writeFileSync(slip,JSON.stringify({bets:[
  {type:'firstScorer',player:'Raul Jimenez',sel:'Mexico',sel2:'Czechia',odds:15},   // accents stripped
  {type:'anytimeScorer',player:'Jiménez',sel:'Mexico',sel2:'Czechia',odds:3},        // surname only
  {type:'firstScorer',player:'Hirving Lozano',sel:'Mexico',sel2:'Czechia',odds:15},  // genuine miss
  {type:'firstScorer',player:'R. Jiménez',sel:'Mexico',sel2:'Czechia',odds:15},      // initial + surname ("V. Dijk" format)
  {type:'firstScorer',player:'S. Jiménez',sel:'Mexico',sel2:'Czechia',odds:15}]}));  // wrong initial → must NOT match
 const SN=JSON.parse(run([here+'evaluate_bets.mjs','--bets',slip,'--json'])).bets.map(x=>x.status);
 ok('scorer bet tolerates missing accents (Raul Jimenez = Raúl Jiménez)',SN[0]==='won');
 ok('scorer bet tolerates surname-only pick (Jiménez)',SN[1]==='won');
 ok('scorer bet still loses for a genuinely different player',SN[2]==='lost');
 ok('scorer bet tolerates initial + surname (R. Jiménez = Raúl Jiménez)',SN[3]==='won');
 ok('scorer bet initial must match: wrong initial (S. Jiménez) still loses',SN[4]==='lost');
 // (3c) Korean romanisation: the feed hyphenates ("Hwang In-Beom") where the slip joins the
 // syllables ("Hwang Inbeom"); a joined-signature match settles these correctly.
 run([here+'update_data.mjs','g_A_1=1-0','--clear-stats','g_A_1']);
 run([here+'update_data.mjs','--goal','g_A_1|min:31; team:Korea Republic; scorer:Hwang In-Beom']);
 writeFileSync(slip,JSON.stringify({bets:[
  {type:'firstScorer',player:'Hwang Inbeom',sel:'Korea Republic',sel2:'South Africa',odds:19}]}));
 ok('scorer bet tolerates Korean romanisation (Hwang Inbeom = Hwang In-Beom)',
   JSON.parse(run([here+'evaluate_bets.mjs','--bets',slip,'--json'])).bets[0].status==='won');
 // teamFirstGoal on a goalless finished match → lost (no team scored a first goal)
 run([here+'update_data.mjs','g_F_0=0-0','--clear-stats','g_F_0']);
 writeFileSync(slip,JSON.stringify({bets:[{type:'teamFirstGoal',sel:'Netherlands',sel2:'Japan',odds:4}]}));
 ev=JSON.parse(run([here+'evaluate_bets.mjs','--bets',slip,'--json']));
 ok('teamFirstGoal on a 0-0 match settles lost',ev.bets[0].status==='lost');
 unlinkSync(slip);
}catch(e){ok('post-match stats + scorer settlement: '+e.message,false);}finally{if(existsSync(BAK)){copyFileSync(BAK,FILE);unlinkSync(BAK);}}

// ---- current-status -> Elo delta (teamstatus.mjs) ----
try{
 ok('statusDelta: empty/none -> 0',statusDelta(null)===0&&statusDelta({})===0);
 ok('statusDelta: absences + poor form -> strongly negative',statusDelta({form:'LLLLL',outs:[{name:'A B'},{name:'C D'}]})<=-100);
 const onlyForm=statusDelta({form:'WWWWW'});
 ok('statusDelta: form component is clamped',onlyForm>0&&onlyForm<=35);
 ok('statusDelta: a key player out is penalised more than a fringe one',
   statusDelta({players:[{name:'Star Player'}],outs:[{name:'Star Player'}]}) < statusDelta({outs:[{name:'Bench Guy'}]}));
}catch(e){ok('statusDelta: '+e.message,false);}

// ---- OCR bet classification (ocr_parse.mjs) — real Singapore Pools blocks ----
try{
 const TEAMS=['Australia','Sweden','Uzbekistan','Colombia','Portugal','DR Congo','Czechia','South Africa','Scotland','Morocco','Mexico','Korea Republic','Spain','Cape Verde','Canada','Qatar','Ivory Coast','Curacao','Japan'];
 const ALIAS={'congo dr':'DR Congo','czech republic':'Czechia','korea':'Korea Republic','south korea':'Korea Republic'};
 const norm=s=>(s||'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
 const ocrTeam=str=>{const n=norm(str);if(!n)return null;if(ALIAS[n])return ALIAS[n];for(const t of TEAMS)if(norm(t)===n)return t;for(const t of TEAMS)if(n.includes(norm(t)))return t;for(const k in ALIAS)if(n.includes(k))return ALIAS[k];return null;};
 const C=(sel,mkt,a,b)=>classifyBet(sel,mkt,a,b,ocrTeam);
 ok('OCR: Group Winner -> groupWinner team',(()=>{const r=C('Australia','Group Winner',null,null);return r.type==='groupWinner'&&r.sel==='Australia';})());
 ok('OCR: Group Winner (Sweden) -> groupWinner',(()=>{const r=C('Sweden','Group Winner',null,null);return r.type==='groupWinner'&&r.sel==='Sweden';})());
 ok('OCR: Pick The Score draw -> score',(()=>{const r=C('Draw 2-2','Pick The Score','Uzbekistan','Colombia');return r.type==='score'&&r.out==='2-2'&&r.sel==='Uzbekistan'&&r.sel2==='Colombia';})());
 ok('OCR: Fulltime PTS team score -> score oriented to scorer',(()=>{const r=C('Congo DR 2-1','Fulltime PTS','Portugal','DR Congo');return r.type==='score'&&r.sel==='DR Congo'&&r.sel2==='Portugal'&&r.out==='2-1';})());
 ok('OCR: 1st Goal Scorer -> firstScorer (code stripped)',(()=>{const r=C('L. Krejci (CZE)','1st Goal Scorer','Czechia','South Africa');return r.type==='firstScorer'&&r.player==='L. Krejci'&&r.sel==='Czechia';})());
 ok('OCR: 1st Goal Scorer (Hwang) -> firstScorer',(()=>{const r=C('Hwang Inbeom (KOR)','1st Goal Scorer','Mexico','Korea Republic');return r.type==='firstScorer'&&r.player==='Hwang Inbeom';})());
 ok('OCR: Halftime-Fulltime "Team - Draw" -> htft 1/X',(()=>{const r=C('Scotland - Draw','Halftime-Fulltime','Scotland','Morocco');return r.type==='htft'&&r.htOut==='1'&&r.ftOut==='X';})());
 ok('OCR: Team to Score 1st Goal -> teamFirstGoal',(()=>{const r=C('DR Congo','Team to Score 1st Goal','Portugal','DR Congo');return r.type==='teamFirstGoal'&&r.sel==='DR Congo'&&r.sel2==='Portugal';})());
 ok('OCR: "9+ Goals" total -> matchTotal (not a scorer)',(()=>{const r=C('9+ Goals','Total Goals','Spain','Cape Verde');return r.type==='matchTotal'&&!r.player;})());
 ok('OCR: "Top Goal Scorer" -> topScorer (tournament outright, not a match scorer)',(()=>{const r=C('L. Yamal (ESP)','W Cup: Top Goal Scorer',null,null);return r.type==='topScorer'&&r.player==='L. Yamal'&&!r.sel;})());
 // real OCR text: receipt layout (market BEFORE selection; "Bet Amount"/value on separate lines; payout must NOT be taken as stake)
 const receipt=`W Cup\nCanada vs Qatar\nPick The Score\nCanada 1-0 @ 6.50\nBet Amount\n$3.00\nPotential Payout\n$19.50\n0/0591191/0000299\nW Cup\nCanada vs Qatar\nPick The Score\nDraw 0-0 @ 11.00\nBet Amount\n$3.00\nPotential Payout\n$33.00\nTotal Stake\n$6.00\nTransaction Fee S0.00\nTotal Amount $6.00`;
 const rb=parseSGP(receipt,ocrTeam);
 ok('OCR parse: receipt "Pick The Score" -> score (not 1x2), stake=Bet Amount not payout',(()=>{const b=rb.find(x=>x.out==='1-0');return b&&b.type==='score'&&b.sel==='Canada'&&b.sel2==='Qatar'&&b.stake===3;})());
 ok('OCR parse: receipt draw 0-0 -> score, stake 3 (not Total Stake $6)',(()=>{const b=rb.find(x=>x.out==='0-0');return b&&b.type==='score'&&b.stake===3;})());
 // real OCR text: list layout (market AFTER selection)
 const list=`Transaction: Thu, 18 Jun 2026, 9.00pm\nSweden @ 3.15\nGroup Winner\nW Cup: Group F Winner\nBet Amount\n$5.00\nTransaction: Thu, 18 Jun 2026, 8.49pm\nHwang Inbeom (KOR) @ 19.00\n1st Goal Scorer\nMexico vs Korea Republic\nBet Amount\n$3.00`;
 const lb=parseSGP(list,ocrTeam);
 ok('OCR parse: list Group Winner -> groupWinner Sweden $5',(()=>{const b=lb.find(x=>x.type==='groupWinner');return b&&b.sel==='Sweden'&&b.stake===5&&b.odds===3.15;})());
 ok('OCR parse: list 1st Goal Scorer -> firstScorer Hwang $3',(()=>{const b=lb.find(x=>x.type==='firstScorer');return b&&b.player==='Hwang Inbeom'&&b.sel==='Mexico'&&b.sel2==='Korea Republic'&&b.stake===3;})());
 // regression: OCR misreads "Ivory" as "lvory" (l↔I). The fixture line must still resolve,
 // so the score bet's opponent is Curacao — NOT the next receipt's team (Japan). makeCanon has the fold.
 const canon=makeCanon(TEAMS);
 ok('OCR fold: "lvory Coast" resolves to Ivory Coast',canon('lvory Coast')==='Ivory Coast');
 const misread=`W Cup\nCuracao vs lvory Coast\nPick The Score\nIvory Coast 2-0 @ 6.50\nBet Amount\n$3.00\nPotential Payout\n$19.50\n0/0591191/0000310\nW Cup\nJapan vs Sweden\n1st Goal Scorer\nA. Isak (SWE) @ 6.00\nBet Amount\n$3.00`;
 const mb=parseSGP(misread,canon);
 ok('OCR parse: misread fixture still pairs the score bet with Curacao (not the next receipt Japan)',(()=>{const b=mb.find(x=>x.type==='score'&&x.out==='2-0');return b&&b.sel==='Ivory Coast'&&b.sel2==='Curacao';})());
 // regression: ESPN names DR Congo "Congo DR" — the script canon must map it (lineup backfill relies on it)
 ok('canon maps ESPN "Congo DR" -> DR Congo',makeCanon(['DR Congo','Portugal'])('Congo DR')==='DR Congo');
}catch(e){ok('OCR classify: '+e.message,false);}

// ---- schedule / staleness helpers (fdmap.mjs) ----
try{
 const rt=fmtSGT(schedToUTC('Jun 19','9:00am SGT'));
 ok('SGT round-trips (Jun 19 9:00am)',rt.d==='Jun 19'&&rt.t==='9:00am SGT');
 ok('openfootball time -> SGT (13:00 UTC-6 -> Jun 12 3:00am SGT)',(()=>{const s=fmtSGT(parseOFtime('2026-06-11','13:00 UTC-6'));return s.d==='Jun 12'&&s.t==='3:00am SGT';})());
 ok('SGT noon/midnight format',fmtSGT(schedToUTC('Jun 20','12:00pm SGT')).t==='12:00pm SGT'&&fmtSGT(schedToUTC('Jun 20','12:00am SGT')).t==='12:00am SGT');
 const sched={g_A_0:{d:'Jun 12',t:'3:00am SGT'},g_L_5:{d:'Dec 31',t:'9:00pm SGT'}},now=Date.UTC(2026,5,20,0,0);
 ok('staleness: past match w/o result is flagged',overdueFixtures(sched,{},now).some(o=>o.id==='g_A_0'));
 ok('staleness: future match not flagged',!overdueFixtures(sched,{},now).some(o=>o.id==='g_L_5'));
 ok('staleness: recorded result not flagged',!overdueFixtures(sched,{g_A_0:[1,0]},now).some(o=>o.id==='g_A_0'));
}catch(e){ok('fdmap helpers: '+e.message,false);}

// ---- matchTotal settlement (regression: market was unhandled → a real bet could never settle) ----
try{copyFileSync(FILE,BAK);const slip=join(ROOT,'.selftest.mt.json');
 run([here+'update_data.mjs','g_H_4=5-4','--clear-stats','g_H_4']); // Spain v Cape Verde = 9 goals
 writeFileSync(slip,JSON.stringify({bets:[{type:'matchTotal',sel:'Spain',sel2:'Cape Verde',out:'9+',odds:12,stake:3}]}));
 let ev=JSON.parse(run([here+'evaluate_bets.mjs','--bets',slip,'--json']));
 ok('matchTotal "9+" on a 9-goal match settles won',ev.bets[0].status==='won');
 ok('matchTotal is auto-classified (not manual)',ev.bets[0].validation==='auto');
 run([here+'update_data.mjs','g_H_4=4-4','--clear-stats','g_H_4']); // 8 goals
 ev=JSON.parse(run([here+'evaluate_bets.mjs','--bets',slip,'--json']));
 ok('matchTotal "9+" on an 8-goal match settles lost',ev.bets[0].status==='lost');
 unlinkSync(slip);
}catch(e){ok('matchTotal settlement: '+e.message,false);}finally{if(existsSync(BAK)){copyFileSync(BAK,FILE);unlinkSync(BAK);}}

// ---- score modelProb bounds (regression: a >10-goal correct-score bet threw in evaluate_bets) ----
try{const slip=join(ROOT,'.selftest.sc.json');writeFileSync(slip,JSON.stringify({bets:[{type:'score',sel:'Spain',sel2:'Cape Verde',out:'11-0',odds:999,stake:1}]}));
 ok('score bet with >10 goals does not crash evaluate_bets',runOk([here+'evaluate_bets.mjs','--bets',slip,'--json']));
 unlinkSync(slip);
}catch(e){ok('score bounds: '+e.message,false);}

// ---- settle parity: app (appSettle) and node (settle) must cover the SAME markets ----
try{const html=readFileSync(join(ROOT,'index.html'),'utf8'),evs=readFileSync(here+'evaluate_bets.mjs','utf8');
 const appBody=html.slice(html.indexOf('function appSettle'),html.indexOf('// ---------- screenshot'));
 const evBody=evs.slice(evs.indexOf('function settle(b)'),evs.indexOf('// ---- validatability'));
 const cs=s=>[...new Set([...s.matchAll(/case '([A-Za-z0-9]+)'/g)].map(m=>m[1]))].sort();
 const a=cs(appBody),e=cs(evBody);
 ok('settle parity: appSettle and node settle cover the same markets ('+a.length+' vs '+e.length+')',JSON.stringify(a)===JSON.stringify(e));
}catch(e){ok('settle parity: '+e.message,false);}

// ---- knockout bracket resolve + openfootball knockout ingest (bracket.mjs) ----
try{const D=parseD();
 const M={73:{round:'R32',a:'Spain',b:'Brazil'},74:{round:'R32',a:'France',b:null},89:{round:'R16',a:'Argentina',b:'Germany'}};
 ok('findKo maps a decided team pair to its id (home = a-side)',(()=>{const f=findKo('Spain','Brazil',M);return f&&f.id==='73'&&f.home==='Spain';})());
 ok('findKo is order-independent',(()=>{const f=findKo('Brazil','Spain',M);return f&&f.id==='73'&&f.home==='Spain';})());
 ok('findKo returns null for an undecided match',findKo('France','Anyone',M)===null);
 const idc=s=>s; // names already canonical in these fixtures
 // ET score + HT + scorers, oriented to our home(a)=Spain even though OF lists Brazil first
 const m1={round:'Round of 32',team1:'Brazil',team2:'Spain',score:{ht:[0,1],ft:[1,1],et:[2,1]},goals1:[{minute:'30',name:'Vinicius'}],goals2:[{minute:'10',name:'Lamine Yamal'}]};
 const r1=mapKnockoutMatch(m1,M,idc);
 ok('mapKnockoutMatch records ET score oriented to a-side',r1&&r1.id==='73'&&JSON.stringify(r1.ft)==='[1,2]');
 ok('mapKnockoutMatch orients HT to a-side',JSON.stringify(r1.ht)==='[1,0]');
 ok('mapKnockoutMatch captures ordered scorers',r1.goals.length===2&&r1.goals[0].scorer==='Lamine Yamal');
 // penalties decide a level tie — winner side correct when OF lists teams swapped vs our a/b
 const m2={round:'Round of 16',team1:'Germany',team2:'Argentina',score:{ft:[1,1],p:[2,4]}};
 const r2=mapKnockoutMatch(m2,M,idc);
 ok('mapKnockoutMatch sets pens to the shoot-out winner (A=our a-side Argentina)',r2&&r2.id==='89'&&r2.pens==='A');
 const m3={round:'Round of 16',team1:'Argentina',team2:'Germany',score:{ft:[0,0],p:[5,3]}};
 ok('mapKnockoutMatch pens correct when not swapped',mapKnockoutMatch(m3,M,idc).pens==='A');
 // the 3rd-place playoff IS tracked now (M301) — its goals feed tournament totals + Golden Boot
 const M3P={200:{round:'SF',a:'Spain',b:'France'},201:{round:'SF',a:'Argentina',b:'England'},301:{round:'3P',a:'France',b:'England'},300:{round:'F',a:'Spain',b:'Argentina'}};
 const r3p=mapKnockoutMatch({round:'Match for third place',team1:'France',team2:'England',score:{ft:[4,6]}},M3P,idc);
 ok('mapKnockoutMatch maps the 3rd-place playoff to M301 oriented to a-side',r3p&&r3p.id==='301'&&JSON.stringify(r3p.ft)==='[4,6]');
 ok('mapKnockoutMatch ignores a 3rd-place match with unknown teams',mapKnockoutMatch({round:'Match for third place',team1:'Spain',team2:'Brazil',score:{ft:[1,0]}},M3P,idc)===null);
 // resolveBracket: R32 resolves once all groups complete, then cascades on a recorded R32 result
 const res={};for(const g of Object.keys(D.groups))for(let i=0;i<6;i++)res['g_'+g+'_'+i]=[1,0];
 const data1={results:res};const MA=resolveBracket(D,data1);
 const r32=Object.values(MA).filter(x=>x.round==='R32');
 ok('resolveBracket: all 16 R32 teams resolve when groups complete',r32.length===16&&r32.every(x=>x.a&&x.b));
 data1.results[String(D.R32[0].m)]=[2,0]; // a-side of r32 index 0 advances
 const MB=resolveBracket(D,data1);
 const r16id=D.r16m[D.r16.findIndex(p=>p.includes(0))];
 ok('resolveBracket cascades: a recorded R32 result resolves an R16 side',!!(MB[r16id]&&(MB[r16id].a||MB[r16id].b)));
 // object-shaped pens (a recorded shoot-out sequence) resolves the winner exactly like a legacy 'A'/'B' string
 const m73=String(D.R32[1].m);data1.results[m73]=[1,1];
 data1.pens={[m73]:{w:'A',kicks:[{team:'A',taker:'X',r:'scored'},{team:'B',taker:'Y',r:'missed'}]}};
 const MC=resolveBracket(D,data1),aSide=MC[m73].a,r16id2=D.r16m[D.r16.findIndex(p=>p.includes(1))];
 ok('resolveBracket advances the shoot-out winner from an object-shaped pens',!!(MC[r16id2]&&(MC[r16id2].a===aSide||MC[r16id2].b===aSide)));
}catch(e){ok('knockout bracket/ingest: '+e.message,false);}

// ---- penalty shoot-out sequence (--pso): record kicks, derive winner, round-trip, guards ----
try{copyFileSync(FILE,BAK);
 run([here+'update_data.mjs','73=1-1','--pso','73=A:Virgil van Dijk:scored; B:Kaoru Mitoma:missed; A:Cody Gakpo:scored; B:Wataru Endo:scored; A:Xavi Simons:scored; B:Takefusa Kubo:saved']);
 const pj=readData().pens['73'];
 ok('--pso stores the shoot-out as {w,kicks}',pj&&typeof pj==='object'&&Array.isArray(pj.kicks)&&pj.kicks.length===6);
 ok('--pso derives the winner from the tally (A 3–1)',pj.w==='A');
 ok('--pso records each kick as {team,taker,r}',pj.kicks[0].team==='A'&&pj.kicks[0].taker==='Virgil van Dijk'&&pj.kicks[1].r==='missed');
 run([here+'update_data.mjs','74=0-0','--pens','74=B']);
 const d2=readData();
 ok('mixed pens map (legacy string + rich object) round-trips through serialize',
   typeof d2.pens['74']==='string'&&typeof d2.pens['73']==='object'&&Array.isArray(d2.pens['73'].kicks));
 ok('a mixed pens map does not choke resolveBracket',(()=>{try{resolveBracket(parseD(),d2);return true;}catch{return false;}})());
 ok('--pso rejects a shoot-out with no winner (equal scored kicks)',!runOk([here+'update_data.mjs','75=2-2','--pso','75=A:X:scored; B:Y:scored']));
 ok('--pso rejects a bad result token (missed|saved|scored only)',!runOk([here+'update_data.mjs','76=1-1','--pso','76=A:X:blazed']));
 // app-side guards: single accessor + the raw PENS[..]==='A' comparisons were migrated to penWin()
 const html=readFileSync(join(ROOT,'index.html'),'utf8');
 ok('index.html defines the penWin() accessor',/const penWin=/.test(html));
 ok('no raw PENS[..]===\x27A/B\x27 comparisons remain (all via penWin)',!/PENS\[[^\]]*\]===/.test(html));
 ok('match sheet renders the shoot-out sequence (penKicks)',/penKicks\(/.test(html));
}catch(e){ok('penalty shoot-out sequence: '+e.message,false);}finally{if(existsSync(BAK)){copyFileSync(BAK,FILE);unlinkSync(BAK);}}

// ---- ESPN scoreboard adapter (espn.mjs) — fast/near-real-time results source ----
try{
 const espnJson={leagues:[{season:{type:{name:'Group Stage'}}}],events:[
  {date:'2026-06-22T21:00Z',season:{slug:'group-stage'},competitions:[{status:{type:{completed:true}},
    competitors:[{homeAway:'home',team:{id:'h',displayName:'France'},score:'3'},{homeAway:'away',team:{id:'a',displayName:'Iraq'},score:'0'}],
    details:[{scoringPlay:false,type:{text:'Yellow Card'},clock:{displayValue:"6'"},team:{id:'a'},athletesInvolved:[{displayName:'A. Player'}]},
      {scoringPlay:true,clock:{displayValue:"14'"},team:{id:'h'},athletesInvolved:[{displayName:'Kylian Mbappé'}]},
      {scoringPlay:true,clock:{displayValue:"54'"},team:{id:'h'},athletesInvolved:[{displayName:'Kylian Mbappé'}]},
      {scoringPlay:true,clock:{displayValue:"66'"},team:{id:'h'},athletesInvolved:[{displayName:'Ousmane Dembélé'}]}]}]},
  {date:'2026-06-23T01:00Z',season:{slug:'group-stage'},competitions:[{status:{type:{completed:false}},
    competitors:[{homeAway:'home',team:{id:'x',displayName:'Spain'},score:null},{homeAway:'away',team:{id:'y',displayName:'Brazil'},score:null}],details:[]}]},
  {date:'2026-07-05T19:00Z',season:{slug:'round-of-16'},competitions:[{status:{type:{completed:true}},
    competitors:[{homeAway:'home',team:{id:'p',displayName:'Argentina'},score:'1'},{homeAway:'away',team:{id:'q',displayName:'Germany'},score:'1'}],
    details:[{scoringPlay:true,clock:{displayValue:"30'"},team:{id:'p'},athletesInvolved:[{displayName:'Messi'}]},
      {scoringPlay:true,clock:{displayValue:"70'"},team:{id:'q'},athletesInvolved:[{displayName:'Mueller'}]},
      {scoringPlay:true,shootout:true,team:{id:'p'},athletesInvolved:[{displayName:'Messi'}]},
      {scoringPlay:true,shootout:true,team:{id:'p'},athletesInvolved:[{displayName:'Alvarez'}]},
      {scoringPlay:true,shootout:true,team:{id:'q'},athletesInvolved:[{displayName:'Kane'}]}]}]}]};
 const ms=parseESPNScoreboard(espnJson);
 ok('ESPN: skips not-completed matches',ms.length===2);
 const fr=ms.find(m=>m.team1==='France');
 ok('ESPN: full-time score parsed',JSON.stringify(fr.score.ft)==='[3,0]');
 ok('ESPN: half-time derived from goal minutes',JSON.stringify(fr.score.ht)==='[1,0]');
 ok('ESPN: scorers split to goals1/goals2 (yellow card ignored)',fr.goals1.length===3&&fr.goals2===undefined&&fr.goals1[0].name.includes('Mbapp'));
 const ko=ms.find(m=>m.team1==='Argentina');
 ok('ESPN: knockout round normalised to KO_ROUNDS form',ko.round==='round of 16');
 ok('ESPN: penalty shoot-out -> score.p (not counted as goals)',JSON.stringify(ko.score.p)==='[2,1]'&&ko.goals1.length===1&&ko.goals2.length===1);
 ok('ESPN: normRound maps quarter/semi/final',normRound('Quarterfinals')==='quarter-final'&&normRound('Semifinals')==='semi-final'&&normRound('Final')==='final'&&normRound('group-stage')==='group stage');
 ok('ESPN: espnDates is a yesterday..tomorrow UTC window',espnDates(Date.UTC(2026,5,22,12,0)).join(',')==='20260621,20260622,20260623');
}catch(e){ok('ESPN adapter: '+e.message,false);}

// ---- lineup ingestion + injury auto-clear (espn.parseESPNLineups + lineups.applyLineup) ----
try{
 const summary={rosters:[
  {team:{displayName:'Portugal'},formation:'4-3-3',roster:[
    {starter:true,jersey:'1',position:{abbreviation:'G'},athlete:{displayName:'Diogo Costa'}},
    {starter:true,jersey:'3',position:{abbreviation:'CD'},athlete:{displayName:'Rúben Dias'}},
    {starter:true,jersey:'7',position:{abbreviation:'RW'},athlete:{displayName:'Cristiano Ronaldo'}},
    {subbedIn:true,jersey:'26',position:{abbreviation:'CF'},athlete:{displayName:'Gonçalo Ramos'}},
    {starter:false,subbedIn:false,jersey:'22',athlete:{displayName:'Unused Sub'}}]},
  {team:{displayName:'Uzbekistan'},roster:[{starter:true,jersey:'1',athlete:{displayName:'Player A'}}]}]},
   subs=[{type:{type:'substitution'},clock:{displayValue:"70'"},team:{displayName:'Portugal'},participants:[{athlete:{displayName:'Gonçalo Ramos'}},{athlete:{displayName:'Cristiano Ronaldo'}}]}];
 const lus=parseESPNLineups(summary);
 ok('parseESPNLineups: per-team XI/subs with jersey+position',lus.length===2&&lus[0].starters.length===3&&lus[0].subs.length===1&&lus[0].starters[0].num==='1'&&lus[0].starters[0].pos==='GK');
 ok('posGroup maps abbreviations',posGroup('G')==='GK'&&posGroup('CD')==='DEF'&&posGroup('CM-R')==='MID'&&posGroup('CF')==='FWD');
 ok('sameName: suffix/subset match',sameName('Vinícius Júnior','Vinicius Jr')&&sameName('Alisson Becker','Alisson')&&!sameName('Danilo Luiz','Danilo Santos'));
 // curated squad uses a DIFFERENT spelling but the SAME jersey → must merge by number, not create a dup
 const profiles={Portugal:{squad:[{name:'Ruben Dias',no:'3',role:'CB'}],outs:[{name:'Ruben Dias',note:'muscle injury'}]}};
 const r=applyLineup(profiles,'Portugal','g_K_4',{starters:lus[0].starters,subs:lus[0].subs});
 const dias=profiles.Portugal.squad.find(x=>x.no==='3');
 ok('applyLineup: jersey-number match (no duplicate for "Rúben Dias" vs "Ruben Dias")',profiles.Portugal.squad.filter(x=>normName(x.name).includes('dias')).length===1&&dias.xiM.includes('g_K_4'));
 ok('applyLineup: keeps curated name + role on a number match',dias.name==='Ruben Dias'&&dias.role==='CB');
 ok('applyLineup: AUTO-CLEARS injury for a player who started (accent-insensitive)',(profiles.Portugal.outs||[]).length===0&&r.cleared.includes('Ruben Dias'));
 ok('applyLineup: adds a new player with jersey + position',(()=>{const c=profiles.Portugal.squad.find(x=>x.no==='1');return c&&c.name==='Diogo Costa'&&c.pos==='GK';})());
 ok('applyLineup: sub appearance tallied',profiles.Portugal.squad.find(x=>x.no==='26').subM.includes('g_K_4'));
 applyLineup(profiles,'Portugal','g_K_4',{starters:lus[0].starters,subs:lus[0].subs});
 ok('applyLineup: idempotent per fixture',profiles.Portugal.squad.find(x=>x.no==='3').xiM.length===1);
 ok('applyLineup: ignores an unknown team',applyLineup(profiles,'Atlantis','g_K_4',lus[0]).added===0);
 // minutes: Ronaldo (starter) subbed off at 70 → 70'; Ramos (sub) on at 70 → 20'; Dias full → 90'
 const psubs=parseESPNSubs({keyEvents:subs}).filter(s=>s.team==='Portugal');
 const mins=computeMinutes(lus[0],psubs,90);
 ok('computeMinutes: starter full / subbed-off / sub-on',mins['Cristiano Ronaldo']===70&&mins['Gonçalo Ramos']===20&&mins['Rúben Dias']===90);
 const cards=parseESPNCards({keyEvents:[
   {type:{text:'Yellow Card'},clock:{displayValue:"17'"},team:{displayName:'Portugal'},participants:[{athlete:{displayName:'Bruno Fernandes'}}]},
   {type:{text:'Red Card'},clock:{displayValue:"49'"},team:{displayName:'Uzbekistan'},participants:[{athlete:{displayName:'Player A'}}]},
   {type:{text:'Goal'},clock:{displayValue:"60'"},team:{displayName:'Portugal'},participants:[{athlete:{displayName:'Someone'}}]}]});
 ok('parseESPNCards: yellow→y, red→r (non-card events ignored)',cards.length===2&&cards[0].type==='y'&&cards[0].player==='Bruno Fernandes'&&cards[1].type==='r'&&cards[1].team==='Uzbekistan');
}catch(e){ok('lineup ingestion: '+e.message,false);}

// ---- per-player goal tally + team form (lineups.applyGoals / computeForm) ----
try{
 const profiles={Canada:{squad:[{name:'Jonathan David'},{name:'Cyle Larin'}]}};
 const goals=[{min:16,team:'Canada',scorer:'Cyle Larin'},{min:29,team:'Canada',scorer:'Jonathan David'},
   {min:45,team:'Canada',scorer:'Jonathan David'},{min:75,team:'Canada',scorer:'Mohamed Manai',og:true},
   {min:90,team:'Canada',scorer:'Jonathan David'}];
 const ch=applyGoals(profiles,'Canada','g_B_3','Qatar',goals);
 const jd=profiles.Canada.squad.find(p=>p.name==='Jonathan David');
 ok('applyGoals: tallies a hat-trick into the player log',ch&&jd.log[0].g===3&&jd.log[0].m==='g_B_3');
 ok('applyGoals: own goal not credited to a player (adds new OG scorer? no)',!profiles.Canada.squad.some(p=>p.name==='Mohamed Manai'));
 ok('applyGoals: idempotent — re-run reports no change',applyGoals(profiles,'Canada','g_B_3','Qatar',goals)===false&&jd.log.length===1);
 // form from results, chronological, most-recent last
 const D=parseD();const res={};
 // give group B two Canada results: Bosnia (g_B_5, draw) earlier date, Qatar (g_B_3, win) later
 res['g_B_5']=[1,1];res['g_B_3']=[6,0];
 const sched={g_B_5:{d:'Jun 13'},g_B_3:{d:'Jun 19'}};
 const form=computeForm(D,{results:res,sched});
 ok('computeForm: Canada form reflects actual results (draw then win = "DW")',form.Canada==='DW');
}catch(e){ok('goal tally / form: '+e.message,false);}

// ---- official FIFA third-place table (thirds_combinations.json + bracket.thirdAssignment) ----
try{const tbl=JSON.parse(readFileSync(join(ROOT,'thirds_combinations.json'),'utf8'));
 ok('thirds table has all 495 combinations',Object.keys(tbl).length===495);
 const ELIG={74:['A','B','C','D','F'],77:['C','D','F','G','H'],79:['C','E','F','H','I'],80:['E','H','I','J','K'],81:['B','E','F','I','J'],82:['A','E','H','I','J'],85:['E','F','G','I','J'],87:['D','E','I','J','L']};
 let valid=true;for(const [key,row] of Object.entries(tbl)){if(Object.values(row).slice().sort().join('')!==key)valid=false;for(const [m,g] of Object.entries(row))if(!ELIG[m].includes(g))valid=false;}
 ok('thirds table: every row assigns its combo respecting slot eligibility',valid);
 ok('thirds table: known row EFGHIJKL',JSON.stringify(tbl['EFGHIJKL'])===JSON.stringify({74:'F',77:'G',79:'E',80:'K',81:'I',82:'H',85:'J',87:'L'}));
 const D=parseD(),FXx=[[0,1],[2,3],[0,2],[1,3],[0,3],[1,2]];
 ok('thirdAssignment: null until all 12 groups complete',thirdAssignment(D,{results:{}},tbl)===null);
 const res={};for(const g of Object.keys(D.groups))for(let i=0;i<6;i++)res['g_'+g+'_'+i]=[1,0];
 const ta=thirdAssignment(D,{results:res},tbl);
 ok('thirdAssignment: 8 slots once complete',!!ta&&Object.keys(ta).length===8);
 const bt=fifaBestThirds({groups:D.groups,results:res,matchStats:{},elo:D.elo,fx:FXx});
 const key=bt.slice(0,8).map(x=>x.g).sort().join('');
 ok('thirdAssignment matches the official table row for the qualifying combo',JSON.stringify(ta)===JSON.stringify(tbl[key]));
 const M=resolveBracket(D,{results:res,thirds:ta},tbl);
 const std=fifaStandings(ta[74],{groups:D.groups,results:res,matchStats:{},elo:D.elo,fx:FXx});
 ok('resolveBracket slots the official 3rd-placed team into M74',!!M[74]&&(M[74].a===std[2].t||M[74].b===std[2].t));
}catch(e){ok('thirds table: '+e.message,false);}

// ---- evaluate_bets ----
// Settles the real slip, which lives on the private origin/bets-private branch and
// is NOT present in a public clone of the app. If that branch isn't reachable, skip
// this check rather than fail, so the suite stays green for anyone cloning the public
// mirror. The private repo, which has the branch, still runs it for real.
let _slipAvail=true;
try{execFileSync('git',['show','origin/bets-private:bets.json'],{stdio:'ignore'});}catch{_slipAvail=false;}
if(_slipAvail){
 try{const e=JSON.parse(run([here+'evaluate_bets.mjs','--json']));ok('evaluate_bets reads slip + produces summary',!!e.summary&&Array.isArray(e.bets)&&!!e.coverage);}
 catch(e){ok('evaluate_bets (needs origin/bets-private): '+e.message.split('\n')[0],false);}
}else{
 ok('evaluate_bets — skipped (no origin/bets-private slip in this clone)',true);
}

// ---- app function regression guards (extract real source from index.html, run in a sandbox) ----
// These pull the ACTUAL function bodies out of index.html so they guard the committed code, not a copy.
try{const html=readFileSync(join(ROOT,'index.html'),'utf8');
 const extractFn=(name)=>{const i=html.indexOf('function '+name+'(');if(i<0)throw new Error('not found: '+name);
  let depth=0,started=false;for(let k=html.indexOf('{',i);k<html.length;k++){const c=html[k];if(c==='{'){depth++;started=true;}else if(c==='}'){depth--;if(started&&depth===0)return html.slice(i,k+1);}}throw new Error('unbalanced: '+name);};
 const mk=(params,name,...vals)=>new Function(...params,extractFn(name)+';return '+name+';')(...vals);
 const lastTok=s=>String(s||'').toLowerCase().split(/\s+/).filter(Boolean);
 const scorerEq=(a,b)=>{const A=lastTok(a),B=lastTok(b);if(!A.length||!B.length)return false;const sa=new Set(A),sb=new Set(B);return A.every(x=>sb.has(x))||B.every(x=>sa.has(x));};
 const nameEq=scorerEq;

 // --- findFx: now KO-aware (the settlement bug fix) ---
 {const GL=['A'],D={groups:{A:['T0','T1','T2','T3']}},FX=[[0,1],[2,3],[0,2],[1,3],[0,3],[1,2]];
  const KOSCHED={'200':1},eligFor=id=>id==='200'?{a:'Brazil',b:'Japan'}:null;
  const findFx=mk(['GL','D','FX','KOSCHED','eligFor'],'findFx',GL,D,FX,KOSCHED,eligFor);
  ok('findFx: group fixture resolves (T0 v T1 -> g_A_0, home T0)',JSON.stringify(findFx('T0','T1'))===JSON.stringify({id:'g_A_0',home:'T0'}));
  ok('findFx: order-independent, home stays the listed side',JSON.stringify(findFx('T1','T0'))===JSON.stringify({id:'g_A_0',home:'T0'}));
  ok('findFx: KO tie now resolves (Brazil v Japan -> 200, home a-side)',JSON.stringify(findFx('Brazil','Japan'))===JSON.stringify({id:'200',home:'Brazil'}));
  ok('findFx: KO tie order-independent (home stays a-side)',JSON.stringify(findFx('Japan','Brazil'))===JSON.stringify({id:'200',home:'Brazil'}));
  ok('findFx: unknown pairing -> null',findFx('X','Y')===null);}

 // --- liveState: the live→final→ingested bridge (fixes the "match ended → not started" blank-out) ---
 {const liveState=mk([],'liveState');
  const W=165*60000,BR=12*36e5,ko=1_000_000; // W=live window, BR=max bridge; ko=arbitrary kickoff epoch
  ok('liveState: not kicked off yet -> off',liveState(ko,ko-60000,false,false,W,BR)==='off');
  ok('liveState: inside the 165-min window -> live',liveState(ko,ko+60*60000,false,false,W,BR)==='live');
  // THE regression: match finished (ESPN posted a final) but data.json has not ingested it yet AND
  // the 165-min window has lapsed — must keep showing the final, NOT revert to "not started".
  ok('liveState: window lapsed + ESPN final, not yet ingested -> bridged',liveState(ko,ko+200*60000,false,true,W,BR)==='bridged');
  ok('liveState: window lapsed, no ESPN final -> off',liveState(ko,ko+200*60000,false,false,W,BR)==='off');
  ok('liveState: official result present -> off (even inside the window)',liveState(ko,ko+60*60000,true,true,W,BR)==='off');
  ok('liveState: bridge expires after BR -> off',liveState(ko,ko+BR+60000,false,true,W,BR)==='off');}

 // --- provSettle: provisional live settlement, display-only, self-correcting on VAR ---
 {const stubFx=(t1,t2)=>({id:'ko1',home:t1}),liveMatchIds=()=>['ko1'];
  let STATS={},state={scores:{}},LINEUPS={},LIVE={ko1:{state:'in'}};
  const provSettle=mk(['findFx','STATS','state','liveMatchIds','LINEUPS','LIVE','scorerEq'],'provSettle',stubFx,STATS,state,liveMatchIds,LINEUPS,LIVE,scorerEq);
  const bet=(type,sel,sel2,player)=>({type,sel,sel2,player});
  LINEUPS.ko1={goals:[{min:"12'",scorer:'Raphinha',team:'Brazil',og:false},{min:"40'",scorer:'Kamada',team:'Japan',og:false}]};
  ok('provSettle: firstScorer for a non-first scorer = lost',provSettle(bet('firstScorer','Brazil','Japan','Kamada'))==='lost');
  ok('provSettle: firstScorer for the actual first scorer = won',provSettle(bet('firstScorer','Brazil','Japan','Raphinha'))==='won');
  ok('provSettle: anytimeScorer once the player has scored = won',provSettle(bet('anytimeScorer','Brazil','Japan','Kamada'))==='won');
  ok('provSettle: teamFirstGoal for the first-scoring side = won',provSettle(bet('teamFirstGoal','Brazil','Japan',''))==='won');
  ok('provSettle: teamFirstGoal for the other side = lost',provSettle(bet('teamFirstGoal','Japan','Brazil',''))==='lost');
  LINEUPS.ko1={goals:[{min:"40'",scorer:'Kamada',team:'Japan',og:false}]}; // VAR chalks off Raphinha -> feed re-parsed without it
  ok('provSettle: after a VAR chalk-off, the new first scorer = won (self-corrects)',provSettle(bet('firstScorer','Brazil','Japan','Kamada'))==='won');
  LINEUPS.ko1={goals:[]};
  ok('provSettle: no goals yet while live = null (stays open)',provSettle(bet('firstScorer','Brazil','Japan','Kamada'))===null);
  LIVE.ko1={state:'post'};
  ok('provSettle: match ended 0-0 = lost',provSettle(bet('anytimeScorer','Brazil','Japan','Kamada'))==='lost');
  LIVE.ko1={state:'in'};STATS.ko1={goals:[{min:40,scorer:'Kamada',team:'Japan'}]};
  ok('provSettle: once recorded, defers to appSettle = null',provSettle(bet('anytimeScorer','Brazil','Japan','Kamada'))===null);
  STATS.ko1=undefined;
  ok('provSettle: ignores non-goal markets = null',provSettle(bet('match1x2','Brazil','Japan',''))===null);}

 // --- scorerDist: penalty-taker model conserves each team's total xG ---
 {const PROFILES={Test:{squad:[{name:'Striker',pos:'FW'},{name:'Mid',pos:'MF'},{name:'Back',pos:'DF'},{name:'Taker Man',pos:'FW'}]}};
  const POSW={FW:1,MF:0.5,DF:0.2},pGoals=()=>0,teamGames=()=>3,availW=()=>1,PEN_K=0.075,lambda=1.3,total=lambda*0.88;
  const runDist=(takers)=>mk(['PROFILES','POSW','pGoals','teamGames','availW','nameEq','TAKERS','PEN_K'],'scorerDist',PROFILES,POSW,pGoals,teamGames,availW,nameEq,takers,PEN_K)('Test',lambda);
  const sum=d=>d.reduce((s,x)=>s+x.xg,0);
  const withT=runDist({Test:['Taker Man']}),noT=runDist({Test:[]});
  ok('scorerDist: total xG conserved WITH takers',Math.abs(sum(withT)-total)<1e-9);
  ok('scorerDist: total xG conserved WITHOUT takers',Math.abs(sum(noT)-total)<1e-9);
  const xgOf=(d,n)=>(d.find(x=>x.name===n)||{}).xg||0;
  ok('scorerDist: designated taker gets a penalty bump',xgOf(withT,'Taker Man')>xgOf(noT,'Taker Man')+1e-6);
  const mis=runDist({Test:['Nobody Here']}); // a misspelled/unmatched taker name must not break conservation
  ok('scorerDist: an unmatched taker name still conserves the total',Math.abs(sum(mis)-total)<1e-9);}

 // --- decBets: PBKDF2 iterations read per-blob (v1=100k fallback, v2=600k stored) ---
 {const _ub=s=>Uint8Array.from(Buffer.from(s,'base64')); // app uses atob; base64→bytes equivalent
  // extractFn drops the leading `async`, so re-prepend it to keep the awaits valid
  const decBets=new Function('_ub','async '+extractFn('decBets')+';return decBets;')(_ub);
  const tenc=new TextEncoder(),b64=u=>Buffer.from(u).toString('base64');
  const mkBlob=async(iters,withIt)=>{const salt=crypto.getRandomValues(new Uint8Array(16)),iv=crypto.getRandomValues(new Uint8Array(12));
   const km=await crypto.subtle.importKey('raw',tenc.encode('pw'),'PBKDF2',false,['deriveKey']);
   const key=await crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:iters,hash:'SHA-256'},km,{name:'AES-GCM',length:256},false,['encrypt']);
   const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,tenc.encode(JSON.stringify({bets:[{sel:'X'}],reads:{},teams:[]})));
   const blob={salt:b64(salt),iv:b64(iv),ct:b64(new Uint8Array(ct))};if(withIt)blob.it=iters;return blob;};
  const v1=await mkBlob(100000,false);
  ok('decBets: v1 blob (no it) decrypts via 100k fallback',(await decBets(v1,'pw')).bets[0].sel==='X');
  const v2=await mkBlob(600000,true);
  ok('decBets: v2 blob (it=600k) decrypts at stored iteration count',(await decBets(v2,'pw')).bets[0].sel==='X');
  const mism=await mkBlob(600000,false); // 600k ciphertext but it omitted → 100k fallback must fail
  let failed=false;try{await decBets(mism,'pw');}catch{failed=true;}
  ok('decBets: 600k ciphertext without it field fails at 100k (proves blob.it is honored)',failed);}
}catch(e){ok('app function regression guards: '+e.message,false);}

console.log(fail?`\n${fail} check(s) FAILED`:'\nall checks passed');
process.exit(fail?1:0);
