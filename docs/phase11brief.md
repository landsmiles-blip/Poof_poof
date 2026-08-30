# Phase 11 — Restore the board, light the stage

**Branch:** `playables`
**Base:** `eae8208` (Phase 10.2)
**Live at time of writing:** `main` @ `ce9055f`, `BUILD_VERSION = '2026.08.28-12'`
**Owner of this document:** the auditor. Implement it as written; where it is wrong, say so in the report rather than quietly diverging.

This brief is self-contained. Every file path, line reference and number in it was read off `origin/playables` at `eae8208` — not recalled.

---

## 0. Why this phase exists

Phase 10.2 shortened the board from 7 rows to 5. The stated reasoning was that seven rows left the top half permanently empty and the danger state never fired.

The observation was true. The fix was wrong, and it was my call, so this brief starts by undoing it.

Two things went wrong at once, and only one of them was about difficulty:

**It cut the steering window by 29%.** The falling fruit is dragged horizontally while it falls. That fall *is* the interaction. Distance from spawn to an empty floor is roughly `(ROWS − 0.5) × CELL + radius`:

| ROWS | fall distance | time at 260 px/s |
|------|---------------|------------------|
| 7    | ~438 px       | ~1.68 s          |
| 5    | ~310 px       | ~1.19 s          |

The `COMBO_WINDOW_FALL_MULTIPLIER` comment in `js/constants.js` puts an empty-board fall at "~1.66s", which is the 7-row figure and corroborates the model.

**It shrank the game on screen.** This is the one nobody modelled. `css/style.css` sizes the canvas as `min(100vw − 16, min(100vh − 16, 1600) × ratio)`. On any phone, the width term wins, so the on-screen height is `(viewport width − 16) ÷ ratio` — and `ratio` is `384 ÷ (118 + ROWS × 64)`. Fewer rows means a squarer canvas means a **shorter** canvas on a fixed-width phone:

| ROWS | logical | ratio  | height on a 390×844 phone | screen used | dead space |
|------|---------|--------|---------------------------|-------------|------------|
| 5    | 438     | 0.8767 | 427 pt                    | **51%**     | 417 pt     |
| 6    | 502     | 0.7649 | 489 pt                    | 58%         | 355 pt     |
| 7    | 566     | 0.6784 | 551 pt                    | **65%**     | 293 pt     |
| 8    | 630     | 0.6095 | 614 pt                    | 73%         | 230 pt     |

Half the phone is page background at 5 rows. `css/style.css`'s own 9.9 comment predicted this exactly — *"Widening ROWS would close it for real"* — and 10.2 went the other way without reading it.

So: revert the height, and then do something deliberate with the space that is left over, instead of leaving it a flat brown fill. That second half is where the reference images come in.

---

## 1. Revert the board height

### 1.1 `js/constants.js` — `ROWS`

Set `ROWS = 7`. Replace the whole 10.2 comment block above it with this:

```js
// 11.1: back to 7. 10.2 cut this to 5 to force the danger state to fire more
// often -- the observation behind that (a seven-row board's top half sits
// empty in ordinary play) was correct, and the fix was not.
//
// Two things a simulation of danger-state frequency could not see. The fall
// from spawn to an empty floor is ~(ROWS - 0.5) * CELL + radius; at 5 rows
// that is ~310px / ~1.19s against 7 rows' ~438px / ~1.68s. That fall is not
// dead time -- it is the entire steering interaction, and 10.2 removed 29%
// of it. And css/style.css sizes the canvas from 384 / (HUD_HEIGHT + ROWS *
// CELL); on a phone the width term always wins, so FEWER rows makes the game
// physically SHORTER on screen: 51% of a 390x844 phone at 5 rows against 65%
// at 7. That file's own 9.9 comment says so in as many words.
//
// The original complaint stands and is NOT addressed here. If the board
// should feel tighter, the levers are the gravity ramp and SPAWN_POOL, not
// the ceiling -- lowering the ceiling punishes the player for merging well,
// which is the one thing the game is asking them to do. Do not re-shrink
// this to fix difficulty.
export const ROWS = 7;
```

### 1.2 `js/constants.js` — Extra Row price

The 10.2 reprice was reasoning *from* `ROWS = 5` and must revert with it. Set `cost: 50` on the `extraRow` entry and delete the `10.2:` comment block above it entirely.

### 1.3 `css/style.css` — the stale fallbacks

