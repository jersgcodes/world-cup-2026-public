#!/usr/bin/env node
// Backfill ESPN-summary data (starting XIs + box-score stats) for every played match
// the cron's rolling-window pass missed. fetch_results.mjs only ingests lineups inside
// ESPN's yesterday..tomorrow window, and box-score stats are otherwise only added by the
// manual enrichment routine — so many played matches end up with no XI appearances and/or
// no possession/shots/etc. This scans the whole tournament window, fetches each ESPN
// summary ONCE, and fills whatever is missing:
//   - starting-XI / sub appearances into profiles (also clears injuries for players who played)
//   - box-score stats into matchStats[fxid].stats  (poss, sh, sot, cor, fouls, off, sav, pacc)
// Never overwrites stats the enrichment routine already wrote. Idempotent; early-exits with
// zero network calls when nothing is missing.
//
//   node scripts/backfill_lineups.mjs [--dry] [--from 20260611]
import {readData, writeData, parseD} from './datafile.mjs';
import {makeCanon, findFx, FX} from './fdmap.mjs';
import {resolveBracket, findKo, KO_ROUNDS} from './bracket.mjs';
import {fetchESPN, fetchESPNSummary, parseESPNLineups, parseESPNSubs, parseESPNCards} from './espn.mjs';
import {applyLineup, computeMinutes} from './lineups.mjs';

const dry = process.argv.includes('--dry');
const reapply = process.argv.includes('--reapply');  // re-ingest EVERY played fixture (identity fix + minutes)
const fromArg = (() => { const i = process.argv.indexOf('--from'); return i >= 0 ? process.argv[i + 1] : null; })();

const D = parseD(), d = readData();
const canon = makeCanon([].concat(...Object.values(D.groups)));
d.matchStats = d.matchStats || {}; d.profiles = d.profiles || {};

const hasStats = ms => !!(ms && ms.stats && Object.keys(ms.stats).length);
const hasMins = ms => !!(ms && ms.minutes && Object.keys(ms.minutes).length);
const cardsResolved = ms => !!(ms && (ms.cardsDone || (ms.cards && ms.cards.length)));   // enrichment cards win
const needs = id => { const ms = d.matchStats[id] || {}; return reapply || !ms.lineup || !hasStats(ms) || !hasMins(ms) || !cardsResolved(ms); };
const matchLen = fxid => (String(fxid).startsWith('g_') ? 90 : 90);   // group = 90; KO ET handled later

// ESPN box-score statistic name -> our key + value normaliser. *Pct fields ≤1 are fractions.
const STAT_MAP = {
  possessionPct: ['poss', v => Math.round(+v)],
  totalShots: ['sh', v => +v],
  shotsOnTarget: ['sot', v => +v],
  wonCorners: ['cor', v => +v],
  foulsCommitted: ['fouls', v => +v],
  offsides: ['off', v => +v],
  saves: ['sav', v => +v],
  passPct: ['pacc', v => Math.round(+v <= 1 ? +v * 100 : +v)],
};
// our home/away teams for a fixture (group from FX seeding; knockout from the resolved bracket)
function teamsOf(fxid, M) {
  if (fxid.startsWith('g_')) { const [, g, i] = fxid.split('_'); const pr = FX[+i]; return [D.groups[g][pr[0]], D.groups[g][pr[1]]]; }
  const m = M[fxid]; return m ? [m.a, m.b] : [null, null];
}
// parse ESPN boxscore into our {key:[home,away]} oriented to OUR fixture home(a)/away(b)
function parseBox(summary, aTeam, bTeam) {
  const teams = summary?.boxscore?.teams || []; if (teams.length < 2) return null;
  const byTeam = {};
  for (const t of teams) { const tn = canon(t.team?.displayName); if (!tn) continue; const o = {}; for (const s of (t.statistics || [])) { const m = STAT_MAP[s.name]; if (m) o[m[0]] = m[1](s.displayValue); } byTeam[tn] = o; }
  const A = byTeam[aTeam], B = byTeam[bTeam]; if (!A || !B) return null;
  const out = {}; for (const [, [key]] of Object.entries(STAT_MAP)) if (A[key] != null && B[key] != null && !Number.isNaN(A[key]) && !Number.isNaN(B[key])) out[key] = [A[key], B[key]];
  return Object.keys(out).length ? out : null;
}

