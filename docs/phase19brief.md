# Phase 19 — the run you can read

Two complaints from real play, and they turned out to be the same complaint:

> "how does the game end? with one line full or the master line if I may call it
> that way? because it's like the game ends randomly. it gives the ending like a
> surprise because you do not even know how the game ended!!!"

> "does it stop increasing difficulty or does it increase forever? is it like the
> one where you hit a wall like the other time at level 13, or is this one
> progressive?"

The run had a shape the player could not see, and past level 14 it had no shape
at all. This phase gives it both.

---

## 1. The wall (measured, not suspected)

17's cadence tightens 16 drops → 5 drops between level 3 and level 14, then
stops. Printed straight from the shipped function:

```
  level  3 -> rise every 16 drops
  level 14 -> rise every  5 drops
  level 40 -> rise every  5 drops
```

Level 40 played **exactly** like level 14. That is the same flatline 15 was
supposed to have killed, moved further out. 17 was survivable-ending only
because the flat difficulty happens to be lethal — nothing about it grew.

### The fix

`floorRiseCadenceDrops` gets a second stage: past the stage-one floor it keeps
shaving a drop every `FLOOR_RISE_SLOW_LEVELS` (5) levels, down to
`FLOOR_RISE_DROPS_HARD_MIN`. Slow on purpose — stage one shaves a drop *every*
level, and running that slope to the end would just bury people.

```
  level  3 -> 16      level 14 -> 5      level 24 -> 3
  level 13 ->  6      level 19 -> 4      level 29 -> 2
                                         level 34 -> 1
```

### The answer to "does it increase forever"

No — and nothing can. What matters is what it stops *at*. The hard floor is a
cadence of **1**: a rise for every drop. At that point the board gains `COLS`
(6) fruit per turn and the player answers with one, while a merge frees at most
one cell (two, on a MAX_TIER vanish). **No merge rate closes that gap** — not
on any board, not with any power-up. So the end of the curve is not a plateau
you can camp on, it is a death sentence with a countdown.

Measured, from a clean **empty** board with the clock pinned at each level:

| level | cadence | drops survived (median) | max |
|-------|---------|------------------------|-----|
| 3     | 16      | 335                    | 1071 |
| 8     | 11      | 199                    | 519 |
| 14    | 5       | 99                     | 289 |
| 19    | 4       | 79                     | 247 |
| 24    | 3       | 65                     | 164 |
| 29    | 2       | 45                     | 103 |
| 34+   | 1       | **21**                 | **57** |

That last row is the answer to his question. "How far can you go" now has an
answer instead of an asymptote.

### What I tried and threw away

I first built a **second lever**: escalate the *tier* of the rising row, so late
rises arrive as peaches instead of cherries. It reads like the obvious idea. It
measures **backwards**.

4×5 sweep, cadence 5..2 × rising-row base tier 0..4, 250 runs each, one variable
at a time:

```
  cadence=5 tier=0  med 109 drops   max 299
  cadence=5 tier=4  med 134 drops   max 809     <- 2.7x the tail
  cadence=3 tier=0  med  65 drops   max 167
  cadence=3 tier=4  med  74 drops   max 302
```

Survival rose monotonically with tier at *every* cadence. Reason, once you see
it: big fruit sit close to the MAX_TIER vanish, so a high-tier row merges into
the big stuff already at the bottom of the pile and **evaporates**. Pushing up
peaches is a gift, not a threat.

So the tier lever is gone — code, constants and all. `riseRowTiers()` is back to
the two lowest tiers, permanently, and constants.js records *why* so nobody
spends an afternoon re-deriving it. Cadence is the only lever here that points
the right way.

### What this does NOT change

Nothing before level 14. Retuned over 400 runs each:

```
  [careless] med 132 drops (level 14)   [17: 132 / level 14]
  [careful ] med 167 drops (level 17)   [17: 167 / level 17]
  never-ended: 0/800
```

The typical run is **identical**. Only the tail changed, and it changed from
flat to climbing.

---

## 2. The ending you can see coming

The run has always ended for a reason — `raiseFloor`'s first loop: a rise that
finds any column already at the top. But **that top edge was never drawn**, so
the one line in the game that actually kills you was the one thing not on
screen. Hence "it ends randomly."

Three additions, none of which change a single rule:

**The ceiling line.** A dashed rule across the top of row 0 — literally where
the topout check reads (`stackHeight[c] >= rows` means that column occupies row
0 and the next rise is fatal). Quiet at 0.14 alpha on an open board, ramping to
0.9 and pulsing when a column is against it, in `theme.danger` (the game's one
red, used nowhere else).

