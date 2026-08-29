# Poof Poof — project rules

Canvas merge game. Vanilla ES modules, no build step, no dependencies.
Baseline for this work: `BUILD_VERSION = '2026.08.28-5'` in `js/constants.js`,
tagged `v2026.08.28-5-pre-cert`. (Previously recorded as `-4`; `main` had never
actually been fast-forwarded past the initial commit — the real tree lived only
on the `claude/fruit-merge-game-twa04f` branch, one commit ahead of `-4`. See
Phase 0 in the plan.)

**Goal:** pass YouTube Playables certification without breaking the standalone
GitHub Pages build. Both targets ship from this one codebase.

The phased work is in `docs/playables-plan.md`. Do not start a phase before the
one above it is committed and its tests pass.

---

## Hard rules — a change that breaks one of these is wrong, even if it works

These come from Google's published Playables certification requirements. They
are not preferences.

**Storage.** No `localStorage`, `sessionStorage`, IndexedDB or cookies for
player progress, anywhere outside `js/platform.js`. Progress goes through
`platform.save()` / `platform.load()`. The requirement is explicit: games "MUST
NOT use any other mechanism to save user progress."

**Lifecycle.** No `visibilitychange`, no Page Visibility API, anywhere. Pause
and resume come from `platform.onPause()` / `platform.onResume()`. Pausing must
stop the render loop, not just the audio.

**Audio.** Audio must be able to start with no user gesture — Playables may give
the game focus automatically, and a game that waits for a tap fails
certification. Keep the gesture path as a fallback for the Pages build only.
Output nothing while the host reports audio disabled.

**Network.** No `fetch`, `XMLHttpRequest`, WebSocket, or any external request.
All game data ships in the bundle. No webfonts without explicit sign-off.

**Language.** Never read `navigator.language` or `navigator.languages`. Locale
comes from `platform.language()`.

**Sandbox.** The Playables iframe sandbox grants only `allow-pointer-lock`,
`allow-same-origin` and `allow-scripts`. So: no `alert`, `confirm` or `prompt`;
no popups; no form submission; no downloads.

**CSP.** No dynamically injected `<script>` tags (static inline scripts are
fine). No `eval`. No WebAssembly. No Web Workers.

**Paths.** Relative only. Filenames: alphanumerics plus `_`, `-`, `.`.

**Orientation.** Never lock orientation or posture, in the manifest or in code.

**Controls.** No in-game master mute button. Granular music / sound-effect
toggles are permitted and expected. Haptics must have a user-facing off switch.

---

## Architecture rules

**One platform seam.** `js/platform.js` is the only file that may reference
`ytgame`, `localStorage`, or document-level lifecycle events. Everything else
imports from it. If you find yourself adding a platform check outside that file,
the seam is in the wrong place — fix the seam.

**Two implementations, one interface.** `ytgameImpl` when
`window.ytgame?.IN_PLAYABLES_ENV` is true, `localImpl` otherwise. The Pages
build must keep working at every commit.

**Protect the existing separation.** This codebase is already clean in a way
that makes the port possible — keep it that way:

- `js/physics.js` and `js/state.js` are pure. No DOM, no canvas, no audio, no
  storage imports. Physics pushes `{type, ...}` onto `state.events`; `main.js`
  drains them and turns them into sound and effects. Do not shortcut this.
- `js/render.js` never mutates state.
- `js/constants.js` holds every tunable number. New magic numbers go there.

**Coordinate space.** The board maths assumes a 384 x N logical space
(`COLS * CELL`). Responsive and high-DPI work changes the canvas backing store
and the context transform — never the logical coordinates.

---

## Working style

- Branch per phase. Small commits. Tests before the change where the change is
  testable.
- Pure-logic tests run under plain `node` against the real modules — no test
  framework, no dependencies. Put them in `unit-tests/`.
- Match the existing comment style: comments explain *why* a thing is the way it
  is, especially where the obvious implementation was wrong. Several files carry
  hard-won notes like this. Do not strip them.
- Bump `BUILD_VERSION` in `js/constants.js` on every deploy. It is rendered in
  the HUD and on the menu and is the only way to tell which build a browser is
  running.

## Ask, do not guess

Stop and ask if you hit any of these:

- A requirement that seems to conflict with another.
- Anything that would need a network request.
- A change to the scoring, combo, or unlock economics beyond what the plan
  specifies — those numbers were tuned against simulation.
- Removing or rewriting a commented explanation you do not understand.
