#!/usr/bin/env node
// Writes growing per-country profiles into data.json's "profiles" block — playing
// style, physical traits, key players, and dated scouting notes that accumulate
// as the tournament goes. Meant to be driven by the daily routine (researched
// online + learned from matches) but usable by hand.
//
//   node scripts/update_profiles.mjs "Spain" \
//     --style "Possession & positional play; high line; relentless rest-defence." \
//     --form "WWWDW" \
//     --physical "Press:high; Pace:high; Set-pieces:medium" \
//     --players "Pedri:CM:tempo; Lamine Yamal:RW:1v1 threat" \
//     --note "Controlled 70%+ possession in opener; vulnerable to pace in behind." \
//     --source "https://espn.com/..." --asof "27 Jun 2026"
//
// Flags (all optional except the country):
//   --style "…"        set the one-line style summary
//   --form "WWDLW"     set a recent-form string
//   --physical "k:v; k2:v2"   merge physical traits (key:value pairs)
//   --players "Name:role:note; …"   replace the key-players list
//   --note "…"         append a dated observation (newest kept)
//   --source "url"     add a source (deduped)
//   --asof "D Mon YYYY"   set the profile's "updated" label + data.json asof
//   --clear            remove this country's profile entirely
import {readData,writeData,parseD} from './datafile.mjs';

const D=parseD();
const TEAMS=new Set([].concat(...Object.values(D.groups)));

const argv=process.argv.slice(2);
if(!argv.length){console.error('usage: update_profiles.mjs "<Country>" [--style …] [--form …] [--physical "k:v;…"]\n  [--players "Name:role:note;…"] [--squad "Name:POS:Club;…"] [--log "Player | vs Opp | min:90; g:1; spd:34.1; dist:11.2; note:…"]\n  [--note …] [--source url] [--asof "D Mon YYYY"] [--clear]');process.exit(1);}
const country=argv[0];
if(!TEAMS.has(country)){console.error('unknown country (must match index.html exactly):',country,'\nvalid e.g.:','Korea Republic, United States, Cape Verde, …');process.exit(1);}
const opt={};for(let i=1;i<argv.length;i++){const a=argv[i];if(a.startsWith('--'))opt[a.slice(2)]=(i+1<argv.length&&!argv[i+1].startsWith('--'))?argv[++i]:true;}

const d=readData();d.profiles=d.profiles||{};
if(opt.clear){delete d.profiles[country];writeData(d);console.log('cleared profile:',country);process.exit(0);}
const p=d.profiles[country]||{};
if(opt.style)p.style=opt.style;
if(opt.form)p.form=opt.form;
if(opt.physical){p.physical=p.physical||{};opt.physical.split(';').forEach(kv=>{const[k,...v]=kv.split(':');if(k&&k.trim())p.physical[k.trim()]=v.join(':').trim();});}
if(opt.players){p.players=opt.players.split(';').map(s=>s.trim()).filter(Boolean).map(s=>{const[name,role,...note]=s.split(':');return {name:(name||'').trim(),role:(role||'').trim(),note:note.join(':').trim()};});}
// --squad "Name:POS:Club; …" sets the roster (POS = GK/DEF/MID/FWD), preserving any per-player match logs already collected
if(opt.squad){const prev=Object.fromEntries((p.squad||[]).map(x=>[x.name,x.log||[]]));
 p.squad=opt.squad.split(';').map(s=>s.trim()).filter(Boolean).map(s=>{const[name,pos,...club]=s.split(':');const nm=(name||'').trim();return {name:nm,pos:(pos||'').trim().toUpperCase(),club:club.join(':').trim(),log:prev[nm]||[]};});}
// --log "Player | vs Opponent | min:90; g:1; a:0; spd:34.1; dist:11.2; sprint:28; note:…" appends one match to that player's log
if(opt.log){const[pname,vs,kvs]=opt.log.split('|').map(s=>(s||'').trim());
 p.squad=p.squad||[];let pl=p.squad.find(x=>x.name.toLowerCase()===(pname||'').toLowerCase());
 if(!pl){const sn=(pname||'').toLowerCase().split(' ').pop();
  const near=p.squad.filter(x=>{const xn=x.name.toLowerCase();return sn&&(xn.includes(sn)||xn.split(' ').pop()===sn);}).map(x=>x.name);
  console.error(`--log: "${pname}" is not in ${country}'s squad — use the EXACT squad name (a mismatch would create a phantom player and misattribute the stats)`+(near.length?`. Did you mean: ${near.join(' / ')}?`:`. Load the roster first with --squad.`));process.exit(1);}
 const e={vs:vs||''};(kvs||'').split(';').forEach(kv=>{const[k,...v]=kv.split(':');if(k&&k.trim())e[k.trim()]=v.join(':').trim();});
 e.on=typeof opt.asof==='string'?opt.asof:new Date().toISOString().slice(0,10);
 pl.log=pl.log||[];pl.log.push(e);}
