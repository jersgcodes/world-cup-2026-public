#!/usr/bin/env node
// Deterministic results fetcher for the GitHub Actions cron. Pulls match data from
// openfootball/worldcup.json (public domain, NO key / NO signup), maps each to our
// fixture id, and writes data.json: results + half-time score + ordered goalscorers.
// No LLM, no scraping, no account. Writes only when something actually changed, so a
// no-new-results run produces no commit.
//
//   node scripts/fetch_results.mjs [--dry]
import {readData, writeData, parseD} from './datafile.mjs';
import {makeCanon, findFx, fetchOpenfootball} from './fdmap.mjs';
import {resolveBracket, mapKnockoutMatch, addGoals, findKo, KO_ROUNDS, thirdAssignment} from './bracket.mjs';
import {fetchESPN, espnDates, fetchESPNSummary, parseESPNLineups, parseESPNSubs} from './espn.mjs';
import {applyLineup, applyGoals, computeForm, computeMinutes} from './lineups.mjs';
import {readFileSync} from 'fs';
// FIFA's official 495-row third-place → R32 slot table (Annex C). Used to slot the 8 best thirds
// exactly per the published combination, instead of the old greedy guess.
let THIRDS_TABLE = {}; try { THIRDS_TABLE = JSON.parse(readFileSync(new URL('../thirds_combinations.json', import.meta.url))); } catch (e) { console.error('thirds table:', e.message); }

const dry = process.argv.includes('--dry');
const D = parseD(), d = readData();
const canon = makeCanon([].concat(...Object.values(D.groups)));
// ESPN is the PRIMARY source (fast, near-real-time); openfootball is the fallback that backfills
// history outside ESPN's rolling window. Process openfootball FIRST then ESPN LAST so ESPN WINS on
// any conflict, while openfootball still provides older matches ESPN no longer lists. Either source
// failing is tolerated; both failing aborts.
const of = await fetchOpenfootball().catch(e => { console.error('openfootball:', e.message); return []; });
const espn = await fetchESPN(espnDates(Date.now())).catch(e => { console.error('espn:', e.message); return []; });
if (!espn.length && !of.length) { console.error('no results source reachable (ESPN + openfootball both failed)'); process.exit(1); }
console.log(`sources: ESPN ${espn.length} match(es, primary) + openfootball ${of.length} match(es, backfill)`);
const matches = [...of, ...espn];

const J = x => JSON.stringify(x);
d.matchStats = d.matchStats || {};
let dirty = false; const unmapped = new Set(); let skipped = 0;

for (const m of matches) {
  if (!m.score || !m.score.ft) continue;                 // not played yet
  const t1 = canon(m.team1), t2 = canon(m.team2);
  if (!t1) unmapped.add(m.team1); if (!t2) unmapped.add(m.team2);
  if (!t1 || !t2) continue;
  const fx = findFx(t1, t2, D);
  if (!fx) { skipped++; continue; }                      // knockout / not a tracked group fixture
  const home1 = fx.home === t1;
  const ft = home1 ? [m.score.ft[0], m.score.ft[1]] : [m.score.ft[1], m.score.ft[0]];

  const prev = d.results[fx.id];
  if (!(prev && prev[0] === ft[0] && prev[1] === ft[1])) {
    d.results[fx.id] = ft; dirty = true;
    console.log(`${prev ? 'update' : 'set'} ${fx.id}  ${t1} ${m.score.ft[0]}-${m.score.ft[1]} ${t2}`);
  }
  // HT + goalscorers -> matchStats (enables HT / scorer / team-first-goal settlement too)
  const ms = d.matchStats[fx.id] = d.matchStats[fx.id] || {};
  if (m.score.ht) { const ht = home1 ? [m.score.ht[0], m.score.ht[1]] : [m.score.ht[1], m.score.ht[0]]; if (J(ms.ht) !== J(ht)) { ms.ht = ht; dirty = true; } }
  const goals = [];
  addGoals(goals, m.goals1, t1); addGoals(goals, m.goals2, t2); goals.sort((a, b) => a.min - b.min);
  if (goals.length && J(ms.goals) !== J(goals)) { ms.goals = goals; dirty = true; }
}

// ---- official third-place → R32 slot assignment (once all 12 groups are complete) ----
// Write data.thirds {matchId: group} so resolveBracket here, the app, and the evaluator all slot
// the 8 best thirds EXACTLY per FIFA's table — not the greedy approximation.
{
  const ta = thirdAssignment(D, d, THIRDS_TABLE);
  if (ta && J(d.thirds) !== J(ta)) { d.thirds = ta; dirty = true; console.log('set third-place slots:', Object.entries(ta).map(([m, g]) => `M${m}=3${g}`).join(' ')); }
}

