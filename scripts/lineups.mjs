// Apply an ingested match lineup to a team's profile: tally national-team appearances
// (starting XI / sub) per fixture, and AUTO-CLEAR injuries — a player who actually started or
// came on can't still be "out", so they're removed from the team's `outs`. This is the FACTUAL
// half of profile upkeep (from ESPN), distinct from the LLM routine's judgment (scouting/form notes).

// Accent/punctuation-insensitive name match so "Rúben Dias" == "Ruben Dias".
export const normName = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();

// name tokens minus generational suffixes, for a conservative subset match
// ("Vinícius Júnior" ⊇ "Vinicius Jr" → same; "Alisson Becker" ⊇ "Alisson" → same).
const NAME_SUFFIX = new Set(['jr', 'junior', 'sr', 'snr', 'filho', 'neto', 'ii', 'iii']);
const nameToks = s => normName(s).split(' ').filter(t => t && !NAME_SUFFIX.has(t));
export function sameName(a, b) {
  const A = nameToks(a), B = nameToks(b); if (!A.length || !B.length) return false;
  const sa = new Set(A), sb = new Set(B);
  return A.every(t => sb.has(t)) || B.every(t => sa.has(t));   // one token-set ⊆ the other
}

// Mutates profiles[teamName]. lineup.starters/subs may be name strings OR {name,num,pos,abbr}.
// Identity priority: jersey number (reliable) → exact name → UNIQUE suffix-stripped subset.
// Fills in jersey/position when missing. Returns {added, cleared:[names]}.
export function applyLineup(profiles, teamName, fxid, lineup) {
  const p = profiles[teamName]; if (!p) return { added: 0, cleared: [] };   // only known teams
  p.squad = p.squad || [];
  const findOrAdd = raw => {
    const pl = typeof raw === 'string' ? { name: raw } : raw;
    const nn = normName(pl.name);
    let s = null;
    if (pl.num) s = p.squad.find(x => x.no != null && x.no !== '' && String(x.no) === String(pl.num));  // jersey number
    if (!s) s = p.squad.find(x => normName(x.name) === nn);                                              // exact name
    if (!s) { const cands = p.squad.filter(x => sameName(x.name, pl.name)); if (cands.length === 1) s = cands[0]; } // unique subset
    if (!s) { s = { name: pl.name }; p.squad.push(s); }                     // genuinely new player
    if (pl.num && (s.no == null || s.no === '')) s.no = pl.num;             // backfill jersey
    if (pl.pos && !s.pos) s.pos = pl.pos;                                   // backfill position group
    return s;
  };
  const appeared = [];
  const nameOf = raw => typeof raw === 'string' ? raw : raw.name;
  for (const raw of (lineup.starters || [])) {
    const s = findOrAdd(raw);
    s.xiM = s.xiM || []; if (!s.xiM.includes(fxid)) s.xiM.push(fxid);       // started this match
    s.natXI = true;
    if (s.subM) s.subM = s.subM.filter(m => m !== fxid);                     // start & sub are exclusive per match
    appeared.push(nameOf(raw));
  }
  for (const raw of (lineup.subs || [])) {
    const s = findOrAdd(raw);
    if (!(s.xiM && s.xiM.includes(fxid))) { s.subM = s.subM || []; if (!s.subM.includes(fxid)) s.subM.push(fxid); }
    appeared.push(nameOf(raw));
  }
  // injury auto-clear: whoever appeared is demonstrably available
  const appNN = new Set(appeared.map(normName));
  const cleared = [];
  if (Array.isArray(p.outs) && p.outs.length) {
    p.outs = p.outs.filter(o => { const hit = appNN.has(normName(o.name)); if (hit) cleared.push(o.name); return !hit; });
  }
  return { added: appeared.length, cleared };
}

// Per-player minutes for one team in a match. lineup = {starters,subs} (strings or objects),
// teamSubs = [{on,off,min}] for THIS team. Starter not subbed = full match; subbed off at m;
// sub on at m → matchLen−m. Returns { playerName: minutes }.
export function computeMinutes(lineup, teamSubs, matchLen = 90) {
  const offMin = {}, onMin = {};
  for (const s of (teamSubs || [])) { if (s.off) offMin[normName(s.off)] = s.min; if (s.on) onMin[normName(s.on)] = s.min; }
  const nameOf = raw => typeof raw === 'string' ? raw : raw.name;
  const mins = {};
  for (const raw of (lineup.starters || [])) { const name = nameOf(raw); const off = offMin[normName(name)]; mins[name] = (off != null ? off : matchLen); }
  for (const raw of (lineup.subs || [])) { const name = nameOf(raw); const on = onMin[normName(name)]; mins[name] = (on != null ? Math.max(0, matchLen - on) : 0); }
  return mins;
}

// Tally a match's goalscorers into player profiles (idempotent per fixture, marked src:'auto' so it
// never clashes with the routine's narrative --log). Own goals are skipped (the scorer is an opponent).
// plAgg sums log[].g, so this surfaces "3G" etc. on the squad list. Returns goals credited to players.
export function applyGoals(profiles, teamName, fxid, opponent, goals) {
  const p = profiles[teamName]; if (!p) return 0;
  p.squad = p.squad || [];
  const tally = {};
  for (const g of (goals || [])) { if (g.team !== teamName || g.og) continue; tally[g.scorer] = (tally[g.scorer] || 0) + 1; }
  let changed = false;
  for (const [scorer, cnt] of Object.entries(tally)) {
    const nn = normName(scorer);
    let s = p.squad.find(x => normName(x.name) === nn); if (!s) { s = { name: scorer }; p.squad.push(s); }
    s.log = s.log || [];
    let e = s.log.find(x => x.m === fxid && x.src === 'auto'); if (!e) { e = { m: fxid, vs: opponent, src: 'auto' }; s.log.push(e); changed = true; }
    if (e.g !== cnt) { e.g = cnt; changed = true; }
  }
  return changed;   // only true on a real change → no spurious commits when re-run idempotently
}

// Recent W/D/L form per team from recorded GROUP results, chronological (most-recent last, last 5) —
// matches teamstatus.mjs's slice(-5). Returns {team: "WDLWW"}. A fact, so the cron owns it, not the routine.
export function computeForm(D, data) {
  const results = data.results || {}, sched = data.sched || {};
  const FX = [[0, 1], [2, 3], [0, 2], [1, 3], [0, 3], [1, 2]];
  const MON = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  const dv = s => { if (!s || !s.d) return 0; const m = s.d.match(/([A-Za-z]{3})\s+(\d+)/); return m ? (MON[m[1]] || 0) * 100 + (+m[2]) : 0; };
  const rec = {};
  for (const g of Object.keys(D.groups)) for (let i = 0; i < 6; i++) {
    const id = 'g_' + g + '_' + i, sc = results[id]; if (!sc) continue;
    const pr = FX[i], home = D.groups[g][pr[0]], away = D.groups[g][pr[1]], dt = dv(sched[id]);
    (rec[home] = rec[home] || []).push({ dt, r: sc[0] > sc[1] ? 'W' : sc[0] < sc[1] ? 'L' : 'D' });
    (rec[away] = rec[away] || []).push({ dt, r: sc[1] > sc[0] ? 'W' : sc[1] < sc[0] ? 'L' : 'D' });
  }
  const out = {};
  for (const t in rec) { rec[t].sort((a, b) => a.dt - b.dt); out[t] = rec[t].map(x => x.r).join('').slice(-5); }
  return out;
}
