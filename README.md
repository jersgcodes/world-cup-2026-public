# WC Lab: World Cup 2026

One place to follow the 2026 World Cup: every match, every squad, the live bracket, and a
statistical model that prices each game and bet, instead of hopping between half a dozen tabs.

**Live app:** https://jersgcodes.github.io/world-cup-2026/
**Full write-up (what it is, how it is built, and what it proved):** [docs/WRITEUP.md](docs/WRITEUP.md)

This is a public code snapshot of a project I built and ran live for the duration of the tournament.
The private working repo carries the automation and my (encrypted) personal betting slip; this mirror
is the app and the pipeline, so the engineering can be read end to end.

## What it does

- **Live bracket that resolves itself.** As group results land, the knockout tree fills in
  automatically, including the fiddly FIFA best-third-place slotting; teams light up once
  mathematically confirmed, and every dependent view recomputes.
- **A Monte-Carlo model, not a guess.** Team-strength (Elo) ratings feed a Dixon-Coles
  conditional-Poisson scoreline model, sampled over thousands of simulated tournaments to produce a
  market board (group winner, finalist, champion odds), which then prices each bet by expected value.
- **Bets that settle themselves, tolerantly.** Bets grade automatically against live results, with a
  forgiving name matcher (accents, suffixes, surname-only, initials, romanisation) that runs
  identically in the browser and in Node.
- **A private slip in a public file.** The owner's betting slip is encrypted client-side (AES-GCM +
  PBKDF2) and published as ciphertext inside the data file; only a passphrase decrypts it. No backend.

## How it is built

A zero-build static app plus a small Node data pipeline, sharing one artifact:

```
  ESPN feed  ──┐
               ├──►  Node pipeline  ──►  data.json  ──►  index.html (browser)
  openfootball ┘     (fetch, model,       (single           renders everything
                      settle, encrypt)      artifact)         client-side
```

- **Front end:** a single hand-written `index.html` (no framework, no bundler, vanilla JS + inline
  CSS) that fetches `data.json` at runtime and renders every view client-side, under a locked-down
  Content-Security-Policy.
- **Pipeline:** small ES-module scripts under `scripts/` that ingest results, run the model, settle
  bets, and write `data.json`.
- **Tournament shape as data:** `scripts/formats/wc2026.mjs` is a declarative descriptor of the
  tournament (groups, qualification, knockout id blocks, tiebreaker, scoring); `scripts/tournament-engine.mjs`
  consumes it and `validateFormat()` proves it matches the live app, so the two cannot drift. This is
  the generalisation path to future tournaments and other sports (see
  [docs/adr/0001](docs/adr/0001-generalising-to-a-tournament-engine.md)).
- **Tests:** `scripts/selftest.mjs`, a pure-Node assertion suite (no framework) covering bracket
  resolution, the name matcher, penalty sequences, the slip merge, encryption version migration,
  live-state transitions, and bet settlement.

## What it proved

The honest scorecard is in [docs/WRITEUP.md](docs/WRITEUP.md) Part 3. In short: the model's structural
calls were strong (its four most-likely champions were exactly the four semi-finalists; its top pick
won and its second was runner-up), it stayed honest about its uncertainty where it was weakest (total
goals came in almost two standard deviations high), and a book of small correlated bets still lost
about 11 percent, which is the real lesson: calibrated edge on paper is not the same as profit once
variance and margin get a vote.

## Run it locally

```bash
# view the app (any static server; it fetches data.json at runtime)
python3 -m http.server 8000   # then open http://localhost:8000

# run the test suite (Node 18+)
node scripts/selftest.mjs

# inspect the tournament-format descriptor
node scripts/tournament-engine.mjs
```

## Attribution

Results and lineups are from ESPN; historical data from the [openfootball](https://github.com/openfootball)
project. Projections are model estimates, not predictions. The app code is free to read and learn from;
the bundled match data belongs to its respective sources. Bet responsibly.
