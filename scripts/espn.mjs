// ESPN free scoreboard adapter (no key, near-real-time). Emits matches in the SAME shape
// fetch_results already consumes from openfootball ({team1,team2,round,date,score:{ft,ht,p?},
// goals1,goals2}) so both sources flow through the same findFx / mapKnockoutMatch mapping.
// ESPN is the FAST source (openfootball lags hours); openfootball stays as fallback + corrector.
//
// One scoreboard call per date returns finished matches with `details[]` scoring plays, so we
// get score + scorers + (derived) HT + penalty shoot-outs without any per-match summary call.

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/scoreboard';
const ESPN_SUMMARY = 'https://site.api.espn.com/apis/site/v2/sports/soccer/fifa.world/summary';

// normalise ESPN's stage label to the round strings mapKnockoutMatch expects (KO_ROUNDS),
// or pass through (e.g. "group-stage") so group matches map via findFx instead.
export function normRound(s) {
  const x = (s || '').toLowerCase().replace(/[-_]/g, ' ');
  if (/round of 32|r32|knockout.*32/.test(x)) return 'round of 32';
  if (/round of 16|r16/.test(x)) return 'round of 16';
  if (/quarter/.test(x)) return 'quarter-final';
  if (/semi/.test(x)) return 'semi-final';
  if (/\bfinal\b/.test(x) && !/quarter|semi|round/.test(x)) return 'final';
  return x;
}

// PURE: parse one ESPN scoreboard JSON payload into our match shape. Only FINISHED matches.
export function parseESPNScoreboard(json) {
  const out = [];
  const leagueStage = json?.leagues?.[0]?.season?.type?.name || '';
  for (const ev of (json?.events || [])) {
    const c = (ev.competitions || [])[0]; if (!c) continue;
    const st = c.status?.type || ev.status?.type || {};
    if (!st.completed) continue;                                  // only fully-played matches
    const cs = c.competitors || [];
    const home = cs.find(x => x.homeAway === 'home'), away = cs.find(x => x.homeAway === 'away');
    if (!home || !away || home.score == null || away.score == null) continue;
    const round = normRound(ev.season?.slug || ev.season?.type?.name || leagueStage);
    const goals1 = [], goals2 = []; let p1 = 0, p2 = 0;
    for (const d of (c.details || [])) {
      if (!d.scoringPlay) continue;
      const isHome = d.team?.id === home.team?.id;
      if (d.shootout) { if (isHome) p1++; else p2++; continue; }  // penalty shoot-out, not a match goal
      const min = parseInt((d.clock?.displayValue || '').replace(/[^0-9]/g, ''), 10);
      const nm = (d.athletesInvolved && d.athletesInvolved[0]?.displayName) || '';
      const name = nm + (d.ownGoal ? ' (og)' : '') + (d.penaltyKick ? ' (pen)' : '');
      (isHome ? goals1 : goals2).push({ minute: isNaN(min) ? '' : String(min), name });
    }
    const ft = [Number(home.score), Number(away.score)];
    const ht = [goals1.filter(g => +g.minute <= 45).length, goals2.filter(g => +g.minute <= 45).length];
    const m = { espnId: ev.id, team1: home.team.displayName, team2: away.team.displayName, round, date: (ev.date || '').slice(0, 10), score: { ft, ht } };
    if (goals1.length) m.goals1 = goals1;
    if (goals2.length) m.goals2 = goals2;
    if (p1 || p2) m.score.p = [p1, p2];                           // shoot-out → mapKnockoutMatch reads score.p
    out.push(m);
  }
  return out;
}

// Fetch a set of UTC date strings (YYYYMMDD) and return all finished matches across them.
// A rolling window (yesterday..tomorrow) each run captures freshly-finished matches in any TZ.
export async function fetchESPN(dates) {
  const all = [];
  for (const date of dates) {
    try {
      const r = await fetch(`${ESPN_BASE}?dates=${date}`);
      if (!r.ok) { console.error('ESPN ' + date + ' HTTP ' + r.status); continue; }
      all.push(...parseESPNScoreboard(await r.json()));
    } catch (e) { console.error('ESPN ' + date + ' fetch failed:', e.message); }
  }
  return all;
}