const backlog = new Set(Object.keys(d.results).filter(needs));
console.log(`played fixtures to process (${reapply ? 'reapply: all' : 'missing XI / box-score / minutes'}): ${backlog.size}`);
if (!backlog.size) { console.log('nothing to backfill'); process.exit(0); }   // free in steady state (no network)

function dateRange() {
  const start = fromArg ? Date.UTC(+fromArg.slice(0, 4), +fromArg.slice(4, 6) - 1, +fromArg.slice(6, 8)) : Date.UTC(2026, 5, 11);
  const end = Date.now() + 864e5, out = [];
  for (let t = start; t <= end; t += 864e5) { const dt = new Date(t); out.push(`${dt.getUTCFullYear()}${String(dt.getUTCMonth() + 1).padStart(2, '0')}${String(dt.getUTCDate()).padStart(2, '0')}`); }
  return out;
}

const espn = await fetchESPN(dateRange());
console.log(`ESPN returned ${espn.length} finished match(es) across the window`);
const M = resolveBracket(D, d);

let dirty = false, xiDone = 0, statDone = 0, minDone = 0, cardDone = 0, noXI = 0;
for (const m of espn) {
  if (!m.espnId) continue;
  const t1 = canon(m.team1), t2 = canon(m.team2); if (!t1 || !t2) continue;
  let fxid = null;
  if (KO_ROUNDS.has((m.round || '').toLowerCase())) { const ko = findKo(t1, t2, M); if (ko) fxid = ko.id; }
  else { const f = findFx(t1, t2, D); if (f) fxid = f.id; }
  if (!fxid || !d.results[fxid]) continue;                  // not a tracked, played fixture
  const ms = d.matchStats[fxid] = d.matchStats[fxid] || {};
  if (!reapply && ms.lineup && hasStats(ms) && hasMins(ms) && cardsResolved(ms)) continue;   // already complete
  let summary; try { summary = await fetchESPNSummary(m.espnId); } catch (e) { console.error('summary', fxid, e.message); continue; }

  if (reapply || !ms.lineup || !hasMins(ms)) {
    const lus = parseESPNLineups(summary);
    if (!lus.length) { if (!ms.lineup) noXI++; }
    else {
      const subs = parseESPNSubs(summary), mins = {};
      for (const lu of lus) {
        const tn = canon(lu.team); if (!tn) continue;
        const r = applyLineup(d.profiles, tn, fxid, lu);                    // XI/sub appearances + identity (jersey/pos)
        const teamSubs = subs.filter(s => canon(s.team) === tn);
        Object.assign(mins, computeMinutes(lu, teamSubs, matchLen(fxid)));  // per-player minutes
        if (r.added || r.cleared.length) console.log(`  XI   ${fxid} ${tn}: +${r.added} apps${r.cleared.length ? ', cleared out: ' + r.cleared.join(', ') : ''}`);
      }
      if (!ms.lineup) { ms.lineup = true; xiDone++; }
      if (Object.keys(mins).length && JSON.stringify(ms.minutes) !== JSON.stringify(mins)) { ms.minutes = mins; minDone++; }
      dirty = true;
    }
  }
  if (reapply || !hasStats(ms)) {
    const [aTeam, bTeam] = teamsOf(fxid, M);
    const bx = aTeam && bTeam ? parseBox(summary, aTeam, bTeam) : null;
    if (bx && JSON.stringify(ms.stats) !== JSON.stringify(bx)) { ms.stats = bx; dirty = true; statDone++; console.log(`  stat ${fxid}: ${Object.keys(bx).join(', ')}`); }
  }
  if (!cardsResolved(ms)) {   // never overwrite enrichment cards; a `cardsDone` flag stops card-free matches re-fetching
    const [aTeam, bTeam] = teamsOf(fxid, M);
    const cards = parseESPNCards(summary).map(c => ({ team: canon(c.team), type: c.type, player: c.player })).filter(c => c.team === aTeam || c.team === bTeam);
    if (cards.length) { ms.cards = cards; cardDone++; console.log(`  card ${fxid}: ${cards.length} (${cards.filter(c => c.type === 'r').length} red)`); }
    ms.cardsDone = true; dirty = true;
  }
}

console.log(`\nbackfilled ${xiDone} XI + ${statDone} box-score + ${minDone} minutes + ${cardDone} cards; ${noXI} had no XI posted yet`);
if (dirty) {
  d.asof = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  if (!dry) { writeData(d); console.log(`wrote data.json; asof "${d.asof}"`); } else console.log('[dry] would write data.json');
} else console.log('nothing written');