`#game-canvas` still carries `var(--canvas-ratio, 0.678445)` and `aspect-ratio: var(--canvas-aspect, 384 / 566)`. Those are the **7-row** numbers; 10.2 changed `ROWS` and left them behind, so the shipped build renders one wrong-shaped frame before `js/main.js`'s `syncCanvasAspect` runs. Reverting `ROWS` makes them correct again — leave the values alone, but **add the test in §5.1** so the next person to touch `ROWS` cannot repeat this.

### 1.4 Nothing else

`comboWindowSecFor` in `js/state.js` already derives from `effectiveRows(state)`, and `boardHeightFor` / `canvasHeightFor` in `js/render.js` already read `state.grid.length`. The revert propagates on its own. **Do not** hand-adjust `COMBO_WINDOW_FALL_MULTIPLIER`, `GRAVITY_*`, `MILESTONE_SCORES` or `SPAWN_POOL` to compensate. One change, judged on its own.

---

## 2. Remove the in-play build stamp

`js/render.js` line ~139, at the end of `drawHUD`:

```js
ctx.fillText(`v${BUILD_VERSION}`, width - 8, HUD_HEIGHT - 3);
```

`HUD_HEIGHT` is 118 and the pause button occupies y 80–106 at the right edge, so this draws as a small grey string directly beneath the pause button. It is the "some word there" in the report.

Delete the whole `ctx.save() … ctx.restore()` stamp block and drop `BUILD_VERSION` from the `./constants.js` import at the top of `js/render.js` if nothing else in the file uses it.

**This does not lose the stamp.** `js/shop.js` renders `<p class="build-stamp">v${BUILD_VERSION}</p>` at lines 171 and 222 (menu and game-over), and `tests/verify-features.js:125` checks for it via `document.body.textContent` — DOM, not canvas. Both keep working. `CLAUDE.md`'s requirement is satisfied by the menu stamp.

---

## 3. The backdrop

### 3.1 What the reference images actually share

Three images: soft candy shapes, glossy cubes, flat confetti. Different surface treatments, one composition — **a bright play panel on a darker vignetted ground, with decorative shapes scattered through the surround.** That is what is being adopted. Not the artwork.

The artwork itself is out of the question and this is not a close call: the project draws everything in code (`CLAUDE.md`; the `icon` field comment in `constants.js` says so again), which is what holds the bundle at a fraction of the 30 MiB certification ceiling, and shipping found images means shipping third-party IP through a Google review. The composition is not anybody's property. Build that.

### 3.2 New file: `js/background.js`

Four layers, drawn on a full-viewport canvas that sits **behind** `#app`.

```js
export function initBackground();                 // create + size #bg-canvas, handle resize
export function setBoardRect(rect);               // cached; NOT read per frame
export function drawBackground(theme, timeSec);   // one frame, self-throttled
```

**Layer 1 — ground.** Vertical linear gradient over the whole viewport: `theme.page` lightened ~10% at the top to `theme.page` darkened ~30% at the bottom. Today this area is one flat `--page-bg`. This layer alone is the largest single improvement in the phase.

**Layer 2 — halo.** Radial gradient centred on the board rect's centre, radius ≈ `hypot(boardW, boardH) × 0.9`, from `theme.accent` at alpha 0.13 → 0.05 at 55% → 0 at the edge. This is the thing all three references do that the game does not: the panel reads as lit from behind rather than pasted on. Keep it under 0.15 — above that it stops being light and starts being a colour wash.

**Layer 3 — shapes.** Sixteen flat fruit silhouettes, radius 16–62 px, alpha 0.05–0.10, colour taken from the **live skin's** tier colours (`skinColor` in `js/state.js`), drifting up and sideways at a few px/sec with slow rotation on the rosettes, wrapping at the viewport edges. Positions, sizes, tiers and velocities from a **seeded** PRNG (a 12-line `mulberry32`) so the layout is identical on every load and a screenshot diff means something.

Draw these as *flat* shapes — a plain filled disc, and a plain six-petal rosette (six discs on a ring plus a centre disc, same construction as `drawFlower`). **Do not** reuse `render.js`'s `drawCircle`/`drawFlower`: their rims and specular highlights are tuned to read at full opacity on the board and turn into visible noise at 6% alpha in the surround. A private ~25-line pair of helpers in this module is the correct answer, not an export from `render.js`.

**Layer 4 — vignette.** Radial, transparent at 30% of `max(vw,vh) × 0.78` out to `rgba(0,0,0,0.45)` at the edge. This is what keeps layer 3 from reading as clutter: the shapes fade out exactly where they would start competing with the board.

