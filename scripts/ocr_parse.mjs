// Parse Singapore Pools "Bet Activities" / bet-receipt OCR text into the app's bet shape.
// Pure — ocrTeam (string -> canonical team or null) is injected. Mirrored into index.html
// (the browser can't import) — keep the two in sync.
//
// Real OCR is messier than the on-screen layout:
//   - The MARKET can appear BEFORE the selection (receipt view) or AFTER it (list view).
//   - Labels and values land on SEPARATE lines:  "Bet Amount" ⏎ "$3.00",  "Potential Payout" ⏎ "$19.50".
// So we anchor on the "<selection> @ <odds>" line and search OUTWARD for the market + fixture,
// and take the stake from the "$" that follows a "Bet Amount" label (never a payout/total/fee).

export function classifyBet(selText, market, teamA, teamB, ocrTeam) {
  const s = (selText || '').trim(), m = (market || '').toLowerCase();
  const sc = s.match(/(\d+)\s*[-–]\s*(\d+)/);
  const named = ocrTeam(s.replace(/\d+\s*[-–]\s*\d+/, '').replace(/draw/ig, ''));
  const other = t => (t && t === teamA) ? teamB : teamA;
  const strip = x => x.replace(/\([^)]*\)/g, '').replace(/[•·]/g, '').trim();
  if (m.includes('group winner')) return { type: 'groupWinner', sel: ocrTeam(s) };
  if (m.includes('team to score') && m.includes('goal')) { const t = ocrTeam(s); return { type: 'teamFirstGoal', sel: t, sel2: other(t) || teamB }; }
  if (m.includes('top goal scorer') || m.includes('top scorer') || m.includes('golden boot')) return { type: 'topScorer', player: strip(s) }; // tournament outright (no fixture)
  if (m.includes('scorer')) { const first = m.includes('1st') || m.includes('first'); return { type: first ? 'firstScorer' : 'anytimeScorer', player: strip(s), sel: teamA, sel2: teamB }; }
  if ((m.includes('half') && m.includes('full')) || m.includes('ht-ft') || m.includes('htft')) {
    const parts = s.split(/\s*[-–\/]\s*/).map(x => x.trim());
    const codeOf = p => { if (/draw/i.test(p)) return 'X'; const t = ocrTeam(p); return (t && t === teamB) ? '2' : '1'; };
    return { type: 'htft', sel: teamA, sel2: teamB, htOut: codeOf(parts[0] || ''), ftOut: codeOf(parts[1] || '') };
  }
  if (m.includes('half') && sc) { const sel = named || teamA; return { type: 'htScore', sel, sel2: other(sel) || teamB, out: (+sc[1]) + '-' + (+sc[2]) }; }
  if (m.includes('total goal') || /\d+\s*\+\s*goal/i.test(s)) return { type: 'matchTotal', sel: teamA, sel2: teamB, out: s, label: ((teamA && teamB) ? teamA + ' v ' + teamB + ' — ' : '') + 'total goals ' + s };
  if (m.includes('pick the score') || m.includes('correct score') || m.includes('pts') || (m.includes('score') && sc)) {
    if (sc) { const isDraw = /draw/i.test(s); const sel = isDraw ? teamA : (named || teamA); return { type: 'score', sel, sel2: other(sel) || teamB, out: (+sc[1]) + '-' + (+sc[2]) }; }
  }
  if (m.includes('finalist') || (s.includes('&') && !teamA)) { const ps = s.split('&').map(x => ocrTeam(x)).filter(Boolean); if (ps.length === 2) return { type: 'finalistPair', sel: ps[0], sel2: ps[1] }; }
  const out = /draw/i.test(s) ? 'X' : (named && named === teamB ? '2' : '1');
  return { type: 'match1x2', sel: teamA, sel2: teamB, out };
}

const SEL_RE = /^(.*\S)\s*@\s*(\d+(?:\.\d+)?)\s*$/;
const isAmtLabel = l => /^\s*(bet amount|stake|unit\b)/i.test(l);
const isBadAmt = l => /payout|total stake|total amount|transaction fee|balance/i.test(l);
const isMarket = l => /(pick the score|correct score|fulltime pts|full time pts|group winner|tournament winner|outright|1st goal scorer|first goal scorer|anytime|goal scorer|to score|half\s*time|halftime|fulltime|full time|ht[\/-]?ft|to win|total goals|handicap|over\/under|finalist|winning margin|double chance|match result|1x2|to lift)/i.test(l);
const money = l => { const m = (l || '').match(/\$\s*(\d+(?:\.\d+)?)/); return m ? +m[1] : null; };
function fixtureOf(l, ocrTeam) { if (/\bcup\b/i.test(l)) return null; const m = l.match(/^(.+?)\s+(?:vs|v)\s+(.+)$/i); if (!m) return null; const a = ocrTeam(m[1]), b = ocrTeam(m[2]); return (a && b) ? [a, b] : null; }

export function parseSGP(text, ocrTeam) {
  const L = (text || '').split(/\n+/).map(s => s.trim()).filter(Boolean);
  const anchors = [];
  for (let i = 0; i < L.length; i++) { const m = L[i].match(SEL_RE); if (m && !isAmtLabel(L[i]) && !isBadAmt(L[i])) anchors.push({ i, selText: m[1].trim(), odds: +m[2] }); }
  const cands = anchors.map((an, idx) => {
    const lo = idx > 0 ? anchors[idx - 1].i : -1, hi = idx < anchors.length - 1 ? anchors[idx + 1].i : L.length;
    let market = '', teams = null, stake = null;
    // stake: first "Bet Amount" after the anchor (value same-line or following), before the next bet
    for (let j = an.i + 1; j < hi; j++) {
      if (isAmtLabel(L[j])) { const same = money(L[j]); if (same != null) { stake = same; break; } for (let k = j + 1; k < hi; k++) { if (isBadAmt(L[k])) break; const v = money(L[k]); if (v != null) { stake = v; break; } } break; }
    }
    // a team named in the selection (e.g. "Ivory Coast 2-0") MUST appear in the chosen fixture —
    // stops a misread fixture line from pairing this bet with a neighbouring receipt's match.
    const selTeam = ocrTeam((an.selText || '').replace(/\d+\s*[-–]\s*\d+/, '').replace(/draw/ig, ''));
    // market + fixture: nearest line in EITHER direction within this bet's window
    for (let d = 1; d < 14 && (!market || !teams); d++) {
      for (const j of [an.i - d, an.i + d]) {
        if (j <= lo || j >= hi || j < 0 || j >= L.length) continue;
        if (!teams) { const f = fixtureOf(L[j], ocrTeam); if (f && (!selTeam || f.includes(selTeam))) teams = f; }
        if (!market && isMarket(L[j])) market = L[j];
      }
    }
    return { selText: an.selText, odds: an.odds, market, teamA: teams ? teams[0] : null, teamB: teams ? teams[1] : null, stake };
  });
  return cands.map(c => { const b = classifyBet(c.selText, c.market, c.teamA, c.teamB, ocrTeam); if (!b) return null; b.odds = c.odds; b.stake = c.stake || 0; b.status = 'open'; return b; }).filter(b => b && (b.sel || b.player));
}
