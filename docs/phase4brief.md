# Phase 4 brief — rendering, and the Playables build target

Work on `playables`. `CLAUDE.md`'s hard rules apply throughout.

Two jobs: make the canvas correct on real devices, and produce a build that
contains only the game. The first contains the one bug Google documents that
never reproduces on a desktop.

---

## 4.1 — Density-aware, responsive canvas

### What exists

`sizeCanvas()` already multiplies the logical size by a fixed `RENDER_SCALE`
and sets a `--canvas-aspect` custom property. `toCanvasPoint()` in `js/input.js`
already divides by `CANVAS_WIDTH` rather than `canvas.width`, so pointer
mapping is already immune to backing-store changes — **verify that is still
true after your changes and do not "simplify" it**, since using `canvas.width`
there is the classic way to break hit-testing at high DPI.

### What to change

- Derive the scale from `window.devicePixelRatio` rather than a constant.
  **Clamp it** — roughly 1 to 2, at most 3. An unclamped DPR on a cheap 3x phone
  triples fill-rate and memory for no visible gain, and the certification
  ceiling is a 512 MB JS heap, which Google attributes to iOS limits.
- Re-measure and resize from a `ResizeObserver` on the canvas's container. There
  is currently no resize listener anywhere in the codebase.
- Recompute on `devicePixelRatio` change too — moving a window between monitors
  changes it without changing element size.

### The zero-viewport guard — do not skip this

From Google's certification FAQ, verbatim:

> "For performance reasons, the game is initially loaded in a WebView that is
> not displayed to the user, resulting in the WebView viewport size being zero."

So: **refuse to size from a zero or sub-1px measurement.** Keep the last known
good size, and re-measure on the next observation. Without this guard, adding
responsive sizing *introduces* an Android-only failure that never appears on
your machine — the game boots at 0x0 and never recovers, because nothing
re-measures.

Treat that guard as the point of this item, not as defensive decoration.

### Layout

The canvas currently has `max-width: 100%; height: auto` and the overlay is a
fixed `width: 384px`. That fills width only. Requirements are that the game
fills the viewport or is centred with pillar/letterbox padding, across ratios
from 9:32 to 32:9.

- Scale to fit **both** dimensions, preserving aspect. Letterbox or pillarbox
  the remainder.
- **The overlay must scale with it.** The menu, shop and game-over screens are
  DOM at a fixed 384px. If only the canvas grows, the shop stays a small card
  on a large screen and the two halves of the game visibly disagree.
- State must survive resize. Nothing currently reacts to resize, so this is true
  by accident today — make it true on purpose.

### Acceptance

- Mount the game inside a `0 x 0` container, then expand it. The board must
  appear correctly. This is the Android failure, reproduced locally.
- Sweep 9:32, 9:16, 3:4, 1:1, 16:9 and 32:9. Nothing clipped, nothing stretched,
  no horizontal page scroll.
- Resize mid-run at each ratio and assert the board state is unchanged.
- Assert the clamp: with a stubbed `devicePixelRatio` of 4, the backing store
  does not exceed the clamped multiple.

---

## 4.2 — The Playables build target

No bundler. A plain Node script — `tools/build-playables.js` — that produces
`dist/playables/`. Add `dist/` to `.gitignore`.

### Include

`index.html` (rewritten, see below), `css/`, `js/`, `assets/fonts/`.

### Exclude — nothing that is not the game

`package.json`, `node_modules/`, `tests/`, `unit-tests/`, `docs/`, `.github/`,
`tools/`, `manifest.json`, `icons/`, the service worker and its registration,
`CLAUDE.md`, `README`, and any dotfiles.

### The rewritten `index.html`

- The Playables SDK script tag stays, **before all game code**.
- No manifest link, no icon links, no theme-color meta that only serves the PWA.
- No service worker registration, and no update-and-reload logic. A cache layer
  serving yesterday's build inside a certification review would be genuinely
  bad, and a self-triggered reload inside the container worse.
- Static inline scripts are fine — the CSP permits `'unsafe-inline'` for
  scripts. What it forbids is injecting a `<script>` tag at runtime, which this
  game does not do. Do not "fix" a non-problem by externalising working code.

### Orientation

The manifest is excluded, so its `"orientation": "portrait"` cannot apply. Also
grep for `screen.orientation.lock` and confirm there is none. Locking
orientation or posture is prohibited outright.

### `?dev=1` — the remaining half of item 1.5

Strip dev mode from the Playables build only. Keep it in the Pages build so
`tests/verify-features.js` keeps its coverage — that suite has a `?dev=1` check,
and deleting the check to make a removal pass would quietly cost you coverage.

Assert it: a test that loads the built `dist/playables/index.html` with `?dev=1`
and confirms nothing is unlocked.

### Report the numbers

Print the built bundle's total byte size and file count. Limits are 30 MiB
initial (measured to `gameReady`), 250 MiB total, 30 MiB per file, 8,000 files.
You will be far inside all of them — record the figures anyway so a future
addition that blows the budget is visible immediately.

---

## 4.3 — Feature-check `ctx.roundRect`

Used unguarded in `drawPowerBar` in `js/render.js`. It throws on Safari below 16
and takes the entire HUD frame down with it. Compatibility with the iOS YouTube
app's WebView is a MUST-level requirement.

Fall back to a plain `rect` when it is absent. Test with `roundRect` deleted
from the prototype.

---

## 4.4 — Close the one gap phase 3 left open

Phase 3 correctly reported that the music-burst-on-resume behaviour was left
verified by construction rather than by test, because Playwright has no
inspection surface for it.

It is testable in Node, though: stub an AudioContext whose `currentTime` you
control, pause the scheduler, advance the fake clock 30 seconds, resume, and
assert `scheduleStep` is called no more than a couple of times on the first
tick. That is the whole bug — a scheduler catching up on a clock that moved
while it was not looking.

Small test, real protection, and phases 4 and 5 both touch the loop again.

---

## What must not change

- `js/physics.js` and `js/state.js` stay pure.
- The 384-wide **logical** coordinate space. Backing store and context transform
  change; game maths does not.
- `js/platform.js` remains the only file referencing `ytgame`, `localStorage` or
  `visibilitychange`.
- Gameplay, scoring, combo and unlock economics. A red phase 1 test means you
  changed behaviour — fix the code, not the test.

---

## Finish

- All suites green: `unit-tests/` and `tests/verify-features.js`.
- The Pages build still works, unchanged, at every ratio.
- The built `dist/playables/` runs standalone from a local server.
- Commit, then `git push origin playables`. Do not push `main`.
- Do not bump `BUILD_VERSION`. This is not a deploy.
- Report per file what changed, the bundle size and file count, which tests you
  added, and anything in this brief that turned out to be wrong.
