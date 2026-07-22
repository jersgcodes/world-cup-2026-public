// Shared knockout-bracket resolver + openfootball knockout mapping.
// Single source of truth for "which teams are in knockout match <id>" given recorded
// results — used by resolve_bracket.mjs (display/calendar) and fetch_results.mjs (auto-ingest).
// Knockout teams are known only once their feeder matches are decided, so callers that
// ingest results must re-resolve after each round (a recorded R32 unlocks the R16 names).
import {fifaStandings, fifaBestThirds} from './standings.mjs';

export const FX = [[0,1],[2,3],[0,2],[1,3],[0,3],[1,2]];
// the openfootball knockout rounds we track. The third-place playoff (M301) is included:
// its goals count toward tournament totals (totalGoals bet) and the Golden Boot (scorer bets).
export const KO_ROUNDS = new Set(['round of 32','round of 16','quarter-final','semi-final','match for third place','final']);

// Resolve the full bracket from recorded results: id -> {round, a, b} with teams or null.
// Mirrors resolve_bracket.mjs / evaluate_bets.mjs exactly.
export function resolveBracket(D, data, thirdsTable) {
  const results = data.results || {}, pens = data.pens || {}, matchStats = data.matchStats || {}, fifaRank = data.fifaRank;
  const GL = Object.keys(D.groups);
  const groupComplete = g => { for (let k = 0; k < 6; k++) if (!results['g_' + g + '_' + k]) return false; return true; };
  const allGroupsComplete = GL.every(groupComplete);
  const standings = g => fifaStandings(g, { groups: D.groups, results, matchStats, elo: D.elo, fifaRank, fx: FX });
  const bestThirds = () => fifaBestThirds({ groups: D.groups, results, matchStats, elo: D.elo, fifaRank, fx: FX });
  // greedy approximation — last resort only (any combo has MANY valid matchings, so this can mis-slot)
  function greedyThirds() {
    const qualG = bestThirds().slice(0, 8).map(x => x.g), assign = {}, used = {};
    D.R32.forEach(e => [e.a, e.b].forEach(s => { if (s.t !== 'T') return; const pk = qualG.find(g => s.elig.includes(g) && !used[g]); if (pk) { assign[s.slot] = pk; used[pk] = 1; } }));
    return assign;
  }
  // OFFICIAL: a precomputed data.thirds (written by the cron) wins; else the FIFA 495-row table
  // (matchId → group) keyed by the sorted set of qualifying groups; returns {slot: group} or null.
  function tableThirds() {
    const row = (data.thirds && Object.keys(data.thirds).length) ? data.thirds
      : (thirdsTable ? thirdsTable[bestThirds().slice(0, 8).map(x => x.g).sort().join('')] : null);
    if (!row) return null;
    const assign = {};
    D.R32.forEach(e => [e.a, e.b].forEach(s => { if (s.t === 'T' && row[e.m] != null) assign[s.slot] = row[e.m]; }));
    return assign;
  }
  const thirds = allGroupsComplete ? (tableThirds() || greedyThirds()) : {};
  const groupSide = side => {
    if (side.t === 'W') return groupComplete(side.g) ? standings(side.g)[0].t : null;
    if (side.t === 'R') return groupComplete(side.g) ? standings(side.g)[1].t : null;
    if (side.t === 'T') { if (!allGroupsComplete) return null; const g = thirds[side.slot]; return g ? standings(g)[2].t : null; }
    return null;
  };
  const M = {};
  D.R32.forEach(e => { M[e.m] = { round: 'R32', a: groupSide(e.a), b: groupSide(e.b) }; });
  const winnerOf = m => {
    const sc = results[String(m)], t = M[m]; if (!t || t.a == null || t.b == null || !sc) return null;
    if (sc[0] > sc[1]) return t.a; if (sc[1] > sc[0]) return t.b;
    const pv = pens[String(m)], p = typeof pv === 'string' ? pv : (pv && pv.w); // pens value: legacy 'A'|'B' or {w,kicks}
    if (p === 'A') return t.a; if (p === 'B') return t.b; return null;
  };
  // the beaten side of a decided match (used for the third-place playoff feeders)
  const loserOf = m => {
    const w = winnerOf(m), t = M[m]; if (!w || !t) return null;
    return w === t.a ? t.b : t.a;
  };
  const r32ids = D.R32.map(e => e.m);
  D.r16.forEach((p, k) => { M[D.r16m[k]] = { round: 'R16', a: winnerOf(r32ids[p[0]]), b: winnerOf(r32ids[p[1]]) }; });
  D.qf.forEach((p, k) => { M[D.qfm[k]] = { round: 'QF', a: winnerOf(D.r16m[p[0]]), b: winnerOf(D.r16m[p[1]]) }; });
  D.sf.forEach((p, k) => { M[200 + k] = { round: 'SF', a: winnerOf(D.qfm[p[0]]), b: winnerOf(D.qfm[p[1]]) }; });
  M[301] = { round: '3P', a: loserOf(200), b: loserOf(201) };   // third-place playoff (SF losers)
  M[300] = { round: 'F', a: winnerOf(200), b: winnerOf(201) };
  return M;
}

