# Phase 13 — The title screen, the ladder, and depth in the backdrop

**Branch:** `playables`
**Base:** `23f1408` (12.1 pre-deploy fixes)
**Provenance:** written by the auditor, who also wrote and tested the accompanying implementation before it was handed over. Unusually for this repo the code arrived with the brief rather than after it — so this document exists to be checked *against* the diff, not to be implemented from. Read the diff and disagree with it where it is wrong.

**Authorised by the repo owner**, in these words: *"you have all the permission to make the changes and edit in the game to make it look good and give a player reason to stare into it even if they are not playing it… but that should not undo any other changes that we have made… what we have now is the baseline, the only way we can go is up from here."*

---

## 0. Two things to settle before reading the diff

### 0.1 Why "13" and not "12.4"

`docs/phase12brief.md` §12.4 already specifies a menu-copy and font change, and 12.2 and 12.3 are still unbuilt. Numbering this 12.4 would imply the phases in between had landed. They have not.

This is a separate, **fully additive** set that depends on nothing in 12.2 or 12.3 and can ship before either. **§12.4 of the phase 12 brief is superseded by this document** and should not be implemented separately — building both would produce two competing title screens.

### 0.2 Why it deviates from what §12.4 specified

§12.4 named **Baloo 2** and the line *"Two of a kind, and — poof."* Both were written from reasoning, without rendering anything. Once five candidate faces were actually drawn on the real menu across all four backdrops, two things changed:

- **Titan One over Baloo 2.** Baloo 2 is a rounded text face; at display size it reads as heavier Fredoka rather than as a logo. Titan One is a poster face — it carries a thick outside stroke without collapsing, which is what makes the difference between coloured text and a wordmark.
- **"Slide. Match. Poof." over "Two of a kind, and — poof."** The em-dash construction is literary for a title screen. More importantly the replacement teaches the verb, and the verb matters: the player does not *drag* the fruit (gravity moves it), does not *catch* it, and does not *drop* it. They **slide** it sideways while it falls. Naming the action wrongly in the first line anyone reads is worse than not naming it.

Both are judgement calls and both are reversible in one line. If the reviewer prefers §12.4's originals, say so — but say so having seen the rendered result, which is the whole reason they changed.

---

## 1. What is in the diff

### 13.1 — The wordmark and the opening line
`assets/fonts/titanone-latin.woff2` (10 KB, SIL OFL 1.1, notice added to the existing `OFL.txt`), a `@font-face` and a `.wordmark` block in `css/style.css`, `wordmarkHTML()` in `js/shop.js`.

The name is drawn **twice per word**, stacked: a solid white copy carrying the stroke underneath, the per-letter coloured copy laid exactly over it. This is not decoration on top of decoration — a stroke applied per letter grows each glyph outward independently, rings every letter in white, and the word falls apart into scattered stickers; widening the tracking to stop the collisions makes it worse. One stroked copy of the whole word gives one continuous outline. Both layers emit identical characters and identical per-letter transforms, so they cannot fall out of register (verified: 0px offset on both words).

Letter colours come from `skinColor()`, not `TIERS` directly, so the title follows the player's chosen palette with no second code path.

`FONT_FAMILY` is **not** touched. Every `ctx.font` in `js/render.js` reads it and the HUD layout is tuned to Fredoka's metrics — see `POWER_SLOT`'s own comment about digits spilling over the board edge at `y=86`. Canvas keeps Fredoka. This is a DOM-only face.

### 13.2 — `MILESTONE_SCORES` — the change to argue about
`[0, 1000, 3000, 8000]` → `[0, 500, 1500, 4000]`.

**This is the item `CLAUDE.md` is right to gate, so here is the evidence rather than an assertion.**

The existing values were calibrated against simulated runs — median score novice ~1000, casual ~3000, expert ~9000. That calibration is real and it is in the code comment. The problem is what it was calibrated *against*: a bot that never misreads the board and never fumbles a drag. Measured against the actual player:

- **Personal best: 2,127.** This is not an estimate. It is rendered on the menu of the live build as `Best score: 2127` and appears in screenshots of the deployed game.
- Consequently stops 2 (3,000) and 3 (8,000) have **never once been reached**. The Dusk and Midnight palettes, the Bomb and the Rainbow Fruit are all built, tested, shipped — and have never been seen or used by anyone playing this game.
- The same bot that produced the original calibration was re-run on the current build: novice 5,904, casual 10,652 median. The gap between that and 2,127 is the size of the miscalibration.

At the new values a 2,127 best sits inside stop 2 immediately, with stop 3 one good run away.

**Flagged as provisional in the code comment, and repeated here:** phase 12.2 (the spawn column) will lengthen runs and lift every score in the game. These four numbers must be re-checked against real scores once 12.2 lands. They are deliberately one line so that re-check is cheap.

**If the reviewer disagrees, this is the item to revert.** It is one line and nothing else in the diff depends on it.

### 13.3 — Backdrop depth
`BG_BANDS` replaces the flat `BG_SHAPE_*` population in `js/constants.js`; `js/background.js` builds and draws from it.

Shapes now **fall** rather than drift upward, so the surround echoes the game's own motion instead of contradicting it. Three bands — far (small, faint, slow), mid, near (large, faster, visibly tumbling) — because depth comes from scale and speed, not from alpha alone. 18 shapes, up from 16.

