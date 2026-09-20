# Phase 23 — a curve that climbs the whole way, and a way to fight it

## What phase 22 got wrong

Phase 22 moved the floor rise off the drop counter and onto the play. That part
worked and stands. What it shipped alongside was a curve that did not bite until
the run was nearly over.

Measured on `2026.09.20-27`, 250 runs, competent play (merge whenever possible):

| level | rises per 10 drops | board fill | survival to next level |
|---|---|---|---|
| 5 | 0.00 | 13% | 100% |
| 10 | 0.15 | 20% | 100% |
| 15 | 0.56 | 35% | 100% |
| 17 | 0.70 | 46% | 100% |
| 20 | 1.01 | 64% | 88% |
| 22 | 1.27 | 70% | 73% |

**Survival was 100% all the way to level 17.** Nothing could kill you for the
first ~170 drops — roughly three minutes of a four-minute run — and then it
arrived as a cliff. The floor first moved at level 12. That is the "still very
simple" complaint, and it is a real defect, not a matter of taste.

The cause was `PRESSURE_BANK_FLOOR = -60`. A buffer that deep meant the meter
had to climb 160 points before it could ever fire, so in practice it did not. A
guard rail intended for the rare enormous cascade was in fact load-bearing for
every run.

### Two measurement corrections, recorded because they nearly cost the phase

**The first reading of this curve was wrong.** The harness cleared `state.events`
*after* calling `spawnFruit` — but the rise fires inside `spawnFruit`, so every
`floorRose` event was wiped before it could be counted. It reported "0.00 rises
at every level" and "net pressure negative at every level", and the conclusion
drawn from it — that the pressure system was switched off entirely for good
players — was false. Sampling pressure only after the spawn also meant the
"net" figure was measuring the drain half and none of the fill.

This is the second harness bug in two phases (phase 22's steered with
`active.x`, which `hardDrop` ignores). Both were caught by checking the
instrument rather than believing a dramatic result. **The order in this game is
`spawnFruit` (fill, maybe rise) then `hardDrop` (merges, drain)** — anything
sampling per drop has to bracket both.

**And the first three tuning attempts were rejected on measurement.** Removing
the tier bonus outright, and raising the per-level fill to 2.5–3.5 at the same
time, brought risk forward correctly but collapsed the competent run from 218 to
94–111 drops and the skill spread from 2.18x to ~1.3x. Harsher is not the same
as better.

## What changed

### 1. The curve moves forward and climbs all the way

`PRESSURE_PER_DROP_BASE` 18 → 20, `PRESSURE_PER_DROP_PER_LEVEL` 1.2 → 2.5,
`PRESSURE_DRAIN_BASE` 20 → 18, `PRESSURE_DRAIN_CASCADE_BONUS` 0.35 → 0.55, and
the one that actually mattered, `PRESSURE_BANK_FLOOR` −60 → −20.

### 2. The comeback: a merge is worth more the closer the floor is

`PRESSURE_CLUTCH_BONUS = 1.0`. Drain scales linearly from the plain base rate at
an empty meter to double at a full one, clamped at both ends. A three-link chain
with the bar nearly full drains about four times what a single merge on an empty
bar does.

This is what lets the curve above be genuinely steep without the ending becoming
arbitrary. The game leans harder every level; fighting back pays most exactly
when it is leaning hardest. It is invisible as a rule and obvious as a feeling —
the bar visibly craters when a chain lands under pressure.

### 3. The bomb buys cells, not time

`PRESSURE_DRAIN_BOMB_CASCADE = 0`, gating the bomb's cascade the same way the
rise's already was.

Measured on `2026.09.20-27`, 200 detonations on real mid-run boards: one bomb
refunded a median **47.8** pressure (half a rise; a full one at p90) to a player
dropping at random, and **exactly 0.0** to a player merging as they went —
because a competent board has no backlog for its full-board sweep to find. Same
subsidy-for-bad-play shape phase 22 removed from the rise, hiding inside an
item. The clutch would have made it worse, since a bomb is used when the meter
is high, which is precisely when a drain is worth most.

