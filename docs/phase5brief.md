# Phase 5 brief — compliance sweep and test rig

Work on `playables`. `CLAUDE.md`'s hard rules apply throughout.

This is the last engineering phase. Its job is to prove, under the conditions
YouTube actually enforces, that everything phases 1–4 claimed is true.

Part A is yours. Part B is the human's — real devices, which no agent can hold.

---

# Part A — automated

## 5.0 — Three carry-overs from phase 4

### [ ] 5.0.1 Fail the build when the generated index.html falls behind

`buildIndexHtml()` generates `dist/playables/index.html` from scratch, taking
only the title and description from the repo's `index.html`. Generating rather
than stripping is the right call — but it creates a silent failure mode: if the
Pages `index.html` later gains a stylesheet, a font preload, or a script the
game needs, the generated one will not have it. The game breaks in Playables and
passes every test on Pages.

Add an assertion to `tools/build-playables.js`: parse the repo's `index.html`,
collect every `<script src>`, `<link rel="stylesheet">` and `<link rel="preload">`
target, and fail the build if any of them is neither present in the generated
output nor on an explicit, commented ignore list (the manifest and icons belong
on that list). Same fail-loud spirit as the existing `devModeEnabled` check.

### [ ] 5.0.2 Keep the debug hook out of the Playables build

`window.__poofDebugState` currently ships. Gate its definition on the platform
check the codebase already has, so it exists on Pages — where
`tests/verify-features.js` uses it — and not in the container. Then add a build
assertion that the string does not appear anywhere in `dist/playables/`.

### [ ] 5.0.3 What happens with no ResizeObserver?

The observer is guarded by `typeof ResizeObserver === 'function'`, but nothing
else sets `lastGoodCssSize`. If it is absent, does the canvas ever get sized at
all? Support is broad enough that this is low risk, but a game that renders
nothing is the worst possible failure. Either add a one-shot measurement plus a
`window.resize` listener as a fallback, or confirm in a comment why it cannot
happen.

## 5.1 — Run the whole suite under YouTube's real CSP

Google publishes the exact policy for local testing. The docs suggest Chrome
DevTools response-header overrides — **do better than that.** Playwright can
inject the header itself with `page.route()`, which turns a manual, forgettable
step into a repeatable test.

Add a run of the existing e2e suite with this header injected on the document
response:

```
default-src 'none'; script-src 'report-sample' 'self' 'unsafe-eval' 'unsafe-inline' blob: https://www.youtube.com/game_api/v0 https://www.youtube.com/game_api/v0/ https://www.youtube.com/game_api/v1 https://www.youtube.com/game_api/v1/; object-src 'none'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' blob: data:; media-src 'self' blob:; font-src 'self' data: https://fonts.googleapis.com https://fonts.gstatic.com; connect-src 'self' blob: data:; sandbox allow-pointer-lock allow-same-origin allow-scripts; base-uri 'self'; manifest-src 'self'; worker-src 'self' blob:
```

Run it against `dist/playables/`, not the Pages build — that is what ships.

Fail the run on **any** CSP violation reported to the console. A violation that
only logs is still a violation.

Two things that policy settles, so nobody re-litigates them later:

- `script-src` includes `'unsafe-inline'`, so a static inline `<script>` is
  fine. What the CSP forbids is injecting a `<script>` tag at runtime.
- The sandbox grants only `allow-pointer-lock`, `allow-same-origin` and
  `allow-scripts` — so no `alert`, `confirm` or `prompt`, no popups, no form
  submission, no downloads.

## 5.2 — Grep sweep for prohibited APIs

Run against `dist/playables/` and fail on any match outside `js/platform.js`:

`localStorage`, `sessionStorage`, `indexedDB`, `document.cookie`,
`visibilitychange`, `navigator.language`, `navigator.languages`, `fetch`,
`XMLHttpRequest`, `WebSocket`, `eval(`, `new Worker`, `WebAssembly`, `alert(`,
`confirm(`, `prompt(`, `screen.orientation`.

Only storage and lifecycle may match, and only in `platform.js`. Commit this as
a script so it can be re-run before every future submission.

## 5.3 — Record the compliance figures

Print and commit to `docs/playables-plan.md`:

- Built bundle: total bytes, file count, largest single file.
- Peak JS heap across an 18-drop run, measured with the CDP performance
  metrics Playwright exposes. The ceiling is 512 MB and you will be nowhere
  near it — the point is to have the number, so a future regression is visible.
- Time from navigation to `gameReady()`. Initial bundle size is measured as
  bytes downloaded to that point, and the target is interaction under five
  seconds.

## 5.4 — Final state of the plan document

Update `docs/playables-plan.md` so every item is marked with its real outcome
and the commit that closed it. This document is the submission record: when a
Partner Manager asks what was verified and how, this is the answer.

---

# Part B — for the human, on real hardware

Write these into `docs/device-test-checklist.md` as a checklist to be filled in
by hand, with a line for device, OS version, browser and result. Do not mark
them done yourself.

- **Android phone, real device.** The zero-viewport WebView boot is the failure
  Google documents by name and it does not reproduce on desktop. Load
  `dist/playables/` through a WebView test app, not just mobile Chrome.
- **iOS device.** `roundRect` on older Safari, AudioContext behaviour, and the
  512 MB heap ceiling Google attributes to iOS limits.
- **Aspect ratios by hand.** Rotate the phone. Fold, if it folds. Confirm
  nothing clips and the shop never disagrees with the board.
- **A full run with sound**, on a phone, with the device muted and unmuted.
- **Haptics** on a device that has them, and the toggle actually silencing them.

Skip the Android Studio emulator. A real phone reproduces the WebView boot
better and does not need the RAM.

---

## Finish

- All suites green, including the new CSP run.
- Commit, then `git push origin playables`.
- Do not push `main`. Do not bump `BUILD_VERSION`.
- Report: the compliance figures, any CSP violations found, and anything in
  this brief that turned out to be wrong.