// The OFFICIAL third-place assignment for the CURRENT qualifying combo: {matchId: group}, or null
// (until all 12 groups are complete, or if the table lacks the row). The cron writes this to
// data.thirds so the app + evaluator consume the exact slotting without bundling the 495-row table.
export function thirdAssignment(D, data, thirdsTable) {
  const results = data.results || {};
  const GL = Object.keys(D.groups);
  const gc = g => { for (let k = 0; k < 6; k++) if (!results['g_' + g + '_' + k]) return false; return true; };
  if (!GL.every(gc) || !thirdsTable) return null;
  const bt = fifaBestThirds({ groups: D.groups, results, matchStats: data.matchStats || {}, elo: D.elo, fifaRank: data.fifaRank, fx: FX });
  const key = bt.slice(0, 8).map(x => x.g).sort().join('');
  return thirdsTable[key] ? { ...thirdsTable[key] } : null;
}

// Find our knockout fixture id for a (canonical) team pair, using a resolved bracket.
// Returns {id, home} (home = the team our results array orients to first) or null.
export function findKo(t1, t2, M) {
  for (const id of Object.keys(M)) {
    const m = M[id]; if (!m.a || !m.b) continue;
    if ((m.a === t1 && m.b === t2) || (m.a === t2 && m.b === t1)) return { id, home: m.a };
  }
  return null;
}

// Parse openfootball goal events into our ordered {min,team,scorer,og?,pen?} list.
export function addGoals(out, arr, team) {
  for (const g of (arr || [])) {
    const min = parseInt(g.minute, 10);
    const og = /o\.?\s*g\.?|own goal/i.test(g.name || '');
    const pen = /pen/i.test(g.name || '');
    const scorer = (g.name || '').replace(/\s*\([^)]*\)\s*/g, '').trim();
    out.push({ min: isNaN(min) ? 0 : min, team, scorer, ...(og ? { og: true } : {}), ...(pen ? { pen: true } : {}) });
  }
  return out;
}

// Map one openfootball knockout match to our recordable shape, given a resolved bracket M
// and a name-canonicaliser. Returns {id, ft:[a,b], pens?, ht?, goals?} or null if unmappable
// (teams unknown, not a tracked knockout, or not yet played).
export function mapKnockoutMatch(m, M, canon) {
  if (!m || !m.score || !m.score.ft) return null;
  if (!KO_ROUNDS.has((m.round || '').toLowerCase())) return null;
  const t1 = canon(m.team1), t2 = canon(m.team2); if (!t1 || !t2) return null;
  const fx = findKo(t1, t2, M); if (!fx) return null;
  const home1 = fx.home === t1;
  const sc = m.score.et || m.score.ft;                 // extra-time score if it went to ET
  const ft = home1 ? [sc[0], sc[1]] : [sc[1], sc[0]];
  const out = { id: fx.id, ft };
  const pp = m.score.p || m.score.pen || m.score.penalties;   // penalty shoot-out (only decisive when level)
  if (Array.isArray(pp) && pp.length === 2 && ft[0] === ft[1]) out.pens = ((home1 ? pp[0] > pp[1] : pp[1] > pp[0]) ? 'A' : 'B');
  if (m.score.ht) out.ht = home1 ? [m.score.ht[0], m.score.ht[1]] : [m.score.ht[1], m.score.ht[0]];
  const goals = []; addGoals(goals, m.goals1, t1); addGoals(goals, m.goals2, t2); goals.sort((a, b) => a.min - b.min);
  if (goals.length) out.goals = goals;
  return out;
}
