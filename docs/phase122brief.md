# Phase 12.2 — Where a fruit comes from, and when the run is actually over

**Branch:** `playables`
**Base:** `2209192` (Phase 13)
**Provenance:** written by the auditor, who also wrote and tested the implementation before handing it over. Read the diff and disagree with it where it is wrong; the brief exists to be checked against, not implemented from.

Specified originally as §12.2 of `docs/phase12brief.md`. That section stands, with two corrections recorded in §4 below — one of them a correction to my own evidence.

---

## 1. The problem, measured in the real game

Not simulated. Six runs on the shipped build, in a browser, touching nothing:

| run | time | drops | score | board | final stacks |
|-----|------|-------|-------|-------|--------------|
| 1 | 18.0s | 12 | 40 | 17% | `0,0,0,7,0,0` |
| 2 | 13.5s | 9 | 19 | 17% | `0,0,0,7,0,0` |
| 3 | 18.8s | 12 | 37 | 17% | `0,0,0,7,0,0` |
| 4 | 13.4s | 10 | 28 | 17% | `0,0,0,7,0,0` |
| 5 | 13.5s | 9 | 12 | 17% | `0,0,0,7,0,0` |
| 6 | 13.5s | 9 | 12 | 17% | `0,0,0,7,0,0` |

**Median 13.5s. Every single run ended in the identical shape.** Seventeen percent of the board used, five columns completely empty.

`spawnFruit` spawned at `Math.floor(COLS / 2)` — column 3 — and `isGameOver` read that one column. Every fruit the player failed to steer landed in the one column that ended the run, and free space everywhere else counted for nothing.

## 2. What changed

**Two changes that only work together.** Either alone makes the game worse.

**(a) The spawn column varies.** A plain uniform pick across the six columns, redirected outward to the nearest column with room when the chosen one is full — the same alternating left/right search `columnForX` already performs, reused rather than duplicated.

**(b) The run ends when no column has room.** `isGameOver` now loops. This is the one line that stopped five empty columns from counting for nothing.

**(c) A floor on reaction time.** If a fruit's natural fall would take less than `SPAWN_MIN_REACTION_SEC` (0.8s), it holds at the top of its column for the difference before gravity engages. **The player can steer during the hold — that is the entire point.**

**(d) The danger warning covers every column,** since any of them can now be the one that matters. One shared pulse phase so several marked columns read as one warning; a column with no room left is drawn steady rather than pulsing, because a full column is a fact, not a warning.

## 3. Why (c) is not optional

Change (a) alone would be unfair, and this is the number:

| spawn rule | drops arriving over a column with ≤2 rows of headroom |
|---|---|
| fixed column | 8–13% |
| varying column | **30–38%** |

A third of drops would land with almost no time to steer. The floor pays out exactly there and costs nothing elsewhere: a fall to the floor of an empty seven-row board already takes ~1.7s, well past the floor, so the hold is zero.

**A floor rather than a flat delay, deliberately.** A flat 0.3s hold on every drop would add roughly ninety seconds of pure waiting to a three-hundred-drop run — slowing the whole game to fix a problem that only exists on short falls.

## 4. Two things I got wrong, recorded rather than quietly dropped

**A shuffled bag was built and abandoned.** "All six columns before any repeat" sounds obviously better than a uniform pick. Measured over 300 runs per skill level it was indistinguishable from plain random on run length, score and board use — because the full-column redirect breaks the bag's guarantee often enough to erase the difference. It cost an extra piece of state to carry and reset, for nothing. **Killed on the evidence.**

**My simulation harness disagreed with the real game and the real game was right.** The harness put a passive run at 99–149 drops; the browser says 9–12. I have not found the flaw in the harness. What that means for this brief: **the browser measurements in §1 and §5 are the evidence, and the simulation figures in §3 should be read as indicative of a ratio, not as absolute truth.** I had also, earlier in this project, generalised "13 seconds" from a single live run — §1 is that claim properly re-measured, and it happened to hold.

## 5. The result, measured the same way

A passive run on this build, sampled as it went:

| t | drops | score | board | stacks |
|---|-------|-------|-------|--------|
| 15s | 6 | 7 | 7% | `0,1,0,1,0,1` |
| 30s | 13 | 13 | 21% | `1,4,1,2,0,1` |
| 60s | 29 | 89 | 33% | `2,2,2,4,1,3` |
| 90s | 41 | 133 | 55% | `3,4,3,7,1,5` |

