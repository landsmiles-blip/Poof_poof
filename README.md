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

- `js/constants.js` -- all tunable numbers (grid size, tiers, costs, speeds).
- `js/state.js` -- game state shape and lifecycle transitions (menu / playing / game over).
- `js/physics.js` -- falling motion, landing, merge resolution, column settling. No DOM access.
- `js/render.js` -- canvas drawing only. No state mutation.
- `js/input.js` -- pointer (mouse + touch, unified via Pointer Events) handling.
- `js/shop.js` -- DOM-based menu / game-over / shop screens.
- `js/storage.js` -- the only file that touches `localStorage`.
- `js/main.js` -- wires it together and runs the `requestAnimationFrame` loop.

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
