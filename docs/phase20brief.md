# Phase 20 — the run that plays fair

Everything from your two questions, my audit of the shipped build, and two
independent code audits, fixed in one pass. Thirteen defects, two features, and
one thing I got wrong in Phase 19 and have to correct in print.

---

## 1. The ending — you were right, and the fix took three attempts

### What was wrong

Two different rules for losing, disagreeing by fifty cells:

- **Ordinary drop:** the run ends only when **every cell** is full. I filled 59
  of 60, left one gap, dropped a fruit — game continued.
- **A floor rise:** the run ends if **any one column** is full.

```
   6 . . . . .          one column capped
   5 . . . . .          five columns empty
   6 . . . . .          50 of 60 cells free
   ...
   floor rises  ->  RUN OVER
```

And because the floor rises constantly, the harsh rule was the one in charge
almost the whole run. That is "it ends randomly and yet there are still spaces
to play", exactly.

It was never a designed rule. It was `raiseFloor` protecting itself: shifting a
full column up would push its top fruit off the board, and "cannot shift" got
written down as "you lose".

### Two fixes that were built, measured, and thrown away

**Attempt 1 — full columns sit the rise out.** Fair, and it destroys the game.
Every capped column stops taking fruit, so incoming pressure *falls* as the
board fills. The board finds an equilibrium and stops ending.

```
terminal cadence, median run:   21 drops  ->  17,325 drops
never ended:                    0 / 40    ->  13 / 40
```

**Attempt 2 — redistribute: a rise always brings COLS cells, into whatever
columns have room.** Holds pressure constant on paper. Worse in practice —
**34 of 40 runs never ended** — because concentrating small fruit into few
columns feeds cascades faster than it fills the board.

### What I got wrong in Phase 19, in print

Both failures taught the same thing, and it corrects a claim the Phase 19 brief
made confidently:

> "terminal by arithmetic: a rise inserts COLS fruit against one drop, and a
> merge frees at most one cell. No merge rate closes that gap."

**That was wrong.** Merges *can* outpace the floor — the measurements above are
the proof. What was actually ending runs the whole time was the one-full-column
rule. The arithmetic was never doing the work I said it was.

### The fix that shipped

A column at the ceiling is a **deadline, not a loss**, and the deadline is
exactly **one floor cadence** — you have until the floor pushes again. Clear a
cell in it and the deadline is gone.

The deadline belongs to **the column**, not to the board, and that distinction
is load-bearing — see section 6 for what happened when it wasn't.

Keying the grace to the cadence rather than to a fixed number of drops does
three things no fixed number could:

- it **scales itself** — 16 drops of grace early, 5 by level 14, 1 at the
  terminal cadence, so the endgame stays exactly as lethal as it was;
- it keeps **one clock** in the game instead of two competing ones;
- and the **next-rise meter you have been reading all run turns out to be the
  countdown**. No new gauge. The one already on screen was it.

Measured, empty board, difficulty clock pinned:

| level | cadence | median drops survived | never ended |
|-------|---------|----------------------|-------------|
| 14 | 5 | 94 | 0/40 |
| 24 | 3 | 56 | 0/40 |
| 34 | 1 | **22** | 0/40 |
| 60 | 1 | 20 | 0/40 |

Level 34 was 21 drops before this phase. The endgame is unchanged; only the
unfairness is gone.

Full runs, 400 each: careless median 136 drops (level 14), careful 166 (level
17), **0 of 800 failed to end**.

---

## 2. The popping — not a glitch, and now you can see why

It is a chain reaction and it is meant to be there. The problem was that
`resolveMerges` is one synchronous loop: merge a pair, repack the column,
rescan from the top, repeat — *all before a single frame is drawn*. Traced:

```
before:   . . 0 . . .          you drop into column 2
          . . 0 1 2 .

after:    . . . . . .          four fruit gone, one tier-3 in COLUMN 4
          . . . . 3 .          in one frame, with no visible cause
```

The grid still resolves in one frame — physics stays synchronous and
deterministic, and the difficulty design depends on that. **Only the feedback
is staged.** Each merge now carries its position in the chain, and its pop is
delayed by that many beats (70ms, capped at six), so the chain plays out in the
order it actually happened and you can watch it travel.

