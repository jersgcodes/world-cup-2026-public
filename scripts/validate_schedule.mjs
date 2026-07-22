#!/usr/bin/env node
// Cross-checks our schedule (kickoff date + time, SGT) against openfootball's kickoffs,
// flagging mismatches — the class of bug behind Mexico v Korea being 11am instead of
// 9am SGT. No API key. Exit non-zero on any mismatch (so CI flags it).
//
//   node scripts/validate_schedule.mjs
import {readData, parseD} from './datafile.mjs';
import {makeCanon, findFx, fetchOpenfootball, parseOFtime, fmtSGT} from './fdmap.mjs';

const D = parseD(), d = readData();
const canon = makeCanon([].concat(...Object.values(D.groups)));
const matches = await fetchOpenfootball().catch(e => { console.error(e.message); process.exit(1); });

let issues = 0, checked = 0;
for (const m of matches) {
  const t1 = canon(m.team1), t2 = canon(m.team2);
  if (!t1 || !t2) continue;
  const fx = findFx(t1, t2, D); if (!fx) continue;
  const our = d.sched[fx.id]; if (!our || !m.date || !m.time) continue;
  const ms = parseOFtime(m.date, m.time); if (isNaN(ms)) continue;
  checked++;
  const sgt = fmtSGT(ms);
  if (our.d !== sgt.d || our.t !== sgt.t) {
    issues++;
    console.log(`MISMATCH ${fx.id}  ${t1} v ${t2}:  ours "${our.d} ${our.t}"  |  openfootball "${sgt.d} ${sgt.t}"`);
  }
}
console.log(issues
  ? `\n${issues} schedule mismatch(es) of ${checked} checked — fix build_schedule.mjs + data.json sched.`
  : `OK: all ${checked} checked fixtures match openfootball kickoffs.`);
process.exit(issues ? 1 : 0);