**Still alive past 150 seconds** when the measurement was stopped, against a 13.5s median before. Note the stacks at 90s: column 3 is full at 7 and the run continues, because the other five columns have room. That is the whole change in one row of numbers.

## 6. What is deliberately NOT in this phase

**No "where is the next fruit coming from" indicator.** I specified one in the original §12.2 and, having built the rest, I no longer think it is needed: the fruit appears at the top of its column and the reaction floor guarantees a minimum time to see it and act. Adding a second place to look for information the board already shows would be noise. **Judge it by playing — if it turns out to be needed, it is a separate change with its own evidence.**

No change to `SPAWN_POOL`, `MILESTONE_SCORES`, the combo window, `ROWS` or the gravity ramp. One lever at a time.

## 7. Consequence to expect

Scores and run lengths go up across the board. `MILESTONE_SCORES` was retuned in phase 13 to `[0, 500, 1500, 4000]` and its comment marks it **provisional pending exactly this change**. It should now be re-checked against real scores — not in this phase, but next, and with real play rather than simulation.

## 8. Verification

- **24 unit tests pass** (plus `run.js`, the aggregate runner — 25 files in `unit-tests/`, which is what an earlier draft of this brief miscounted as 25 tests), including a new `unit-tests/spawn-column.js` asserting: the run ends only when the whole board is full; a spawn is never blocked while any column has room; a fruit never arrives over a full column (200 trials, since the pick is random); fruit reaches all six columns over 400 spawns; and the reaction floor is zero on an empty board, positive over a tall column, never exceeds the floor, does not move the fruit downward while held, and drains rather than trapping it.
- **The full Playwright suite: 48 checks, 0 not wired, no console or page errors** — including all four 12.1 freeze regressions, the Playables CSP run, the offline boot, and the ratio sweep. Bundle 19 files / 0.285 MiB, peak heap 4.09 MiB, time-to-interactive 135 ms.
- `tools/check-prohibited-apis.js` clean against a fresh `dist/playables/`.
- `tools/build-playables.js` builds.
- `BUILD_VERSION` → `2026.08.28-16` in **both** `js/constants.js` and `service-worker.js`.

**Two existing tests changed.**

`tests/verify-features.js`'s freeze regression waited for an untouched run to reach game over, with a 40s ceiling written for the old 13-16s median. That assumption is false by design now — a passive run survives past 150s — so the wait hung and the suite stopped at its first check. It now forces the terminal board deterministically via `page.evaluate`, the same way the bomb test does. What the test is *about* — the rAF chain surviving a host pause with no resume — is untouched; only how the run ends.

`unit-tests/bomb-landmine.js` asserted that filling the spawn column ends the run. That is the old rule. Its actual subject — a bomb occupying a cell like any other tier — is unchanged; it now builds the real terminal state (whole board full but one cell) using a `(r + c) % 2` checkerboard, which has no two equal neighbours in either direction and so cannot cascade-merge on its own.

## 8b. A regression this brief shipped once, and how

The first version of this patch **deleted `withAlpha` from `js/render.js`** — a helper phase 11.2 added for the gridline fade — along with the comment above `drawVignette`. Neither had anything to do with this phase. `drawBoard` still called it, so it threw on **every frame of every run**: the board, fruit, danger markers, contact shadows and swap ring all failed to draw. Phase 12.1's `try/catch` was the only reason it degraded to a blank board instead of a hard freeze.

Two failures produced it, and both are worth recording because neither is exotic:

1. The edit replaced a *range* of the file between two function names, and something unrelated was sitting inside that range. A textual range edit is only safe if you have read what is in it.
2. **The Playwright suite was never run.** The unit tests all passed and cannot render anything; the build and the API sweep are static checks. Nothing in that set can see a blank board. The verification list in §8 originally did not mention the suite at all, which is exactly consistent with it not having been run.

The suite is now run and green. If a future phase claims verification without the Playwright line in §8, that claim is incomplete.

## 9. What the reviewer should check that the tests cannot

- `chooseSpawnColumn` uses `Math.random()`. Confirm that is acceptable here — it is presentation-adjacent, not save-affecting, and nothing in the project seeds a global RNG — or replace it deliberately.
- The hold is computed once at spawn against the column the fruit arrives over, not recomputed as the player drags. Confirm that reads as grace rather than as lag when you play it.
- `drawDangerState` now strokes up to six rectangles a frame instead of one. Negligible, but confirm it does not read as visual noise when several columns are high at once.
- Play it. The numbers say the run is longer; only playing says whether it is better.