// ESPN position abbreviation (G, RB, CD-L, CM-R, CF, …) -> our squad group GK/DEF/MID/FWD.
export function posGroup(ab) {
  ab = (ab || '').toUpperCase();
  if (!ab) return null;
  if (ab === 'G' || ab.startsWith('GK')) return 'GK';
  if (/^(D$|CD|CB|RB|LB|RWB|LWB|WB|FB|SW)/.test(ab)) return 'DEF';
  if (/^(M$|CM|DM|AM|CDM|CAM|RM|LM|RCM|LCM)/.test(ab)) return 'MID';
  if (/^(F$|ST|CF|RW|LW|SS|W$)/.test(ab)) return 'FWD';
  return null;
}
// clock "67'" / "90'+2'" -> integer minute (adds stoppage)
export function clockMin(s) { const m = (s || '').match(/(\d+)(?:'?\s*\+\s*(\d+))?/); return m ? (+m[1] + (m[2] ? +m[2] : 0)) : null; }

// PURE: parse an ESPN summary payload's rosters into per-team lineups. Each team ->
// {team, formation, starters:[{name,num,abbr,pos}], subs:[…]}. Used to record XI/sub
// appearances + jersey/position (identity), and to auto-clear injuries.
export function parseESPNLineups(summary) {
  const out = [];
  for (const r of (summary?.rosters || [])) {
    const team = r.team?.displayName; if (!team) continue;
    const starters = [], subs = [];
    for (const p of (r.roster || [])) {
      const name = p.athlete?.displayName; if (!name) continue;
      const ab = p.position?.abbreviation || '';
      const e = { name, num: p.jersey != null ? String(p.jersey) : '', abbr: ab, pos: posGroup(ab) };
      if (p.starter) starters.push(e);
      else if (p.subbedIn) subs.push(e);
    }
    if (starters.length || subs.length) out.push({ team, formation: r.formation || '', starters, subs });
  }
  return out;
}

// PURE: bookings from a summary -> [{team, type:'y'|'r', player, min}], one per card event.
// Matches the enrichment convention (y / r only — ESPN logs straight reds; a second yellow is
// rare and the fair-play tiebreak is near-never decisive). Only fills when enrichment hasn't.
export function parseESPNCards(summary) {
  const out = [];
  for (const e of (summary?.keyEvents || [])) {
    const tx = e.type?.text || ''; if (!/card/i.test(tx)) continue;
    const player = (e.participants || [])[0]?.athlete?.displayName || '';
    out.push({ team: e.team?.displayName || '', type: /red/i.test(tx) ? 'r' : 'y', player, min: clockMin(e.clock?.displayValue) });
  }
  return out;
}

// PURE: substitutions from a summary -> [{team, on, off, min}] (on replaces off at `min`).
export function parseESPNSubs(summary) {
  const out = [];
  for (const e of (summary?.keyEvents || [])) {
    const t = e.type || {}; if (t.type !== 'substitution' && !/substitution/i.test(t.text || '')) continue;
    const min = clockMin(e.clock?.displayValue);
    const pa = e.participants || [];                       // text: "X replaces Y" → [on, off]
    const on = pa[0]?.athlete?.displayName, off = pa[1]?.athlete?.displayName;
    out.push({ team: e.team?.displayName || '', on: on || '', off: off || '', min });
  }
  return out;
}

export async function fetchESPNSummary(eventId) {
  const r = await fetch(`${ESPN_SUMMARY}?event=${eventId}`);
  if (!r.ok) throw new Error('ESPN summary ' + r.status);
  return await r.json();
}

// UTC date strings for [now-1day .. now+1day], format YYYYMMDD (caller passes nowMs for testability).
export function espnDates(nowMs) {
  const out = [];
  for (let off = -1; off <= 1; off++) {
    const d = new Date(nowMs + off * 86400e3);
    out.push(`${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`);
  }
  return out;
}
