#!/usr/bin/env node
// Merge duplicate squad entries created by the OLD lineup ingestion (which keyed on name
// only, so ESPN spellings like "Vinícius Júnior"/"Alisson Becker"/"Danilo" became NEW
// rows separate from curated "Vinicius Jr" #7 / "Alisson" #1 / "Danilo Luiz" #13). After
// the jersey-number ingestion fix + a `backfill_lineups --reapply`, every truly-appearing
// player has a jersey number; the leftover numberless rows are stale duplicates. This:
//   - merges each numberless orphan into its UNIQUE numbered counterpart (by suffix-stripped
//     name-subset), combining appearances + log + filling missing fields, then drops it;
//   - drops a pure-auto orphan (no curated role/club/note) whose appearances are already
//     re-homed onto numbered entries (ambiguous first-names like a 3rd "Danilo");
//   - keeps anything it can't safely resolve (and logs it).
// Idempotent: a clean squad has no orphans, so it's a no-op. Safe to run every cron.
//
//   node scripts/dedupe_squads.mjs [--dry]
import {readData, writeData} from './datafile.mjs';
import {normName, sameName} from './lineups.mjs';

const dry = process.argv.includes('--dry');
const d = readData();
const curated = e => !!(e.role || e.club || e.note || e.style);   // has scouting → never auto-drop
const uniq = a => [...new Set(a || [])];
const apps = e => new Set([...(e.xiM || []), ...(e.subM || [])]);
const surname = n => { const t = normName(n).split(' ').filter(Boolean); return t[t.length - 1] || ''; };
const sortedToks = n => normName(n).split(' ').filter(Boolean).sort().join(' ');
function lev(a, b) { const m = a.length, n = b.length, dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]); for (let j = 0; j <= n; j++) dp[0][j] = j; for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return dp[m][n]; }
// numbered N and numberless O are the same player if names subset-match, OR (when O actually
// appeared) they share a fixture AND the names are close — same surname, same tokens in any
// order (Korean "Lee Gi-Hyuk"), or a ≤2-char spelling variant ("Marwan"/"Marawan", "Ko"/"Kou").
function likelySame(n, o) {
  if (sameName(n.name, o.name)) return true;
  const oa = apps(o); if (!oa.size) return false;
  const na = apps(n); if (![...oa].some(f => na.has(f))) return false;   // must share a match
  return surname(n.name) === surname(o.name) || sortedToks(n.name) === sortedToks(o.name) || lev(normName(n.name), normName(o.name)) <= 2;
}

function mergeInto(target, orphan) {
  target.xiM = uniq([...(target.xiM || []), ...(orphan.xiM || [])]);
  target.subM = uniq([...(target.subM || []), ...(orphan.subM || [])]).filter(m => !target.xiM.includes(m));
  if (orphan.natXI) target.natXI = true;
  // carry log entries we don't already have (match on m+src for auto, else by note)
  const have = new Set((target.log || []).map(x => (x.m || '') + '|' + (x.src || '') + '|' + (x.note || '')));
  for (const e of (orphan.log || [])) { const k = (e.m || '') + '|' + (e.src || '') + '|' + (e.note || ''); if (!have.has(k)) { (target.log = target.log || []).push(e); have.add(k); } }
  for (const f of ['pos', 'club', 'role', 'note', 'style', 'clubMin', 'clubAvail']) if (target[f] == null && orphan[f] != null) target[f] = orphan[f];
}

let merged = 0, dropped = 0, kept = 0;
for (const [team, p] of Object.entries(d.profiles || {})) {
  const squad = p.squad || []; if (!squad.length) continue;
  const numbered = squad.filter(e => e.no != null && e.no !== '');
  const orphans = squad.filter(e => (e.no == null || e.no === ''));
  const remove = new Set();
  for (const o of orphans) {
    if (numbered.includes(o)) continue;
    const targets = numbered.filter(n => likelySame(n, o) && !remove.has(n));
    if (targets.length === 1) { mergeInto(targets[0], o); remove.add(o); merged++; console.log(`merge ${team}: "${o.name}" → "${targets[0].name}" #${targets[0].no}`); }
    else if (targets.length > 1 && !curated(o)) { remove.add(o); dropped++; console.log(`drop  ${team}: "${o.name}" (ambiguous; apps re-homed on #${targets.map(t => t.no).join('/#')})`); }
    else if (!curated(o) && !(o.xiM || []).length && !(o.subM || []).length) { remove.add(o); dropped++; console.log(`drop  ${team}: "${o.name}" (empty auto entry)`); }
    else { kept++; console.log(`keep  ${team}: "${o.name}" (no unique numbered match; left as-is)`); }
  }
  if (remove.size) p.squad = squad.filter(e => !remove.has(e));
}

console.log(`\nmerged ${merged}, dropped ${dropped}, kept ${kept}`);
if (merged || dropped) {
  if (!dry) { writeData(d); console.log('wrote data.json'); } else console.log('[dry] would write data.json');
} else console.log('no duplicates — nothing to do');