Also: the near-black themes get compensated. Midnight's page colour is `#05080F`, and darkening it a further `BG_GROUND_DARKEN` erased the ground, the shapes and most of the halo — the best-looking board in the game arriving on a dead backdrop exactly when the player is most invested. Both the darkening and the halo now interpolate on how dark the page colour already is, read from its relative luminance, so a future palette gets the same treatment without a special case.

### 13.4 — The puff
Every so often one of the larger shapes fades out with a soft expanding ring behind it, then returns. Periods are per-shape across 18–40 s and only the mid and near bands do it, which works out at roughly one puff every three seconds somewhere on a phone screen. Analytic from absolute time, like the positions, because the ~15 fps throttle means frames arrive at irregular intervals and anything accumulated per call would drift. Disabled under `prefers-reduced-motion`.

The rationale is the request this phase was authorised under — *a reason to stare into it even if they are not playing*. The game is called Poof Poof and its one verb is "two things meet and vanish"; the backdrop should say that too, not merely drift.

### 13.5 — One forward-looking line on the game-over screen
`nextUnlockHTML()` in `js/shop.js`, `.next-unlock` in the CSS. Derived from `MILESTONE_SCORES`, `SKINS` and `POWERUPS` rather than a hand-kept list, so it can never name a reward that has been renamed or moved. The game-over screen is where a player decides whether to go again and it was five lines of receipt, all pointing backwards.

### 13.6 — `.skin-btn`
Was a hardcoded `#8e44ad` — `TIERS[1]`, the grape's fruit colour, reused as a button colour. It was the only button in `css/style.css` not taking `var(--accent)`, so it sat off-palette on every theme and would read as broken on Midnight's teal. The `selected` state gains a ring so it stays distinguishable now that both use the accent.

### Version
`BUILD_VERSION` → `2026.08.28-15` in **both** `js/constants.js` and `service-worker.js`.

---

## 2. Two unit tests changed, and why that is not a red flag

`unit-tests/dev-mode-storage.js` and `unit-tests/input-callbacks.js` both hardcoded a milestone value (`8000` and `1000`). They now read `MILESTONE_SCORES` instead.

This is deliberately **not** "patch the number so the test goes green". Both tests are asserting something else entirely — dev mode inflating `highScore` to the top milestone, and a locked power-up reporting its own unlock score — and neither is about the specific figure. Repeating the figure was the bug; a future retune of the ladder can no longer break either test.

---

## 3. What was verified before this was handed over

- The patch applies cleanly to a **fresh clone at `23f1408`**, and on that clean checkout all **24 unit tests pass** and `tools/build-playables.js` runs.
- `tools/check-prohibited-apis.js` clean against a fresh `dist/playables/`.
- Bundle **0.279 MiB across 19 files** (was 0.254 / 18) — the font is the whole difference, against a 30 MiB ceiling.
- **The 12.1 freeze reproduction still recovers** on this build: game over → `document.hidden` with no resume → Play Again → the rAF chain restarts. Nothing in this phase touches `js/main.js` or `js/platform.js`.
- Wordmark: both layers at 0px offset on both words; 8 letters; `aria-label="Poof Poof"` so the name is announced once rather than as sixteen letters across two layers; fits the card at 384 px and at 320 px with no horizontal page scroll.
- `theme-contrast` still passes. Its worst case moved from 4.56:1 at score 5,515 to 4.56:1 at score 2,760 — same margin, relocated by the milestone change. See §5.

---

## 4. What the reviewer should check that the tests cannot

- `paint-order: stroke fill` is what puts the stroke behind the glyph. Where it is unsupported the letters render heavier rather than broken — confirm that degradation is acceptable, or add a fallback.
- The two wordmark layers are `position: relative` / `position: absolute`. Confirm nothing in the `.screen` cascade gives `.wm-word` a competing position.
- `BG_BANDS` is now the only source of shape geometry. Confirm no `BG_SHAPE_*` constant is left orphaned in `js/constants.js`.
- The puff draws a stroked arc per popping shape. Confirm this does not push the backdrop's per-frame cost somewhere it matters on a low-end phone.

---

## 5. Known consequence, stated rather than buried

The milestone rescale moves the palette's crossing zone — where Dusk's light lavender board interpolates into Midnight's dark navy, passing through a washed mid-tone — from around score 5,500 down to around 2,000. It used to be invisible because nobody reached it. It is now where a real player actually sits.

Contrast still passes (4.56:1 against a 4.5 floor) and the result reads as soft rather than ugly, but it is a real consequence of §13.2 and it should be seen before it is accepted.

Separately and pre-existing: that 4.56:1 is a margin of six hundredths above the floor, and has been since phase 7. Logged as a standing risk for whoever next touches `THEMES`.

---

## 6. Definition of done

- [ ] the diff read in full and disagreed with where warranted — especially §13.2
- [ ] 24 unit tests, prohibited-API sweep, `build-playables.js`, full Playwright suite all green
- [ ] the 12.1 freeze regression tests specifically re-run and still passing
- [ ] screenshots at 390×844: menu, a Midnight-theme run, game over
- [ ] committed to `playables` as **Phase 13** and pushed
- [ ] `docs/phase12brief.md` §12.4 marked superseded by this document, so the repo does not carry two competing title-screen specs

Not deployed by this phase. `main` gets the merge separately, per `docs/deploybrief.md`.
