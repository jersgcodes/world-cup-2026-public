#!/usr/bin/env node
// Staleness monitor: flags group fixtures whose kickoff (+2.5h) has passed but still
// have NO result — i.e. the results pipeline (cron or routine) has likely stalled
// (the failure mode behind the missing Jun 19 results). Exit non-zero if any, so a
// scheduled GitHub Action goes red and emails you.
//
//   node scripts/check_staleness.mjs
import {readData} from './datafile.mjs';
import {overdueFixtures} from './fdmap.mjs';

const d = readData();
const over = overdueFixtures(d.sched || {}, d.results || {}, Date.now());
if (over.length) {
  console.log(`STALE: ${over.length} match(es) finished by now have no result:`);
  for (const o of over) console.log(`  ${o.id}  ${o.d} ${o.t}`);
  console.log('\nResults pipeline may be stuck — check the results cron and the Claude routine.');
  process.exit(1);
}
console.log('OK: every match that should have finished has a result.');
