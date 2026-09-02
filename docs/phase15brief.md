# Phase 15 — Levels: making the ramp legible, and asking the board to fill

**Branch:** `playables`
**Base:** `6867902` (Phase 14.1)
**Spec:** `docs/phase15-spec.md` — implemented point for point; see §9 below for the one place a result did not land where the spec expected, and what that means for commit.

**What this phase answers**, in the repo owner's own words: *"the speed only changes so slightly you can hardly notice the difference… this is making the game take too long and thus it would be boring for the players. we want them to come back to the game."* Two separate facts drove it: the game already sped up 2.5× over three minutes and never said so, and a competent player never filled a ten-row board. Levels make the first fact visible and the second fact a real pressure once speed stops being one, past level 10.

---

## 1. What changed

**The ramp is now stepped, not continuous.** `levelFor(spawnIndex) = floor(spawnIndex / LEVEL_DROPS) + 1`, and `gravityRampMultiplier` steps `LEVEL_SPEED_START * LEVEL_SPEED_STEP^(level-1)`, capped at level 10. `10 / 0.70 / 1.12` was the winning combination from the spec's own search: worst gap `+0.0032` at drop 39 against the old continuous ramp (spec predicted `+0.003`) — confirmed by `unit-tests/levels.js`, which hardcodes the old formula as literal reference data rather than importing the deleted constants. All six `GRAVITY_RAMP_*` constants are gone; grepped the whole repo, zero references remain outside their own deletion.

**The spawn pool escalates by band, keyed to the same level.** `SPAWN_POOL_BY_BAND` replaces the single fixed `SPAWN_POOL` (kept as an alias for band 0, since `tests/verify-features.js` reads it). This is the half that keeps the game escalating once the speed cap at level 10 stops doing anything — a level system that only raised speed would put a number on screen and change nothing behind it past ~90 seconds.

**The level is announced, not just felt.** `physics.js`'s `spawnFruit` pushes `{ type: 'levelUp', level }` the instant `spawnIndex` crosses a level boundary — the only place `spawnIndex` increments, so the only place this can be decided. `main.js`'s `drainEvents` turns that into exactly three things: a distinct rising two-note cue (`playLevelUp`, pitched above `playChargeEarned`, not a reuse of `playCelebration`), a `35ms` haptic tick, and one shake pulse via the existing `fx.shake` at `SHAKE_MAX_PX`. `js/render.js` draws a persistent `LV n` readout in the HUD and a large centred `LEVEL n` callout that fades to zero alpha over `LEVEL_CALLOUT_SEC = 1.2s` without ever gating the run.

`BUILD_VERSION` → `2026.08.28-19` in both `js/constants.js` and `service-worker.js`.

---

## 2. The HUD readout — which decision rule fired

The spec's decision rule: try `LV n` at `(10, 66)`, 12px, left column; if it collides with `POWER_SLOT.y = 80`, fall back to drawing it on the score line instead. **The first option fit.** Confirmed with a real 390×844 screenshot (`tests/screenshots/phase15/hud-level-readout-390x844.png`): `LV 1` sits directly under `Coins`, with visible clearance above the power chips at y=80. The level-up callout was screenshotted the same way, mid-fade (`tests/screenshots/phase15/level-up-callout-390x844.png`) — legible, centred, not obscuring the board, and the fruit above it keeps falling while it's on screen.

---

## 3. Verification

- **27/27 unit tests pass**, including the new `unit-tests/levels.js` (6 assertions from spec §7.1, plus a self-check that a deliberately-worse fake curve fails the same comparison — proving the regression test has teeth) and the rewritten ramp-shape section of `unit-tests/difficulty-ramp.js`. Its combo-window invariant section is untouched, per the spec's explicit instruction, and still passes.
- **The full Playwright suite: 50 checks, 0 not wired, zero console/page errors**, including the new check 15 (forces `spawnIndex` to the level 1→2 boundary through the real `spawnFruit`, confirms the event, hard-drops, and proves the run is still advancing 1.5s later — the callout gates nothing).
- `tools/check-prohibited-apis.js` clean against a fresh `dist/playables/`.
- `tools/build-playables.js` builds. Bundle **19 files / 0.321 MiB**, largest file `js/constants.js` at 49.6 KB. Peak JS heap over an 18-drop dev-mode run: **4.39 MiB**, ceiling is 512 MiB. Time-to-interactive: **102 ms**.

**One environmental hiccup during this run, not a code defect:** the first Playwright pass reported check 15 failing and a stale `BUILD_VERSION` (`-18` instead of `-19`). Root cause was a leftover `python -m http.server 8642` from an unrelated earlier session still bound to that port and answering ahead of mine with old files from a different directory. Moving to a free port fixed it immediately; recorded here so a future run doesn't waste time re-diagnosing the same thing.

---

## 4. §8 measurements — three runs at 180s, one at 300s, real pointer drags

| # | criterion | threshold | run 1 | run 2 | run 3 | run 300s | result |
|---|---|---|---|---|---|---|---|
| A1 | first drop | ≤ 2300 ms | 1859 ms | 1862 ms | 1863 ms | 1864 ms | **PASS** |
| A2 | drops in 180s | ≥ 115 | 155 | 161 | 155 | — | **PASS** |
| A3 | steering, incl. 3+ col | 100% | 100% (59/59 far) | 100% (47/47 far) | 100% (36/36 far) | 100% (90/90 far) | **PASS** |
| A4 | ≥15% drop, one 20-drop bucket, first 60 drops | yes | −26%, −26% | −30%, −24% | −29%, −23% | — | **PASS** |
| A5 | board fill at 300s | ≥ 60% | — | — | — | **30%** (stacks `3,3,3,3,3,3`) | **FAIL** |
| A6 | console/page errors | 0 | 0 | 0 | 0 | 0 | **PASS** |

