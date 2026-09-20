# Phase 22 — the floor rises on play, not on a clock

## What was actually wrong

The complaint was "the game has become too easy." The measurement says something
worse and more specific: **the game was not responding to the player at all.**

A bot was pointed at the shipped build (`2026.09.07-26`, the live GitHub Pages
build), steering through `setDragTarget` exactly the way a finger does, 300 runs
per policy:

| policy | what it does | median drops | median score |
|---|---|---|---|
| `suicide` | always stacks the **tallest** legal column — actively trying to lose | 180 | 7,585 |
| `random` | drops anywhere legal | 165 | 7,436 |
| `decent` | merges whenever a matching top is available | 188 | 12,470 |

Score answered to skill. **Survival did not.** A player deliberately trying to
lose survived 180 drops; a player playing well survived 188. Four percent apart.
Every run ended at 100% board fill with ~26 stones on the board.

The cause is `floorRiseCadenceDrops(levelFor(spawnIndex))` — the rise fired on a
pure function of the drop counter, so the board filled on a schedule no one
could push back on. The game asks "how far can you last" and answered with the
same number for everybody. That is why it felt flat: there was no threat, only
an ending.

### A correction worth recording

The first three measurement passes of this phase were **wrong**, and the way
they were wrong is the useful part. The harness set `state.active.x` to steer
the drop. `hardDrop` reads `active.targetX`. So every "policy" was dropping in
column 3, every time — the bots were identical, and they produced identical
results, which looked exactly like a damning finding about the game.

A harness check (`target column vs. column that actually grew`, 1,800 trials)
caught it: 0/1800 matched before the fix, 1800/1800 after. Every number above is
from the corrected harness. The lesson is cheap to state and expensive to skip:
**verify the instrument before trusting the reading**, especially when the
reading is dramatic.

A second hypothesis also died on measurement. `mergeOnePair` scans the whole
board and resolves every adjacent pair anywhere, so "merges resolve globally,
not where the player dropped" looked like the root cause. It was implemented and
measured: **zero effect** (0.963 → 0.964 merges/drop). The board is always in a
fully-resolved state, so a local scan and a global scan find the same merges.
The change was reverted rather than shipped on the strength of a good story.

## What changed

### 1. Pressure replaces the clock

Each drop adds `pressurePerDrop(level)` to `state.pressure`. Each merge the
**player** caused takes some back, more for higher tiers and for deeper links of
a chain. The floor rises when pressure crosses `PRESSURE_RISE_AT`, and the
overflow is carried rather than reset. `PRESSURE_PER_DROP_PER_LEVEL` grows the
fill without bound, so a run still always ends — it just ends where the player
put it. A big chain may bank credit below zero, bounded at
`PRESSURE_BANK_FLOOR`, so one lucky cascade buys breathing room and not
immunity.

### 2. The rise arrives inert

`RISE_RESOLVES_MERGES = false`. This is the load-bearing half.

The old rise resolved its own cascade, and that cascade ran at **0.48
merges/drop for a player stacking the worst column and 0.13 for one playing
well**. The floor was tidying up, for free, exactly the boards that had earned
it — a subsidy that scaled with how badly you were playing. A well-built bottom
row still pays; it pays on the next *drop*, when the player triggers it, which
was always the point.

### 3. The rise meter tells the truth

`drawRiseMeter` read `dropsSinceFloorRise / cadence`. That counter no longer
decides anything, and a meter that fills on a number the game does not act on is
a lie drawn at 60fps. Same two `fillRect`s, same bar, fed from pressure.

Nothing else was touched. No art, no colour, no layout, no audio, no copy.

## Result

Same harness, same policies, 120 runs each, on this build:

| policy | median drops | median score |
|---|---|---|
| `random` | 97 | 1,765 |
| `suicide` | 129 | 3,478 |
| `decent` | 214 | 13,623 |

| | shipped | phase 22 |
|---|---|---|
| survival spread (decent ÷ random) | 1.14× | **2.20×** |
| score spread (decent ÷ random) | 1.68× | **7.72×** |
| good player's run | 188 drops | 214 drops |
| careless player's run | 165 drops | 97 drops |

Careless play now fails in about half the time. Good play lasts slightly longer
than it used to and scores roughly eight times what careless play scores. The
game got much harder to play badly and no harder to play well, which is the only
version of "harder" worth shipping.

### Calibration

`PRESSURE_PER_DROP_BASE`, `PRESSURE_DRAIN_BASE` and `PRESSURE_PER_DROP_PER_LEVEL`
were chosen by sweep against the measured merge throughput (0.57 merges/drop
careless, 0.84 merges/drop competent), not by feel. Six combinations were run at
50 trials each; `18 / 20 / 1.2` gave the widest spread that still terminated
every run. A slower level ramp (`0.9`) matched it on spread but was rejected:
it leans on the escalation being slow, which is the wrong thing to bet on
against a human better than the bot.

Tail check, 120 runs of the strongest policy: median 212, p90 246, p99 272, max
277 drops, **all terminated**.

## Verification

- `unit-tests/run.js` — **35/35**, run three times to confirm RNG-independence.
- `unit-tests/pressure.js` — new, 7 sections: the grace holds the meter at zero
  at every point the rule is read; a drop adds exactly `pressurePerDrop` and
  crossing fires exactly one rise carrying the overflow; chains and higher tiers
  drain strictly more, matching the constants exactly rather than approximately;
  banked credit is bounded; a rise onto a board of matching pairs merges
  **nothing**; dropping onto a match still merges, so the counterplay moved
  rather than vanished; and twelve merge-greedy runs all terminate.
- `unit-tests/run-legibility.js` and `unit-tests/teach.js` — updated, not
  weakened. The meter test now sweeps the whole pressure range and asserts
  banked credit draws as an empty bar rather than a backwards one. The teach
  test now proves the rise teaches STONE and *nothing about breaking one*, then
  drives a real player-caused crack to earn BROKEN.
- `tools/build-playables.js` — 19 files, 0.433 MiB.
- `tools/check-prohibited-apis.js` — clean.
- `tests/verify-features.js` — 51 checks, 2 not wired (unchanged from baseline);
  bundle 0.433 MiB, peak heap 4.61 MiB, time-to-interactive 345 ms, zero CSP
  violations, offline boot OK.
- **Played in a real browser** (Chromium, 430×900, touch), not only in node.
  Pressure climbed ~24–27 per drop, a chain at drop 94 banked it to **−33.6**,
  three floor rises fired on the threshold and carried their overflow, and at
  drops 105–107 sustained merging held pressure flat (16.2 → 15.8 → 13.4) while
  score climbed 447 → 501 — a player holding the floor off by playing well,
  which is the entire point of the phase. Zero page errors.

## What this phase does NOT do

It does not make the game earn money. The game has **no ad integration at all** —
no `ytgame.ads.requestInterstitialAd()`, no `ytgame.ads.requestRewardedAd()`, no
continue-after-death. Per Google's own Playables monetization reference, those
are the two developer-controlled revenue surfaces, and the game implements
neither. Difficulty tuning changes how long people play; it cannot create an ad
impression that nothing requests. That is the next phase, and it is the one that
actually pays.
