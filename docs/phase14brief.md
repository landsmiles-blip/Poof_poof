# Phase 14 — A board the shape of the genre, and a chute you can see

**Branch:** `playables`
**Base:** `253f5d2` (Phase 12.2)
**Provenance:** written by the auditor, who also wrote and tested the implementation before handing it over. Read the diff and disagree with it where it is wrong; this document exists to be checked *against*, not implemented from.

**What this phase answers.** Two complaints, in the repo owner's own words:

> *"the fruit dropping from every witch way is not making sense we can bring back the last idea… better the last idea of the way the fruits wer droping from the the center one."*

> *"is it supposed to cover the all the way to the flor of the phone and the ceiling of the screen or it is suspended somewhere… does that meet with youtubes requirements."*

They turn out to be the same complaint. Both are downstream of one number.

---

## 1. The number

Every successful game in this genre is roughly twice as tall as it is wide. Ours was not:

| game | board | ratio |
|---|---|---|
| Tetris (Guideline) | 10 × 20 visible | 1 : 2.0 |
| Puyo Puyo | 6 × 12 | 1 : 2.0 |
| Dr. Mario | 8 × 11–16 | 1 : 1.4 – 2.0 |
| **Poof Poof, before** | **6 × 7** | **1 : 1.17** |
| **Poof Poof, after** | **6 × 10** | **1 : 1.67** |

That ratio is not decoration. **A short board cannot afford a fixed spawn column.** Puyo has spawned every pair at one fixed column since 1991 — and marks that square, and ends the run when it fills — because twelve rows of headroom make one column survivable. Seven rows did not: measured on the shipped pre-12.2 build, six runs, median **13.5 s**, every one ending on stacks `0,0,0,7,0,0`. Seventeen percent of the board used, five columns empty, run over.

12.2 fixed that by changing two rules at once — a random spawn column *and* a whole-board game over — and the random half was rejected on play. It was the wrong half. The board was too short, and **we never drew the lethal column at all**, which Puyo has done from second one.

---

## 2. What changed

**14.1 — `ROWS` 7 → 10.** One constant. Everything below is a consequence of it or a repair to something it broke.

**14.2 — the spawn column is fixed again**, at `Math.floor(COLS / 2)`. `chooseSpawnColumn` becomes **`spawnColumnFor`, exported and deterministic**. The outward redirect to the nearest open column is kept as the mercy path.

**14.3 — the chute** (`drawSpawnChute` in `js/render.js`): a wash down the mouth of the spawn column fading out over two rows, two lip ticks and a chevron at the top edge. It reads its column from `spawnColumnFor` — *the same function `spawnFruit` calls* — so when the middle fills and the spawn redirects, **the marker moves with it**. A marker that kept pointing at a dead column would be worse than no marker.

**14.4 — the run still ends only when no column has room.** Unchanged from 12.2. This is what makes 14.2 safe, and it is the one line that must not be reverted alongside the spawn column.

**14.5 — the halo is a different primitive.** Not cosmetics; a repair. See §4.

`BUILD_VERSION` → `2026.08.28-17` in **both** `js/constants.js` and `service-worker.js`.

---

## 3. What ten rows actually does to the screen

Measured off the live element in a browser at each viewport, not computed from the CSS formula (`tools/measure-phase14.cjs fill`):

| device | canvas | height fill | area fill | fruit cell |
|---|---|---|---|---|
| iPhone 12/13/14 390×844 | 374×738 | **87 %** | 84 % | 62.3 px |
| Pixel 7 412×915 | 396×782 | 85 % | 82 % | 66.0 px |
| iPhone SE 375×667 | 330×651 | 98 % | 86 % | 55.0 px |
| iPhone 15 Pro Max 430×932 | 414×817 | 88 % | 84 % | 69.0 px |
| tall/narrow 9:22 434×857 | 418×825 | 96 % | 93 % | 69.7 px |
| desktop 1280×800 | 397×784 | 98 % | 30 % | 66.2 px |

