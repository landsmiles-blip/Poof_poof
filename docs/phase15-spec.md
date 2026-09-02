# Phase 15 — Levels — IMPLEMENTATION SPEC

**Read this whole document before writing any code.**

You are implementing a level system in `landsmiles-blip/Poof_poof`, branch `playables`, on top of Phase 14.1 (`BUILD_VERSION = '2026.08.28-18'`). This document is the specification. Where it gives a number, use that number. Where it gives a decision rule, follow the rule. Where it says MUST NOT, treat it as a hard constraint that overrides any local judgement about what would be tidier.

You are expected to disagree with anything in here that is wrong. Say so before implementing it. Do not silently substitute a different design.

---

## 0. Non-negotiables

1. **`CLAUDE.md`'s hard rules are unchanged and absolute.** No storage outside `js/platform.js`, no `visibilitychange`, no network, no orientation lock, no dynamically injected script, no in-game master mute. Nothing in this phase needs any of them.
2. **`js/physics.js` and `js/state.js` stay pure.** No DOM, no canvas, no audio, no storage. Physics pushes `{type, ...}` onto `state.events`; `js/main.js` drains them. Do not shortcut this.
3. **`js/render.js` never mutates state.**
4. **Every new tunable number goes in `js/constants.js`.** No new magic numbers in any other file.
5. **`HUD_HEIGHT` MUST NOT change.** It feeds `CANVAS_HEIGHT`, the CSS aspect-ratio fallbacks, and `unit-tests/css-geometry.js`. Changing it re-opens the entire phase-14 screen-fill chain. Fit the level readout into the existing HUD.
6. **`ROWS`, `GRAVITY_PX_PER_SEC`, `GRAVITY_BASELINE_FALL_SEC`, `SPAWN_MIN_REACTION_SEC` and `MILESTONE_SCORES` MUST NOT change in this phase.**
7. **Bump `BUILD_VERSION` to `'2026.08.28-19'` in BOTH `js/constants.js` and `service-worker.js`.** A bump in only one does not reach phones.

---

## 1. Why this phase exists

The repo owner's words: *"the speed only changes so slightly you can hardly notice the difference… this is making the game take too long and thus it would be boring for the players. we want them to come back to the game."*

Two separate facts, both measured in a real browser on the current build, 390×844, real pointer drags:

**Fact A — the game already speeds up, and it is invisible.** Median time-to-land by drop bucket, two runs:

| drops | run 1 | run 2 |
|---|---|---|
| 1–20 | 2311 ms | 2326 ms |
| 41–60 | 1194 ms | 1272 ms |
| 101–120 | 811 ms | 942 ms |

A 2.5× change across three minutes, and the game never tells the player it happened. **This phase does not create escalation. It makes existing escalation legible, and extends it.**

**Fact B — a competent player never fills the board.** Both runs ended with stacks of `2,2,2,1,2,2` after ~120 drops — one fifth of a ten-row board. Phase 14 made the board taller, which removed the space pressure that Suika Game (the closest commercial relative to this game) relies on entirely. Speed is currently the only pressure, and speed has a hard ceiling — see §3.

---

## 2. Genre evidence the design is built on

| game | level trigger | speed step per level | announced to player |
|---|---|---|---|
| Tetris (Guideline Marathon) | every 10 lines | 21–32% faster | yes |
| Dr. Mario (NES) | every 10 pills | stepped lookup table | yes |
| Suika Game | **none — no levels at all** | none | n/a |

Sources: `https://tetris.wiki/Marathon`, `https://wiki.drmar.io/index.php?title=Mechanics_%28NES%29`, `https://www.kokutech.com/blog/gamedev/design-patterns/unique-mechanics/suika-game`

Two conclusions drive the numbers below:

- **Fallers step every ~10 pieces and show the level.** Poof Poof's `state.spawnIndex` is the same counter as "pieces placed", so 10 drops per level is the genre-native choice, not an arbitrary one.
- **YouTube Playables guidance is a 30–90 second core loop.** A level system whose second level arrives after three minutes is worthless on this platform. At 10 drops per level the player reaches level 2 in roughly 25 seconds.

---

## 3. The constraint that shapes everything: the reaction floor

`SPAWN_MIN_REACTION_SEC = 0.8` holds a fruit at the top of its column whenever the natural fall would take less than 0.8 s. Therefore **total time per drop can never fall below 0.8 s, no matter how high gravity goes.**

