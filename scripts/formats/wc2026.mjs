// Declarative FORMAT descriptor for the 2026 FIFA World Cup.
//
// This captures the *shape* of the tournament (how many groups, how teams
// qualify, how the knockout is wired, which match-id block each round uses,
// which tiebreaker applies) separately from the *content* (which teams, their
// Elo, the fixtures list — those live in the D object inside index.html).
//
// The point: everything the pipeline currently hard-codes about "World Cup 2026"
// (12 groups, 8 best thirds, R32=73-88 / R16=89-96 / QF=97-100 / SF=200-201 /
// 3P=301 / Final=300, the 2026 head-to-head-first tiebreaker) is expressed here
// as data. scripts/tournament-engine.mjs consumes a descriptor of this shape and
// validateFormat() proves this one faithfully describes the live tournament.
//
// A second tournament (Euro, Copa, a 2030 World Cup with a different group count)
// is a new descriptor, not a code change. A second sport is a descriptor plus a
// scoring adapter. See docs/adr/0001-generalising-to-a-tournament-engine.md.

export const WC2026 = {
  id: 'fifa-wc-2026',
  sport: 'football',
  name: 'FIFA World Cup 2026',

  groupStage: {
    groups: 12,
    teamsPerGroup: 4,
    // single round-robin: which team-indices meet in each of the 6 fixtures.
    // Mirrors the app's FX. fixtureCount === teamsPerGroup*(teamsPerGroup-1)/2.
    fixtures: [[0, 1], [2, 3], [0, 2], [1, 3], [0, 3], [1, 2]],
    // ordered tiebreaker keys. 'fifa-2026' puts head-to-head BEFORE overall GD
    // (the rule change introduced for this edition); see scripts/standings.mjs.
    tiebreaker: 'fifa-2026',
  },

  qualification: {
    perGroup: 2,     // group winner + runner-up advance directly
    bestThirds: 8,   // plus the 8 best of the 12 third-placed teams
  },

  // Knockout rounds in playing order. `ids` is the inclusive match-id block the
  // app uses for that round; `feeders` documents where a round's teams come from.
  // This is the single source for the 73-88 / 89-96 / ... numbering the app
  // currently hard-codes in roundName(), KOSCHED, and the ingest KO set.
  knockout: {
    rounds: [
      { key: 'R32', name: 'Round of 32', short: 'R32', matches: 16, ids: [73, 88], feeders: 'group-stage' },
      { key: 'R16', name: 'Round of 16', short: 'R16', matches: 8, ids: [89, 96], feeders: 'R32-winners' },
      { key: 'QF', name: 'Quarter-final', short: 'QF', matches: 4, ids: [97, 100], feeders: 'R16-winners' },
      { key: 'SF', name: 'Semi-final', short: 'SF', matches: 2, ids: [200, 201], feeders: 'QF-winners' },
      { key: '3P', name: 'Third-place playoff', short: '3P', matches: 1, ids: [301, 301], feeders: 'SF-losers' },
      { key: 'F', name: 'Final', short: 'F', matches: 1, ids: [300, 300], feeders: 'SF-winners' },
    ],
    // The per-slot seeding (which group winner / runner-up / best-third meets whom)
    // and the R16/QF/SF pairing indices live in the D object (D.R32, D.r16, D.qf,
    // D.sf). The engine cross-checks counts against D rather than duplicating them.
  },

  // Sport-level scoring semantics. A different sport swaps this block and its
  // matching scoring adapter; the group/knockout machinery is unchanged.
  scoring: {
    draws: true,        // group games can draw; knockout games cannot
    unit: 'goal',
    extraTime: true,    // knockout ties level after 90 go to extra time
    penalties: true,    // then a shoot-out
  },
};

export default WC2026;