Before, on a 390×844: **65 %**.

**The fruit does not shrink on a phone.** The canvas is six columns wide whatever the row count and width is the binding constraint on a phone, so the extra rows consume backdrop, not cell size — 62.3 px before and after. Twelve rows is where the height term finally wins and the fruit starts shrinking; ten is the last stop before that, which is why it is ten and not twelve.

**On certification:** the Playables design requirements say a game *SHOULD* fill the viewport and *MUST* otherwise be centred with pillarbox/letterbox. We were compliant at 65 % under the second clause. At 87 % we satisfy the first. Nothing about the ratio sweep changed — the suite still checks 9:32 through 32:9 and nothing clips, stretches, or scrolls.

**One place it does cost cell size, stated rather than buried:** a desktop window is *height*-bound, so the board gets narrower there — 532×784 with 88.6 px fruit before, 397×784 with 66.2 px fruit now. Desktop is not the certification target and the board still fills 98 % of the window's height, but it is a real regression for anyone playing the Pages build on a laptop.

---

## 4. The backdrop, which the taller board silently broke

The repo owner asked for the animated background to be handled "strategic and smart." Being strategic here meant checking whether it still worked, and it did not.

The halo was one radial gradient centred on the board and sized from the board's own diagonal. The only part of such a gradient anyone can *see* is the margin around the board — and ten rows shrank that margin on a 390×844 phone from 146 px to 53 px while making the board's diagonal larger. Sampling the backdrop canvas itself up the centre line, screen edge to board edge (`tools/measure-phase14.cjs halo`):

| build | profile | largest channel spread |
|---|---|---|
| 7 rows | rgb(57,43,32) → rgb(71,51,34) | **14** |
| 10 rows, old halo | rgb(60,45,32) → rgb(63,47,32) | **3** |
| 10 rows, new halo | rgb(51,39,34) → rgb(64,47,33) → (board) | **13** |

Three levels across the whole visible strip is not a glow, it is a flat tint. The board would have arrived at 87 % of the screen sitting on a backdrop that had quietly stopped doing its job, and a screenshot would not have told anyone.

**The fix is a change of primitive, not of numbers.** The halo is now two soft glows cast *outward from the board's rectangle*, with a falloff length measured in pixels — a spill that scales with whatever margin is actually available, floored so a phone still clears the board's own 24 px CSS drop shadow, ceiling'd because `shadowBlur` cost scales with blurred area. **That is independent of how big the board is, which is the entire point: a future `ROWS` change cannot flatten it again.**

The rectangle is clipped *out* of the canvas before filling (`'evenodd'`), so only the shadow lands. That is load-bearing, not a flourish: the board canvas is hidden on the menu, and without the cutout the fill itself would paint a solid accent-coloured rectangle across the menu where the board is going to be.

**Cost, measured, forced to flush** — Chromium's canvas2d is GPU-backed and queues draw calls, so timing the calls alone reported a meaningless 0.10 ms for two large blurs; a 1×1 `getImageData` forces the raster. Against the ~66 ms one redraw gets at `BG_MIN_REDRAW_INTERVAL_SEC`'s ~15 fps:

| spill ceiling | phone 390×844 | desktop 1280×800 |
|---|---|---|
| the old radial halo | 3.86 ms | 10.43 ms |
| 320 | 3.75 ms | 26.94 ms |
| **240 (shipped)** | **3.80 ms** | **19.64 ms** |
| 180 | 3.78 ms | 17.77 ms |

The phone — the certification target, and the only place a low-end GPU actually bites — is unaffected at every ceiling, because its spill is set by the floor and never reaches the ceiling at all. 240 is chosen to keep the broad desktop glow while giving back most of its cost.

**What was deliberately NOT done to the backdrop.** The near band's shapes (radius 62–112) are now mostly hidden behind the board during play on a phone. That was left alone: the menu — where the backdrop has the whole screen and is the thing you are actually looking at — is untouched and still reads exactly as 13.3/13.4 built it, and during a run the board filling the screen *is the feature*. Making the 53 px frame more elaborate would be noise. The frame's job is to glow, and now it does.