**The next-rise meter.** A 5px strip along the bottom edge — the edge the floor
pushes from — filling as the next rise approaches. The rise is drop-indexed, so
this is an *exact* readout, not an estimate. It reads `(dropsSinceFloorRise + 1)
/ cadence`, so a **full bar means "place this one and the floor pushes."** It
draws nothing during the opening grace, where the cadence is Infinity and
promising a rise would be a lie.

**The results screen names the cause.** "The stack reached the ceiling line." —
wording chosen to point at the mark now on the board — plus **Level reached**,
which the screen never showed at all despite "how far can you go" being the
whole frame.

---

## What changed

| file | change |
|---|---|
| `js/constants.js` | `FLOOR_RISE_DROPS_HARD_MIN` 3 → **1**, `FLOOR_RISE_SLOW_LEVELS`; **removed** the three `FLOOR_RISE_TIER_*` constants; added `CEILING_LINE_*` and `RISE_METER_*`; the rejected-lever sweep recorded in a comment; `BUILD_VERSION` → `2026.09.07-23` |
| `js/state.js` | `floorRiseCadenceDrops` stage two + `stageOneFloorLevel()` (derived, never hardcoded, so retuning stage one cannot desync stage two); `floorRiseTierBase` **deleted** |
| `js/physics.js` | `riseRowTiers()` back to no argument, tiers 0/1 permanently |
| `js/render.js` | `drawCeilingLine` + `drawRiseMeter`, called last in `drawBoard` so neither the vignette nor a passing fruit can dim them; both exported for the test |
| `js/shop.js` | game-over reason line + "Level reached" |
| `service-worker.js` | `BUILD_VERSION` kept in sync |
| `unit-tests/floor-rise.js` | rewritten §1; new §1b anti-flatline guard; new §1c **terminal-state proof** (plays an empty board at the hard floor and asserts it dies) |
| `unit-tests/run-legibility.js` | **new** — 5 sections, see below |

### The two tests that matter most

`floor-rise.js` §1b — the regression guard against this exact bug returning:

```js
const harder = (a, b) => floorRiseCadenceDrops(b) < floorRiseCadenceDrops(a);
assert.ok(harder(14, 40), 'level 40 must be harder than level 14 -- the 17 flatline must not come back');
```

`run-legibility.js` §1–2 — the marks are tied to the *rules*, not drawn nearby:
the ceiling line's y must fall inside row 0 (where the topout check reads), its
alpha must be monotonic in column height, and the board that drives it to full
alpha is handed to `raiseFloor`, which must report `toppedOut: true`. If the
losing rule ever moves and the line does not, the test fails.

---

## Verification (cloud sandbox, fresh clone of `1e565b1`)

- `node unit-tests/run.js` → **30/30** (29 before, +1 new file)
- `node tools/build-playables.js` → 19 files, 0.331 MiB (limit 30 MiB)
- `node tools/check-prohibited-apis.js` → clean
- `node tests/verify-features.js` → **51 checks, 0 not wired**
- `TRIALS=400 node tools/tune-floor-rise.mjs` → 0/800 runs failed to end
- Browser proof (Playwright, 390×844): a real played run reaches game over with
  `reason: "grid-full"` and the overlay reads
  `Game Over | The stack reached the ceiling line. | Level reached: 4 | Score: 195`;
  **zero** page/console errors outside the SDK
- Pixel proof: both new marks sampled directly off the live canvas and confirmed
  distinct from the board background
- Screenshots at the three moments they exist for: resting, one-drop-out
  (bar 4/5 → now full), and a column against the ceiling (line bright red)

### Sandbox caveat (same as 16, 17 and 18)

The agent proxy blocks `www.youtube.com`, so the ytgame SDK 404s here and
`verify-features.js` exits 1 on that alone. Every one of its 51 checks passes.
On the real internet the SDK loads normally.

### One item from the plan that turned out to be nothing

I had "delete the stale `pageshow` comment in `js/main.js`" on this phase's
list. It is **not stale** — `platform.js` really does wire `pageshow` (line 197)
alongside `visibilitychange` and `focus`, so the comment is accurate. Nothing to
fix. Removed from the list rather than quietly dropped.

---

## Definition of done (your side)

1. Apply, run `node unit-tests/run.js` — expect 30/30.
2. Run `node tools/build-playables.js && node tools/check-prohibited-apis.js`.
3. `node tests/verify-features.js` (with a local server on 8642) — 51 checks.
4. Play past level 14 and tell me whether the late game now *feels* like it is
   climbing. The numbers say it is; the numbers are a greedy bot with **no
   power-ups**, which is a lower bound on you.
5. The one tunable I could not measure: `FLOOR_RISE_SLOW_LEVELS = 5` puts the
   terminal cadence at level 34. A bot reaches level 34 in 0.2% of runs — but a
   bot never uses a bomb. If level 34 turns out to be unreachable for a real
   player, lower that constant; if it arrives too soon, raise it. It is one
   number and nothing else depends on it.
