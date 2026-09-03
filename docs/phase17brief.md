# Phase 17 — the rising floor: making a run actually end

## Why this phase exists

Before this, a careful player could not lose. Three facts combined to make the
game unloseable by anyone paying attention:

- Fall speed caps at level 10 (`LEVEL_SPEED_CAP_LEVEL`) — nothing gets faster
  after ~90 seconds.
- The spawn pool is flat from level 13 (the last band of `SPAWN_POOL_BY_BAND`)
  — nothing gets harder after that.
- `isGameOver` fires only when **every** column is full — a competent merger
  keeps the board low, so it never triggers.

Measured on a real phone, a played run reached **level 171 and was still
going**, almost all of it past the point where nothing in the game escalates.
"How long can you last" has no answer if the answer is "forever."

This came out of a design conversation about a self-challenge / "how far can you
go" hook (the player competing against their own best survival). That hook is
worthless if the run never ends. So the one prerequisite — the whole of this
phase — is: **make the game losable, in a few minutes, without ripping out what
makes it feel good.**

## The design decision, and the alternatives rejected

Three mechanics could end a run. Only one was right for this game.

1. **Rising floor (chosen).** Every so often a new row of low fruit is pushed up
   from the bottom, raising every column by one. Guaranteed, skill-*resistant*
   fill: good play delays it, nothing cancels it. Skill still decides *how
   long*, which is exactly the contest we want.
2. **Endless speed-up (rejected).** Uncap gravity so fruit falls faster forever.
   It fights the game's own deliberate 0.8s reaction floor (`SPAWN_MIN_REACTION_SEC`,
   the "grace" the constants comments defend at length), turns a thinking game
   into a twitch test, and on a phone — where placement is a thumb-drag — fast
   precise play is miserable. Worst of all its time-to-lose swings wildly by
   player reflex, so "how long can you last" would measure reflexes, not skill.
3. **Faster spawns (rejected).** The game's own `SPAWN_POOL_BY_BAND` comment
   already documents the paradox: a harsher/faster pool can *empty* the board,
   because it feeds a skilled player more max-tier merges, and a watermelon
   merge **vanishes** (clears its cell). Least reliable of the three.

