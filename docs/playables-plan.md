# Poof Poof — YouTube Playables certification plan

Read `CLAUDE.md` first; its hard rules apply to every phase here.

Work the phases in order. Each phase is a branch. Do not start a phase until the
previous one is committed and its tests pass. Every item states what it is, why
it exists (the requirement it satisfies), the files it touches, and how it is
proven done.

**Status legend:** `[ ]` not started · `[~]` in progress · `[x]` done, test passing

---

## Phase 0 — Establish the baseline

Nothing else is safe until this is true. Three facts about this repository could
not be determined from outside it.

### [x] 0.1 Report the three unknowns — done, tests N/A (investigation only)

Found first, before any of the three listed unknowns: `main` had never been
fast-forwarded past the initial commit. It held only `README.md`. The entire
game tree existed solely on the remote branch `claude/fruit-merge-game-twa04f`,
whose tip (`9ae427d`) is `BUILD_VERSION = '2026.08.28-5'` — one commit past the
`-4` this plan and `CLAUDE.md` were written against. That tip commit
("Fix five spec-compliance defects...") already fixes several items below —
see the re-scoping note at the top of Phase 1.

1. **`index.html`'s inline script** — the service-worker update handshake. On
   `controllerchange` (fired by the new worker's `skipWaiting()`/
   `clients.claim()`) it reloads to pick up the new build, but only if a
   controller already existed (so a first install doesn't reload someone with
   nothing stale), and it defers the reload via `window.__poofDeferReload` —
   set by `main.js`'s `syncReloadGuard()` to `true` while `state.screen ===
   SCREEN.PLAYING` — applying it later through `window.__poofApplyPendingUpdate`
   once the player is back at the menu.
2. **Service worker / `sw.js` 404** — not a contradiction, a wrong filename.
   The file is `service-worker.js`, and that's exactly what `index.html`
   registers. `sw.js` was never supposed to exist.
3. **`setStorageReadOnly`** — has a caller: `js/main.js:30` calls
   `setStorageReadOnly(devModeEnabled())` before `createInitialState()` runs,
   and `storage.js`'s `writeRaw()` checks `readOnly` as the single choke point
   all seven save functions funnel through. Fully landed, not half — this was
   one of the five defects fixed in `-5`.

### [x] 0.2 Tag the baseline — done

`main` fast-forwarded to `claude/fruit-merge-game-twa04f` (`9ae427d`, ff-only,
no merge commit). Tagged `v2026.08.28-5-pre-cert`. Branch `playables` created
from it. Not yet pushed to `origin`.

### [x] 0.3 Set up the test harness — done, `node unit-tests/run.js` passing

`unit-tests/run.js` — plain Node, no framework, no dependencies: discovers
`unit-tests/*.js` (excluding itself), dynamically imports each, exits non-zero
if any throws. Named `unit-tests/`, not `test/`, specifically so it cannot be
confused with the pre-existing `tests/` directory (a separate Playwright e2e
suite, see 5.x below). A root `package.json` (`"type": "module"`, matching
this codebase's actual nature) stops an unrelated ancestor `package.json` on
this machine (`type: module`, for an unrelated sibling project) from leaking
in unpredictably; `tests/package.json` scopes `"type": "commonjs"` back down
for just that directory, since `tests/verify-features.js` predates this and
uses CommonJS `require`. `unit-tests/constants.js` is a
placeholder sanity check on `BUILD_VERSION`'s shape; `magnet.js`,
`rainbow.js`, `input-callbacks.js`, and `dev-mode-storage.js` are Phase 1's
regression tests (results under each item below). Every later phase adds to
`unit-tests/`.

---

## Phase 1 — Gameplay defects a reviewer hits in minutes

Do this before touching architecture: the changes are small, they are in files
later phases will disturb, and a certification reviewer plays the game.

**Re-scoped after 0.1/0.2, then verified, not assumed:** the baseline this
phase was written against was `-4`. The actual baseline is `-5`
(`claude/fruit-merge-game-twa04f`'s tip), whose "Fix five spec-compliance
defects" commit message claimed 1.1, 1.3, 1.4, and the `setStorageReadOnly`
half of 1.5. That claim was not taken on faith: each item's regression test
was written from this plan's own spec and run against the real modules before
any status was marked. Two of the four claims did not hold up, and were fixed
properly in a follow-up pass (see `docs/phase1brief.md`, now folded in below):

- **1.1 and the `setStorageReadOnly` half of 1.5** — genuinely fixed in `-5`.
  Tests passing.
- **1.3** — was not fixed in `-5` (the delivery schedule existed, but `endRun`
  never refunded an undelivered charge, and `spawnFruit` still silently
  overrode `nextTier` for a wild). Fixed properly below; `unit-tests/rainbow.js`
  now passes.
- **1.4** — was not fixed as specified in `-5`, though not fully dead either:
  bomb feedback worked, wired through `state.events` rather than through
  `attachInput`'s callbacks. That turned out to be the better design (see
  below) — the callback mechanism was deleted rather than completed.
  `unit-tests/input-callbacks.js` now passes against the new contract.

### [x] 1.1 Magnet must not complete merges by itself — fixed in `9ae427d`, `unit-tests/magnet.js` passing

**Bug.** `stepMagnet()` in `js/physics.js` calls `resolveMerges(state)` after
moving fruit. The Magnet therefore performs merges rather than making them
likelier — verified by executing the shipped module: two cherries in adjacent
columns, a cherry held over column 3, one 16 ms tick, and the board came back
holding a grape with +3 score and a combo hit, with no player input. The comment
above the function claims it "never places a fruit directly into a merge
position that the player did not set up"; the code contradicts it.

**Fix.** Remove the `resolveMerges` call. Keep `settleColumns`. The board
resolves on the next landing, as it does for every other move.

**Test.** `unit-tests/magnet.js` — build the fixture above, run one `stepMagnet` tick,
assert the two cherries are now adjacent and both still tier 0, and that
`state.score` is unchanged and `state.events` is empty.

### [x] 1.2 Make the combo rule consistent across power-ups — decided, closed

**Problem.** `detonateBomb()` wraps its cascade in `state.suppressCombo` so those
merges score at 1x and do not extend the streak — a deliberate decision,
documented in the file. Magnet-caused merges get no such treatment. After 1.1
the Magnet no longer merges directly, but any merge it *sets up* still lands on
the next drop and feeds the combo normally.

**Decision: leave the asymmetry.** A merge the player completes by dropping a
fruit is a real merge and earns the streak, magnet-assisted or not; the Bomb
clears the board wholesale with no drop at all, so letting its cascade build a
multiplier would make detonating the cheapest way to run the streak up.
Recorded in a comment above `stepMagnet()` in `js/physics.js` so the asymmetry
is not re-flagged later. No code behavior changed by this item.

### [x] 1.3 Rainbow charges must always be delivered — fixed, `unit-tests/rainbow.js` passing

**Original bug.** `startRun()` in `js/state.js` spent the charge and set
`rainbowRemaining = 2`, `rainbowChance = 0.12`; `spawnFruit()` then rolled 12%
per spawn. Simulated over 20,000 runs: a 10-drop run received nothing 28.4% of
the time and lost one of two wilds a further 38.0%. `-5` replaced the roll with
a schedule but left two gaps: `endRun` never refunded an undelivered charge,
and `spawnFruit` still silently overrode `nextTier` for a wild, so the HUD
preview could still lie. `840/1000` simulated 8-drop runs lost a charge
outright before this fix.

**Fix.**

- `RAINBOW_SCHEDULE = [3, 8]` (`js/constants.js`) — two fixed spawn indices,
  not randomised bands: a random offset made "was this run's charge ever
  refunded" impossible to reason about from the schedule alone.
- `nextTierFor(state)` (`js/state.js`) decides the tier for a spawn index one
  spawn ahead of time — called from `startRun` for the very first spawn and
  from the end of `spawnFruit` for every one after — so `state.nextTier` always
  already holds the truth before it is ever shown as the preview. `spawnFruit`
  no longer has a second, competing tier decision.
- `state.rainbowChargeSpent` / `state.rainbowDelivered` (set in `startRun`,
  incremented in `spawnFruit` at the moment a wild actually becomes the falling
  fruit, not when it is merely scheduled) let `endRun` refund a charge that
  delivered zero wilds, and only that case — refunding on partial delivery (one
  of two) would be farmable: buy a charge, take the wild at spawn 3, end the
  run on purpose, get the coins back, repeat.

**Test.** `unit-tests/rainbow.js` — 1,000 simulated 8-drop runs: every charge
either delivers at least one wild or is refunded, never both and never
neither; every preview matches what actually spawns; a run that survives to
spawn 3 and then ends receives no refund.

### [x] 1.4 One feedback path, not two — fixed, `unit-tests/input-callbacks.js` passing

**Original bug.** `js/input.js` called `callbacks.onBombUsed`,
`callbacks.onRemoverUsed` and `callbacks.onLockedPowerUp`, but `js/main.js`
called `attachInput(canvas, state)` with two arguments — all three were dead.
`-5` gave the Bomb feedback anyway, wired through `state.events` rather than
through the callback the plan originally specified.

**Decision: the events path wins, not the callback.** It already existed, it
already worked for the Bomb, and it matches `CLAUDE.md`'s architecture rule —
physics pushes events, `main.js` turns them into sound and effects, `input.js`
stays free of presentation concerns. The `callbacks` parameter was deleted
rather than completed.

**Fix.**

- `removeFruitAt()` (`js/physics.js`) now pushes a `removerUsed` event (row,
  col, tier) at the point the board actually changes.
- A locked/out-of-stock power-up tap changes no board state, so it has no
  physics event to ride — `js/input.js` pushes a `lockedPowerUp` event (id,
  unlock score) straight onto `state.events` itself. Same queue, one
  mechanism.
- `main.js`'s `drainEvents` handles both: a small burst for the remover, and
  for a locked tap a muted `playUiTick()` plus `triggerLockedFlash()` — a
  short-lived `state.lockedFlash` field, ticked in `update()`, drawn as a ring
  around the tapped chip in `js/render.js`. No second label; the unlock score
  is already drawn beneath the chip.
- `attachInput`'s `callbacks` parameter, its default, and all three
  `callbacks.x?.()` call sites are gone. `main.js`'s two-argument call is now
  correct rather than accidentally correct.

**Test.** `unit-tests/input-callbacks.js` — asserts `attachInput` no longer
declares a third parameter, and that using the remover, detonating a bomb, and
tapping a locked chip each push exactly the right event onto `state.events`.

### [~] 1.5 Remove `?dev=1` from the shipped bundle — deferred to 4.2

`setStorageReadOnly` is wired correctly (0.1.3, confirmed by
`unit-tests/dev-mode-storage.js`) — dev mode can no longer corrupt a real
save. That half stays closed.

**Do not remove `?dev=1` in this phase.** `tests/verify-features.js` contains
a check that exercises it; removing dev mode now breaks a currently-green e2e
suite, and the tempting repair — deleting that check — quietly costs coverage.
Dev mode should be stripped by the same build-target mechanism that strips the
manifest and the service worker, which phase 4.2 introduces. Moved the
remaining half of this item there (see 4.2's amended scope below); a
URL-parameter cheat that unlocks everything still is not something to hand a
certification reviewer, just not a phase-1 problem.

---

## Phase 2 — Platform adapter and the save rewrite

The largest change and the one that unblocks everything after it. Build it as an
adapter, not a port: the SDK does not exist outside the Playables container
(`ytgame` is undefined, `IN_PLAYABLES_ENV` is false, `saveData` has no backend),
so direct SDK calls produce code that cannot be run and a live game that no
longer works.

### [ ] 2.1 Create `js/platform.js`

One interface, two implementations, chosen once at boot.

```
init()                    -> Promise<void>
load()                    -> Promise<object>
save(obj)                 -> Promise<void>
firstFrameReady()         -> void
gameReady()               -> void
onPause(cb) / onResume(cb)
audioEnabled()            -> boolean
onAudioEnabledChange(cb)
submitScore(n)            -> Promise<void>
language()                -> Promise<string>
```

- **`ytgameImpl`** — `ytgame.game.*`, `ytgame.system.*`,
  `ytgame.engagement.sendScore`. Selected when
  `window.ytgame?.IN_PLAYABLES_ENV` is true.
- **`localImpl`** — today's `js/storage.js` behind `load`/`save`,
  `visibilitychange` behind `onPause`/`onResume`, `audioEnabled()` returns true.
  This is the only place in the codebase permitted to use either.

**Test.** A third `failingImpl` where every call rejects or throws. The game must
still boot and play. A platform that misbehaves must never take the game down.

### [ ] 2.2 Collapse seven storage keys into one versioned blob

`js/storage.js` currently writes seven independent keys from roughly ten call
sites — `startRun`, `buyPowerUp`, `activateMagnet`, `consumeBomb`,
`consumeRemover`, `selectSkin`, `endRun`, and the audio toggles. Against a
network-backed API that pattern is untenable.

- One object: `{ v: 1, highScore, coins, inventory, unlockedSkins, selectedSkin,
  musicOn, sfxOn, hapticsOn }`.
- Mark dirty on change; flush debounced. Flush unconditionally in `endRun` and
  inside `onPause`.
- **Migrate:** on first local boot, read the seven old keys into the blob so
  existing Pages players keep their progress.
- **Order:** `load()` must resolve before the first `save()`. The requirement is
  explicit.
- Size cap is 3 MiB, target 64 KiB for exit saves. This blob is under a
  kilobyte — assert it anyway.

### [ ] 2.3 Async boot and the ready handshake

`createInitialState()` currently reads storage synchronously at module load. That
has to become an async boot.

Order: SDK script tag before all game code → `platform.init()` → `load()` →
build state → first paint → `firstFrameReady()` → menu rendered and interactive
→ `gameReady()`.

`gameReady()` must not fire while a loading or splash screen is visible. Initial
bundle size is measured as bytes downloaded until `gameReady`.

---

## Phase 3 — Lifecycle and audio

Both are MUST-level, and both appear in Google's published list of what actually
fails games.

### [ ] 3.1 Replace the Page Visibility API

`js/main.js` listens for `visibilitychange` and suspends audio only — the rAF
loop keeps running, because `loop()` always re-requests the frame.

- `onPause`: cancel the rAF handle, suspend audio, clear `js/music.js`'s
  `setInterval` scheduler, flush the save.
- `onResume`: reset `lastTime` before the first frame so `dt` does not spike,
  then restart the loop.

**Test.** Pause mid-fall, wait, resume: the fruit continues from where it was.

### [ ] 3.2 Audio must start without a gesture

Google's certification FAQ, verbatim: *"The most common audio issue that is seen
involves games that are expecting user interaction before starting playback.
However, YouTube Playables may be given focus automatically, so the game must
handle this case."*

`js/audio.js` builds its AudioContext inside `unlockAudio()`, reached only from
`pointerdown`. Attempt creation at boot when `platform.audioEnabled()` is true,
and again from `onAudioEnabledChange`. Keep the gesture path for the Pages
build. The existing unconditional `resume()` is correct — keep it.

**Test.** Boot and play a merge with no pointer event ever dispatched. Sound
must be audible.

### [ ] 3.3 Follow the host mute; delete the in-HUD mute button

Remove `MUTE_RECT` from `js/constants.js`, `drawMuteToggle` from `js/render.js`,
and its hit test from `js/input.js`. The shop's Music and Sound buttons are the
granular controls and stay. Master mute belongs to YouTube.

### [ ] 3.4 Give haptics an off switch

A third toggle beside Sound and Music, stored in the save blob, checked in
`vibrate()` in `js/effects.js`. Hide the control where `hasHaptics()` is false —
that helper already exists and is currently unused.

---

## Phase 4 — Rendering

### [ ] 4.1 Density-aware, responsive canvas — with the zero-viewport guard

The backing store is a fixed 384x566 scaled by CSS `max-width:100%`, with no
`devicePixelRatio` handling and no resize listener anywhere. It blurs on every
modern phone. `js/icons.js` already does DPR correctly for the shop canvases —
apply the same treatment to the game canvas.

- Keep the 384-wide **logical** coordinate space. Set
  `canvas.width = logicalW * dpr`, scale the context once per resize.
- Drive layout from a `ResizeObserver`.
- **Guard:** refuse to size from a zero or sub-1px measurement; keep the last
  good size and re-measure on the next observation.

That guard is not defensive programming, it is a documented failure. Google's
certification FAQ, verbatim: *"For performance reasons, the game is initially
loaded in a WebView that is not displayed to the user, resulting in the WebView
viewport size being zero."* Without the guard, adding responsive sizing
introduces an Android-only bug that never reproduces on desktop.

**Test.** Mount the game in a 0x0 container, then expand it — the board must
appear correctly. Then sweep 9:32, 9:16, 1:1, 16:9 and 32:9, resizing mid-run
each time, and confirm the board state survives.

### [ ] 4.2 Unlock orientation, strip PWA machinery from the Playables build

`manifest.json` sets `"orientation": "portrait"`, which is prohibited outright.
The manifest, icons and any update-and-reload path have no role in the
container. Add a build flag that emits a Playables `index.html` without them,
while the Pages build keeps them.

**Amended scope (from 1.5, deferred here):** the Playables bundle must also
exclude `?dev=1` (dev mode: cut the feature or gate it out for this target
only — the Pages build may keep it), `package.json`, `node_modules/`,
`tests/`, `unit-tests/`, `docs/`, `.github/`, the web app manifest, the icons,
and the service worker. Nothing that is not the game itself ships.

### [ ] 4.3 Feature-check `ctx.roundRect`

Used unguarded in `drawPowerBar` in `js/render.js`. It throws on Safari below 16
and takes the whole HUD frame with it. Compatibility with the iOS YouTube app's
WebView is a MUST.

---

## Phase 5 — Compliance sweep and test rig

### [ ] 5.1 Run under YouTube's real CSP

Override the `Content-Security-Policy` response header for `index.html` using
Chrome DevTools local overrides, with the exact string Google publishes:

```
default-src 'none'; script-src 'report-sample' 'self' 'unsafe-eval' 'unsafe-inline' blob: https://www.youtube.com/game_api/v0 https://www.youtube.com/game_api/v0/ https://www.youtube.com/game_api/v1 https://www.youtube.com/game_api/v1/; object-src 'none'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' blob: data:; media-src 'self' blob:; font-src 'self' data: https://fonts.googleapis.com https://fonts.gstatic.com; connect-src 'self' blob: data:; sandbox allow-pointer-lock allow-same-origin allow-scripts; base-uri 'self'; manifest-src 'self'; worker-src 'self' blob:
```

Note `connect-src 'self' blob: data:` — `tryLoadTrackFile()` in `js/music.js`
would be permitted by the policy, but the requirements still say all game data
must ship in the bundle. Leave `MUSIC_TRACK_URL` null and cut the fetch path
from the Playables build.

### [ ] 5.2 Device matrix

| Surface | What it is uniquely for |
|---|---|
| Chrome DevTools + CSP override | Policy violations, aspect-ratio sweep, foldable postures |
| Real Android phone (WebView test app) | The zero-size viewport boot; the Android-only rendering failure |
| iOS device | `roundRect`, AudioContext behaviour, the 512 MB heap ceiling |
| DevTools memory profiler | Peak JS heap under 512 MB across a long run |

Skip the Android Studio emulator — a real phone reproduces the WebView boot
better and does not need the RAM.

### [ ] 5.3 Grep for prohibited APIs

`localStorage`, `sessionStorage`, `indexedDB`, `document.cookie`,
`visibilitychange`, `navigator.language`, `fetch`, `XMLHttpRequest`,
`WebSocket`, `eval`, `Worker`, `WebAssembly`, `alert`, `confirm`, `prompt`.
Only `js/platform.js` may match, and only for storage and lifecycle.

### [ ] 5.4 Already compliant — verify, do not investigate

Roughly 100 KB total against a 30 MiB initial cap; 13 modules against an 8,000
file limit; alphanumeric filenames; relative paths; sub-5-second load; no
WebAssembly, `eval` or Workers; no external calls; no personal data collection;
no login; no clipboard access; no external links, share prompt or exit button;
no off-platform monetization; pointer events covering touch and mouse;
English-only satisfying the single language mandate; synthesized audio meaning
there are no music rights to clear.

---

## Phase 6 — SHOULD-level, once the above is green

- [ ] Keyboard: arrows to steer, space to drop, `Esc` to close the shop.
- [ ] `prefers-reduced-motion`: read at startup, feeding the same toggles as
      haptics — shake, particles and squash shipped with no opt-out.
- [ ] `platform.submitScore()` in `endRun`. If used, the score sent must match
      the best score in the save.
- [ ] Record effect positions at merge time, not at drain time — a cascade can
      currently put a particle burst on the wrong cell.
- [ ] A danger state as the spawn column fills. Not required; a reviewer forming
      an impression of the game will notice its absence.
- [ ] A colour-blind-safe skin.

---

## Out of scope for certification

Do not start these until the phases above are green: the desktop canvas scale-up,
a display typeface, per-tier fruit detail, the upcoming-fruit queue, score
animation, objectives, an undo item, a stats screen.
