# Phase 21 — the ending you asked for, and what it cost to get it

Three things you asked for. Getting the first one honestly forced a change to
the game itself, and that change is the bulk of this brief.

---

## 1. The ending is now your rule, and nothing else

> "the game should end when you no longer have a move to play. and when does
> that happen when all the columns are full."

That is the rule now. The floor pushes **every** column. A column with no room
has its top fruit crushed off the board. The run ends when there is nowhere to
put the next fruit. No deadline, no grace period, no line of text on the
results screen explaining why you lost — because there is nothing left to
explain.

The results screen no longer tells you why. You asked for that too, and it was
the right instinct: the explanation only existed because the rule wasn't
self-evident.

### The three attempts, because two of them looked right

| | rule | what happened |
|---|---|---|
| 17–19 | any full column ends the run | a loss with fifty of sixty cells free |
| 20 | a full column gets one cadence of grace | still ended runs that had moves left, and needed a text explanation |
| 21 | crushed off the top; you lose when there's no move | the rule the game should always have had |

I argued against 21 last round, using 20's own measurement — letting full
columns **sit out** a rise took the median run from 21 drops to 17,325 with 13
of 40 never ending. **That conclusion was drawn from too few designs.** Sitting
out breaks the game because a capped column stops receiving fruit, so pressure
falls as the board fills. Crushing doesn't: the column still takes a fruit at
the bottom every rise, it just can't grow. Pressure holds, the board fills, the
run ends. 0 of 240 runs failed to terminate.

I also checked the obvious exploit — is keeping a column full a free-deletion
machine? No, it's a trap: **401 drops and 48,666 points** for a bot that farms
it, against **529 and 87,141** for one that plays normally. You're paying a
sixth of the board for one small fruit per rise.

---

## 2. What your rule broke, and the piece that fixes it

Here is the part you need to read, because it changes the game.

With the run ending only when the board is full, I measured the difficulty
curve and it was **completely inert**:

```
cadence 16 -> 227 drops survived
cadence 11 -> 189
cadence  5 -> 234        <- no pattern at all
cadence  3 -> 182
cadence  1 -> 203
```

Level 3 played exactly like level 60. The flatline we killed in Phase 19, back
through a different door.

**The cause is what the floor is made of.** A row of tier 0 and tier 1 fruit is
the cheapest material on the board to clear. A faster floor wasn't applying
pressure — it was **delivering ammunition**. I tried two ways to fix that by
rearranging the row. One made it worse. One inverted the curve outright:
tighter cadence, *longer* runs, half of them never ending.

So the floor now delivers something that cannot be merged away.

### The Stone

A grey slab that arrives in the rising row. It never merges — not with fruit,
not with another stone, not with a Rainbow. The curve came straight back:

```
cadence 16 -> 227 drops        cadence 4 -> 33
cadence 11 -> 189              cadence 3 -> 26
cadence  5 ->  59              cadence 2 -> 19
                               cadence 1 ->  9
```

Monotone, tight, and **0 of 360 runs failed to end**.

A wall you can't touch isn't a game, so: **a stone cracks when a merge happens
right beside it.** Merging *next to* the floor is now the correct play — which
is the "fight the floor" this design has claimed since Phase 17 and never
actually paid out. Cracking one scores.

How many stones per rise grows with the level — one at level 3, more every four
levels, capped at five of six so a rise always brings at least one real fruit.
That's the second difficulty lever this game has been missing: **cadence
controls how often the floor comes, stone count controls how much of it you
can't merge away.**

**It also fixes something you raised weeks ago.** You asked what the point of
buying power-ups was when the game hands them out. Before the stone, a 20-coin
Remover competed with simply merging, and lost. Now the Remover and the Bomb
are the only things that clear stone on demand. The shop has a job.

### It is a new element, and you can veto it

I want to be plain: this is not a bug fix, it's a piece of game design I added
because the measurements left no other way to have your ending rule *and* a
difficulty curve. If you don't want a non-fruit on your board, say so and I'll
take it out — but then the ending has to go back to a deadline, because those
two things cannot both be true.

### The numbers after

```
careless   median 155 drops, level 16, ~5.2 min   (max 205 / 6.8 min)
careful    median 188 drops, level 19, ~6.3 min   (max 231 / 7.7 min)
never ended: 0 / 400
```

Sessions are now **predictable** — the max is only about 1.3x the median, where
before it was 2–3x. For a Playable that matters more than the median itself.

Scores fell into a tighter band too, so both unlock ladders are re-spaced
against 200 fresh bot runs:

```
careless  p10 2744  med  7276  p90 11806  p99 13878  max 16064
careful   p10 8638  med 12149  p90 15024  p99 17917  max 18013

  1,500 palette | 3,000 Swap | 6,000 palette
  9,000 Bomb    | 13,000 palette | 18,000 Rainbow
```

---

## 3. The arsenal — and the debt I owed you

> "the power ups should announce itself as the levels ups do to tell the player
> that this is what they have in their arsenal."

Two things were wrong, and the second one was mine.

**A power-up unlock now pulses its own chip** in the bar at the top, alongside
the callout. The entrance is the tool arriving where you're going to tap it,
not a line of text in the middle of the board.

**And the reason you never saw a single announcement.** Your best is 17,550.
When I re-spaced the milestones in Phase 20, your save woke up already past
five of the six thresholds — Blossom, Swap, Neon, Bomb, Midnight — all granted
**silently**, because the code correctly skips announcing things you already
own. Correct in general. Wrong on the day the goalposts move. You were never
going to see a callout; there was almost nothing left to announce.

The game now records what it has **shown you**, not just what you own. Anything
earned but never celebrated is paid on the next menu:

```
IN YOUR ARSENAL
  Blossom palette
  Swap
  Neon palette
  Bomb
  Midnight palette
```

Once, then never again. And any future change to the ladder repays itself the
same way instead of quietly swallowing a reward.

---

## 4. The chain, properly this time

Phase 20 staged the merge *sparkles* along the chain. The fruit still vanished
all in one frame, so I'd decorated the exact thing that was confusing.

Now each merged fruit **stays drawn where it was until its own pop**. You watch
the chain walk across the board — pop, pop, pop — instead of six cells emptying
at once. The grid still resolves in a single frame, so physics stays
deterministic and nothing about difficulty changes; only what you see does.

The crush has its own burst too, at the top of the column where it happens. A
fruit disappearing with no visible cause is the whole problem this phase is
fixing; I wasn't going to add a new one.

---

## What changed

| file | change |
|---|---|
| `js/constants.js` | `STONE_TIER` + definition + `STONE_CRACK_POINTS`, the stone ramp constants, both unlock ladders re-spaced, `BUILD_VERSION` → `2026.09.07-25` |
| `js/state.js` | `stonesPerRise`, stone colour fixed across palettes, `announcedUnlocks` in the save, `pendingUnlocks` / `clearPendingUnlocks`, chip pulse on a power-up unlock; the ceiling-deadline state deleted |
| `js/physics.js` | `raiseFloor` rebuilt on the crush rule, `riseRowFor`, `crackStonesAround`, stone rejected in `pairTier` above the wildcard and in `swapFruits`, merges carry their consumed fruit |
| `js/effects.js` | `spawnGhost` + the ghost lifecycle |
| `js/render.js` | `drawStone`, `drawGhosts`, stone in the tier lookups |
| `js/main.js` | ghosts on every merge, crush and stone-crack cues |
| `js/shop.js` | the arsenal roll call; the game-over explanation removed |
| `css/style.css` | arsenal callout styling |
| `unit-tests/stone.js` | **new** — 5 sections |
| `unit-tests/floor-rise.js`, `run-legibility.js`, `unlock-announce.js` | rewritten for the new rule and the catch-up |

---

## Verification

- `node unit-tests/run.js` → **33/33** (32 before, +`stone.js`)
- `node tools/build-playables.js` → 19 files, 0.374 MiB (limit 30 MiB)
- `node tools/check-prohibited-apis.js` → clean
- `node tests/verify-features.js` → **51 checks, 0 not wired**
- `TRIALS=200 node tools/tune-floor-rise.mjs` → 0/400 failed to end
- A real played run through the real input path, invariants after every drop:
  180 drops, level 19, 11,780 points, **zero** violations, **zero** errors
- Screenshots: the arsenal roll call loaded from a save matching yours, and
  stones accumulating in real play

### Sandbox caveat (unchanged)

The agent proxy blocks `www.youtube.com`, so the SDK 404s here and
`verify-features.js` exits 1 on that alone. All 51 checks pass.

---

## Definition of done (your side)

1. Apply, `node unit-tests/run.js` — expect 33/33.
2. Build + prohibited-API scan + feature suite.
3. Load the menu. You should get the **IN YOUR ARSENAL** list, once.
4. Play. Three things I want your read on:
   - Does the stone read instantly as "not fruit", or does it take a beat?
   - Cracking one by merging beside it — does that feel like a play you're
     making, or an accident?
   - Does the chain now read as one connected thing?
5. If the stone is wrong for your game, say so. It is one mechanic and I can
   take it out — but the ending goes back to a deadline if I do.