Computed against the shipped `GRAVITY_PX_PER_SEC` of 375.8 px/s and the chosen curve in §4:

| level | from drop | multiplier | px/s | empty-board fall | fall over a 3-high stack |
|---|---|---|---|---|---|
| 1 | 0 | 0.700 | 263 | 2.37 s | 1.64 s |
| 2 | 10 | 0.784 | 295 | 2.11 s | 1.46 s |
| 3 | 20 | 0.878 | 330 | 1.89 s | 1.31 s |
| 4 | 30 | 0.983 | 370 | 1.69 s | 1.17 s |
| 5 | 40 | 1.101 | 414 | 1.51 s | 1.04 s |
| 6 | 50 | 1.234 | 464 | 1.34 s | 0.93 s |
| 7 | 60 | 1.382 | 519 | 1.20 s | 0.83 s |
| 8 | 70 | 1.547 | 582 | 1.07 s | **0.74 s — floor binds** |
| 9 | 80 | 1.733 | 651 | 0.96 s | 0.66 s — floor binds |
| 10 | 90 | 1.941 | 729 | 0.85 s | 0.59 s — floor binds |

**Speed is a real lever for levels 1–7 only, roughly the first 70 drops or 90 seconds.** From level 8 the floor eats it on any stacked column; at level 10 even an empty-board drop is at 0.85 s and the next step would go under the floor.

**This is why the speed multiplier caps at level 10 and why the spawn pool must carry escalation after that.** A level system that only raises speed would put a number on screen and deliver nothing behind it past 90 seconds. Do not implement only the speed half.

---

## 4. Change 1 — the level curve (`js/constants.js`, `js/state.js`)

### 4.1 New constants in `js/constants.js`

```js
export const LEVEL_DROPS = 10;
export const LEVEL_SPEED_START = 0.70;
export const LEVEL_SPEED_STEP = 1.12;
export const LEVEL_SPEED_CAP_LEVEL = 10;
```

**These four values are measured, not chosen by taste.** A search over `LEVEL_DROPS ∈ {10,12,15}` × `LEVEL_SPEED_START ∈ {0.60,0.65,0.70,0.75}` × step in 0.01 increments found the smallest step at each combination for which the stepped curve is **never below the ramp currently shipped in 14.2 at any drop index from 0 to 200**. `10 / 0.70 / 1.12` is the winner: worst gap `+0.003` at drop 39, i.e. it never regresses, and 10 matches the genre.

**`LEVEL_SPEED_CAP_LEVEL = 10` is derived, not picked.** At level 10 an empty-board drop takes 0.85 s. Level 11 would be 0.76 s, below `SPAWN_MIN_REACTION_SEC`, so the floor would erase it. Ten is the last level at which a speed step still changes anything.

Write a comment above these constants recording: the never-below-14.2 constraint, the search that produced them, and the reason the cap is 10. Match the existing comment style in that file — explain *why*, especially where the obvious implementation was wrong.

### 4.2 Replace the ramp in `js/state.js`

`gravityRampMultiplier(spawnIndex)` currently interpolates continuously across three segments. Replace its body. **Keep the exported name `gravityRampMultiplier`** — `js/state.js` and `unit-tests/difficulty-ramp.js` both use it, and renaming it buys nothing.

Add and export:

```js
export function levelFor(spawnIndex) {
  return Math.floor(Math.max(0, spawnIndex) / LEVEL_DROPS) + 1;
}
```

`gravityRampMultiplier(spawnIndex)` becomes:

```js
LEVEL_SPEED_START * Math.pow(LEVEL_SPEED_STEP, Math.min(levelFor(spawnIndex), LEVEL_SPEED_CAP_LEVEL) - 1)
```

**Delete these now-dead constants from `js/constants.js` and every import of them:** `GRAVITY_RAMP_START_MULTIPLIER`, `GRAVITY_RAMP_BASE_MULTIPLIER`, `GRAVITY_RAMP_CAP_MULTIPLIER`, `GRAVITY_RAMP_DROPS_TO_BASE`, `GRAVITY_RAMP_DROPS_TO_CAP`, `GRAVITY_RAMP_EASE_POWER`. Leaving orphaned constants behind is how `BG_SHAPE_*` became a trap in phase 13. **Grep the whole repo for each name before you finish** and confirm zero remaining references outside the deletion itself.