Genre note that settled it: Suika (this game's direct parent) ends a run on
*spatial* pressure — a fixed jar and a top line, no speed ramp, no garbage.
Poof Poof neutralised that inevitability on purpose (a 10-row board for
screen-fill, and vanishing watermelons), so a careful player never runs out of
room. The rising floor re-introduces the spatial inevitability the genre is
built on, without the twitch of option 2 or the backfire of option 3.

**Drop-indexed, not wall-clock.** The level-171 run was reached partly by
pausing to think between moves. A time-based floor would reward that; a
drop-based one is immune to it — a rise costs the same number of placements
however long you deliberate. It is also deterministic, which is what lets the
regression test assert termination without any timing flakiness.

## What changed, file by file

- **`js/constants.js`** — four tuned constants (`FLOOR_RISE_START_LEVEL = 3`,
  `FLOOR_RISE_DROPS_START = 16`, `FLOOR_RISE_DROPS_MIN = 5`,
  `FLOOR_RISE_TIGHTEN_PER_LEVEL = 1`) with a comment carrying the evidence.
  `BUILD_VERSION` → `2026.09.03-21`.
- **`js/state.js`** — `floorRiseCadenceDrops(level)`, a pure function of level
  (Infinity during the grace, then `DROPS_START` tightening by
  `TIGHTEN_PER_LEVEL` each level down to `DROPS_MIN`), keyed off `spawnIndex`
  exactly like `levelFor`. New run field `dropsSinceFloorRise` (init in the
  state literal, reset in `startRun`).
- **`js/physics.js`** — `raiseFloor(state)` and `riseRowTiers()`. `spawnFruit`
  reordered so the rise fires drop-indexed right after the level bump, and
  `startCol`/`hangSec` are computed **after** the rise (the rise shifts every
  column up by one, so a value read before it would be stale). The terminal
  "bail before consuming" guard is preserved at the top.
- **`js/main.js`** — a `floorRose` event handler in `drainEvents`: a light UI
  tick + a level-up-weight haptic. The board visibly jumping is the main
  telegraph; this makes a rise *felt*, not only seen.
- **`service-worker.js`** — `BUILD_VERSION` bump, kept in sync with constants.
- **`unit-tests/floor-rise.js`** (new) — the regression guard (see below).
- **`tools/tune-floor-rise.mjs`** (new) — the headless tuning harness the four
  numbers were measured with.
- **`tools/verify-floor-browser.cjs`** (new) — the one-off in-browser E2E proof.

## How the four numbers were chosen (measured, not guessed)

`tools/tune-floor-rise.mjs` imports the real `state.js`/`physics.js` and plays
greedy runs with no browser and no real-time — hundreds of full runs in a blink
— counting drops survived. A sweep over `DROPS_START ∈ {12,16,20,24}`,
`DROPS_MIN ∈ {4,5,6}` and the start level found that **every** setting keeps the
run bounded (0 unbounded across thousands of runs); the levers only trade off
run length against how much skill matters. `16 / 5 / 1 / level-3` is the balance
that keeps a casual death in the "few minutes" range while giving the opening
~40 seconds of classic, floor-free play.

Measured at the chosen values, 400 runs each strategy (a "careful" bot that
merges onto matching tops, a "careless" one that just fills the shortest
column):

| strategy | median drops | median level | max level | never-ended |
|----------|-------------:|-------------:|----------:|:-----------:|
| careless | ~132 (~4.4 min) | 14 | ~36 | 0 / 400 |
| careful  | ~167 (~5.6 min) | 17 | ~44 | 0 / 400 |

The minute figures assume a rough ~2s per drop and are a **band, not a claim** —
the honest metric is drops/level. The "careful" bot is a *lower* bound on a real
expert who plans several moves ahead, so a human's ceiling is higher than the
table, but still bounded: the cadence tightening to one rise per 5 drops
guarantees the board wins eventually.

## A consequence worth relaying to the player

"How far can you go" numbers are now **tens of levels, not hundreds** — but
bounded and *earned*. Level-171-via-patience is gone; the realistic expert
ceiling is around level 40. That is the point of the mechanic, not a regression,
but it changes what a "good score" looks like, which matters if the self-
challenge is going to be marketed.

## Verification run in the cloud sandbox

- **29 / 29** unit-test files pass (28 existing + new `floor-rise.js`).
- Playables build clean (0.318 MiB, far within limits).
- Prohibited-API sweep clean.
- **In-browser E2E** (Chromium, real game): a run reaches **game-over**, rises
  fire, the board and the game-over screen render correctly (version stamp
  `v2026.09.03-21`), **0 unexpected console errors**.
- Full feature suite (`tests/verify-features.js`): **51 checks, 0 not wired**.
- The patch was re-verified on a **separate fresh clone of `main`** (not the
  tree it was authored in): applies clean, all of the above reproduce.

## The sandbox caveat — read this (same shape as Phase 16)

My cloud sandbox blocks `youtube.com` at the proxy on **every** page load, so
the Playables SDK `<script>` (added in Phase 16) fails to load every time, and
`tests/verify-features.js` therefore logs a console error on every test and
exits 1 **here**. That is a network artefact of my sandbox, not a regression —
the network-independent signal (51 checks, 0 not wired) is clean, and there are
zero non-SDK console errors. On your real-internet machine the SDK loads and
only the deliberate offline-boot test trips the one error your Phase-16
exemption already splices out, so the suite should come back the same
0-not-wired / 0-console-errors / exit-0 it did for Phase 16. Do not read my
exit-1 as a failure; confirm the real numbers on your side.

## Definition of done (your side)

1. Apply `phase17.patch` to current `main`.
2. Re-verify on your machine:
   - all unit tests pass, including `unit-tests/floor-rise.js`;
   - `tools/build-playables.js` clean; `tools/check-prohibited-apis.js` clean;
   - `tests/verify-features.js` → confirm **51 checks, 0 not wired, 0 console
     errors, exit 0**. If the only non-zero thing is the known SDK-offline
     console line, that's the exempted one; anything else, stop and report.
3. Read the full diff. Give the `spawnFruit` reorder in `physics.js` a careful
   look: the one deliberate behavioural nuance is that `hangSec` now reads the
   post-increment gravity basis, so at a level boundary a single fruit's hang
   uses the new level's gravity — a fraction of a second on ~1 drop in 10,
   negligible and intentional.
4. Optionally run `tools/tune-floor-rise.mjs` and play a run to feel it.
5. If clean, commit / push / merge to `main` as with prior phases.
