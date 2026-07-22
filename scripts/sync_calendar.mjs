#!/usr/bin/env node
// Calendar sync for the WC2026 Lab knockout bracket.
//
// Fills REAL TEAM NAMES onto the dedicated "world cup 2026" Google Calendar's
// placeholder knockout events as the bracket locks. It resolves the bracket with
// scripts/resolve_bracket.mjs (recorded RESULTS only — never the Elo projection
// the app shows) and, for every event whose match is now DECIDED, computes the
// new event title. Still-TBD matches keep their placeholder untouched.
//
// WHY IT EMITS A PLAN INSTEAD OF WRITING: the Google Calendar connector is an MCP
// tool available to the Claude Code *session*, not to node. So node can't call
// update_event itself. The flow is:
//   1. The session fetches events (list_events on the WC2026 calendar, ~28 Jun–
//      20 Jul 2026) and saves the JSON (the whole {events:[...]} response, or
//      just the array) to a file.
//   2. node scripts/sync_calendar.mjs --events events.json        # human log + plan
//      node scripts/sync_calendar.mjs --events events.json --json # machine plan only
//      (reads stdin if --events is omitted)
//   3. The session applies each plan entry with update_event(calendarId, eventId,
//      summary). It NEVER creates or deletes events — update-only.
// The plan is idempotent: an event appears only when its title would actually
// change, so re-running after the teams are already set is a no-op.
//
// EVENT -> MATCH-ID MAPPING:
//   - Titles carrying an "M<NN>:" token (R32 M73-M88, R16 M89-M96, QF M97-M100)
//     map by that number; the token is preserved on write so re-runs stay stable.
//   - Semi-finals / Final have no M## in the title, so they map by (date, venue):
//       2026-07-15 Arlington   -> M200 (Semi-final 1)
//       2026-07-16 Atlanta     -> M201 (Semi-final 2)
//       2026-07-20 New Jersey  -> M300 (Final)
//     ASSUMPTION: calendar "Semi-final 1" = resolver's first SF (M200). The app/
//     resolver and this calendar are built from the same official bracket, so the
//     ordinal order lines up — flagged in case the official SF numbering differs.
//   - The 3rd-place playoff has no resolver match id and is left as-is.
//
// CAVEAT (mirrors the app): the 3rd-place -> R32 slot allocation is an
// APPROXIMATION of the FIFA table. resolve_bracket only emits those slots once
// all 12 groups finish; still verify them against the official draw.
import {readFileSync} from 'fs';
import {execFileSync} from 'child_process';
import {fileURLToPath} from 'url';
import {dirname,join} from 'path';

const ROOT=join(dirname(fileURLToPath(import.meta.url)),'..');
// the dedicated "world cup 2026" calendar (override with --calendar)
const CAL_DEFAULT='b48e03540b575d629e86c3227d76b4921965c29a323f0372be18d0230f4bca1d@group.calendar.google.com';

const argv=process.argv.slice(2);
const jsonOnly=argv.includes('--json');
let eventsPath=null,calendarId=CAL_DEFAULT;
for(let i=0;i<argv.length;i++){if(argv[i]==='--events')eventsPath=argv[++i];else if(argv[i]==='--calendar')calendarId=argv[++i];}

// load events (the whole list_events response, or a bare array)
const raw=eventsPath?readFileSync(eventsPath,'utf8'):readFileSync(0,'utf8');
const parsed=JSON.parse(raw);
const events=Array.isArray(parsed)?parsed:(parsed.events||[]);

// resolve the bracket: { "73": {round, a, b}, ... } with team names or null
const M=JSON.parse(execFileSync('node',[join(ROOT,'scripts','resolve_bracket.mjs'),'--json'],{encoding:'utf8'}));

// SF/Final fallback mapping by date+venue (no M## token in those titles)
const BYVENUE={'2026-07-15|Arlington':200,'2026-07-16|Atlanta':201,'2026-07-20|New Jersey':300};
const dateOf=ev=>((ev.start&&(ev.start.dateTime||ev.start.date))||'').slice(0,10);

function matchIdFor(ev){
 const s=ev.summary||'';
 const m=s.match(/\bM(\d+)\b/);
 if(m)return m[1];
 const key=dateOf(ev)+'|'+(ev.location||'');
 return BYVENUE[key]!=null?String(BYVENUE[key]):null;
}
function desiredSummary(ev,a,b){
 const s=ev.summary||'';
 if(/M\d+:/.test(s))return s.replace(/(M\d+:\s*).*/,`$1${a} vs ${b}`);   // keep "… M73: " prefix
 if(/\s—\s/.test(s))return s.replace(/(\s—\s).*/,`$1${a} vs ${b}`);       // SF/Final: replace after the em dash
 return `${s} — ${a} vs ${b}`;
}

const plan=[],skipped=[];
for(const ev of events){
 const id=matchIdFor(ev);
 if(id==null||!(id in M))continue;                       // group stage, 3rd place, or non-KO event
 const mt=M[id];
 if(mt.a==null||mt.b==null){skipped.push({id,round:mt.round,reason:'TBD'});continue;}
 const next=desiredSummary(ev,mt.a,mt.b);
 if(next===ev.summary){skipped.push({id,round:mt.round,reason:'already set'});continue;}
 plan.push({calendarId,eventId:ev.id,matchId:Number(id),round:mt.round,current:ev.summary,new:next});
}

if(jsonOnly){console.log(JSON.stringify(plan,null,1));process.exit(0);}

console.log(`WC2026 calendar sync — ${events.length} events scanned · ${plan.length} to update · ${skipped.length} left as-is\n`);
for(const p of plan){console.log(`UPDATE M${p.matchId} [${p.round}]\n  from: ${p.current}\n    to: ${p.new}\n  event: ${p.eventId}\n`);}
if(!plan.length)console.log('(nothing to update — every decided match already shows its teams)\n');
console.log(`No changes were written by this script. Apply the ${plan.length} update(s) above with`);
console.log(`update_event(calendarId="${calendarId}", eventId, summary="<new title>").`);
