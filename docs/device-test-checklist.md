# Device test checklist — Part B of phase 5

These need real hardware. No agent can hold a phone, so every row below is
unchecked until a human fills it in by hand. Do not mark any of these done in
`docs/playables-plan.md` on the strength of the automated suites alone —
phase 5's own point is that passing in Playwright and passing on a device are
different claims.

Test `dist/playables/` (`node tools/build-playables.js`, then serve the
`dist/playables/` folder — not the repo root, and not the Pages build).

Skip the Android Studio emulator for the WebView item specifically — a real
phone reproduces the zero-viewport WebView boot better, and does not need the
emulator's RAM.

For each row, fill in: device, OS version, browser (and its version), and the
result (pass / fail / notes). Leave a row blank rather than guess.

---

## 1. Android phone, real device — zero-viewport WebView boot

The failure Google documents by name, and it does not reproduce on desktop or
in Chrome DevTools' device emulation. Load `dist/playables/` through an actual
WebView test harness (not just mobile Chrome) so the game is genuinely
instantiated before it is shown, matching how the Playables container loads
it.

- Device:
- OS version:
- Browser / WebView version:
- Result:
- Notes:

## 2. iOS device

Three things Google specifically calls out, all sharp only on real Safari:

- `ctx.roundRect` — should fail gracefully (square corners) on Safari < 16,
  and draw normally (rounded corners) on Safari 16+. Note which you tested.
- AudioContext behaviour — does audio actually start without a tap? Does the
  gesture fallback still work if not?
- The 512 MB JS heap ceiling — Google attributes this limit to iOS. Play a
  long session (several minutes, several runs) and watch for a crash or a
  forced reload, not just the automated suite's one 18-drop sample.

- Device:
- OS version:
- Browser version:
- Result:
- Notes:

## 3. Aspect ratios by hand

The automated ratio sweep (phase 4.1) resizes a desktop browser viewport,
which is not the same as a device's own rotation/fold hardware path.

- Rotate the phone portrait ↔ landscape mid-run.
- Fold it, if it folds (or use a foldable emulator/device if that's what's
  available — this is the one sub-item where an emulator is acceptable, since
  the fold hinge itself isn't the thing phase 4.1's guard is protecting
  against).
- Confirm at every orientation: nothing clips, nothing stretches, and the
  shop screen's width never visibly disagrees with the board's.

- Device(s):
- OS version(s):
- Browser version(s):
- Result:
- Notes:

## 4. A full run with sound, muted and unmuted

- Play a complete run (start to game over) on a phone with the device's
  hardware mute/silent switch OFF (sound enabled). Confirm merges, the
  celebration arpeggio, and background music are all audible and sound
  correct (no clipping, no stuck notes).
- Repeat with the device's hardware mute/silent switch ON. Confirm the game
  respects it (this is the *host*-level mute phase 3.3 wires
  `platform.audioEnabled()`/`onAudioEnabledChange()` for — separate from the
  in-app Sound/Music toggles, which should be tested independently of the
  hardware switch).

- Device:
- OS version:
- Browser version:
- Result:
- Notes:

## 5. Haptics on a device that has them

- Confirm merges and bomb detonations actually vibrate on a real device
  (`navigator.vibrate` is unreliable to trust from a desktop browser alone —
  it not being available in this codebase's test environment is a difference
  in the CI machine, not evidence about phones).
- Toggle Haptics off in the shop (phase 3.4) and confirm vibration actually
  stops — not just that the button's label changes.
- Toggle it back on and confirm vibration resumes.

- Device:
- OS version:
- Browser version:
- Result:
- Notes:

---

## Sign-off

Only mark phase 5 (Part B) complete in `docs/playables-plan.md` once every
row above has a filled-in result — not just "will do later" placeholders.

- Filled in by:
- Date:
