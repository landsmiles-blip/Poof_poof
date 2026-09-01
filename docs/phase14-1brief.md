# Phase 14.1 — Two fixes: one old and hidden, one that phase 14 caused

**Branch:** `playables`
**Base:** `c5c1396` (Phase 14)
**Provenance:** written by the auditor, who also wrote and tested the implementation. Read the diff and disagree with it where it is wrong.

Two unrelated defects, both found after phase 14 was committed. One was found by Claude Code's review of 14; the other by actually playing 14.

---

## 1. The bomb kills the run's feedback layer (pre-existing, weeks old)

**Reported by Claude Code as out of scope for 14. Correct — but it is worse than "an error on every affected detonation."**

`detonateBomb` clears its whole 3×3 **including the bomb's own cell**, so the `bombCleared` event carries a cell whose tier is `BOMB_TIER` (98). `main.js` turned each cleared cell into a burst through its own `colorForTier`, which handled the rainbow sentinel and **not** the bomb — so `skinColor` indexed a nine-entry palette with 98, returned `undefined`, and `effects.js`'s `boostVibrance` did `undefined.replace(...)`.

`js/render.js` carried a **second copy** of the same lookup which *did* handle the bomb. That is exactly why nobody caught it: the copy you would naturally read was the correct one.

**The blast radius is not one burst.** `main.js` cleared `state.events` *after* the loop, so the throw skipped the clear, the same event stayed at the head of the queue, and it threw again **every frame for the rest of the run**. Reproduced on a pristine `253f5d2`:

```
frame 1: THREW -- queue STILL holds 3 events
frame 2: THREW -- queue STILL holds 3 events
frame 3: THREW -- queue STILL holds 3 events
```

Everything queued behind it is unreachable: merge sounds, particles, squash, haptics, chip pulses — **and the pause button**, because `openPauseMenu()`'s only caller is the `pauseRequested` branch inside that loop. Phase 12.1's try/catch kept the game *drawing*, which is why it never looked broken.

**It is not rare.** `bright` is true on milestones 0–2. The Bomb unlocks at 1,500 and milestone 3 starts at 4,000, so almost every bomb a player ever uses lands on a light board. On Midnight it degrades harmlessly to wrong-coloured particles.

**The fix, in two parts.**

**(a) One lookup, not two.** `tierColor(state, tierIndex)` now lives in `js/state.js` beside the palette it reads, handles both sentinels, and is called by *both* `main.js` and `render.js`. The duplication was the bug; deleting one copy and patching the other would have left the duplication in place. Same reasoning as 14's `spawnColumnFor`.

**(b) `try { … } finally { state.events.length = 0; }`.** This is the landmine underneath (a). A dropped frame of effects is a bad outcome; a dropped *run* is a different kind of bad, and the difference is this `finally`. Any future handler throw now costs one frame.

---

## 2. `ROWS` was never one lever — phase 14 halved an active player's game

Phase 14's §5 said gravity would be left alone: one lever at a time. **That argument was wrong**, and I only found out by playing it.

Three played runs of 180 s each, real pointer drags, a bot merging as well as it can (`tools/playtest-phase14.cjs`), 390×844:

| build | drops / 180 s | score | first drop | steering |
|---|---|---|---|---|
| 7 rows, 260 px/s (what's live) | 135, 127, 132 | 1633 / 1494 / 1744 | 2.24 s | 100 % |
| **10 rows, 260 px/s (phase 14)** | **71, 69, 70** | **787 / 706 / 555** | 3.46 s | 100 % |
| **10 rows, derived (376)** | **118, 117, 116** | **1244 / 1289 / 1361** | **2.24 s** | 100 % |

**Ten rows at a fixed 260 halved an actively-played run.** Variance is tiny — 69/70/71 versus 116/117/118. This is not noise.

Steering was never the problem: **100 % of drops reached the column they aimed at at every setting**, including every 3-plus-column move. The taller board cost throughput, not accuracy.

**Two effects multiply.** The obvious one is geometry — 45 % more fall on every drop. The one that is easy to miss is that the gravity ramp is keyed to `spawnIndex`, **drops, not time**, so fewer drops means the ramp climbs slower, which means gravity stays lower, which means fewer drops still. That is why the slowdown is 2.2× and not the 1.45× geometry alone predicts.

**And it lands hardest on the good player, which is backwards.** Merge well and your stacks stay low; low stacks mean near-full-height falls on *every* drop, so you pay the tax every time. The passive player's stacks grow and their falls shorten, so they escape most of it.

**The fix is a derivation, not a number.**

```js
export const GRAVITY_BASELINE_FALL_SEC = 431 / 260;
export const GRAVITY_PX_PER_SEC =
  ((ROWS - 1) * CELL + CELL / 2 + TIERS[0].radius) / GRAVITY_BASELINE_FALL_SEC;
```

`GRAVITY_BASELINE_FALL_SEC` is **not a new tuning value.** It is exactly what 260 px/s produced on the seven-row board every constant in that file was tuned against, so the expression **reproduces 260.000 px/s at `ROWS = 7`**. That makes this a refactor plus a fix, not a silent retune of the ramp, the combo window, the spawn pool and the milestones. At ten rows it gives ~375.8.

The distance term is deliberately identical to `js/state.js`'s `emptyBoardFallSec`, because the combo window is derived from that function — a mismatch would quietly put the window out of step with the fall it exists to sit just above. **Side effect worth naming: the combo window is now back to its seven-row value too.**

**Still true and still the better long-term answer:** the genre's response to a slow fall is a drop control, and `hardDrop` is keyboard-only — a phone player cannot skip a fall at all. This change makes the wait *what it always was*, not short. A touch drop control is still worth building.

---

## 3. One comment fix

`js/constants.js` said the chute is drawn in `theme.text`; the code reads `theme.grid`. Flagged by Claude Code, and mine — the comment was written during an earlier version of the design. Corrected, with the reason recorded. Two stale references in the `ROWS` comment (`chooseSpawnColumn`, and the note claiming gravity was deliberately untouched) fixed in the same pass.

---

## 4. Verification

- **26 unit tests pass** (24 + two new).
- **Full Playwright suite: 49 checks, 0 not wired** (48 + one new). Bundle 19 files / 0.305 MiB, peak heap 4.40 MiB, TTI 163 ms.
  - The same two console 404s appear. **Pre-existing** — identical on a clean `253f5d2`.
- `tools/check-prohibited-apis.js` clean. `tools/build-playables.js` builds.
- `BUILD_VERSION` → `2026.08.28-18` in **both** `js/constants.js` and `service-worker.js`.

**Both new tests were proved to fail against the unfixed code**, which is the only thing that makes them worth having:

- `unit-tests/tier-color.js` — with the `BOMB_TIER` branch removed: *"the bomb sentinel must resolve to its own definition on skin classic"*.
- The new Playwright check — with both fixes reverted: *"queue drained to 2 after the detonation; a pauseRequested queued AFTERWARDS still opened the panel (paused=false, visible=false)"*. That is the jam and the dead pause button, reproduced end-to-end in a real browser.

`unit-tests/fall-time-invariance.js` asserts the derivation reproduces 260 px/s at seven rows, that fall time is identical across board heights from 5 to 20 rows, and that `GRAVITY_PX_PER_SEC` is actually derived rather than pinned back to a literal.

## 5. What the reviewer should check that the tests cannot

- **`tierColor` in `state.js`, not `render.js`.** It is a pure read of state plus constants, and `main.js` should not import the renderer to ask what colour something is. Confirm that placement; if it is wrong, the fix is to move it, **not** to reintroduce a second copy.
- **The `finally` swallows nothing that was not already swallowed** — phase 12.1's try/catch around the loop body was already the outer net. Confirm.
- **`GRAVITY_BASELINE_FALL_SEC = 431 / 260` is written as the division on purpose**, so the provenance of 1.6577 is visible in the expression rather than buried in a comment. Confirm that reads better than a literal.
- **Play it.** The numbers say the pace is back. Only playing says whether it is right.

## 6. Definition of done

- [ ] the diff read in full, especially §2's reversal of phase 14's own stated decision
- [ ] 26 unit tests, prohibited-API sweep, `build-playables.js`, full Playwright suite all green
- [ ] committed to `playables` as **Phase 14.1**, pushed, and merged to `main` so it can actually be played
