# ADR 0001: Generalising WC Lab into a tournament engine (and beyond football)

Status: Accepted (design) · Date: 2026-07-21

## Context

WC Lab was built for one event: the 2026 World Cup. Now that the tournament is
over and the system proved itself (see `docs/WRITEUP.md` Part 3), the question is
what it takes to reuse it for the next tournament, and for other sports.

The good news from a month of live running: most of the engine is already
sport-and-tournament agnostic. The bad news: the parts that are not agnostic are
scattered as literals across the pipeline and the front end, so "run it again for
the Euros" currently means a careful find-and-replace rather than a config swap.

This ADR records what is generic, what is hard-coded, the abstraction that
separates them, and how far that abstraction stretches to other sports. It is a
design decision plus a first working step, not a full rewrite.

## What is already generic

These carried the whole World Cup unchanged and would carry any group-and-knockout
football tournament as-is:

- **Standings** (`scripts/standings.mjs`) — group ranking is driven by a tiebreaker
  sequence, not by "12 groups". `fifaBestThirds` ranks any set of third-placed
  teams; only the count taken is a parameter.
- **Bracket resolver** (`scripts/bracket.mjs`) — resolves `id -> {a, b}` from the D
  wiring and recorded results. It reads structure from D; it does not assume a
  match count.
- **Monte-Carlo simulator** (`scripts/simulate.mjs`) — samples group games from
  ratings, ranks by the standings rules, cascades the knockout from D. Nothing in
  it says "48 teams".
- **Bet settlement** (`scripts/evaluate_bets.mjs` + the browser mirror) — 17
  enumerated market types graded against results. The market *catalogue* is
  football-flavoured, but the settlement machinery is generic.
- **Name matching, encryption, ingest freshness, the two-branch slip topology,
  the service worker, the selftest harness** — all sport-neutral infrastructure.

## What is hard-coded to "World Cup 2026"

Audited across the tree, the tournament-specific assumptions cluster in five places:

1. **Match-id numbering** — R32 `73-88`, R16 `89-96`, QF `97-100`, SF `200-201`,
   3P `301`, Final `300`. These literals appear in `roundName()`/`roundShort()` and
   the schedule labels in `index.html`, in the ingest KO set in
   `scripts/update_data.mjs`, and in `KOSCHED`.
2. **Group count and qualification** — 12 groups, top two plus 8 best thirds. The
   `slice(0, 8)` for best thirds is a literal in `simulate.mjs` and `standings.mjs`.
3. **Group fixture pattern** — `FX = [[0,1],[2,3],[0,2],[1,3],[0,3],[1,2]]`, the
   single round-robin of four.
4. **Third-place seeding matrix** — the per-slot `elig` arrays in `D.R32` and the
   495-row combinations table are specific to this bracket design.
5. **Tiebreaker rule** — the 2026 change (head-to-head before overall goal
   difference) is baked into `standings.mjs`.

Plus cosmetics: venue-altitude adjustments and the June-July date window.

The third-place playoff bug (a whole match with no id slot, silently dropped for
the entire tournament; see WRITEUP Part 3) is the clearest evidence that a
scattered, literal numbering scheme is a liability. A round that is not in a
declared structure is a round that can go missing without anything erroring.

## Decision

Introduce a declarative **FORMAT descriptor**: one object per tournament that
captures shape (group count, teams per group, fixture pattern, qualification,
knockout rounds with their id blocks and feeders, tiebreaker id, scoring
semantics) as data, separate from content (which teams, their ratings), which
stays in D.

A sport-agnostic **tournament engine** consumes a descriptor and nothing else.

This ADR ships the first, non-invasive slice of that:

- `scripts/formats/wc2026.mjs` — the 2026 World Cup expressed as a FORMAT
  descriptor.
- `scripts/tournament-engine.mjs` — `validateFormat`, `describeFormat`,
  `roundNameFor`, `knockoutIds`. `validateFormat(WC2026, D)` proves the descriptor
  faithfully matches the live tournament, and selftest asserts it, so the two
  cannot drift.

This is deliberately additive. It does not rewire the running app; it establishes
the descriptor as the single source of truth for tournament shape and locks it to
reality with a test. The migration below is the path from "descriptor describes
the app" to "descriptor drives the app".

### Migration path (football, future tournaments)

Incremental, each step guarded by the existing selftest:

1. **Derive the id classifier from the descriptor.** *Done.* The Node ingest KO set
   in `update_data.mjs` now reads `knockoutIds(WC2026)` instead of the literal
   `[...,200,201,301,300]` ladder — the exact line the third-place playoff fell
   through. `validateFormat` was strengthened to also pin the R32 id block to D, so
   the descriptor and the live wiring are fully cross-checked. The browser, which
   cannot import the Node descriptor, now classifies every match label through a
   single `KROUNDS` table (replacing four scattered id ladders, two of which
   mislabelled M301); selftest asserts that table matches the descriptor, so the two
   cannot drift. This makes the 3P omission impossible by construction: a round in
   the descriptor is a round the ingest set and labels include automatically.
2. **Parameterise the best-thirds count** — read `qualification.bestThirds` instead
   of `slice(0, 8)`.
3. **Parameterise the tiebreaker** — select the sequence by `groupStage.tiebreaker`
   so historical or non-FIFA rules are a descriptor value, not a code edit.
4. **Lift D's teams/ratings out of index.html** into a per-tournament content file,
   leaving index.html format-neutral. A new tournament becomes: new descriptor +
   new content file + regenerated thirds table.

At that point "run it for the 2030 World Cup" (a different group count) or "run it
for the Euros" is a new descriptor and a content file, not a source change.

### Reaching other sports

The same descriptor plus two swappable adapters covers most bracket sports:

- **Scoring adapter** — the `scoring` block already names the axes that vary:
  `draws` (basketball and most playoff formats have none), `unit` (goal vs point
  vs run vs set), `extraTime`/`penalties` (sport-specific tiebreak: overtime,
  super-over, fifth set). Group ranking and knockout resolution do not care what
  the unit is once the adapter maps a result to win/draw/loss and a total.
- **Rating + simulation adapter** — Elo-through-Dixon-Coles is football-specific.
  Other sports plug in their own rating-to-scoreline model (e.g. possession-based
  for basketball, an innings model for cricket). The Monte-Carlo shell that samples
  a bracket thousands of times is unchanged.
- **Market catalogue** — `firstScorer`, `topScorer`, `totalGoals` become
  `firstBasket`, `topScorer`, `totalPoints`, etc. The settlement *machinery* (grade
  each type against a result, hard-settle the tournament-long ones) is reused; the
  *list* of types is per-sport data.

What does NOT generalise, and should not be forced to: the pure-knockout sports
with no group stage (tennis draws, cup competitions) want a seeded-bracket
descriptor variant rather than the group-plus-knockout one; and league formats
(round-robin only, points table, no bracket) are a different shape again. The
descriptor should grow a `kind` field (`group-knockout` | `bracket` | `league`)
rather than pretend one shape fits all.

## Consequences

**Positive**

- Tournament shape becomes data, testable and diffable, with `validateFormat`
  guaranteeing the descriptor matches reality.
- The class of bug that hid the third-place playoff (an unmodelled round) is
  designed out once the app reads structure from the descriptor.
- A second football tournament is a config exercise; a second sport is config plus
  two adapters, against a proven engine rather than a blank page.

**Negative / costs**

- Full realisation touches core files (`standings.mjs`, `simulate.mjs`,
  `index.html`), so it must be staged behind selftest, not done in one pass. The
  running, deployed app is not disturbed by this ADR's additive first step.
- A descriptor is another thing to keep honest; the mitigation is that
  `validateFormat` fails loudly the moment it drifts from D.
- Multi-sport is a genuine extension (adapters, new market catalogues), not a free
  consequence of the descriptor. This ADR commits to the football generalisation as
  working code and to the multi-sport shape as design; it does not claim the sport
  adapters are built.

## Status of the first step

Shipped and green under `node scripts/selftest.mjs`:

- `scripts/formats/wc2026.mjs`, `scripts/tournament-engine.mjs`
- selftest: `validateFormat` matches live D (now including the R32 id block),
  `knockoutIds` covers 32 matches, `roundNameFor` derives labels including the
  third-place playoff, and the browser `KROUNDS` table matches the descriptor.
- `update_data.mjs` ingest KO set is now `knockoutIds(WC2026)`; `index.html`
  routes all match labels through one descriptor-mirrored `KROUNDS` table.

So the descriptor now *drives* the knockout id scheme end to end (ingest + labels),
not merely describes it. Remaining migration steps 2–4 (parameterise best-thirds,
tiebreaker, and lift teams/ratings out of index.html) stay deferred until a second
tournament actually needs them; they are pure refactors with no user-visible change.