The bomb still clears its nine cells, still sweeps, still scores. Re-measured
after the gate: median refund **0.0**, max **0.0**, across 199 detonations.

Nothing else was touched. `js/render.js` is not in this diff at all — the meter
has read pressure since phase 22, so the new curve needed no visual change.

## Result

250 runs per policy:

| policy | drops (p10 / med / p90 / max) | median score |
|---|---|---|
| random (careless) | 69 / **82** / 101 / 125 | 1,431 |
| suicide (worst play) | 83 / **101** / 120 / 139 | 2,174 |
| decent (competent) | 126 / **141** / 163 / 185 | 6,286 |

The curve, competent play, 250 runs:

| level | rises per 10 drops | board fill | survival |
|---|---|---|---|
| 5 | 0.03 | 13% | 100% |
| 8 | 0.70 | 24% | 100% |
| 10 | 0.97 | 35% | 100% |
| 12 | 1.44 | 52% | 99% |
| 14 | 1.58 | 71% | 68% |
| 16 | 2.06 | 79% | 35% |

The floor now starts moving around level 6–8 instead of 12, board fill climbs
smoothly instead of sitting flat and then spiking, and survival declines by
degrees from level 12 rather than falling off a cliff at 18. Careless play meets
the floor at level 3 and is dead by level 8.

### The cost, stated plainly

A competent run is 141 drops where phase 22 gave 211, and scores about 6,300
where phase 22 gave 13,000. Survival spread is 1.77x (was 2.28x) and score
spread 4.53x (was 7.9x). That is the price of a curve that escalates: the deep
runs are the ones escalation is designed to catch, so they shorten most.

A gentler tune was measured and rejected: `Fg=1.8, B=-25` kept 184 drops and
10,635 points but only moved the first rise from level 12 to level 10 and risk
from 16 to 16 — nearly the same game, and it would have earned the same "still
very simple" verdict.

**One consequence to be aware of: existing high scores are now much harder to
beat.** A personal best set on an earlier build sits in a scoring range this
build rarely reaches. Scores were left alone rather than inflated to match; if
that stale best becomes a problem, the options are a one-off reset or a scoring
pass, and neither belongs in a difficulty phase.

## Verification

- `unit-tests/run.js` — **36/36**, run three times for RNG-independence.
- `unit-tests/clutch.js` — new, 7 sections: the comeback is exactly linear in
  danger and clamped at both ends against the constants, not approximately; a
  chain under pressure beats both a lone merge under pressure and the same chain
  when safe; a bomb on a full backlog with the meter at 90% refunds exactly
  nothing; the player's own merge still pays, and pays more under pressure; fill
  rises at every level and by at least 80% by level 15; the floor actually moves
  during competent play and moves before level 12 (the phase-22 defect, as a
  regression test); and banked credit is still bounded.
- `tools/build-playables.js` — 19 files, 0.436 MiB.
- `tools/check-prohibited-apis.js` — clean.
- **Played in a real browser** (Chromium, 430x900, touch), started at level 12:
  **7 floor rises in 26 drops**, and at drop 132→133 the meter went **96.9 →
  33.1** on a single merge while the score jumped 239 → 295 — the comeback
  visibly throwing the floor back at the last moment, which is the exact moment
  this phase exists to create. Zero page errors.

## Still not done

The game still has **no ad integration**: no `ytgame.ads.requestInterstitialAd`,
no `ytgame.ads.requestRewardedAd`, no continue-after-death. Difficulty work
changes how the game plays. It cannot create an ad impression that nothing
requests. A shorter, sharper run with a real near-miss at the end is a better
home for a rewarded "keep going" prompt than phase 22's was — but the prompt
does not exist yet, and that is where the revenue is.
