// Current-status -> Elo adjustment. Turns a country profile's CURRENT situation
// (injuries/suspensions in `outs`, plus recent `form`) into an Elo delta so that
// MATCH-level model odds reflect more than the pre-tournament rating — AND explains
// itself, so the per-match read can show WHY it adjusted.
//
// Applied to next-match predictions only (value_scan upcoming matches, the app's
// match sheet, and match1x2/score bet pricing) — NOT to the tournament-long market
// sim, because injuries are usually temporary and shouldn't tank season-long odds.
//
// Constants are deliberately conservative and easy to tune; an Elo gap of ~70-100
// already moves win odds a lot. The app duplicates this logic near eff() — keep in sync.

// Elo penalty applied to a team that has MATHEMATICALLY CLINCHED 1st place when it
// plays its remaining group match — it has nothing left to play for, so it tends to
// rest/rotate starters. Match-level only (like the status delta), never the
// tournament sim. index.html hardcodes the same number — keep in sync.
export const ROTATION_PEN = 75;

export const STATUS = {
  outEach: -40,      // each recorded absence (the routine only logs material ones)
  outKeyBonus: -25,  // extra if the absentee is one of the profile's listed key players
  outFloor: -110,    // most the injury component can subtract
  formStep: 7,       // Elo per net win across the last 5 results
  formCap: 35,       // clamp on the form component (either direction)
};

const surname = n => (n || '').toLowerCase().split(' ').pop();
const last = n => (n || '').split(' ').slice(-1)[0];

// { delta, parts:[{label,d}] } — parts explain the adjustment for display.
export function statusBreakdown(profile) {
  if (!profile) return { delta: 0, parts: [] };
  const S = STATUS, parts = [];
  // injuries / suspensions
  const keys = new Set((profile.players || []).map(p => surname(p.name)).filter(Boolean));
  const outs = profile.outs || [];
  if (outs.length) {
    let raw = 0; const names = [];
    for (const o of outs) { const key = keys.has(surname(o.name)); raw += S.outEach + (key ? S.outKeyBonus : 0); names.push(last(o.name) + (key ? '*' : '')); }
    parts.push({ label: 'out: ' + names.join(', '), d: Math.max(raw, S.outFloor) });
  }
  // recent form (a W/D/L string like "WWDLW")
  const f = (profile.form || '').toUpperCase().replace(/[^WDL]/g, '').slice(-5);
  if (f) {
    let net = 0; for (const c of f) { if (c === 'W') net++; else if (c === 'L') net--; }
    if (net) parts.push({ label: 'form ' + f, d: Math.max(-S.formCap, Math.min(S.formCap, net * S.formStep)) });
  }
  return { delta: Math.round(parts.reduce((s, p) => s + p.d, 0)), parts };
}

export const statusDelta = p => statusBreakdown(p).delta;

// human-readable reason, e.g. "-108 (out: Partey, Kudus -80; form DLLLL -28)"; '' if no adjustment
export function statusNote(profile) {
  const { delta, parts } = statusBreakdown(profile);
  if (!parts.length) return '';
  return `${delta >= 0 ? '+' : ''}${delta} (${parts.map(p => `${p.label} ${p.d >= 0 ? '+' : ''}${p.d}`).join('; ')})`;
}

// match-level effective Elo: base rating + current-status delta
export const effElo = (team, D, profiles) => D.elo[team] + statusDelta((profiles || {})[team]);
