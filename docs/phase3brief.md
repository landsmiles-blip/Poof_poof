# Phase 3 brief — lifecycle and audio

Work on `playables`. `CLAUDE.md`'s hard rules apply throughout.

Phase 2 moved the plumbing. This phase changes the behaviour behind it. Both
items here are MUST-level, and both appear in Google's own list of what actually
fails certification — so the testing is the work, not the diffs.

---

## 3.1 — Pause must actually stop the game

`platform.onPause` currently calls `suspendAudio()` and `persistNow()`. That was
correct for phase 2, which only moved plumbing. It is not enough now: the render
loop keeps running, because `loop()` unconditionally re-requests the next frame.

### What pause must do

- **Cancel the animation frame.** Store the handle from
  `requestAnimationFrame` and `cancelAnimationFrame` it. Do not just gate the
  body of `loop()` with a flag — the requirement is to pause execution, and a
  loop that still wakes 60 times a second is still executing.
- **Suspend audio** (already done).
- **Stop the music scheduler.** `js/music.js` drives itself with
  `setInterval(scheduler, LOOKAHEAD_MS)`. Clear it.
- **Flush the save** (already done).

### What resume must do

- Reset `lastTime = performance.now()` before restarting, so the first frame
  back does not compute a huge `dt`. The existing `Math.min(0.05, ...)` clamp
  already protects against a spike, but reset it anyway — relying on a clamp to
  hide a wrong value is how the next bug gets missed.
- Restart the loop.
- Resume audio.

### The music-scheduler trap

`js/music.js` schedules notes ahead against `ctx.currentTime` and advances
`nextNoteTime` past it. If the interval is cleared but the AudioContext keeps
running, then on resume `ctx.currentTime` has jumped forward while
`nextNoteTime` has not — and the `while (nextNoteTime < ctx.currentTime +
SCHEDULE_AHEAD_SEC)` loop will dump every missed step at once, as an audible
burst.

Do not rely on the context being suspended to prevent this. On resume, reset
`step` and set `nextNoteTime = ctx.currentTime + 0.08` — the same values
`startMusic()` uses — before restarting the scheduler.

### Acceptance

A Playwright check: start a run, let a fruit fall partway, fire pause, wait,
fire resume. Assert the board state is unchanged across the pause and the fruit
continues from where it was — no teleport, no burst of music, no silent context.

---

## 3.2 — Audio must be able to start without a gesture

This is the named failure. From Google's certification FAQ, verbatim:

> "The most common audio issue that is seen involves games that are expecting
> user interaction before starting playback. However, YouTube Playables may be
> given focus automatically, so the game must handle this case."

`js/audio.js` builds its AudioContext inside `unlockAudio()`, which is reached
only from `pointerdown` handlers. If the game is handed focus automatically,
nothing ever calls it and the game is silent for the whole session.

### What to change

- At boot, if `platform.audioEnabled()` is true, attempt `unlockAudio()`
  directly — no gesture required.
- Attempt it again from `platform.onAudioEnabledChange` when audio becomes
  enabled.
- **Keep the `pointerdown` fallback.** On the Pages build a browser may still
  refuse to start a context outside a gesture; the fallback is what covers that.
  This is not redundancy, it is the two environments having different rules.
- The existing unconditional `resume()` inside `unlockAudio` is correct and its
  comment explains why. Leave it.

### Acceptance

A Playwright check that boots the game and plays through a merge **without ever
dispatching a pointer event**, and asserts audio actually started. The existing
suite already verifies merge and celebration sound, so extend that mechanism
rather than inventing a second one.

---

## 3.3 — Follow the host's mute, and delete the in-HUD mute button

Requirements: use `isAudioEnabled` and `onAudioEnabledChange`, output nothing
while the host reports audio disabled, avoid in-game mute buttons, and allow
granular controls only.

### Effective audio state

Output is audible only when **both** are true: the host allows audio, and the
player's own toggle for that channel is on.

```
sfx audible   = platform.audioEnabled() && save.sfxOn
music audible = platform.audioEnabled() && save.musicOn
```

Never write the host's state into the save. It belongs to YouTube, not to the
player's preferences — persisting it would mean a host mute silently became a
permanent user setting.

### Delete the master mute control

- `MUTE_RECT` from `js/constants.js`
- `drawMuteToggle` and its call from `js/render.js` (and the now-unused
  `isMuted` import)
- The mute hit-test from `js/input.js`

The shop's Sound and Music buttons stay — those are the granular controls the
requirements explicitly permit.

Removing `MUTE_RECT` frees space at the top-right of the HUD. Leave it empty for
now; do not fill it. Phase 6 has candidates.

---

## 3.4 — Haptics need an off switch

Design requirements permit haptic feedback but require a way to toggle it.
`js/effects.js` currently vibrates on every merge with no user control.

- Add `hapticsOn` to the save blob, defaulting to on.
- Check it inside `vibrate()` in `js/effects.js`.
- Add a third toggle beside Sound and Music in the shop, following exactly the
  pattern those two already use — including how they mark `state.dirty`. Do not
  invent a second mechanism.
- **Hide the control entirely where `hasHaptics()` returns false.** That helper
  already exists in `js/effects.js` and is currently unused — a toggle for
  something the device cannot do is worse than no toggle.

---

## What must not change

- `js/physics.js` and `js/state.js` stay pure. No platform import, no DOM.
- Gameplay, scoring, combo and unlock economics are untouched. If a phase 1 test
  goes red you have changed behaviour — stop and fix the code, not the test.
- `js/platform.js` remains the only file referencing `ytgame`, `localStorage` or
  `visibilitychange`.

---

## Finish

- All suites green: `unit-tests/` and `tests/verify-features.js`.
- The Pages build still works. Serve it locally and play a full run with sound.
- Commit, then `git push origin playables`. Do not push `main`.
- Do not bump `BUILD_VERSION`. This is not a deploy.
- Report per file what changed, which tests you added, and anything in this
  brief that turned out to be wrong.
