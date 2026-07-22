#!/usr/bin/env node
// Resolves the knockout bracket from data.json's recorded RESULTS — emitting the
// real teams for each knockout match only once they are actually DECIDED (never
// the Elo projection the app shows). Single source of truth: the `D` object is
// read straight out of index.html so this can't drift from the app.
//
//   node scripts/resolve_bracket.mjs           # human-readable
//   node scripts/resolve_bracket.mjs --json    # machine output for the calendar sync
//
// Decision rules:
//  - A group's 1st/2nd are final only when all 6 of its matches have results.
//  - Third-place slots (R32) resolve only when ALL 12 groups are complete
//    (the best-thirds ranking + FIFA-table allocation need the full picture).
//    NOTE: allocation here mirrors the app's approximation; the real FIFA draw
//    may differ — verify the 3rd-place R32 ties when the official table posts.
//  - R16→Final teams need the feeding knockout RESULTS. If data.json records a
//    knockout score under its numeric id (e.g. "73":[2,1]), the higher score
//    advances; a level score is UNDECIDED unless data.json's "pens" block names
//    the shoot-out winner's side, e.g. "pens":{"73":"A"} (A=left, B=right team).
//    Set these with: node scripts/update_data.mjs 73=1-1 --pens 73=A
import {parseD,readData} from './datafile.mjs';
import {resolveBracket} from './bracket.mjs';
import {readFileSync} from 'fs';
let THIRDS_TABLE={};try{THIRDS_TABLE=JSON.parse(readFileSync(new URL('../thirds_combinations.json',import.meta.url)));}catch{}

// --- the app's data object D (single source of truth) ---
const D=parseD();
const GL=Object.keys(D.groups);
const data=readData();
const scores=data.results||{};
const groupComplete=g=>{for(let k=0;k<6;k++)if(!scores['g_'+g+'_'+k])return false;return true;};
const allGroupsComplete=GL.every(groupComplete);

// the full bracket: m-id -> {round, a, b} with teams or null (shared resolver — see bracket.mjs)
const M=resolveBracket(D,data,THIRDS_TABLE);

if(process.argv.includes('--json')){console.log(JSON.stringify(M,null,1));process.exit(0);}
const sh=t=>D.short[t]||t;
console.log(`groups complete: ${GL.filter(groupComplete).length}/12   all complete: ${allGroupsComplete}`);
let decided=0;
for(const m of Object.keys(M).map(Number).sort((a,b)=>a-b)){const t=M[m];
 const a=t.a?sh(t.a):'· TBD ·',b=t.b?sh(t.b):'· TBD ·';if(t.a&&t.b)decided++;
 console.log(`M${m} [${t.round}] ${a}  vs  ${b}`);}
console.log(`\nfully-decided knockout matchups: ${decided}/${Object.keys(M).length}`);
