// Sport-agnostic tournament-format engine.
//
// Consumes a declarative FORMAT descriptor (see scripts/formats/wc2026.mjs) and
// nothing else. It knows how a group-and-knockout tournament is shaped, but not
// which teams play or which sport it is. Two jobs:
//
//   validateFormat(format, D) -> string[]   list of inconsistencies (empty = OK)
//   describeFormat(format)    -> string      human summary
//
// plus small derivations a future engine would drive the pipeline from:
//
//   roundNameFor(format, id)  -> string      "Round of 32" ... "Final"
//   knockoutIds(format)       -> number[]    every knockout match id, in order
//
// validateFormat is the proof: it checks that this descriptor faithfully matches
// the LIVE tournament (the D object parsed out of index.html). If the two ever
// drift, selftest fails. That is what makes the descriptor trustworthy enough to
// be the thing you swap when the tournament or the sport changes.

// expand an inclusive [lo, hi] id block into the list of ids it covers
function idRange([lo, hi]) {
  const out = [];
  for (let i = lo; i <= hi; i++) out.push(i);
  return out;
}

// every knockout match id the format declares, in playing order
export function knockoutIds(format) {
  return format.knockout.rounds.flatMap(r => idRange(r.ids));
}

// which round a knockout id belongs to, by its declared id block. Returns the
// round's `name` (or `short` when short=true), or null if the id is unclaimed.
export function roundNameFor(format, id, short = false) {
  id = +id;
  for (const r of format.knockout.rounds) {
    if (id >= r.ids[0] && id <= r.ids[1]) return short ? r.short : r.name;
  }
  return null;
}

// human-readable one-screen summary of a format
export function describeFormat(format) {
  const gs = format.groupStage, q = format.qualification;
  const teams = gs.groups * gs.teamsPerGroup;
  const advance = gs.groups * q.perGroup + q.bestThirds;
  const lines = [];
  lines.push(`${format.name}  [${format.sport}]`);
  lines.push(`  Group stage: ${gs.groups} groups of ${gs.teamsPerGroup} (${teams} teams), ${gs.fixtures.length} games each, tiebreaker "${gs.tiebreaker}"`);
  lines.push(`  Qualify: top ${q.perGroup} per group + ${q.bestThirds} best thirds = ${advance} to the knockout`);
  lines.push(`  Knockout:`);
  for (const r of format.knockout.rounds) {
    const span = r.ids[0] === r.ids[1] ? `#${r.ids[0]}` : `#${r.ids[0]}-${r.ids[1]}`;
    lines.push(`    ${r.name.padEnd(20)} ${String(r.matches).padStart(2)} match(es)  ${span}  <- ${r.feeders}`);
  }
  const sc = format.scoring;
  lines.push(`  Scoring: unit "${sc.unit}", draws ${sc.draws ? 'allowed' : 'no'}${sc.extraTime ? ', extra time' : ''}${sc.penalties ? ', penalties' : ''}`);
  return lines.join('\n');
}

// Check that `format` faithfully describes the live tournament in `D`.
// Returns a list of human-readable problems; empty means the descriptor and the
// running app agree. This is what selftest asserts.
export function validateFormat(format, D) {
  const errs = [];
  const gs = format.groupStage, q = format.qualification;

  // --- group stage ---
  const groupKeys = Object.keys(D.groups || {});
  if (groupKeys.length !== gs.groups)
    errs.push(`groups: format says ${gs.groups}, D has ${groupKeys.length}`);
  for (const g of groupKeys) {
    if (D.groups[g].length !== gs.teamsPerGroup)
      errs.push(`group ${g}: format says ${gs.teamsPerGroup} teams, D has ${D.groups[g].length}`);
  }
  const expectFixtures = (gs.teamsPerGroup * (gs.teamsPerGroup - 1)) / 2;
  if (gs.fixtures.length !== expectFixtures)
    errs.push(`fixtures: single round-robin of ${gs.teamsPerGroup} needs ${expectFixtures}, format lists ${gs.fixtures.length}`);

  // --- knockout round shape, checked against D's wiring ---
  const byKey = Object.fromEntries(format.knockout.rounds.map(r => [r.key, r]));
  const check = (key, actual) => {
    const r = byKey[key];
    if (!r) { errs.push(`knockout: format is missing round ${key}`); return; }
    if (r.matches !== actual)
      errs.push(`${key}: format says ${r.matches} match(es), D wires ${actual}`);
  };
  check('R32', (D.R32 || []).length);
  check('R16', (D.r16 || []).length);
  check('QF', (D.qf || []).length);
  check('SF', (D.sf || []).length);
  check('3P', 1);
  check('F', 1);

  // --- best-thirds count: number of third-place slots wired into R32 ---
  const thirdSlots = (D.R32 || []).flatMap(e => [e.a, e.b]).filter(s => s && s.t === 'T').length;
  if (thirdSlots !== q.bestThirds)
    errs.push(`best thirds: format says ${q.bestThirds}, D wires ${thirdSlots} third-place slots into R32`);

  // --- match-id blocks: the R16/QF ids the app hard-codes must match the format ---
  const idsMatch = (key, actual) => {
    const r = byKey[key]; if (!r || !actual) return;
    const declared = idRange(r.ids).join(',');
    const got = [...actual].join(',');
    if (declared !== got) errs.push(`${key} ids: format ${declared} vs D ${got}`);
  };
  idsMatch('R16', D.r16m);
  idsMatch('QF', D.qfm);
  // R32 ids live on D.R32 entries (as .m) in bracket order, so compare as sorted sets
  {
    const r = byKey['R32'];
    if (r && D.R32) {
      const declared = idRange(r.ids).slice().sort((a, b) => a - b).join(',');
      const got = D.R32.map(e => e.m).slice().sort((a, b) => a - b).join(',');
      if (declared !== got) errs.push(`R32 ids: format ${declared} vs D ${got}`);
    }
  }

  // --- id blocks must not overlap (301 sitting next to 300 is the easy mistake) ---
  const seen = new Map();
  for (const r of format.knockout.rounds) {
    for (const id of idRange(r.ids)) {
      if (seen.has(id)) errs.push(`id ${id} claimed by both ${seen.get(id)} and ${r.key}`);
      seen.set(id, r.key);
    }
  }

  return errs;
}

// CLI: `node scripts/tournament-engine.mjs` prints the WC2026 summary + validates
// it against the live D. Exits non-zero on any inconsistency.
if (import.meta.url === `file://${process.argv[1]}`) {
  const { WC2026 } = await import('./formats/wc2026.mjs');
  const { parseD } = await import('./datafile.mjs');
  console.log(describeFormat(WC2026));
  const errs = validateFormat(WC2026, parseD());
  if (errs.length) {
    console.error('\nFORMAT MISMATCH:');
    for (const e of errs) console.error('  - ' + e);
    process.exit(1);
  }
  console.log('\nvalidateFormat: OK (descriptor matches the live tournament)');
}
