#!/usr/bin/env node
// Regenerates data.json's `sched` block (all 72 group fixtures) from the
// authoritative match table below, converting kickoffs from UTC to Singapore
// time (SGT, UTC+8). It PRESERVES any results already in data.json (merged over
// the baked seed), so it is safe to re-run. Day-to-day score updates go through
// scripts/update_data.mjs, not this file.
//
//   node scripts/build_schedule.mjs          # write data.json
//   node scripts/build_schedule.mjs --dry    # preview only
//
// Table row: [group, team1, team2, utcDate 'Mon D', utc 'HH:MM', venue, seedScore|null]
// utcDate/utc are the UTC instant; team1/team2 are FIFA's listed order and also
// the score orientation. Sources cross-checked across major outlets (fifa.com
// blocks automated fetch); UTC times computed from venue-local/ET with June-2026
// DST offsets and anchored to confirmed kickoffs.
import {readFileSync,writeFileSync,existsSync} from 'fs';
import {fileURLToPath} from 'url';
import {dirname,join} from 'path';

const ROOT=join(dirname(fileURLToPath(import.meta.url)),'..');
const FILE=join(ROOT,'data.json');
const ASOF='13 Jun 2026';

const groups={A:["Mexico","Czechia","Korea Republic","South Africa"],B:["Switzerland","Canada","Bosnia and Herzegovina","Qatar"],C:["Brazil","Morocco","Scotland","Haiti"],D:["Turkiye","United States","Paraguay","Australia"],E:["Ecuador","Germany","Ivory Coast","Curacao"],F:["Netherlands","Japan","Sweden","Tunisia"],G:["Belgium","Egypt","Iran","New Zealand"],H:["Spain","Uruguay","Saudi Arabia","Cape Verde"],I:["France","Norway","Senegal","Iraq"],J:["Argentina","Austria","Algeria","Jordan"],K:["Portugal","Colombia","DR Congo","Uzbekistan"],L:["England","Croatia","Ghana","Panama"]};
const FX=[[0,1],[2,3],[0,2],[1,3],[0,3],[1,2]];
const MON={Jan:0,Feb:1,Mar:2,Apr:3,May:4,Jun:5,Jul:6,Aug:7,Sep:8,Oct:9,Nov:10,Dec:11};
const MNAME=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function fxIndex(g,t1,t2){const T=groups[g];const a=T.indexOf(t1),b=T.indexOf(t2);
 if(a<0)throw new Error(`team not in ${g}: ${t1}`);if(b<0)throw new Error(`team not in ${g}: ${t2}`);
 for(let i=0;i<6;i++){const[x,y]=FX[i];if((x===a&&y===b)||(x===b&&y===a))return {i,swap:!(x===a&&y===b)};}
 throw new Error(`no FX pair for ${g}: ${t1} v ${t2}`);}
function toSGT(date,utc){const[mon,day]=date.split(' ');const[H,Mi]=utc.split(':').map(Number);
 const d=new Date(Date.UTC(2026,MON[mon],+day,H+8,Mi));
 let h=d.getUTCHours();const ap=h<12?'am':'pm';let h12=h%12||12;
 return {d:`${MNAME[d.getUTCMonth()]} ${d.getUTCDate()}`,t:`${h12}:${String(d.getUTCMinutes()).padStart(2,'0')}${ap} SGT`};}

