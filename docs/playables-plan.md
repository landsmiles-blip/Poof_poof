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

### [x] 2.1 Create `js/platform.js` — done, `unit-tests/platform.js` passing

One interface, two implementations (`localImpl`, `ytgameImpl`), chosen once at
import time from `window.ytgame?.IN_PLAYABLES_ENV`. `js/storage.js` is deleted
-- its guarded design (in-memory fallback when `localStorage` throws on
*access*, not just read/write) moved into `localImpl` intact, along with the
`?dev=1` read-only mode (now `platform.setReadOnly`/`isReadOnly`, a local-only
extension to the interface below, not part of the Playables-facing contract).

Interface actually shipped (`save`/`flush` split per 2.2's write discipline,
otherwise as specified):
```
init() load() save(obj) flush() firstFrameReady() gameReady()
onPause(cb) onResume(cb) audioEnabled() onAudioEnabledChange(cb)
submitScore(n) language() setReadOnly(v) isReadOnly()
```

`ytgameImpl` additionally guards every single SDK call in a try/catch, failing
open (`load()` -> null, `audioEnabled()` -> true) -- it is the one
implementation with no local fallback behind it, so it carries the same
"must never take the game down" burden `js/storage.js` always carried alone.

**Test, adjusted from the brief:** "boots the game against a failingImpl" is
not something a plain-node test can do at all -- `js/main.js` touches
`document`/canvas at import time, so running it needs a real DOM.
`unit-tests/platform.js` instead (a) drives `ytgameImpl` against a
`window.ytgame` stub where every SDK method throws or rejects, and (b) drives
a literal `failingImpl` (every one of the interface's own methods throws or
rejects) through the exact guarded call sequence `main.js`'s `boot()` and
`persist()` make, asserting neither ever throws and both fall back to a fresh
save. `tests/verify-features.js`'s "Survives blocked localStorage" check is
the closest thing to an actual browser-level version of this and still
passes.

### [x] 2.2 Collapse seven storage keys into one versioned blob — done, `unit-tests/migration.js` and `unit-tests/save-blob.js` passing

- Blob: `{ v: 1, highScore, coins, inventory, unlockedSkins, selectedSkin,
  musicOn, sfxOn }`. (`hapticsOn` deferred to phase 3, as planned.)
- **Write discipline, revised twice:** `js/state.js` cannot call
  `platform.save()` itself -- see "What must not change" below. The first cut
  threaded a `persist` function into `attachInput`/`renderMenu`/`renderGameOver`
  as a third argument, called explicitly at every mutating call site --
  correct, but it broke phase 1's `attachInput.length === 2` regression test
  and scattered the responsibility for remembering to call it across
  `js/input.js` and `js/shop.js`. Moved the *marking* into `js/state.js`
  instead: every mutating export (`startRun`, `buyPowerUp`, `activateMagnet`,
  `consumeBomb`, `consumeRemover`, `selectSkin`, `endRun`) sets a plain
  `state.dirty = true` on success (a data flag, not an I/O call, so this does
  not reintroduce a platform import) and leaves it alone on a no-op failure.
  `js/input.js`/`js/shop.js` set it directly for the one case outside
  `state.js`'s reach -- the mute/music toggle, which lives in
  `js/audio.js`/`js/music.js`. `attachInput`/`renderMenu`/`renderGameOver` are
  back to their original phase-1 signatures; `unit-tests/input-callbacks.js`
  asserts the arity again, plus that `state.dirty` ends up set only where
  warranted. `js/main.js`'s `loop()` is the single place that reads and clears
  it, once a frame, regardless of screen (most of these actions happen on the
  menu/game-over overlays, not mid-run) -- `unit-tests/dirty-flag.js` covers
  the flag itself.
- `persistNow()` (`save()` then `flush()`) is called at `endRun` and inside
  the pause handler, both in `js/main.js`, per the brief -- not inside
  `state.js`'s `endRun` itself, which the brief's own wording implied but
  "what must not change" ruled out.
- **`persist()` is conditional, not unconditional:** the first cut called
  `persist()` once, unconditionally, right after boot -- covering the
  fresh-save starter-Remover grant, but also firing (harmlessly, but
  needlessly) on every single boot of an existing save where nothing changed.
  `createInitialState()` now only sets `state.dirty = true` when the grant
  actually happens; loading an existing save, or booting under `?dev=1`,
  leaves it `false`. The loop's dirty-check above picks up a genuine grant on
  its own; migration doesn't need this at all, since `localImpl.load()`
  already persists a migrated blob synchronously, inside `load()` itself.
- **Migrated:** `localImpl.load()` reads the seven legacy keys when the
  versioned key is absent, builds the blob, and writes it back once.
  `unit-tests/migration.js` seeds all seven, asserts nothing is lost, and
  asserts a genuinely fresh save loads as `null` rather than a migrated blob.
- **Order:** `platform.load()` resolves inside `main.js`'s `boot()` before
  `createInitialState()` runs, which is itself before anything can call
  `persist()` -- structurally enforced, not just documented.
- **Size:** `unit-tests/save-blob.js` asserts a realistic blob stays under
  both the 3 MiB cap and the 64 KiB target (230 bytes, in practice).

### [x] 2.3 Async boot and the ready handshake — done, Pages build confirmed booting (20/20 e2e, offline boot included)

**Bigger than planned, as the brief warned:** three modules read storage at
import time, not one (`state.js`, `audio.js`'s `let muted = loadMuted()`,
`music.js`'s `let musicOn = loadMusicOn()`), plus `main.js` ran its entire
boot at module top level.

**Approach taken (hydrate, don't read), per the brief:** `createInitialState(save)`
takes the loaded blob as an argument; `audio.js`/`music.js` each export
`hydrate(save)` instead of self-loading; `js/main.js` is now `async function
boot()`. Handshake order as specified: `platform.init()` -> `load()` ->
`createInitialState(save)` + `hydrateAudio(save)` + `hydrateMusic(save)` ->
`sizeCanvas()`/`attachInput()` -> `showScreen()` (queues the first paint) ->
`onPause`/`onResume` wired -> font-ready gate -> `requestAnimationFrame(loop)`.

**`firstFrameReady()`/`gameReady()` timing, corrected:** the first cut called
both synchronously, in the same tick as `showScreen()`, before the browser had
painted anything at all. Now both wait on `requestAnimationFrame`:
`firstFrameReady()` fires inside the first rAF callback after `showScreen()`
(the callback that runs right before the browser's next paint), and
`gameReady()` fires inside a second, nested rAF callback one tick later --
guaranteeing at least one real paint has happened, and that the two calls
never land in the same tick. The menu is interactive by construction the
moment `showScreen()` returns (`shop.js` wires its button listeners
synchronously), so nothing needs to load between the two calls.

**One gap, not resolved:** the brief calls for an SDK script tag in
`index.html` before `js/main.js`. Left as a documented, uninserted comment
rather than a guessed `src` -- an invented Playables SDK URL would be
indistinguishable from a verified one to whoever reads this next. Needs the
real tag from Google's onboarding docs before certification.

**Checked, not a violation:** `boot()`'s font-loading step is
`document.fonts.ready` -- a browser API that resolves once the `@font-face`
already declared in `css/style.css` finishes loading, not a fetch the game
issues. That `@font-face` points at `url('../assets/fonts/fredoka-latin.woff2')`,
a relative, same-origin path to a file already shipped in the bundle (per
`js/constants.js`'s `FONT_FAMILY` comment, self-hosted specifically so nothing
needs fetching). No external request is made; nothing to remove.

**Found and fixed along the way (not in the brief):** `service-worker.js`'s
precache list still named the deleted `js/storage.js` and was missing the new
`js/platform.js`. Since `cache.addAll()` is all-or-nothing, this silently
broke the *entire* offline install -- confirmed via `tests/verify-features.js`'s
"Offline boot" check going from passing to failing the moment `js/storage.js`
was deleted, before the list was fixed.

### [x] 2.4 Route the lifecycle through the adapter now — done (added by `docs/phase2brief.md`; not in this plan's original text)

`js/main.js` no longer listens for `visibilitychange` directly -- `platform.onPause`/
`onResume` (wired inside `localImpl`'s own `visibilitychange` listener) do,
behavior unchanged (suspend/resume audio only; stopping the render loop is
phase 3.1). `grep -r visibilitychange js/` now matches only `js/platform.js`.

## What must not change (from `docs/phase2brief.md`) -- honored

`js/physics.js` and `js/state.js` stayed pure: no DOM, no canvas, no audio, no
storage, no platform imports. `state.js` receives `save` as an argument and
returns `toSaveBlob()`'s shape; it never calls `platform.*` itself, which is
why 2.2's write discipline moved to the callers instead of living inside
`state.js`'s mutators as the brief's own wording for that section literally
suggested -- the two parts of the brief conflicted, and this section won, since
it was the more specific and more load-bearing constraint. `js/render.js`
still mutates nothing. All of Phase 1's `unit-tests/` stayed green throughout
(magnet, rainbow, input-callbacks all still pass) -- gameplay, scoring, combo
and unlock economics are untouched.

---

## Phase 3 — Lifecycle and audio

Both are MUST-level, and both appear in Google's published list of what actually
fails games.

### [x] 3.1 Replace the Page Visibility API — done, `tests/verify-features.js` "Pause actually stops the game" / "Resume continues, no silent context" passing

`js/main.js` listened for `visibilitychange` and suspended audio only — the
rAF loop kept running, because `loop()` always re-requested the frame.

- `onPause`: `rafHandle` (the return value of `requestAnimationFrame`, now
  tracked in `js/main.js`) is passed to `cancelAnimationFrame` — gating
  `loop()`'s body with a flag was explicitly rejected in the brief, since the
  loop would still wake 60 times a second. Also suspends audio,
  `music.pauseScheduler()` (clears `setInterval`, added to `js/music.js`), and
  flushes the save (`persistNow()`, already in place from phase 2).
- `onResume`: resets `lastTime`, resumes audio, `music.resumeScheduler()`
  (resets `step`/`nextNoteTime` to "now" before restarting the interval — the
  music-scheduler trap below), restarts the loop.
- **The music-scheduler trap:** `setInterval` fires on the wall clock
  regardless of `AudioContext` suspension, so clearing just the interval on
  pause and resetting the scheduling clock on resume (exactly what
  `startMusic()` already did) was necessary, not optional — confirmed by
  reading `music.js`'s scheduler loop, which would otherwise dump every missed
  step at once.

**Test, adapted:** a Playwright check (`tests/verify-features.js`) starts a
run, lets a fruit fall, dispatches a synthetic `visibilitychange`
(`document.hidden` shadowed via `Object.defineProperty`, since Playwright has
no first-class "background this tab" primitive), and compares two canvas
screenshots **both taken during the pause** — comparing a pre-pause shot
against a during-pause shot was tried first and is wrong on its own terms: a
frame or two legitimately renders during the dispatch round trip, so that
pair always differs even with a correct fix. After resume, a further
screenshot must differ (proving the loop restarted) and the `AudioContext`
must read `'running'`, not stuck suspended. This checks freeze/resume and a
live context; it does not check the absence of an audible music burst or
pixel-exact fruit-position continuity — those would need audio-graph
introspection or reading `js/main.js`'s private `state`, neither of which
existed already, and adding either was judged more machinery than this check
warranted.

### [x] 3.2 Audio must start without a gesture — done, both halves of `tests/verify-features.js`'s split audio-without-gesture check passing

`js/audio.js` built its `AudioContext` inside `unlockAudio()`, reached only
from `pointerdown`. `js/main.js`'s `boot()` now calls `unlockAudio()`
unconditionally when `platform.audioEnabled()` is true (always true for
`localImpl`), and again from `platform.onAudioEnabledChange` when audio
becomes enabled. The `pointerdown` fallback stays. The existing unconditional
`resume()` inside `unlockAudio()` was already correct; untouched.

**Test, split in two, not retried in product code.** A first attempt asserted
`ctx.state === 'running'` outright against default Chromium, with zero
pointer events. It failed, consistently and reproducibly — not flaky, blocked
every time. Default Chromium's autoplay policy refuses a gesture-less
`resume()` outright (logs *"The AudioContext was not allowed to start...
must be resumed after a user gesture"*) and does not self-resolve; a second
explicit `unlockAudio()` call, still with zero gestures, does not help
either. Adding a retry loop to `boot()` to chase that was explicitly rejected
— it would change the product to satisfy a browser policy quirk the real
Playables container doesn't share (the container grants audio out-of-band via
`platform.audioEnabled()`, not through the page's gesture history). Instead:

- **"Audio context created without a gesture"** (default Chromium): asserts
  `getAudioContext() !== null` right after the menu renders, zero pointer
  events dispatched anywhere in the block. This is the actual game's
  responsibility and the thing that fails certification -- gating context
  *creation* behind a gesture. Passes.
- **"Audio actually starts, no gesture (permissive Chromium)"**: a second,
  separate `chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })`
  — the closest local equivalent of the Playables audio grant — asserts
  `ctx.state === 'running'`, zero pointer events. Passes, consistently across
  repeated runs. Kept in its own browser instance, closed immediately after,
  so the shared `browser` (and therefore the merge/celebration sound checks)
  stays on default Chromium and honest about what a real Pages visitor's
  browser actually does. Has a documented fallback (assertion 1 alone, `wired`
  but not `visibleToNewPlayer`, with an explanatory note) if the flag ever
  stops working in this Playwright setup.

**Also found while writing this:** headless Chromium takes a variable,
sometimes 500ms+ amount of time to actually flip a previously-blocked context
to `'running'` after an explicit resume call. The merge-sound check's fixed
80ms wait was already borderline before this phase and became flaky once
boot() started attempting (and being blocked on) a resume earlier than
before. Replaced the fixed wait with a poll on `ctx.state === 'running'` (2s
deadline) purely to get a running context for that check's own purpose — not
evidence about the no-gesture case, which the two checks above cover.

### [x] 3.3 Follow the host mute; delete the in-HUD mute button — done

`MUTE_RECT` (`js/constants.js`), `drawMuteToggle` (`js/render.js`, plus its
now-unused `isMuted` import there), and the mute hit-test (`js/input.js`) are
gone. The shop's Sound and Music buttons remain as the permitted granular
controls. Effective audio state, implemented in `js/audio.js`/`js/music.js`:

```
sfx audible   = platform.audioEnabled() && save.sfxOn
music audible = platform.audioEnabled() && save.musicOn
```

`setHostAudioEnabled()` in each module ANDs the host flag into `ready()`
alongside the player's own toggle; neither module persists the host's half —
`toSaveBlob()` never receives it, only `sfxOn`/`musicOn`, which is why it
cannot leak into the save. The freed HUD corner is left empty, as instructed;
nothing new drawn there.

### [x] 3.4 Give haptics an off switch — done, `unit-tests/haptics.js` and `unit-tests/save-blob.js` passing

`hapticsOn` joins the save blob (`state.js`'s `toSaveBlob`, defaulting to
`true` when absent — both for a fresh save and for an existing save from
before this field existed). `js/effects.js` owns the flag the same way
`js/audio.js`/`js/music.js` own `sfxOn`/`musicOn` (a `hydrate(save)` export,
no storage import), and `vibrate()` checks it first. The shop's third toggle
(`js/shop.js`) follows the Sound/Music pattern exactly — same
toggle/tick/`state.dirty`/redraw shape — and renders nothing at all when
`hasHaptics()` is false, using the helper that already existed and was
already unused before this phase.

---

## Phase 4 — Rendering

### [x] 4.1 Density-aware, responsive canvas — with the zero-viewport guard — done, all four `tests/verify-features.js` checks passing

Replaced the fixed `RENDER_SCALE = 3` with `js/main.js` measuring the
canvas's actual on-screen CSS size (`ResizeObserver`, plus a `matchMedia`
re-subscription trick for `devicePixelRatio` changes, which fire no resize
event of their own) and setting the backing store to that size times a
clamped DPR (`MIN_BACKING_SCALE`/`MAX_BACKING_SCALE` in `js/constants.js`,
1–3). `js/render.js` derives the draw-time transform scale from
`ctx.canvas.width` instead of importing a constant, so it never needs to know
how big the canvas currently is. `js/input.js`'s `toCanvasPoint()` already
divided by the logical size, not `canvas.width` — verified still true, not
"simplified" away.

**The zero-viewport guard** (`handleCanvasMeasurement` in `js/main.js`):
refuses a width/height under 1px, keeping the last known good size. Also
naturally covers the canvas being `hidden` behind a menu/game-over overlay,
since `ResizeObserver` reports a zero content rect the moment an observed
element stops rendering.

**Layout, the part the brief didn't fully solve:** `#overlay` (`css/style.css`)
used a width formula derived purely from `100vh`, which silently disagreed
with the board the moment the canvas became the *width*-constrained one
(an ultra-wide viewport) rather than the height-constrained one it assumed.
Fixed by having `js/main.js` publish the canvas's actual measured width as a
`--canvas-css-width` custom property on `:root`, which `#overlay` now reads
directly — the two can no longer disagree about width regardless of which
dimension the viewport constrains. Overlay height stays content-driven
(scrollable), not tied to the board's aspect ratio, since the shop's content
doesn't share the board's shape.

**Test, extended:** the 0x0-container case is simulated via `display: none`
on the canvas itself (Playwright's `setViewportSize` refuses below 1×1, but
`ResizeObserver` reports the same zero-content-rect signal the instant an
observed element stops rendering, which is the actual mechanism at play).
The ratio sweep runs 9:32, 9:16, 3:4, 1:1, 16:9, 32:9 (3:4 added to the
brief's list) checking no horizontal scroll, the canvas fully inside the
viewport, and the backing store tracking the measured size × DPR. "State
survives resize" is checked against `window.__poofDebugState` — a new,
harmless, read-only-in-practice test hook (`js/main.js`, right after `state`
is assigned) added because there was no other way to see the running game's
actual state from outside; asserts the run stays on the `playing` screen and
score never decreases across the sweep (an exact-snapshot comparison would be
wrong here, since gameplay is genuinely continuing throughout, not frozen).
The DPR clamp is checked with Playwright's `deviceScaleFactor: 4` context
option standing in for a stubbed `devicePixelRatio`.

### [x] 4.2 The Playables build target — done, `tools/build-playables.js`

`node tools/build-playables.js` produces `dist/playables/` (`.gitignore`d):
`css/`, `js/`, `assets/fonts/`, and a from-scratch `index.html` (title and
description meta pulled from the real `index.html`; everything else built
directly rather than stripped from it, since regex-stripping an evolving file
is the more fragile direction) with the SDK placeholder comment before
`js/main.js`, no manifest/icon/theme-color, no service worker registration or
update-and-reload script. No bundler — a plain Node script, matching the
brief.

**`?dev=1`** (the remaining half of item 1.5): `js/state.js`'s
`devModeEnabled()` is replaced in the *built copy only*, matched against its
exact current source text — if that text has changed and no longer matches,
the build throws rather than silently shipping an unstripped `?dev=1`. The
Pages build's real source is untouched, so `tests/verify-features.js`'s
existing `?dev=1` check there keeps its coverage.

**Orientation:** the manifest is excluded entirely, so its
`"orientation": "portrait"` cannot apply; the build script also greps every
`js/*.js` file for `screen.orientation.lock` and refuses to build if it finds
one (there is none).

**Numbers:** 17 files, 172,026 bytes (0.164 MiB) — printed by the build
script every run, checked against all four limits (30 MiB initial, 250 MiB
total, 30 MiB/file, 8,000 files) in code, not just by eyeballing the log.

**Test:** `tests/verify-features.js` rebuilds `dist/playables/` at the top of
every run (so this suite also catches the build script itself breaking), then
serves it from a dedicated Node static server rooted at exactly that
directory — not a path under the main suite's server — so "runs standalone"
means a request for anything outside the build 404s rather than silently
resolving against a repo file the build was supposed to exclude. Confirms
`?dev=1` unlocks nothing and a real drop plays.

### [x] 4.3 Feature-check `ctx.roundRect` — done, `unit-tests/round-rect.js` and a real-browser check passing

`js/render.js`'s three `ctx.roundRect` call sites (`drawPowerBar`) now go
through `roundRectPath()`, which calls `ctx.roundRect` when present and falls
back to a plain `ctx.rect` (dropping the cosmetic radius) when it is not.
Verified two ways: `unit-tests/round-rect.js` against a fake context with
`roundRect` deleted, and manually in a real browser with
`delete CanvasRenderingContext2D.prototype.roundRect` — the HUD renders with
square-cornered chips instead of rounded ones, no thrown error.

### [x] 4.4 Close the one gap phase 3 left open — done, `unit-tests/music-scheduler.js` (added by `docs/phase4brief.md`; not in this plan's original text)

The music-scheduler-resume behaviour (phase 3.1) was verified by construction,
not by test, since Playwright has no inspection surface for "was there an
audible burst." Now tested directly: a stubbed `AudioContext` with a
`currentTime` this test controls, real `pauseScheduler()`/`resumeScheduler()`
calls, and a 30-second fake clock jump while paused. Confirms zero oscillators
get scheduled while paused (even across the jump) and that resume schedules
only a handful on its first tick — not the dozens-at-once burst a scheduler
naively catching up on a clock that moved while it wasn't looking would
produce.

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
