# Phase 2 brief — platform adapter and the save rewrite

Work on `playables`. `CLAUDE.md`'s hard rules apply throughout.

This is the largest change in the project and the one that unblocks phases 3–5.
Read the whole brief before starting.

**Build it as an adapter, not a port.** The SDK does not exist outside the
Playables container: `ytgame` is undefined, `IN_PLAYABLES_ENV` is false, and
`saveData` has no backend to talk to. Direct SDK calls would produce code that
cannot be run and a live game that no longer works. The GitHub Pages build must
keep working at every single commit in this phase.

---

## 2.1 — `js/platform.js`

One interface, two implementations, selected once at boot.

```
init()                    -> Promise<void>
load()                    -> Promise<object>
save(obj)                 -> void          (debounced internally)
flush()                   -> Promise<void> (write now, await completion)
firstFrameReady()         -> void
gameReady()               -> void
onPause(cb) / onResume(cb)
audioEnabled()            -> boolean
onAudioEnabledChange(cb)
submitScore(n)            -> Promise<void>
language()                -> Promise<string>
```

Selection: `window.ytgame?.IN_PLAYABLES_ENV` → `ytgameImpl`, else `localImpl`.

**`ytgameImpl`** maps to `ytgame.game.loadData` / `saveData` / `firstFrameReady`
/ `gameReady`, `ytgame.system.onPause` / `onResume` / `isAudioEnabled` /
`onAudioEnabledChange` / `getLanguage`, and `ytgame.engagement.sendScore`.

**`localImpl`** wraps today's behaviour: the existing `js/storage.js` guarded
access behind `load`/`save`, `visibilitychange` behind `onPause`/`onResume`,
`audioEnabled()` returns true, `firstFrameReady`/`gameReady` are no-ops,
`submitScore` resolves, `language()` resolves to `'en'`.

**Preserve `storage.js`'s defensive design when you move it.** Its guards are
not decoration — sandboxed iframes and blocked-site-data browsers can throw on
*access* to `localStorage`, not just on read or write, and that file already
handles it with an in-memory fallback. Keep that, and keep the read-only mode
used by `?dev=1`.

`js/platform.js` is the **only** file in the codebase permitted to reference
`ytgame`, `localStorage`, or `visibilitychange`. Everything else imports from
it.

### Test

Add a third `failingImpl` where every method rejects or throws, and a test that
boots the game against it. The game must still start and play. A platform that
misbehaves must never take the game down.

---

## 2.2 — Collapse seven keys into one versioned blob

### The shape

```
{ v: 1, highScore, coins, inventory, unlockedSkins, selectedSkin,
  musicOn, sfxOn }
```

(`hapticsOn` joins this in phase 3. Design the version field so adding it is a
non-event.)

### Write discipline

`saveInventory`, `saveCoins`, `saveHighScore`, `saveSelectedSkin`, `saveMuted`
and `saveMusicOn` are called from roughly ten sites — `startRun`, `buyPowerUp`,
`activateMagnet`, `consumeBomb`, `consumeRemover`, `selectSkin`, `endRun`, and
the two audio toggles. Against a network-backed API that pattern is untenable.

Replace them with: mark dirty on change, `platform.save()` debounced (~1s), and
an unconditional `platform.flush()` in `endRun` and inside the pause handler.

### Migration

On first boot under `localImpl`, if the blob is absent but the seven legacy keys
exist, read them into the blob and write it once. Existing Pages players must
not lose progress. Add a test for this: seed the seven old keys, boot, assert the
blob matches and the player keeps their coins, skins and inventory.

### Ordering

`load()` must resolve before the first `save()`. The requirement is explicit and
the current code cannot satisfy it — see 2.3.

### Size

Cap is 3 MiB, target 64 KiB for exit saves. This blob is under a kilobyte.
Assert it anyway, so a future addition that blows the budget fails a test rather
than a certification review.

---

## 2.3 — Async boot

**This is the hard part, and it is bigger than the plan said.** Three modules
read storage at import time, not one:

- `js/state.js` — `createInitialState()` calls `loadHighScore`, `loadCoins`,
  `loadInventory`, `loadUnlockedSkins`, `loadSelectedSkin`
- `js/audio.js` — `let muted = loadMuted();` at module scope
- `js/music.js` — `let musicOn = loadMusicOn();` at module scope

And `js/main.js` runs the entire boot at module top level: `createInitialState()`,
then `showScreen()`, then `requestAnimationFrame(loop)`.

All four have to change together.

### The approach: hydrate, don't read

Do **not** make module-load magically async, and do not reach for dynamic
`import()` to defer things. Instead, pass the loaded save in:

- `createInitialState(save)` takes the blob as an argument.
- `js/audio.js` and `js/music.js` each expose a `hydrate(save)` that sets their
  flags. Neither reads storage.
- `js/main.js` becomes an `async function boot()` that awaits
  `platform.init()` and `platform.load()`, hydrates all three, then starts.

This keeps the modules synchronous and testable, and makes the data flow
obvious.

### Handshake order

```
SDK script tag (before all game code)
  -> platform.init()
  -> platform.load()
  -> createInitialState(save) + audio.hydrate(save) + music.hydrate(save)
  -> first paint
  -> platform.firstFrameReady()
  -> menu rendered and interactive
  -> platform.gameReady()
```

`gameReady()` must not fire while a loading or splash screen is visible. Initial
bundle size is measured as bytes downloaded until `gameReady`, so do not put
work after it that belongs before it.

Add the SDK script tag to `index.html` **before** the game's module script.
Outside Playables it is a harmless 404 or an unused global — confirm the game
still boots on Pages with it present.

---

## 2.4 — Route the lifecycle through the adapter now

`js/main.js` currently listens for `visibilitychange` directly. Since `localImpl`
now encapsulates that, change `main.js` to use `platform.onPause` /
`platform.onResume` in this phase.

Keep the *behaviour* identical for now — suspend and resume audio, exactly as
today. Phase 3 changes what those handlers do (stop the render loop, clear
`music.js`'s `setInterval` scheduler, flush the save). This phase only moves the
plumbing, so phase 3 is a behaviour change rather than a plumbing change.

After this, `grep visibilitychange js/` should match `js/platform.js` and
nothing else.

---

## What must not change

- `js/physics.js` and `js/state.js` stay pure — no DOM, no canvas, no audio, no
  storage, and now no platform imports either. `state.js` receives the save as
  an argument; it does not fetch it.
- `js/render.js` still mutates nothing.
- Gameplay, scoring, combo and unlock economics are untouched. If a phase 1 test
  goes red, you have changed behaviour — stop and fix it rather than updating
  the test.

---

## Finish

- All suites green: `unit-tests/` and `tests/verify-features.js`.
- The Pages build still works. Serve it locally and play a run.
- Commit, then `git push origin playables`. Do not push `main` — that publishes
  the live site, and this work is not ready for players.
- Do not bump `BUILD_VERSION`. This is not a deploy.
- Report: what changed per file, which tests you added, and anything in the
  brief that turned out to be wrong.
