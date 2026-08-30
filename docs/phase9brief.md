# Phase 9 brief — magnet redesign, pause menu, and outstanding fixes

Work on `playables`. Read `CLAUDE.md` and `docs/playables-plan.md` first — they
carry the standing rules for this project and the history of what was verified
and why.

**If you are a new agent joining this project:** the game is a canvas merge game
targeting YouTube Playables certification. Everything is drawn in code — no
image files, no webfonts, no network requests, ever. There are 22 unit tests
(plain Node, `unit-tests/`) and 39+ end-to-end checks (Playwright,
`tests/verify-features.js`). Both must stay green, along with the CSP run and
the prohibited-API sweep.

Sections are independent. **Commit after each.** 9.1 is a blocker; do it first.

---

## 9.1 — BLOCKER: the letterbox coordinate bug

Confirmed from a phone screenshot, not inferred.

The canvas **element** is taller than the logical 384x566 game, so the board is
drawn letterboxed inside it with empty canvas visible below the column grid.
`toCanvasPoint` divides by the full element rect, so `scaleX` and `scaleY`
differ — roughly 0.53 versus 0.41 on a 9:20 phone. Every HUD tap therefore
computes about 12 logical pixels above where the finger actually is, and the
power-up hit boxes are only 26px tall. Every chip tap misses.

Dragging the falling fruit still works, which is why this looked like a
power-up bug for two rounds: that path needs only an approximately-right x and
any y below the HUD.

**Fix:** make the element's box match the logical aspect exactly, so there is no
letterbox *inside* the canvas — letterbox with layout around it instead. Or map
pointer coordinates through the content rect rather than the element rect. The
first is cleaner.

**The coverage gap that allowed this:** every existing touch test runs at one
viewport shape, where the skew is near zero. Add tests that tap the visual
centre of every power-up chip at several aspect ratios **including tall phone
ratios like 9:20 and 9:22**, and assert each tap is consumed by its slot.

---

## 9.2 — Redesign the magnet

### Why the current design is wrong

The magnet moves fruit that has already settled. It rearranges a stack the
player deliberately built, which is why it reads as "moving things
unnecessarily" — it fights the player's plan rather than serving it. It is also
the direct cause of the reported glitch, because it mutates grid cells while
cascades resolve.

### The new design

**The magnet never touches settled fruit. It influences the falling one.**

- The player places the magnet on a column (it stays where placed, across
  drops, until moved).
- While a fruit is falling, it drifts toward the magnet's column instead of
  falling straight — a curve, not a snap.
- Dragging always overrides. The magnet assists aim; it never takes control.
- Pull strength falls off with horizontal distance, so a magnet far across the
  board nudges rather than yanks.
- Its battery drains only while it is actually influencing a fruit, and
  refills when idle.

Draw the pull: field arcs from the magnet toward the falling fruit, and a
highlight on the target column.

**Delete the settled-fruit movement entirely** — `stepMagnet`'s grid mutation,
its `settleColumns` call, and the tween that was added for it. Do not keep it
behind a flag. Removing it is what removes the glitch.

**Consequence to check:** `magnetTargets`, the bomb/rainbow exclusion in
`pairTier` that existed to stop the magnet grabbing a bomb, and any test
asserting the magnet moves grid cells all need revisiting. The `pairTier` bomb
rejection stays — it protects merging, not just the magnet.

---

## 9.3 — A pause menu

There is currently no way to pause. Add a small control in the HUD that opens an
in-game pause panel offering: **Resume**, **Music on/off**, **Sound on/off**,
and **Back to menu**.

### Certification constraints — read these before designing it

- **No in-game exit or quit button.** "Back to menu" means the game's *own*
  main menu. Nothing may offer to close, quit, or leave the Playable itself.
- **No master mute button.** That was deliberately removed in phase 3 because
  the host owns master audio. Granular music and sound-effect toggles are
  permitted and are what belongs here.
- Opening the pause panel must stop the run properly — cancel the animation
  frame, suspend audio, pause the music scheduler — using the same path
  `platform.onPause` already uses. Do not add a second pause mechanism.
- `Esc` should close the pause panel, taking priority over its current job of
  cancelling an armed power-up.

---

## 9.4 — Clean up the debug build

The live site is currently on `2026.08.28-9`, which carries the `?hitdebug=1`
diagnostic overlay. Strip it once 9.1 is confirmed fixed on a real phone.

---

## What must not change

- `js/physics.js` and `js/state.js` stay pure — no DOM, no canvas, no audio, no
  storage, no platform imports.
- `js/platform.js` stays the only file referencing `ytgame`, `localStorage` or
  `visibilitychange`.
- No image files, no webfonts, no network requests of any kind.
- The 384-wide logical coordinate space.
- Scoring, combo and unlock economics.

---

## Finish

- All suites green, including the CSP run and the prohibited-API sweep.
- Report the bundle size and file count.
- Commit per section, push `playables` only.
- Deploying is a separate, deliberate step — see `docs/deploy-brief.md`, and
  note that `BUILD_VERSION` must be bumped **before** the push because it
  derives the service worker's cache name.
