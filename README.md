# Poof Poof

A fruit-merge puzzle game. Drag falling fruit across a 6x7 grid; matching
fruit that touches merges into the next tier (cherry -> grape -> lemon ->
orange -> apple -> pear -> peach -> pineapple -> watermelon). Score builds a
persistent high score and coin balance; coins buy power-ups in the shop
between runs.

Vanilla HTML/CSS/JS, no build step, no dependencies.

## Running locally

Any static file server works, e.g.:

```
python3 -m http.server 8000
```

Then open `http://localhost:8000/`.

## Code layout

- `js/constants.js` -- all tunable numbers (grid size, tiers, shapes, combo, skins, costs, speeds).
- `js/state.js` -- game state shape and lifecycle transitions (menu / playing / game over), combo tracking, skin unlocks.
- `js/physics.js` -- falling motion, landing, merge resolution, column settling. No DOM, canvas, or audio access.
- `js/render.js` -- canvas drawing only. No state mutation.
- `js/input.js` -- pointer (mouse + touch, unified via Pointer Events) handling.
- `js/audio.js` -- runtime-synthesized sound effects (WebAudio). No audio files.
- `js/effects.js` -- squash-and-stretch, particles, screen shake, haptics. Presentational only.
- `js/theme.js` -- milestone palette interpolation, and pushing it out to CSS.
- `js/icons.js` -- vector power-up icons drawn in code. No image files.
- `js/shop.js` -- DOM-based menu / game-over / shop screens.
- `js/storage.js` -- the only file that touches `localStorage`, and the only one that needs to.
- `js/main.js` -- wires it together and runs the `requestAnimationFrame` loop.

Physics never imports audio or the DOM. Merges push events onto `state.events`,
and `main.js` drains that queue into sound each frame -- so gameplay logic stays
testable in isolation and there is exactly one place where the game becomes audible.

## Features

**Fruit shapes.** Each tier carries a `shape` (`'circle' | 'flower'`) in
`constants.js`, alternating by default. It is per-tier data rather than an
index calculation, so any single tier can be changed without touching
`render.js`. A flower's petals are sized so it occupies exactly the same
footprint as the circle it replaces -- grid geometry and landing math are
untouched.

**Sound.** Every effect is synthesized at runtime with WebAudio: no audio
files, so the payload cost is zero and there is no sample licensing to
resolve. Merge pops rise one semitone per tier (320 Hz -> 508 Hz across the
nine tiers); reaching the top tier plays a five-note major arpeggio on a
different waveform so it is unmistakable. Audio starts only on a user
gesture (browsers require it), silences itself when the tab is hidden, and
every call is a no-op if audio is unavailable -- sound failing must never
take gameplay with it. Mute toggles from the HUD speaker icon or the
shop/menu button, and persists.

**Combo multiplier.** Every merge extends a window; the multiplier climbs
`+0.25` per merge in the streak, capped at `3x`. Cascades inside one drop
always chain. Chaining *across* drops depends on fall time, which is shorter
when the stack is tall -- so the combo pays for playing dangerously rather
than for playing patiently. The window is tuned to `1.2s` against simulated
runs; at `2.0s` a competent player never dropped out of the streak and the
multiplier degenerated into a permanent flat bonus.

**Milestones.** `MILESTONE_SCORES` (0 / 1000 / 3000 / 8000) is the single
progression ladder. Skins, power-up availability, and the visual theme all
key off it, so adding a stop extends every gated system at once. Thresholds
are calibrated against 250-run simulations at three skill levels (median
score: novice ~1000, casual ~3000, expert ~9000) so they land on successive
rungs of the skill curve.

**Unlockable skins.** Three skins beyond the default, earned at those
milestones and selectable in the shop. Unlocks are re-derived from the best
score on load, so the stored list can never drift out of sync with what the
player has earned.

**Power-ups.** The original three (Slow Drop, Fruit Remover, Extra Row) are
available from the start. Three more unlock on the milestones above,
alongside that milestone's skin:

- *Magnet* (1000) -- while held, the exposed top-of-column fruit matching the
  fruit you are dragging slides one column closer, once per 0.45s. It is
  deliberately narrow: it never moves buried fruit, never moves a fruit more
  than one column per step, and cannot chain. Planning happens against an
  unmutated snapshot precisely because a naive single-pass version let one
  fruit cross the whole board in a single step and drop straight into the
  merge -- which would make it solve the board rather than nudge it.
- *Bomb* (3000) -- arm it, tap a cell, and everything within one cell is
  cleared regardless of tier. Awards no score and does not touch the combo
  counter, so it stays an escape hatch for a bad board rather than the
  cheapest way to build a streak.
- *Rainbow Fruit* (8000) -- wild fruit delivered through the ordinary spawn
  path, which merges with whatever it touches and becomes that tier. Two
  wilds settle to the lowest tier; a wild against the top tier clears like a
  matching top-tier pair.

Power-up icons are vectors drawn in `icons.js`, same as the fruit shapes --
no image files. Each is a single-colour silhouette taking its colour from the
caller, verified legible at the real 26px HUD size against a neutral chip, the
armed accent, and the dark end-game theme.

**Merge feel.** Squash-and-stretch and a particle burst on every merge, both
scaling with tier (5 -> 16 particles, 0.18 -> 0.42 scale overshoot) so the
visuals escalate in step with the merge pitch. Canvas shake on the top three
tiers only, capped at 5px and applied to the board but never the HUD -- a
shaking score readout reads as a glitch rather than as impact. Haptics via
the Vibration API, 12ms normally and 45ms for a top-tier merge, feature
checked and wrapped so browsers that lack it, or that throw when vibration
is blocked by permissions policy, fail silently.

**Theme.** The palette is interpolated continuously between one palette per
milestone, driven by the current run score, so the world warms up gradually
instead of snapping at each threshold -- measured colour distance across
every threshold crossing is zero. Canvas colours come from the same object
that feeds the CSS custom properties, so the page chrome and the overlay
screens move with the board.

## PWA / Android (Trusted Web Activity) distribution

This is set up as an installable PWA (`manifest.json`, `service-worker.js`,
icons in `icons/`), which is the prerequisite for wrapping it as a Trusted
Web Activity (TWA) and shipping it on Google Play. What's done vs. what's
left is split cleanly by what actually requires *your* Google account:

**Done here:**
- Web app manifest with standalone display mode and icons (192/512/maskable).
- Offline-capable service worker.
- Mouse + touch input, smooth rAF loop, persistent local storage for
  score/coins/inventory -- all verified in a real browser (Chromium via
  Playwright): menu -> play -> merge -> score -> game over -> shop purchase
  -> persistence across a new run, all checked with zero console errors.

**Still needed, and it's on you, not me -- these require your own Google
account, payment method, and judgment calls I can't make:**
1. Host the game on HTTPS at a real domain (GitHub Pages, Netlify, Vercel, etc. all work).
2. Register a Google Play Developer account ($25 one-time fee).
3. Generate the Android package with [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap)
   (`npx @bubblewrap/cli init --manifest=https://yourdomain/manifest.json`),
   which scaffolds the TWA wrapper from the manifest above.
4. Create a signing keystore and keep it safe -- losing it means you can
   never update the app again under the same listing.
5. Host `/.well-known/assetlinks.json` (Bubblewrap generates this) so the
   TWA verifies ownership and drops the browser address bar.
6. Write and host a privacy policy page (required even though this game
   collects no data -- everything is local `localStorage`), fill out the
   Play Console Data Safety form accordingly, and complete the content
   rating questionnaire.
7. Provide store listing assets: feature graphic, screenshots, short/full description.
8. Submit for review. Google's review is a human/automated process neither
   of us controls the outcome of.

**One non-negotiable:** keep the name, art, and audio original. This genre
has an actual commercial original (Suika Game / Watermelon Game by Aladdin
X), and Play has pulled clones that copied its name or assets. The merge
mechanic itself isn't protectable and plenty of legitimate clones exist on
the store -- just don't call this "Suika" or reuse its art.