### 3.3 Cost control — read this before implementing

- **Backing store at DPR 1**, not `devicePixelRatio`. Every layer is a soft gradient or a shape at ≤10% alpha; there is not one hard edge on this canvas that a higher DPR would sharpen. At 412×960 that is ~1.6 MB against a 512 MB heap ceiling. Clamping here rather than reusing `MIN/MAX_BACKING_SCALE` is deliberate — say so in a comment so it does not get "fixed" later.
- **Throttle to ~15 fps** (redraw only if ≥66 ms since the last). Nothing on this canvas moves faster than 8 px/sec.
- **Respect reduced motion.** `js/effects.js` already owns that state (`reducedMotion`, line ~74). Use its existing accessor; if it is not exported, export it rather than calling `matchMedia` a second time. Under reduced motion: draw once, then never again except on resize.

### 3.4 Wiring

**`index.html`** — add before `<div id="app">`:

```html
<canvas id="bg-canvas" aria-hidden="true"></canvas>
```

**`tools/build-playables.js`** — the Playables build generates its own `index.html` from scratch; the same markup appears again at **line ~168–171**. Add the canvas there too. See landmine L1.

**`css/style.css`**:

```css
#bg-canvas {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 0;
  pointer-events: none;
}

#app { position: relative; z-index: 1; }
```

`body`'s `background: var(--page-bg)` stays as the pre-JS first paint. `#pause-overlay` is already `z-index: 10` and is unaffected.

**`js/main.js`**:

- `initBackground()` once in `boot()`, and one `drawBackground(...)` before the first `startLoop()` so the menu is never drawn on a bare `--page-bg`.
- In `handleCanvasMeasurement`, after `applyBackingStoreSize()`, call `setBoardRect(canvas.getBoundingClientRect())`. That function already runs on every real measurement and already early-returns on a zero rect, so the last good rect survives the canvas being `hidden` behind the menu — which is what you want: the halo stays where the board was.
- Call `drawBackground(themeForScore(state.score), now / 1000)` inside `loop()` — **outside** the `if (state.screen === SCREEN.PLAYING && !state.paused)` block. See landmine L2.

---

## 4. The board as a panel (`js/render.js`)

Small, and the change that makes the whole thing read as designed rather than decorated.

### 4.1 A defined top edge

Right now one gradient runs unbroken from the score readout to the floor, so the play area has no edge at all. In `drawFrame`, after the existing full-canvas gradient fill and before `drawHUD`:

1. Tint the HUD strip `0, 0 → BOARD_WIDTH, HUD_HEIGHT`: `rgba(0,0,0,0.055)` on a light board, `rgba(255,255,255,0.045)` on a dark one. Decide with `relativeLuminance(theme.boardTop) >= 0.5` — `js/theme.js` already exports `relativeLuminance`.
2. A 10 px vertical gradient from `rgba(0,0,0,0.10)` to transparent, starting at `y = HUD_HEIGHT` — the HUD casting a shadow onto the play area.
3. A 1 px highlight along `y = HUD_HEIGHT`: `rgba(255,255,255,0.85)` light board, `rgba(255,255,255,0.16)` dark.

**The tint is the risky one — see landmine L3 and do not implement it without §5.2.**

### 4.2 Fade the column lines

In `drawBoard`, five full-height hairlines at flat opacity read as ruled paper across an empty top half. Replace the flat `ctx.strokeStyle = theme.grid` with a vertical gradient over `0 → rows * CELL`: fully transparent at the top, reaching `theme.grid` by ~45% down and holding. Alignment stays legible where fruit actually rests; the empty half stops looking like a spreadsheet.

### 4.3 Explicitly out of scope

Do not add: a pulsing or combo-reactive halo; parallax; particles in the backdrop; a second accent colour; rounded corners on the board interior; any change to `CANVAS_WIDTH`, `COLS`, `CELL` or `HUD_HEIGHT`; any change to fruit rendering. The instruction is *simple and neat but eye-catching*. Six restrained layers, done properly, clear that bar. Ten do not.

---

## 5. Tests

### 5.1 New: `unit-tests/css-geometry.js`

Read `css/style.css` as text, extract the two fallbacks in the `#game-canvas` rule (`var(--canvas-ratio, N)` and `aspect-ratio: var(--canvas-aspect, 384 / N)`), and assert both agree with `CANVAS_WIDTH / (HUD_HEIGHT + ROWS * CELL)` and `HUD_HEIGHT + ROWS * CELL` from `js/constants.js`, to 5 decimal places.

