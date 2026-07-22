# WC Lab: World Cup 2026

A single place to follow the 2026 World Cup: every match, every squad, the live bracket, and your own bets, instead of hopping between a handful of sites.

---

## Part 1: What is this? (for anyone)

### Why it exists

I don't follow football news religiously, but I love **tournament** football. It's more unpredictable than a league season, it's condensed into a few intense weeks so you can actually focus on every game, and the World Cup especially is the most unpredictable of all, charged with national pride and one-off drama.

The problem: to enjoy it properly you end up with half a dozen tabs open, one for the table, one for the bracket, one for squads, one for who's injured, one for live scores. I wanted **one place** to get up to speed fast: all the data on players and countries, and an honest sense of how good each team really is, before and during a match.

Having everything in one place turned out to make something else easier: understanding what was actually worth **betting** on (a happy side-effect). That pulled me toward building **prediction models** to price things properly. And once it was useful to me, I wanted to share it, first with friends, now publicly.

### What you can do

The app has a row of tabs across the top:

| Tab | What it gives you |
|---|---|
| **Today** | Matches happening now and next, with live scores, and any of your bets that are in play. |
| **Bracket** | The knockout tree (Round of 32 to Final). Teams slot in automatically as groups finish; a team turns green once it's mathematically confirmed into a round. Shows the model's projected champion. |
| **Schedule** | Every fixture with kickoff time (in your timezone or Singapore time), results, goalscorers and match sheets. |
| **Compare** | Two teams side by side, plus how the tournament is unfolding versus the pre-tournament model. |
| **Groups** | All 12 group tables, updating live and sorted by the official FIFA tiebreakers. |
| **Bets** | A personal betting slip: track what you've backed, see whether it's winning, and how it's priced against the model. |
| **Profiles** | Full squads with per-player stats (goals, assists, minutes, form, injuries) that build up as the tournament goes on. |
| **Stats** | Tournament leaderboards: Golden Boot race, assists, cards, minutes. |

Tap any match to open its **match sheet**: the model's read on the game, lineups, goals, key stats, and for knockout ties decided on penalties, the shoot-out kick by kick.

### The bets slip (and the padlock)

The Bets tab is a personal betting tracker. You can add your own bets on any device (they save to that device only), or, if the owner has published their slip, you'll see a **padlock**: their bets are private and encrypted, and you need their passphrase to view them. Nothing is stored on a server. The encrypted slip travels inside the app's data file, and only the passphrase can unlock it.

### Where the numbers come from (so you can trust them)

Two kinds of information live in this app, and they're treated very differently:

- **Recorded facts**: scores, goals, half-times, lineups, cards. These come from **ESPN's live feed** (updated every few minutes during the tournament), backfilled from a public open-data project for anything ESPN is slow on. When you see a result, it happened.
- **Projections**: win percentages, bracket paths, the champion pick, bet pricing. These come from a **statistical model** (team-strength ratings run through thousands of simulated tournaments). They are *estimates*, not predictions. The whole point of the World Cup is that the underdog wins sometimes.

The toolbar shows when the data was last refreshed ("pulled 4m ago"), and warns you in amber if it hasn't updated in a while. Lineups are only as current as ESPN's, and are usually confirmed about an hour before kickoff.

---

## Part 2: How it's built (technical)

A note for the technically curious, or anyone reviewing this as a portfolio piece. This is less a line-by-line tour and more the shape of the system, a few features I'm happy with, and the reasoning behind the choices that weren't obvious.

### Architecture at a glance

```
  ESPN feed  ──┐
               ├──►  Node pipeline  ──►  data.json  ──►  index.html (browser)
  openfootball ┘     (fetch, model,       (single           renders everything
                      settle, encrypt)      artifact)         client-side
```

Two halves, one shared artifact:

- **A build-time data pipeline** (small Node ES-module scripts) that ingests results, runs the model, settles bets, and writes one `data.json`.
- **A zero-build front end**: a single hand-written `index.html` (no framework, no bundler, vanilla JS + inline CSS) that fetches `data.json` at runtime and renders every view client-side. A locked-down Content-Security-Policy limits network access to self, the GitHub API (slip sync), and ESPN (live scores/lineups).

The whole thing is **static**: hosted on GitHub Pages, no application server, no database. `data.json` is the only moving part, and a self-hosted VPS regenerates it on a timer.

### Features I'm happy with

- **A live tournament that resolves itself.** As group results land, the knockout bracket fills in automatically (including the fiddly FIFA best-third-place-team slotting), teams light up green once mathematically confirmed, and every dependent view recomputes. No manual bracket wiring.
- **A Monte-Carlo model, not a guess.** Team-strength ratings feed a Dixon-Coles conditional-Poisson scoreline model, sampled over thousands of simulated tournaments to produce a market board (group winner, finalist, champion odds), which then prices each bet by expected value and edge.
- **Bets that settle themselves, tolerantly.** Bets grade automatically against live results, and the name matching is deliberately forgiving (more below).
- **Penalty shoot-outs kick by kick.** A tie can record the full sequence, and the match sheet renders each kick with a running tally.

### Decisions worth explaining (the why, not just the what)

- **No framework, no build step.** For a solo project with a hard end date (the final), every dependency is a future liability: a build that breaks, a package that needs patching. A single HTML file that runs anywhere, forever, with no toolchain is the cheapest thing to maintain and the easiest to hand to a friend. The trade-off is a large single file and manual DOM work, which I accepted knowingly for a bounded-lifetime app.
- **Client-side encryption instead of a backend.** The slip is private, but I didn't want to run (and secure) a server just to hide it. So it's encrypted in the browser with AES-GCM + PBKDF2 and published as ciphertext inside `data.json`; only the passphrase decrypts it. A version field lets me rotate the iteration count over time without locking out older blobs. This keeps the app fully static while still being private.
- **A two-branch release topology.** App code and the *encrypted* slip live on `main`; the *plaintext* slip lives on a separate private branch. This keeps secrets out of the public deploy by construction, and a three-way merge lets my phone and the repo both edit the slip without clobbering each other.
- **Forgiving name matching.** Feeds, screenshots, and a hand-typed slip all spell players differently. A token-bag matcher settles bets tolerant of accents (`Raúl Jiménez` = `Raul Jimenez`), suffixes, surname-only picks, initials (`V. Dijk` = `Virgil van Dijk`), and romanisation (`Hwang Inbeom` = `Hwang In-Beom`). The same logic runs in the browser and in Node so both settle identically. Getting this wrong means grading a winning bet as a loss, so it's worth the care.
- **Identity by jersey number, not name.** Deriving all per-player stats from recorded match events, keyed on shirt number, means the same goal never double-counts under two spellings. One source of truth beats reconciling several.
- **Legibility over a second data source.** Rather than chase a second lineup feed, the app makes ESPN's freshness and confidence visible ("pulled Xm ago", stale warnings) and clearly separates recorded facts from model estimates. Honesty about the data is more useful than a false sense of completeness.

### Automation and testing

- Results refresh runs on a self-hosted VPS via a `systemd` timer every few minutes (moved off GitHub Actions once the free-minutes quota ran out). GitHub Actions stays as a manual backup; a scheduled routine handles content enrichment only, not results.
- A service worker does network-first fetching so an installed PWA never serves a stale build.
- The safety net is `selftest.mjs`, a pure-Node assertion suite (no test framework) covering bracket resolution, the name matcher, penalty sequences, the three-way slip merge, encryption version migration, live-state transitions, and bet settlement. It runs in CI and as a local pre-commit gate.

---

## Part 3: What it proved (the post-mortem)

The tournament is over. Spain beat Argentina 1-0 in the final; England beat France 6-4 in the third-place playoff. So the interesting question is no longer "what does the model think" but "was any of it right". Here is the honest scorecard, measured against the pure pre-tournament model (team ratings only, no results in yet).

### The structural calls were good

The model's pre-tournament champion ranking, top to bottom, was **Spain 29.5%, Argentina 20.3%, France 12.4%, England 6.7%**. The actual final four were **Spain, Argentina, England, France**. The four semi-finalists were exactly the model's four most-likely champions, its number-one pick won the whole thing, and its number-two pick was runner-up. Reach-the-final was the same story: Spain (43.2%) and Argentina (34.4%) were its two clearest finalists, and they were the two who got there. Winning continent: UEFA at 64.9%, and a UEFA side won.

That is about as well as a probabilistic model can do without claiming to be a crystal ball. It never said "Spain, certainly". It said Spain were the most likely of a wide field at roughly three-to-one against, and the most likely thing happened. The value was in the ranking being right, not in any single number being a prophecy.

### The scoring call was not

Total goals is where the model missed cleanly. It expected **276 goals, give or take 17**; the tournament produced **308**, almost two standard deviations high. This one had more goals than the ratings implied it should, and a ten-goal third-place playoff (the England-France thriller) did not help. A calibrated model being wrong here is the model working as intended: 308 sat in the tail it had priced as unlikely, and the unlikely sometimes lands. It is a useful reminder that "calibrated" means honest about uncertainty, not immune to it.

### Calibrated does not mean profitable

The betting slip is the sharpest test, because money makes you honest. Across **104 bets staking $364**, the slip finished at **minus $39.30, a return of about minus 11%**. Eleven bets won and ninety-three lost. The single best result, **Spain and Argentina as the finalist pair at 15.0 for a $70 profit**, paid off precisely because the model's structural read was right. The bleed came from the long tail: dozens of small first-scorer and exact-scoreline punts, each priced at a slim edge, most of them missing.

That is the real lesson, and it is worth stating plainly. A model can be genuinely well-calibrated on the questions it is good at (who reaches the final, who wins the group) and still lose money when you fire a hundred small, correlated, high-variance bets at the questions it is worst at (who scores first, the exact score). Edge on paper is not the same as profit in practice once variance and the bookmaker's margin get a vote. The app was built to *show* that edge honestly, including when the honest answer was "this one is close, look but do not necessarily bet". It did.

### The bug that survived to the whistle

One failure is worth owning. For the entire tournament the pipeline never tracked the **third-place playoff**. The knockout resolver simply did not have a slot for it, so England 6-4 France went unrecorded: its ten goals were missing from the tournament total, and the bracket never showed a bronze medallist. Everything else automated cleanly for a month, and this one structural gap sat quietly the whole time because nothing downstream errored, it just silently omitted a match. It was found and closed after the final. The lesson filed under the others: silent omissions are the dangerous kind, because a pipeline that never crashes can still be quietly incomplete.

### What the whole thing demonstrated

Stepping back from the football: this was a small, single-artifact, zero-backend system that ingested a live month-long tournament from public feeds, ran a real statistical model over it, priced and self-settled a book of bets, kept a private slip encrypted in a public file, and stayed correct enough to be used daily by real people. The model earned its keep on the structural questions, stayed honest about its uncertainty on the rest, and the engineering held up under a month of live data with one bug to show for it. That is the proof: not that the model saw the future, but that a modest, legible, well-tested pipeline can turn noisy public data into calibrated, honest, useful reads, and admit clearly where it cannot.

---

*Built by Jer. Results and lineups © ESPN; historical data from the openfootball project. Projections are model estimates. Bet responsibly.*