**`levelFor` MUST be a pure function of `spawnIndex` alone.** Do not read score, time, or any other state. `startRun` already resets `spawnIndex` to 0, so the level resets per run for free — do not add a separate `state.level` field that has to be kept in sync. Derive it everywhere.

### 4.3 Consequence you must verify, not assume

`comboWindowSecFor` is derived from `currentGravityPxPerSec`, so the combo window now steps with the level. That is correct and intended. `unit-tests/difficulty-ramp.js` already asserts the window stays between one and two empty-board falls at every drop index — **that assertion must still pass unchanged.** If it fails, the curve is wrong, not the test.

---

## 5. Change 2 — the spawn pool escalates (`js/constants.js`, `js/state.js`)

This is the half that keeps the game escalating after speed stops working. **It is not optional.**

`SPAWN_POOL = [0, 0, 0, 1, 1, 2]` is fixed for an entire run. Replace with a per-band table:

```js
export const SPAWN_POOL_BY_BAND = [
  [0, 0, 0, 1, 1, 2], // band 0 — levels 1-2
  [0, 0, 1, 1, 2, 2], // band 1 — levels 3-4
  [0, 1, 1, 2, 2, 3], // band 2 — levels 5-6
  [1, 1, 2, 2, 3, 3], // band 3 — levels 7-8
  [1, 2, 2, 3, 3, 4], // band 4 — levels 9-10
  [2, 2, 3, 3, 4, 4], // band 5 — levels 11+
];
export const LEVELS_PER_SPAWN_BAND = 2;
```

Band index is `Math.min(SPAWN_POOL_BY_BAND.length - 1, Math.floor((levelFor(spawnIndex) - 1) / LEVELS_PER_SPAWN_BAND))`.

`randomSpawnTier()` in `js/state.js` takes `spawnIndex` and samples from the band's pool. `nextTierFor(state)` passes `state.spawnIndex`. **`createInitialState` must pass 0**, not read a `state` that does not exist yet at that point in the object literal.

**Keep `SPAWN_POOL` exported as an alias for `SPAWN_POOL_BY_BAND[0]`** — `tests/verify-features.js` reads `C.SPAWN_POOL` to assert a flower tier appears in the opening drops, and band 0 is exactly the opening.

**Honest status of these six rows: the SHAPE is validated, the VALUES are a starting point.** A prototype with a milder table (topping out at tier 3, reached at drop 90) was played for five minutes: the board went from 20% full at three minutes to 49% full at five, so the mechanism demonstrably creates fill pressure — but the run still did not end. The table above is more aggressive than the one measured. §8 tells you how to check it and §9 tells you what to do if it is wrong.

---

## 6. Change 3 — the player can see the level

Escalation that nobody notices is the entire problem this phase exists to solve. Three pieces.

### 6.1 The event

`js/physics.js`'s `spawnFruit` is the only place `state.spawnIndex` increments. Immediately after it increments, if `levelFor(state.spawnIndex) > levelFor(state.spawnIndex - 1)`, push:

```js
state.events.push({ type: 'levelUp', level: levelFor(state.spawnIndex) });
```

**Push the event from physics; do not call audio, effects or DOM from there.** That seam is the reason this codebase is portable.

### 6.2 The reaction (`js/main.js`)

In `drainEvents`, add a `levelUp` branch that does exactly three things:

1. Play a distinct sound. **Do not reuse `playCelebration`** — that is the top-tier merge fanfare and reusing it makes both mean less. Add a short rising two-note cue in `js/audio.js`, pitched above `playChargeEarned`.
2. `vibrate(HAPTIC_LEVEL_UP_MS)` — add that constant, value `35`.
3. One shake pulse via the existing `fx.shake`, magnitude `SHAKE_MAX_PX`, duration `SHAKE_DURATION_SEC`.

**On the shake, specifically.** The repo owner asked for the screen to shake as the game progresses. Ambient shake during play is rejected: it fights the one interaction the game has, `SHAKE_MAX_PX`'s own comment says "readable, not disorienting", and shake already means "you just did something big". **A single pulse at the instant of a level change is exactly what shake is for** — it is an event, not a state. Implement it that way and no other way.

`js/effects.js` already cuts shake entirely under `prefers-reduced-motion`. Do not special-case it; the sound and the readout still fire, which is correct.