This is the test 10.2 did not have. It fails the moment someone changes `ROWS` and forgets the stylesheet, which is precisely what happened.

### 5.2 Extend: `unit-tests/theme-contrast.js`

The existing test samples 0–10000 and asserts text-on-`boardTop` contrast never drops below 4.5:1. §4.1's HUD tint changes the colour the score text is actually drawn on, so **as written the test would keep passing while no longer testing what is on screen** — the exact failure mode this project keeps hitting.

Export a composite helper from `js/theme.js` (or `js/render.js`) that applies the same tint to a board colour, use it in the test, and assert against the tinted value.

**If any score fails**, the crossing segment near the light/dark boundary is the likely culprit — its ink is engineered to sit close to 4.5:1 with roughly 0.008 luminance of headroom, and a 5.5% darkening can eat that. In order: reduce the tint until every sampled score clears 4.5:1 with ≥0.3 of margin; if it will not clear at any useful strength, **drop the tint entirely and keep only §4.1's shadow and highlight**, which carry most of the panel read on their own. Record which of the three outcomes happened, and the final tint value, in the commit message.

### 5.3 Must still pass, unchanged

- every file in `unit-tests/`
- `tools/check-prohibited-apis.js` — clean
- `tools/build-playables.js` — exits 0, **and `dist/playables/index.html` contains `id="bg-canvas"`**
- `tests/verify-features.js` — including the `BUILD_VERSION` on-menu assertion, which must still pass after §2

### 5.4 Evidence to attach to the report

Screenshots, not descriptions: 390×844 and 412×960, at score 0 and score 9000, before and after. A claim that it looks better is not evidence.

---

## 6. Landmines

**L1 — the body markup exists twice.** `index.html` is the GitHub Pages entry point; `tools/build-playables.js` (~line 168) writes a *separate* `index.html` from scratch for the certification bundle. Add `#bg-canvas` to one and the Pages build gets a backdrop while the Playables build silently does not. No existing test compares the two. The §5.3 assertion on `dist/playables/index.html` is the guard — write it.

**L2 — `applyPageTheme` is inside the PLAYING branch.** In `js/main.js`'s `loop()`, the theme push sits inside `if (state.screen === SCREEN.PLAYING && !state.paused)`. Put `drawBackground` in the same place by pattern-matching and the backdrop freezes on the menu, the shop and the game-over screen — which is where a player deciding whether to play again is actually looking. Call it outside the branch.

**L3 — the HUD tint moves the floor under the contrast test.** Fully covered in §5.2. It is listed again here because it is the one change in this phase that can ship looking fine and be quietly wrong on one segment of the score range.

**L4 — two vignettes now stack.** `render.js` already has `drawVignette` on the board (strength 0.05–0.09, scaling with theme progress). §3.2's layer 4 is a *different surface* — the page around the board — and they should not be merged. But check the midnight theme (score ≥ 8000, `page: #05080F`) with both present; if the board's own corners go muddy, reduce the page vignette, not the board's, which is tuned and tested.

**L5 — bump the version in two files.** `BUILD_VERSION` in `js/constants.js` **and** the duplicated literal in `service-worker.js` line 27. They are currently both `'2026.08.28-5'` on `playables`. Set both to `'2026.08.28-13'`. If they disagree, the cache name stops matching the build and the deploy does not reach anybody's phone.

---

## 7. Definition of done

- [ ] `ROWS = 7`; Extra Row back to 50; 10.2's comment blocks replaced, not merely edited around
- [ ] no build stamp under the pause button; menu stamp intact and still asserted by `verify-features.js`
- [ ] `js/background.js` exists, four layers, seeded, DPR-1, ~15 fps, static under reduced motion
- [ ] `#bg-canvas` present in `index.html` **and** in `dist/playables/index.html`
- [ ] board panel edge in; grid fade in; §5.2 resolved and its outcome written into the commit message
- [ ] `unit-tests/css-geometry.js` exists and passes; every other unit test passes; prohibited-API sweep clean; `build-playables.js` exits 0; Playwright suite green
- [ ] `BUILD_VERSION` = `2026.08.28-13` in both `js/constants.js` and `service-worker.js`
- [ ] four screenshots attached
- [ ] committed to `playables` in two commits: **11.1 — restore the board (ROWS 5 → 7)** and **11.2 — light the stage**, so the height revert can be judged and, if necessary, reverted on its own

Not deployed by this phase. `main` gets the merge and the version bump separately, per `docs/deploy-brief.md`.