// ---- knockouts: map by the resolved bracket (teams known only once feeders are decided) ----
// Re-resolve each pass so a freshly-recorded round unlocks the next round's team names.
for (let pass = 0; pass < 6; pass++) {
  const M = resolveBracket(D, d);
  let advanced = false;
  for (const m of matches) {
    const u = mapKnockoutMatch(m, M, canon); if (!u) continue;
    const prev = d.results[u.id];
    if (!(prev && prev[0] === u.ft[0] && prev[1] === u.ft[1])) { d.results[u.id] = u.ft; dirty = advanced = true; console.log(`set ${u.id} [KO] ${u.ft[0]}-${u.ft[1]}${u.pens ? ' (pens ' + u.pens + ')' : ''}`); }
    // ESPN gives only the winning side; keep a manually-recorded shoot-out sequence
    // (object {w,kicks}) intact — only overwrite when the winner actually changes.
    if (u.pens) { d.pens = d.pens || {}; const cur = d.pens[u.id]; const curW = typeof cur === 'string' ? cur : (cur && cur.w); if (curW !== u.pens) { d.pens[u.id] = u.pens; dirty = advanced = true; } }
    const ms = d.matchStats[u.id] = d.matchStats[u.id] || {};
    if (u.ht && J(ms.ht) !== J(u.ht)) { ms.ht = u.ht; dirty = true; }
    if (u.goals && J(ms.goals) !== J(u.goals)) { ms.goals = u.goals; dirty = true; }
  }
  if (!advanced) break;   // no new round recorded → bracket can't unlock further this run
}

// ---- lineups + injury auto-clear (ESPN only; one summary call per match, once) ----
// Records starting-XI / sub appearances into profiles and removes from `outs` any player who
// actually played (so returnees stop showing injured). Marked per fixture so it never re-fetches.
d.profiles = d.profiles || {};
{
  const M = resolveBracket(D, d);
  for (const m of espn) {
    if (!m.espnId) continue;
    const t1 = canon(m.team1), t2 = canon(m.team2); if (!t1 || !t2) continue;
    let fxid = null;
    if (KO_ROUNDS.has((m.round || '').toLowerCase())) { const ko = findKo(t1, t2, M); if (ko) fxid = ko.id; }
    else { const f = findFx(t1, t2, D); if (f) fxid = f.id; }
    if (!fxid) continue;
    const ms = d.matchStats[fxid] = d.matchStats[fxid] || {};
    if (ms.lineup) continue;                                  // already ingested for this fixture
    let summary; try { summary = await fetchESPNSummary(m.espnId); } catch (e) { console.error('lineup', fxid, e.message); continue; }
    const lus = parseESPNLineups(summary); if (!lus.length) continue;
    ms.lineup = true; dirty = true;                            // mark done (so we don't re-fetch)
    const subs = parseESPNSubs(summary), mins = {};
    for (const lu of lus) {
      const tn = canon(lu.team); if (!tn) continue;
      const r = applyLineup(d.profiles, tn, fxid, lu);
      Object.assign(mins, computeMinutes(lu, subs.filter(s => canon(s.team) === tn), 90));
      if (r.added || r.cleared.length) console.log(`lineup ${fxid} ${tn}: +${r.added} apps${r.cleared.length ? ', cleared out: ' + r.cleared.join(', ') : ''}`);
    }
    if (Object.keys(mins).length) ms.minutes = mins;
  }
}

// ---- per-player goal tally + team form (facts derived from recorded results; no LLM/routine) ----
{
  const M = resolveBracket(D, d);
  const FXp = [[0, 1], [2, 3], [0, 2], [1, 3], [0, 3], [1, 2]];
  const teamsOf = fxid => {
    if (fxid.startsWith('g_')) { const [, g, i] = fxid.split('_'); const pr = FXp[+i]; return [D.groups[g][pr[0]], D.groups[g][pr[1]]]; }
    const m = M[fxid]; return m ? [m.a, m.b] : [null, null];
  };
  for (const [fxid, ms] of Object.entries(d.matchStats || {})) {
    if (!ms.goals || !ms.goals.length) continue;
    const [ta, tb] = teamsOf(fxid); if (!ta || !tb) continue;
    if (applyGoals(d.profiles, ta, fxid, tb, ms.goals)) dirty = true;
    if (applyGoals(d.profiles, tb, fxid, ta, ms.goals)) dirty = true;
  }
  const form = computeForm(D, d);
  for (const [t, f] of Object.entries(form)) { const p = d.profiles[t]; if (p && p.form !== f) { p.form = f; dirty = true; } }
}

if (unmapped.size) console.error('UNMAPPED teams (add to OF_ALIAS in scripts/fdmap.mjs):', [...unmapped].filter(Boolean).join(', '));
if (skipped) console.log('skipped (knockout / not a group fixture):', skipped);
if (dirty) {
  d.asof = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  if (!dry) { writeData(d); console.log(`\nwrote updates; asof "${d.asof}"`); } else console.log('\n[dry] would write updates');
} else console.log('no changes');
