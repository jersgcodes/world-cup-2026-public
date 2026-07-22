// Shared helpers for the results/schedule automation, now sourced from openfootball/
// worldcup.json (public domain, NO API key / NO signup) — so nothing depends on a
// personal account. One home for the team-name alias table + SGT time handling.
export const OF_ALIAS = {
  'South Korea': 'Korea Republic', 'USA': 'United States', 'Czech Republic': 'Czechia',
  'Turkey': 'Turkiye', 'Türkiye': 'Turkiye', 'Curaçao': 'Curacao', 'Curacao': 'Curacao',
  'Congo DR': 'DR Congo', 'DR Congo': 'DR Congo', 'Congo': 'DR Congo',  // ESPN uses "Congo DR"
  'Bosnia & Herzegovina': 'Bosnia and Herzegovina', 'Bosnia-Herzegovina': 'Bosnia and Herzegovina',
  "Côte d'Ivoire": 'Ivory Coast', 'Cape Verde Islands': 'Cape Verde', 'IR Iran': 'Iran',
};
export const FX = [[0,1],[2,3],[0,2],[1,3],[0,3],[1,2]];
const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
// fold OCR-confusable glyphs (lowercase-L / capital-I / 1 / |, and O / 0) to one form so a
// misread like "lvory Coast" still resolves. Fallback only — closed team set makes it safe.
const fold = s => norm(s).replace(/[il1|!]/g, 'i').replace(/[o0]/g, 'o');

export function makeCanon(teams) {
  return name => {
    if (!name) return null; if (OF_ALIAS[name]) return OF_ALIAS[name];
    const n = norm(name);
    for (const t of teams) if (norm(t) === n) return t;
    for (const t of teams) if (n.includes(norm(t)) || norm(t).includes(n)) return t;
    const f = fold(n);
    for (const t of teams) if (fold(t) === f) return t;
    for (const t of teams) if (f.includes(fold(t))) return t;
    return null;
  };
}

export function findFx(a, b, D) {
  for (const g of Object.keys(D.groups)) for (let i = 0; i < 6; i++) {
    const h = D.groups[g][FX[i][0]], aw = D.groups[g][FX[i][1]];
    if ((h === a && aw === b) || (h === b && aw === a)) return { id: 'g_' + g + '_' + i, home: h };
  }
  return null;
}

const OF_URL = 'https://raw.githubusercontent.com/openfootball/worldcup.json/master/2026/worldcup.json';
export async function fetchOpenfootball() {
  const r = await fetch(OF_URL);
  if (!r.ok) throw new Error('openfootball ' + r.status);
  const j = await r.json();
  return j.matches || (j.rounds ? j.rounds.flatMap(x => x.matches || []) : []);
}

const MON = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const MN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// openfootball kickoff ("2026-06-11", "13:00 UTC-6") -> UTC ms
export function parseOFtime(date, time) {
  const m = (time || '').match(/(\d{1,2}):(\d{2})\s*UTC([+-]\d{1,2})/);
  if (!date || !m) return NaN;
  const [Y, Mo, Dd] = date.split('-').map(Number);
  return Date.UTC(Y, Mo - 1, Dd, +m[1], +m[2]) - (+m[3]) * 3600e3;
}

// format a UTC instant as our SGT sched prints it
export function fmtSGT(utcMs) {
  const d = new Date(utcMs + 8 * 3600e3);
  let h = d.getUTCHours(), ap = h < 12 ? 'am' : 'pm', h12 = h % 12 || 12;
  return { d: `${MN[d.getUTCMonth()]} ${d.getUTCDate()}`, t: `${h12}:${String(d.getUTCMinutes()).padStart(2, '0')}${ap} SGT` };
}

// parse our sched ("Jun 19", "9:00am SGT") to a UTC timestamp (ms)
export function schedToUTC(dStr, tStr, year = 2026) {
  const [mon, day] = (dStr || '').split(' ');
  const m = (tStr || '').match(/(\d+):(\d+)\s*(am|pm)/i);
  if (!(mon in MON) || !m) return NaN;
  let h = (+m[1]) % 12; if (/pm/i.test(m[3])) h += 12;
  return Date.UTC(year, MON[mon], +day, h, +m[2]) - 8 * 3600e3;
}

// group fixtures past kickoff+grace with no result -> staleness signal
export function overdueFixtures(sched, results, nowMs, graceHours = 2.5) {
  const out = [];
  for (const id of Object.keys(sched || {})) {
    if (!/^g_[A-L]_[0-5]$/.test(id)) continue;
    if (results && results[id]) continue;
    const ko = schedToUTC(sched[id].d, sched[id].t);
    if (!isNaN(ko) && nowMs > ko + graceHours * 3600e3) out.push({ id, d: sched[id].d, t: sched[id].t, ko });
  }
  return out.sort((a, b) => a.ko - b.ko);
}