### 6.3 The readout and the callout (`js/render.js`)

**The persistent readout.** The HUD must show the current level at all times during a run.

Existing HUD occupancy, verified from `drawHUD`: `Score` at (10, 6) 20px bold; `Best` at (10, 32) 13px; `Coins` at (10, 50) 13px; combo meter centred (only when `comboCount >= 2`); `Next` label at (width-10, 6) right-aligned with its preview fruit centred at (width-30, 38); power chips and pause button in the `y: 80–106` strip.

**Decision rule, in order.** Draw `LV n` in the left column at `(10, 66)`, 12px. Screenshot it at 390×844 and confirm it does not touch the power chips, whose top edge is `POWER_SLOT.y = 80`. **If it collides**, do not shrink the font below 12px and do not move `POWER_SLOT` — instead draw it on the score line, to the right of the score text, positioned with `ctx.measureText` on the already-rendered score string plus a 12px gap, at 13px, vertically aligned to the score. Whichever of the two you end up with, say in the brief which one and why.

**The callout.** On level-up, draw the new level large and centred over the board for `LEVEL_CALLOUT_SEC = 1.2` seconds: `DISPLAY_FONT_FAMILY` (Titan One, already loaded for the wordmark), scaling up and fading out, drawn over the board and under nothing.

Hard constraints on the callout:
- **It MUST NOT pause, slow, or gate the run.** Fruit keeps falling. It is decoration over live play.
- **It MUST NOT block the board.** Alpha must reach 0 by the end. Peak alpha no higher than 0.85.
- Its timer lives in the `fx` object (`js/effects.js`), like every other timed effect, and is cleared by `clearEffects`. **It MUST NOT live in `state`** — it is presentation, and `state` is what gets saved.
- Under `prefers-reduced-motion` it still appears but does not scale — fade only. Match how `REDUCED_MOTION_SQUASH_SCALE` handles the merge pop: reduced, not removed.

---

## 7. Tests you must write

### 7.1 `unit-tests/levels.js` (new)

Assert, against the real modules:

1. `levelFor(0) === 1`, `levelFor(LEVEL_DROPS - 1) === 1`, `levelFor(LEVEL_DROPS) === 2`. The boundary is where an off-by-one lives.
2. `levelFor` never decreases as `spawnIndex` increases, from 0 to 500.
3. `gravityRampMultiplier` never decreases, and never exceeds the level-10 value, from drop 0 to 500.
4. **The curve is never below the 14.2 ramp it replaced.** Hardcode the old formula inside this test as reference data — `0.6 → 1.0` eased quadratic over 40 drops, `1.0 → 1.3` linear to 120, flat after — and assert the new multiplier is greater than or equal to it at every drop index 0 to 200. **This is the assertion that stops a future retune from silently making the game slower than the build the owner already approved.**
5. The spawn band advances at the right levels, and every tier the table can emit is a valid index into `TIERS`.
6. A fresh `startRun` reads back at level 1.

### 7.2 `unit-tests/difficulty-ramp.js` (existing — rewrite the ramp-shape section only)

It currently asserts against `GRAVITY_RAMP_DROPS_TO_BASE` and friends, which this phase deletes. Rewrite **only** the assertions that name those constants. **Do not touch the combo-window sections** — those assert the window sits between one and two empty-board falls, which is the invariant that must survive this change untouched. If they fail, fix the curve.

### 7.3 `tests/verify-features.js` (existing — add one check)

Add a check named `15: levels are visible and announced` that, in a real browser:
- forces `state.spawnIndex` to `LEVEL_DROPS - 1`, spawns one fruit through the real `spawnFruit`, and asserts a `levelUp` event with `level === 2` was pushed;
- asserts the HUD shows the level (screenshot, plus reading the rendered canvas is not required — a screenshot in `tests/screenshots/` is sufficient evidence);
- asserts the run is **still on the playing screen and `spawnIndex` is still advancing 1.5 s after the level-up**, i.e. the callout did not pause anything.

---

## 8. Acceptance criteria — run these, do not skip them

All four existing gates must pass: `node unit-tests/run.js`, `node tools/build-playables.js`, `node tools/check-prohibited-apis.js`, and the full Playwright suite in `tests/verify-features.js`.