---

## 5. The cost, which is real, and what I did not do about it

Ten rows makes the board 45 % taller, so a fall to an empty floor takes 45 % longer at the same speed. Measured in a browser, spawn to the next spawn on the very first drop of a fresh run (`tools/measure-phase14.cjs fall`):

| build | first drop |
|---|---|
| 7 rows | 2 459 ms |
| **10 rows** | **3 675 ms** |

**That lands on the worst possible drop** — the first one a new player ever sees — because the gravity ramp's eased opening (`GRAVITY_RAMP_START_MULTIPLIER`, 0.6×) is also at its slowest there. The two gentle-opening mechanisms now stack.

**`GRAVITY_PX_PER_SEC` was not touched**, for two reasons.

1. **One lever at a time.** Changing the board's size and the fall's speed in the same phase makes it impossible to tell which one is responsible for how the result plays. This is the third time `ROWS` has moved and the second time I have moved it wrongly; I am not compounding that with a simultaneous difficulty change.
2. **The genre's answer to "the natural fall is slow" is not faster gravity, it is a drop control.** Every faller has a soft drop and a hard drop. So does this one — `js/physics.js`'s `hardDrop` — except that it is bound to the **keyboard only**. On a phone, the platform this is being certified for, there is currently no way to skip the wait at all.

**So the honest next step is a touch drop control, not a bigger number.** That is a recommendation with evidence behind it, not a preference, and it is deliberately not in this phase.

---

## 6. What a passive run looks like now

The same measurement `docs/phase122brief.md` §1 and §5 report, so all three builds sit on one axis. 390×844, no input at all (`tools/measure-phase14.cjs run`):