const T=[
["A","Mexico","South Africa","Jun 11","19:00","Mexico City",[2,0]],["A","Korea Republic","Czechia","Jun 12","02:00","Guadalajara",[2,1]],["A","Czechia","South Africa","Jun 18","16:00","Atlanta",null],["A","Mexico","Korea Republic","Jun 19","01:00","Guadalajara",null],["A","Czechia","Mexico","Jun 25","01:00","Mexico City",null],["A","South Africa","Korea Republic","Jun 25","01:00","Monterrey",null],
["B","Canada","Bosnia and Herzegovina","Jun 12","19:00","Toronto",[1,1]],["B","Qatar","Switzerland","Jun 13","19:00","SF Bay Area",null],["B","Switzerland","Bosnia and Herzegovina","Jun 18","19:00","Los Angeles",null],["B","Canada","Qatar","Jun 18","22:00","Vancouver",null],["B","Switzerland","Canada","Jun 24","19:00","Vancouver",null],["B","Bosnia and Herzegovina","Qatar","Jun 24","19:00","Seattle",null],
["C","Brazil","Morocco","Jun 13","22:00","New York/NJ",null],["C","Haiti","Scotland","Jun 14","01:00","Boston",null],["C","Scotland","Morocco","Jun 19","22:00","Boston",null],["C","Brazil","Haiti","Jun 20","00:30","Philadelphia",null],["C","Scotland","Brazil","Jun 24","22:00","Miami",null],["C","Morocco","Haiti","Jun 24","22:00","Atlanta",null],
["D","United States","Paraguay","Jun 13","01:00","Los Angeles",[4,1]],["D","Turkiye","Australia","Jun 14","04:00","Vancouver",null],["D","United States","Australia","Jun 19","19:00","Seattle",null],["D","Turkiye","Paraguay","Jun 20","03:00","SF Bay Area",null],["D","Turkiye","United States","Jun 26","02:00","Los Angeles",null],["D","Paraguay","Australia","Jun 26","02:00","SF Bay Area",null],
["E","Germany","Curacao","Jun 14","17:00","Houston",null],["E","Ivory Coast","Ecuador","Jun 14","23:00","Philadelphia",null],["E","Germany","Ivory Coast","Jun 20","20:00","Toronto",null],["E","Ecuador","Curacao","Jun 21","00:00","Kansas City",null],["E","Ecuador","Germany","Jun 25","20:00","New York/NJ",null],["E","Curacao","Ivory Coast","Jun 25","20:00","Philadelphia",null],
["F","Netherlands","Japan","Jun 14","20:00","Dallas",null],["F","Sweden","Tunisia","Jun 15","02:00","Monterrey",null],["F","Netherlands","Sweden","Jun 20","17:00","Houston",null],["F","Tunisia","Japan","Jun 21","04:00","Monterrey",null],["F","Japan","Sweden","Jun 25","23:00","Dallas",null],["F","Tunisia","Netherlands","Jun 25","23:00","Kansas City",null],
["G","Belgium","Egypt","Jun 15","19:00","Seattle",null],["G","Iran","New Zealand","Jun 16","01:00","Los Angeles",null],["G","Belgium","Iran","Jun 21","19:00","Los Angeles",null],["G","New Zealand","Egypt","Jun 22","01:00","Vancouver",null],["G","Egypt","Iran","Jun 27","03:00","Seattle",null],["G","New Zealand","Belgium","Jun 27","03:00","Vancouver",null],
["H","Spain","Cape Verde","Jun 15","16:00","Atlanta",null],["H","Saudi Arabia","Uruguay","Jun 15","22:00","Miami",null],["H","Spain","Saudi Arabia","Jun 21","16:00","Atlanta",null],["H","Uruguay","Cape Verde","Jun 21","22:00","Miami",null],["H","Cape Verde","Saudi Arabia","Jun 27","00:00","Houston",null],["H","Uruguay","Spain","Jun 27","00:00","Guadalajara",null],
["I","France","Senegal","Jun 16","19:00","New York/NJ",null],["I","Iraq","Norway","Jun 16","22:00","Boston",null],["I","France","Iraq","Jun 22","21:00","Philadelphia",null],["I","Norway","Senegal","Jun 23","00:00","New York/NJ",null],["I","Norway","France","Jun 26","19:00","Boston",null],["I","Senegal","Iraq","Jun 26","19:00","Toronto",null],
["J","Argentina","Algeria","Jun 17","01:00","Kansas City",null],["J","Austria","Jordan","Jun 17","04:00","SF Bay Area",null],["J","Argentina","Austria","Jun 22","17:00","Dallas",null],["J","Jordan","Algeria","Jun 23","03:00","SF Bay Area",null],["J","Algeria","Austria","Jun 28","02:00","Kansas City",null],["J","Jordan","Argentina","Jun 28","02:00","Dallas",null],
["K","Portugal","DR Congo","Jun 17","17:00","Houston",null],["K","Uzbekistan","Colombia","Jun 18","02:00","Mexico City",null],["K","Portugal","Uzbekistan","Jun 23","17:00","Houston",null],["K","Colombia","DR Congo","Jun 24","02:00","Guadalajara",null],["K","Colombia","Portugal","Jun 27","23:30","Miami",null],["K","DR Congo","Uzbekistan","Jun 27","23:30","Atlanta",null],
["L","England","Croatia","Jun 17","20:00","Dallas",null],["L","Ghana","Panama","Jun 17","23:00","Toronto",null],["L","England","Ghana","Jun 23","20:00","Boston",null],["L","Panama","Croatia","Jun 23","23:00","Toronto",null],["L","Panama","England","Jun 27","21:00","New York/NJ",null],["L","Croatia","Ghana","Jun 27","21:00","Philadelphia",null],
];

const sched={},seedResults={},seen=new Set();
for(const [g,t1,t2,date,utc,venue,score] of T){
 const {i,swap}=fxIndex(g,t1,t2);const id=`g_${g}_${i}`;
 if(seen.has(id))throw new Error('duplicate '+id);seen.add(id);
 const s=toSGT(date,utc);sched[id]={d:s.d,t:s.t,v:venue};
 if(score)seedResults[id]=swap?[score[1],score[0]]:score;}
for(const g of Object.keys(groups))for(let i=0;i<6;i++)if(!sched[`g_${g}_${i}`])throw new Error('missing g_'+g+'_'+i);

// merge: keep results already recorded in data.json, over the baked seed
let results={...seedResults};let asof=ASOF;
if(existsSync(FILE)){const prev=JSON.parse(readFileSync(FILE,'utf8'));results={...seedResults,...(prev.results||{})};if(prev.asof)asof=prev.asof;}
for(const id of Object.keys(results))if(!(id in sched))throw new Error('orphan result '+id);

const r=Object.entries(results).map(([k,v])=>`  ${JSON.stringify(k)}: [${v[0]}, ${v[1]}]`).join(',\n');
const ss=Object.entries(sched).map(([k,v])=>`  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n');
const out=`{\n "asof": ${JSON.stringify(asof)},\n "results": {\n${r}\n },\n "sched": {\n${ss}\n }\n}\n`;
JSON.parse(out);
if(process.argv.includes('--dry')){process.stdout.write(out);}else{writeFileSync(FILE,out);console.log(`wrote data.json — ${Object.keys(sched).length} fixtures, ${Object.keys(results).length} results, asof "${asof}"`);}