Then measure. `tools/playtest-phase14.cjs` is a played-run harness — real pointer drags, a bot that merges greedily — and it prints median time-to-land bucketed by drop index. **If that file is not in the repo, say so and stop; do not fabricate the numbers.** Run it three times at `SECONDS=180` and once at `SECONDS=300`.

| # | criterion | threshold |
|---|---|---|
| A1 | First drop of a fresh run | ≤ 2300 ms. **Regression gate** — it is 2225–2326 ms today. |
| A2 | Drops in 180 s | ≥ 115. It is 118–122 today. Fewer means the curve went slower somewhere. |
| A3 | Steering accuracy | 100%, including 3+ column moves. Anything less means the speed outran the controls. |
| A4 | Consecutive drop buckets | at least one 20-drop bucket showing a **≥ 15%** drop in median time-to-land within the first 60 drops. This is "you can feel it". |
| A5 | Board fill at 300 s | **≥ 60%**. Today it is 49% with a milder pool table. This is the criterion that says the spawn-pool half actually did something. |
| A6 | No console or page errors | zero, in every run. |

**A1, A2, A3 and A6 are regression gates: if any fails, the phase is wrong and must not be committed.** A4 and A5 are the goals of the phase; see §9.

---

## 9. If A4 or A5 fails — tuning procedure

**Do not tune by feel and do not tune more than one thing at a time.** Re-measure after each change.

- **A4 fails (no felt step).** Raise `LEVEL_SPEED_STEP` in 0.02 increments, maximum 1.20. Re-run test 7.1.4 each time — it must still never fall below the old ramp. Do not lower `LEVEL_DROPS` below 10; that breaks the genre-native pacing this is built on.
- **A5 fails (board still not filling).** Make the spawn table more aggressive, band 3 upward only. Leave bands 0–2 alone: those are the first 60 drops and the first 60 drops are already approved by the owner. Add a band 6 of `[2, 3, 3, 4, 4, 5]` before you make band 5 harsher.
- **A5 still fails after two attempts.** Stop and report. Do not start lowering `SPAWN_MIN_REACTION_SEC` to force it — that constant is the fairness guarantee for a fruit arriving over a tall column, there is no touch drop control to compensate with, and lowering it is a separate decision the owner has not made.

**Calibration warning you must respect.** The playtest bot merges near-optimally and never misreads the board. **It is a skill ceiling, not a typical player.** Do not tune until the *bot* dies — a human will fill the board far faster, and a build that kills the bot in three minutes will kill a person in forty-five seconds. A5 targets board *fill*, deliberately, not death.

---

## 10. Known consequences to record in the brief, not to fix here

- **Scores will rise.** Bigger fruit spawn later and are worth more; a prototype run scored 4373 in five minutes. `MILESTONE_SCORES` has been flagged provisional since 13.2 and is still un-rechecked. **Do not change it in this phase.** State in the brief that it now needs re-checking against real play for the third time.
- **Runs will get shorter.** That is the point. If the owner comes back with "it ends too fast", the lever is §9's spawn table, not the board size.
- **`js/background.js` is missing from the service worker's `ASSETS` precache list** — the only JS module absent from it, since phase 11.2 added it. Runtime caching hides it. Pre-existing, out of scope, worth a line in the brief.

---

## 11. Deliverables

1. The implementation.
2. `docs/phase15brief.md`, written to the same standard as `docs/phase14brief.md`: what changed, why, what was measured with the actual numbers from your runs, what you deliberately did not do, what a reviewer should check that the tests cannot, and any place you disagreed with this spec and what you did instead.
3. All four gates green, plus the §8 measurements pasted in the brief.
4. Committed to `playables` as **Phase 15**, pushed, and merged to `main` — **pushing `main` is the deploy**; the Pages workflow triggers on it.

## 12. Definition of done

- [ ] every deleted `GRAVITY_RAMP_*` constant grepped for and confirmed gone
- [ ] `unit-tests/levels.js` written, and each assertion proved to fail against the unfixed code before it was made to pass
- [ ] `difficulty-ramp.js`'s combo-window assertions untouched and passing
- [ ] all four gates green
- [ ] §8's six criteria measured and recorded, with A1/A2/A3/A6 passing
- [ ] screenshots at 390×844: the HUD level readout, and the level-up callout mid-flight
- [ ] `BUILD_VERSION` `2026.08.28-19` in both files
- [ ] merged to `main` and the live menu shows `v2026.08.28-19`
