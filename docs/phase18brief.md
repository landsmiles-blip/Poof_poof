# Phase 18 — the armed-power-up hang, and the rainbow refund

Two fixes. One is a run-ending bug a player reported and I reproduced; the
other is a latent regression Phase 17 introduced that Claude Code caught in
review and I said I would close properly.

## 1. The hang (reported from real play, reproduced in a browser)

**What the player saw:** "there are times the game just hangs, fruits are
falling, but you cannot direct them, even if you pause and come back again
nothing happens, it's still stuck."

**Reproduced, step by step, in Chromium at phone size:**

| step | result |
|---|---|
| fresh run | fruit steers fine (targetX 224) |
| tap the Fruit Remover chip | `removerArmed: true` |
| tap an **empty** board cell | removal fails, charge NOT spent, `removerArmed` **still true** |
| drag the falling fruit across the board | targetX **224 → 224**. Does not move. |
| pause, then resume | **still armed, still unsteerable** |

**Root cause.** `js/input.js` treats an armed Remover/Swap as "aiming mode":
both `onPointerDown` and `onPointerMove` set `armPreviewCell` and then
`return`, before ever reaching the code that steers the falling fruit. That is
correct while you are aiming. The trap is that the arm can outlive the aim:
`consumeRemover` only runs when a removal actually succeeds, so tapping empty
space leaves the tool armed — and that is **deliberate**, asserted by
`unit-tests/input-callbacks.js` ("tapping an empty cell must not consume a
charge"). `pauseRun` did not clear the flags either. The only escapes were
re-tapping the chip (not discoverable) or pressing Escape — and a phone has no
Escape key. On mobile, that is a dead run with the fruit still falling.

**Why the obvious fix is wrong.** "Disarm on a miss" would break the existing,
intentional behaviour the tests pin down — including the two-tap Swap, where a
tap on empty space must leave a pending selection untouched. So this phase does
not change what arming *means*. It bounds how long it can last.

**The fix, two independent belts:**

- `ARM_EXPIRY_DROPS = 3` (js/constants.js). Arming stamps
  `state.armedAtSpawnIndex`; `expireArmedPowerUp(state)` runs once per drop from
  `spawnFruit` — drop-indexed like the floor, so no clock and immune to pausing
  — and releases an arm that has gone unused for three drops. Three is chosen so
  Swap's two taps can span a couple of drops without the tool evaporating
  mid-gesture, while capping the worst case at a few seconds instead of a run.
- `pauseRun()` now clears `removerArmed`, `swapArmed`, `swapSelectedCell`,
  `armPreviewCell` and the stamp. Pausing is the first thing a stuck player
  tries; before this it did nothing at all. No charge is spent, because arming
  never cost one.

**Proved in a real browser, both paths:**

- *Pause path* — after the fix, the pause tap shows `removerArmed: false`, and
  the drag after resume moves the fruit **224 → 32**.
- *Self-heal path* — arm, tap empty, then touch nothing: after five unsteered
  drops the arm has released on its own and the next drag moves the fruit
  **224 → 32**.

## 2. The rainbow refund (the 17.1 follow-up)

Phase 17 reordered `spawnFruit` and, in doing so, moved two
`return { blocked: true }` bail points to *after* the line that counts a
rainbow as delivered. The original code had exactly one bail point and it sat
before that line — "bail before consuming anything", as its own comment said.
`endRun` refunds the charge only when `rainbowDelivered` is still 0, and it
reads that **before** resetting, so a floor top-out coinciding with a scheduled
rainbow would have silently eaten a charge the player paid for.

Unreachable with today's constants (`RAINBOW_SCHEDULE = [3, 8]` resolves by
drop 8; the earliest rise is drop 20) — but that safety is two independently
tunable numbers apart, and Phase 17 was a phase spent tuning one of them.
Fixed by moving the increment past every bail point, so the guarantee holds by
structure rather than by luck. My own Phase-17 comment claimed this was safe
because "endRun resets everything"; that reasoning was wrong, and the comment
is corrected in place.

## What changed

- **`js/constants.js`** — `ARM_EXPIRY_DROPS = 3`, with the bug write-up.
  `BUILD_VERSION` → `2026.09.03-22`.
- **`js/state.js`** — `armedAtSpawnIndex` field (literal + `startRun` reset);
  `armRemover`/`armSwap` stamp it, `consumeRemover`/`consumeSwap` clear it;
  new `expireArmedPowerUp(state)`.
- **`js/physics.js`** — calls `expireArmedPowerUp` once per drop in
  `spawnFruit`; rainbow-delivered count moved past every bail point.
- **`js/main.js`** — `pauseRun()` cancels any half-finished aim.
- **`service-worker.js`** — version bump, kept in sync.
- **`unit-tests/arm-expiry.js`** (new) — the bound, the headline
  arm-tap-empty-then-steer scenario, a two-tap Swap spanning a drop, and a
  source check that `pauseRun` clears the flags.

Deliberately **not** in this phase: the milestone/unlock rebalance and the
power-up economy. Those are balance decisions, and stacking them with a bug fix
would make it impossible to tell which change caused what.

## Verification (cloud sandbox)

- **30 / 30** unit-test files pass — including `input-callbacks.js` unchanged,
  which is the proof that the deliberate arming behaviour was not broken.
- Playables build clean (0.322 MiB). Prohibited-API sweep clean.
- Full feature suite: **51 checks, 0 not wired**, zero non-SDK console errors.
- Both browser reproductions above, before and after.

## The sandbox caveat (same as 16 and 17)

My sandbox blocks `youtube.com` on every page load, so the Phase-16 SDK tag
fails every time and `tests/verify-features.js` exits 1 **here**. The
network-independent signal — 51 checks, 0 not wired — is clean, and there are
zero non-SDK errors. On your machine it should come back clean as it did for
17. Don't read my exit-1 as a failure; confirm the real numbers your side.

## Definition of done (your side)

1. Apply `phase18.patch` to current `main` (base `f38328e`).
2. Re-verify: all unit tests incl. `unit-tests/arm-expiry.js`;
   `build-playables.js` clean; `check-prohibited-apis.js` clean;
   `tests/verify-features.js` → **51 checks, 0 not wired, 0 console errors,
   exit 0**. Anything beyond the known SDK-offline line, stop and report.
3. Worth doing by hand, since this one is a feel fix: start a run, tap the
   Remover chip, tap an empty square, then try to drag the fruit. It should be
   stuck for at most three drops and then hand control back — and pausing
   should hand it back immediately.
4. Read the full diff, particularly the `spawnFruit` ordering in
   `js/physics.js` (the rainbow line moved down past both bail points).
5. If clean, commit / push / merge to `main` as with prior phases.