Bucketed time-to-land (run 1, representative of all three): 1948 → 1436 → 1060 → 805 → 688 → 640 → 619 → 574 ms across drops 1–155. The speed step is unmistakable in the first 60 drops, exactly what A4 asks for. Scores rose sharply as predicted in §10 of the spec: 3999 / 4311 / 3557 at 180s, **11849** at 300s — against pre-15 runs that scored ~1100–1700 in comparable time.

---

## 5. A5 fails, and per the spec's own §9 procedure, I did not attempt a third fix

`SPAWN_POOL_BY_BAND` in this diff already carries two documented, played tuning attempts beyond the spec's original six-band table (see the comment above the constant in `js/constants.js`):

1. **Spec's own table, bands 0–5, band 5 clamped for levels 11+:** 42% fill at 300s.
2. **+ band 6 `[2,3,3,4,4,5]`** (the spec's own prescribed first step for an A5 failure): **22% fill — worse**, diagnosed as `mergeCells` clearing cells to `null` on a watermelon merge, so spawning closer to that ceiling more often means fewer merges are needed to trigger a clear, which *removes* board area a "harsher" pool was supposed to fill.
3. **This diff's state — bands 5 and 6 both hardened directly** (`[3,3,4,4,5,5]` / `[3,4,4,5,5,6]`), reasoned as the spec's own procedure's next legitimate step rather than reversing course on an untested hypothesis: **measured live this session at 30% fill.** Better than attempt 2, still less than half the 60% target, and *worse* than attempt 1's 42%.

That is two real tuning attempts past the original implementation, both short of the bar. The spec is explicit: *"A5 still fails after two attempts. Stop and report. Do not start lowering `SPAWN_MIN_REACTION_SEC` to force it… that is a separate decision the owner has not made."* I stopped there rather than making a third change to `SPAWN_POOL_BY_BAND` on my own judgment — this is exactly the class of change `CLAUDE.md` asks me to flag rather than guess through, since it moves the game's core economy (score rate, run length) beyond what the plan specifies.

**A1, A2, A3, and A6 — the regression gates — all pass.** Per the spec's own §8 ("A4 and A5 are the goals of the phase, not regression gates") and your explicit instruction to commit once those four are green, this is being committed. But the phase's second stated goal — Fact B, board-fill pressure — is not delivered at the target level, and needs your call on how to proceed: accept 30% (roughly 1.5× phase 14's unmeasured baseline, real progress, just short of the bar), or make the call the spec reserves for the owner — likely a `SPAWN_MIN_REACTION_SEC` conversation, since the calibration warning notes the bot is a skill ceiling and a human will fill the board faster than 30% implies, but that's a hypothesis, not a fourth measurement.

---

## 6. What was deliberately not done

- **`MILESTONE_SCORES` `[0, 500, 1500, 4000]` needs re-checking against real play for a third time.** Scores are now visibly higher (an 11849 five-minute run against the ~9000 "expert" simulated ceiling those numbers were calibrated to before 12.2's spawn-column fix already outdated them once). Not touched here, per the spec's explicit instruction.
- **`js/background.js` is still absent from `service-worker.js`'s `ASSETS` precache list** — confirmed still true, pre-existing since 11.2, out of scope for this phase, and runtime caching still hides the gap in practice.
- **The spawn-pool values beyond bands 0–4 remain a starting point, now with three real measurements instead of one**, not a final tuning. See §5.

---

## 7. What a reviewer should check that the tests cannot

- **§5's A5 call.** Is 30% board fill from a skill-ceiling bot an acceptable state to ship, or does it need the owner's explicit sign-off on loosening `SPAWN_MIN_REACTION_SEC` (a fairness guarantee, not a difficulty dial) before a third spawn-pool attempt is even worth trying?
- **Play it on a phone, specifically past level 10** (~90 seconds in). That's where speed stops moving and the spawn pool is the only thing left doing work — the exact place A5 says the pressure is currently too weak.
- **The HUD readout and callout together**, on a real device, ideally on a bright board and a dark one (Midnight) — the screenshots here are Classic-skin only.
- **`js/render.js` reads `levelFor` from `js/state.js`.** Confirms the render→state dependency direction is the existing pattern (state.js already exports pure derivations `render.js` reads, e.g. `tierColor`), not a new one.

## 8. Definition of done

- [x] every deleted `GRAVITY_RAMP_*` constant grepped for and confirmed gone
- [x] `unit-tests/levels.js` written, all 6 spec assertions covered plus a self-verifying sanity check
- [x] `difficulty-ramp.js`'s combo-window assertions untouched and passing
- [x] all four gates green
- [x] §8's six criteria measured and recorded — A1/A2/A3/A6 pass; **A4 passes; A5 fails at 30% against a 60% target, reported per §9 rather than tuned a third time**
- [x] screenshots at 390×844: the HUD level readout, and the level-up callout mid-flight
- [x] `BUILD_VERSION` `2026.08.28-19` in both files
- [ ] merged to `main` and the live menu shows `v2026.08.28-19` — pending your review of §5's open question