// --outs "Name:reason; …" sets unavailable players (injuries/suspensions); --outs "" clears
if(opt.outs!==undefined){p.outs=(opt.outs===true||!String(opt.outs).trim())?[]:String(opt.outs).split(';').map(s=>s.trim()).filter(Boolean).map(s=>{const[name,...note]=s.split(':');return {name:(name||'').trim(),note:note.join(':').trim()};});}
// --natxi "Name; Name; …" flags the national-team starting XI (true for listed, false for the rest); "" clears
if(opt.natxi!==undefined){const names=(opt.natxi===true?'':String(opt.natxi)).split(';').map(s=>s.trim().toLowerCase()).filter(Boolean);
 p.squad=p.squad||[];p.squad.forEach(pl=>{pl.natXI=names.includes(pl.name.toLowerCase());});}
// --xi "<matchid>|Name; Name; … (the 11)" records a match's starting XI: sets natXI (current XI)
// AND tallies a WC start per listed player, keyed by match id (idempotent — re-runs don't double count)
if(opt.xi!==undefined&&opt.xi!==true){const [mid,ns]=String(opt.xi).split('|');const matchid=(mid||'').trim();
 const lc=(ns||'').split(';').map(s=>s.trim().toLowerCase()).filter(Boolean);
 p.squad=p.squad||[];p.squad.forEach(pl=>{const isXI=lc.includes(pl.name.toLowerCase());pl.natXI=isXI;
  if(isXI&&matchid){pl.xiM=pl.xiM||[];if(!pl.xiM.includes(matchid))pl.xiM.push(matchid);pl.subM=(pl.subM||[]).filter(m=>m!==matchid);}});}
// --subs "<matchid>|Name; Name; …" tallies a SUB appearance per listed player (came off the bench);
// mutually exclusive with starts — a match counts as a start OR a sub, never both
if(opt.subs!==undefined&&opt.subs!==true){const [mid,ns]=String(opt.subs).split('|');const matchid=(mid||'').trim();
 const lc=(ns||'').split(';').map(s=>s.trim().toLowerCase()).filter(Boolean);
 p.squad=p.squad||[];p.squad.forEach(pl=>{if(matchid&&lc.includes(pl.name.toLowerCase())){pl.subM=pl.subM||[];if(!pl.subM.includes(matchid))pl.subM.push(matchid);pl.xiM=(pl.xiM||[]).filter(m=>m!==matchid);}});}
// --clubmins "Name:played/available; …" sets club-season minutes; the app shows played÷available as the Club %
if(opt.clubmins!==undefined&&opt.clubmins!==true){const m={};
 String(opt.clubmins).split(';').map(s=>s.trim()).filter(Boolean).forEach(s=>{const[name,pa]=s.split(':');const[pl,av]=(pa||'').split('/').map(n=>parseInt(n,10));if(name&&av>0)m[name.trim().toLowerCase()]={pl:pl||0,av};});
 p.squad=p.squad||[];p.squad.forEach(pl=>{const v=m[pl.name.toLowerCase()];if(v){pl.clubMin=v.pl;pl.clubAvail=v.av;}});}
// --units "gk:7; def:8; mid:9; atk:8" sets 0-10 unit ratings (any of gk/def/mid/atk); --units-src to tag
if(opt.units!==undefined&&opt.units!==true){p.units=p.units||{};String(opt.units).split(';').map(s=>s.trim()).filter(Boolean).forEach(kv=>{const[k,v]=kv.split(':');const key=(k||'').trim().toLowerCase();if(['gk','def','mid','atk'].includes(key)&&v!=null&&v.trim()!==''){p.units[key]=Math.max(0,Math.min(10,+v));}});if(opt['units-src'])p.units.src=opt['units-src'];}
if(opt.note){p.notes=p.notes||[];p.notes.push(opt.note);if(p.notes.length>12)p.notes=p.notes.slice(-12);}
if(opt.source){p.sources=p.sources||[];if(!p.sources.includes(opt.source))p.sources.push(opt.source);}
const asof=typeof opt.asof==='string'?opt.asof:null;
p.updated=asof||p.updated||new Date().toISOString().slice(0,10);
if(asof)d.asof=asof;
d.profiles[country]=p;
writeData(d);
console.log('updated profile:',country,'·',Object.keys(p).filter(k=>k!=='updated').join(', ')||'(meta only)');