**And the one that really does look like a bug:** two watermelons merging
**vanish** and leave nothing, where every other merge leaves a bigger fruit.
That now gets its own expanding ring — the same mark a bomb makes, and for the
same reason: it says *something left this square*, not *something grew here*.

---

## 3. Unlocks that land on the run that earned them

Your note: *"as the power ups unlock, announce it — give it a glow where the
player knows he has access to this arsenal."*

An unlock now fires **the moment the score crosses it**: a celebration sound, a
haptic, and an `UNLOCKED / <name>` callout on the board, reusing the level-up
envelope rather than growing a second one.

And the reason six things used to arrive at once: **skins and power-ups sat on
the same three thresholds** (500 / 1500 / 4000). Every milestone fired two
rewards, and all three fell inside one good run.

The two ladders now **interleave**, re-spaced against measured scores
(`tools/measure-scores.mjs`, 400 bot runs each, no power-ups, so a lower bound
on you):

```
careless  p10 2546  med 6681   p75 10095  p90 13895  p99 21559
careful   p10 6953  med 11878  p75 15359  p90 19336  p99 27489

  1,500  palette      3,000  Swap       6,000  palette
  9,000  Bomb        15,000  palette   22,000  Rainbow
```

Six distinct moments. One or two unlocks in a typical run, the last palette a
genuinely strong one, and the Rainbow a real chase.

---

## 4. The eleven other defects

**Mine, from Phase 19:**

| | |
|---|---|
| The first floor rise fired with **zero** warning | The drop counter ran through the opening grace, so it hit 20 against a cadence of 16 and the very first rise fired instantly at level 3 — with the meter, which draws nothing while the cadence is infinite, never having appeared. Twenty silent drops, then the floor jumps. Held at zero until the mechanic is live. |
| The rise meter was **clipped by the screen shake** | 5px meter, flush against the bottom edge, and `SHAKE_MAX_PX` is also 5. Every level-up chopped it. Both marks now draw outside the shake — steady as well as intact. |
| The ceiling line was **nearly invisible** | Measured 1.13:1 against the dark palette. Now 0.42 alpha, 1.75:1 at worst. |
| A comment that **said the opposite** of what the code did | `drawCeilingLine`'s pulse condition. |

**Older, found by audit:**

| | |
|---|---|
| **Swap acted on the wrong fruit and billed you** | The selection held a raw grid coordinate between your two taps, and nothing rebased it — a rise shifts every row up, a merge repacks a column down, and both happen in that gap. Proven: tap a tier 6, one rise later that cell holds a tier 5, and the game swapped the 5. Now rebased exactly through both, carries the tier it was made on, and is dropped rather than guessed at. |
| **The bomb never fired on the board it exists to rescue** | The fuse was ticked *after* the "no room" bail, though its own comment claimed otherwise. If the drop that filled the last cell was the drop the fuse would end on, your 60 coins bought nothing. |
| **Hard-drop ignored your aim** | It read where the fruit had physically eased to, not where you aimed. Measured: 3 of 8 keyboard drops landed in the wrong column. |
| **"Next" was covered by the fruit** | Seven of nine tiers overlapped the label. Moved clear. |
| **The merge bar was drawn through the chip numbers** | Label at y 108–117, bar at y 110–113, bar painted second. "500" and "1500" were struck out. |
| **"Best combo: 187x"** | The multiplier caps at nine merges and the streak never lapses between drops, so it just counted every merge in the run — a real run reported **530**. Replaced with the biggest chain one drop set off, which actually varies. |
| **A free Remover every boot** | It inferred "new save" from an empty inventory plus a zero score, both true again after you spend it and quit. Now recorded in the save, with legacy saves handled both ways. |
| **No label on the Cart/Palette back button** | A screen reader announced nothing. |
| **No board glow on the first menu of a session** | The canvas was still hidden when it was measured. |

Plus: the Cart now explains that you **tap a chip to arm it, then tap the fruit**.

---

## 4b. Three comments that described the code we no longer have

Two of this phase's bugs were "the comment says one thing, the code does
another", so I swept for the rest and found three more — all of them left by
this phase's own changes:

- `raiseFloor`'s header still said a rise "cannot proceed if any column already
  reaches the ceiling ... and that IS the loss". That is exactly the rule
  section 1 removed.
- `FLOOR_RISE_DROPS_HARD_MIN` in `constants.js`, and the matching note in
  `floorRiseCadenceDrops`, still carried Phase 19's "unsurvivable by
  arithmetic" claim. Both now carry the correction and the measurement that
  disproved it, so the next person reads what is true rather than what I
  believed.
- Two references to `CEILING_GRACE_DROPS`, a constant that existed for about
  twenty minutes in the middle of this phase before the deadline moved onto the
  floor cadence.

---

## 5. One bug I introduced and caught mid-phase

Fixing hard-drop to honour your aim broke every headless test harness — they
set the fruit's position directly, which the old code read. Every bot fruit
started landing in the spawn column, and the first score measurements I fitted
the milestone ladder to were taken with that harness. Caught it, routed all
five harnesses through the real steering API, re-measured, and re-spaced the
ladder against the corrected numbers. The figures in section 3 are the
corrected ones.

---

## 6. A bug review caught before this shipped

The first version of the ceiling deadline used **one boolean for the whole
board**. Review — Claude Code, on the function it was told to scrutinise
hardest — found that this reintroduces the exact defect the phase exists to
remove, on a rarer trigger, and proved it by execution rather than by reading:

```
col 0 capped
  rise 1 -> toppedOut false | warned = true        (correct)
player frees a cell in col 0; col 1 tops off through ordinary play
  rise 2 -> toppedOut TRUE                          (wrong)
```

Column 1 died with **zero** grace, because it inherited the warning column 0
had armed and then cleared. An instant, unwarned loss with the rest of the
board playable — precisely what section 1 is about.

Reproduced here independently, then fixed: the flag is now per column, checked
per column, and re-armed per column after the cascade. A deadline belongs to
the column that earned it.

The gap had no test coverage because the existing cases all used a single
column throughout. `unit-tests/floor-rise.js` §3c is now the multi-column case:
rescue one column, cap another in the same cadence, assert the new one gets its
own full grace — and still dies on the rise after that, so the fix removes the
unfairness without removing the ending.

Re-measured after the fix: careless median 141 drops, careful 166, **0 of 600
runs failed to end**, terminal cadence still kills an empty board in a median of
20 drops.

The brief also overstated the guarantee before this — it described a
per-column deadline while the code tracked one globally. Corrected above.

---

## Verification

- `node unit-tests/run.js` → **32/32** (30 before: +`audit-fixes.js`,
  +`unlock-announce.js`)
- `node tools/build-playables.js` → 19 files, 0.356 MiB (limit 30 MiB)
- `node tools/check-prohibited-apis.js` → clean
- `node tests/verify-features.js` → **51 checks, 0 not wired**
- `TRIALS=400 node tools/tune-floor-rise.mjs` → 0/800 failed to end
- A real played run through the real input path, invariants checked after
  **every drop**: 171 drops, level 18, 12,945 points, 19 floor rises,
  **zero** invariant violations, **zero** console errors
- Screenshots confirming the HUD fixes and the live unlock callout

### Sandbox caveat (unchanged since 16)

The agent proxy blocks `www.youtube.com`, so the SDK 404s here and
`verify-features.js` exits 1 on that alone. All 51 of its checks pass.

---

## What I did NOT change

- The chain still resolves in one frame. Staging the *grid* would make physics
  time-dependent, and the whole drop-indexed difficulty design rests on it not
  being.
- The combo mechanic itself. Only what is displayed changed.
- `DRAG_LERP`. The fruit still has weight; hard-drop just respects the aim now.

## Definition of done (your side)

1. Apply, `node unit-tests/run.js` — expect 32/32.
2. Build + prohibited-API scan + feature suite.
3. Play it. Specifically: get a column to the ceiling on purpose and confirm
   you get a real chance to dig out; watch a chain travel and tell me whether
   it now reads as one connected thing; and see whether the unlock callout
   lands as a moment or as an interruption.
4. The milestone numbers are fitted to a bot that never uses a power-up. You
   do. If the ladder feels too slow or too fast, it is two arrays in
   `constants.js` and nothing else depends on them.