| t | 7 rows (12.2's random spawn) | 10 rows (14) |
|---|---|---|
| 15 s | 6 drops, 26 pts, `0,0,1,0,0,1` | 5 drops, 3 pts, `0,0,0,3,0,0` |
| 30 s | 12 drops, 29 pts, `1,1,3,1,0,1` | 11 drops, 29 pts, `0,0,0,6,0,0` |
| 60 s | 27 drops, 222 pts, `0,1,1,3,2,2` | 24 drops, 68 pts, `0,0,4,10,0,0` |
| 90 s | 55 drops, 403 pts, `2,2,3,4,3,5` | 52 drops, 471 pts, `0,0,2,10,1,0` |
| 150 s | 127 drops, 1 100 pts, **`7,7,7,7,7,6` — 98 %, one drop from over** | 107 drops, 1 119 pts, `0,1,6,10,7,0` — 40 % |

Two things worth reading carefully.

**Scores did not explode.** 1 100 against 1 119 at 150 s. The taller board did not turn into free points.

**But the shape of a passive run inverted.** A random spawn fills the board evenly and kills you at ~150 s; a fixed spawn fills the middle, spills outward, and at 150 s still has 60 % of the board free. The extra headroom is disproportionately consumed by the spawn column for a player who does not steer — which is precisely the player the chute and the reaction floor exist for. **A never-touched run now lasts a very long time.** If that reads as the game being too forgiving, the lever is the gravity ramp or `SPAWN_POOL`, *not* the ceiling — see `ROWS`'s own comment, which says so for the third time.

---

## 7. `MILESTONE_SCORES` — still provisional, now doubly so

`[0, 500, 1500, 4000]`, retuned in 13.2 against a real 2 127 personal best and marked **provisional pending 12.2**. 12.2 has landed and so has this; both raise scores. **They still have not been re-checked, and this phase did not do it**, because the honest way to re-check them is against real play by a real player, not another simulation. Flagging it again rather than quietly letting it drift.

---

## 8. Verification

- **24 unit tests pass**, plus `run.js`. Two changed — see §9.
- **The full Playwright suite: 48 checks, 0 not wired**, including all four 12.1 freeze regressions, the Playables CSP run, the offline boot, the DPR clamp and the 9:32→32:9 ratio sweep.
  - Two console 404s appear in the output. **They are pre-existing**: the suite was run on a clean stash of `253f5d2` and produced the identical two lines. Not introduced here, and not fixed here either.
- `tools/check-prohibited-apis.js` clean against a fresh `dist/playables/`.
- `tools/build-playables.js` builds. Bundle **19 files / 0.301 MiB** (was 0.294), peak heap **4.38 MiB**, time-to-interactive **165 ms**.
- Screenshots at 390×844, before and after, at matched board fractions: `tests/screenshots/phase14/rows7-*.png` and `rows10-*.png`.

**This list mentions the Playwright suite because it was actually run.** `docs/phase122brief.md` §8b records that the previous patch shipped a blank board precisely because it was not, and that a verification claim without this line is incomplete.

## 9. Two tests changed, and why that is not patching them green

**`unit-tests/spawn-column.js` is rewritten.** It asserted that fruit reaches all six columns over 400 spawns. That rule was deliberately replaced, so the assertion is inverted rather than deleted: every empty-board spawn must arrive in the middle column and nowhere else. Three new sections were added that did not exist before, all of them about things only the new design can get wrong:

- **the marker and the spawn cannot disagree** — `spawnColumnFor` is called by both `drawSpawnChute` and `spawnFruit`, asserted across five board shapes including the redirect;
- **the redirect goes to the *nearest* open column**, not merely some open one;
- **a full board has no next spawn column** (`-1`), which is what stops the chute being painted over a dead column on the game-over frame.

**`unit-tests/merge-effect-position.js` had a hardcoded seven-cell fixture.** Its subject — a merge event's frozen (x, y) surviving a later shift in the same cascade — is untouched; only its filler tail, which is now generated to whatever height the board is. Same class of bug as the two tests phase 13 fixed for hardcoding a `MILESTONE_SCORES` value: **repeating the constant was the bug.**

## 10. What the reviewer should check that the tests cannot

- **`js/render.js` now imports from `js/physics.js`.** `CLAUDE.md`'s architecture rule protects *physics*'s purity, which is intact — `spawnColumnFor` is a pure read of `stackHeight` and the dependency runs render → physics, never back. The alternative was a second implementation of "where does the next fruit go" in the renderer, and the copy the player can *see* would have been the one that was wrong. **Confirm that trade is the right one**; if not, the fix is to move `spawnColumnFor` into `js/state.js`, not to duplicate it.
- **The chute is drawn in `theme.grid`, not `DANGER_COLOR`.** `DANGER_COLOR`'s own comment says it "appears nowhere except the danger state — one colour, one meaning," and the chute is a resting-state fact, not a warning. Puyo uses a red X; we deliberately do not. **Confirm the escalation reads** — quiet ink while the column has room, `drawDangerState`'s red over the top of it when it does not — on a real screen, ideally on Midnight where `theme.grid` is a light ink on a dark board.
- **Play it on a phone.** The one number in this brief I cannot get from a browser is whether 3.7 seconds of first drop feels like room to think or like waiting. §5 says what I would do about it; it should not be done until someone has actually felt it.
- **The desktop cell-size regression in §3.** 88.6 px → 66.2 px fruit in a laptop window. Acceptable or not is a call, not a fact.

## 11. Definition of done

- [ ] the diff read in full and disagreed with where warranted — especially §5's decision to leave gravity alone, and §10's render → physics import
- [ ] 24 unit tests, prohibited-API sweep, `build-playables.js`, full Playwright suite all green
- [ ] the 12.1 freeze regression tests specifically re-run and still passing
- [ ] played on a real phone, not just screenshotted: the first drop, the chute, and the chute *moving* when the middle column fills
- [ ] committed to `playables` as **Phase 14** and pushed

Not deployed by this phase. `main` gets the merge separately, per `docs/deploybrief.md`.
