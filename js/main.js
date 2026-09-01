// Entry point: owns the requestAnimationFrame loop and wires state, physics,
// render, input, audio, effects, theme, platform, and the shop screens together.

import {
  CANVAS_WIDTH, TIERS, HAPTIC_BOMB_MS, HAPTIC_CHARGE_EARNED_MS, CELL,
  MIN_BACKING_SCALE, MAX_BACKING_SCALE,
} from './constants.js';
import {
  createInitialState, SCREEN, startRun, endRun, tickCombo, skinColor, tierColor, devModeEnabled,
  triggerLockedFlash, tickLockedFlash, tickChipPulse, toSaveBlob,
} from './state.js';
import * as platform from './platform.js';
import { spawnFruit, stepPhysics, isGameOver } from './physics.js';
import { drawFrame, canvasHeightFor } from './render.js';
import { attachInput } from './input.js';
import { renderMenu, renderGameOver, renderPausePanel } from './shop.js';
import {
  playMerge, playCelebration, playGameOver, playUiTick, playChargeEarned,
  suspendAudio, resumeAudio, unlockAudio, getAudioContext,
  hydrate as hydrateAudio, isMuted, setHostAudioEnabled as setAudioHostEnabled,
} from './audio.js';
import {
  attachContext, startMusic, stopMusic, hydrate as hydrateMusic, isMusicOn,
  setHostAudioEnabled as setMusicHostEnabled, pauseScheduler as pauseMusicScheduler,
  resumeScheduler as resumeMusicScheduler,
} from './music.js';
import {
  createEffects, updateEffects, spawnMergeEffects, clearEffects, vibrate,
  hydrate as hydrateHaptics, isHapticsOn, spawnBombRing,
} from './effects.js';
import { themeForScore, applyPageTheme, relativeLuminance } from './theme.js';
import { initBackground, setBoardRect, drawBackground } from './background.js';

const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const pausePanelRoot = document.getElementById('pause-overlay');

// Assigned once, in boot(), once platform.load() resolves -- everything below
// that references `state` is only ever called after that has happened.
let state;
const fx = createEffects();

// 9.3: true only while the in-game pause PANEL is on screen -- a purely
// local presentation flag, the same way input.js's own `dragging` never
// needed to live on state. Distinct from state.paused (which covers a
// host-driven pause too, and gates input/the loop): this one exists so a
// host resume that happens to fire while the player has the panel open does
// not silently un-freeze gameplay out from under it -- see platform.onResume
// below.
let pausePanelOpen = false;

// The canvas has two sizes that must not be confused:
//   - the BACKING STORE (canvas.width/height), in device pixels -- sized to
//     the canvas's actual on-screen CSS size times a clamped
//     devicePixelRatio, so text and hairlines stay sharp without
//     over-provisioning fill-rate and memory on a small display (the
//     certification ceiling is a 512 MB JS heap);
//   - the LOGICAL size the game draws in, always 384 x canvasHeightFor(state).
//     js/render.js derives the backing-store scale from canvas.width at draw
//     time, so nothing here needs to track that number separately.
// CSS sizing (how big the canvas appears on screen) is left to the
// stylesheet; this module only measures the result, and devicePixelRatio, to
// decide the backing store's resolution.

let lastGoodCssSize = null; // { width, height } in CSS px

function clampedDPR() {
  return Math.min(MAX_BACKING_SCALE, Math.max(MIN_BACKING_SCALE, window.devicePixelRatio || 1));
}

function applyBackingStoreSize() {
  if (!lastGoodCssSize) return;
  const dpr = clampedDPR();
  const w = Math.max(1, Math.round(lastGoodCssSize.width * dpr));
  const h = Math.max(1, Math.round(lastGoodCssSize.height * dpr));
  // Compare against the backing size, not the logical one: an old guard here
  // once compared canvas.height to the logical height, so under scaling it
  // never matched and reassigned (resetting the 2D context) on every call.
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

// The zero-viewport guard. From Google's certification FAQ, verbatim: "For
// performance reasons, the game is initially loaded in a WebView that is not
// displayed to the user, resulting in the WebView viewport size being zero."
// Refuse to size the backing store from that; keep the last known good size
// and let the next observation -- once the WebView actually becomes visible
// -- correct it. This is the point of this function, not defensive
// decoration: without it, responsive sizing introduces an Android-only
// failure that never reproduces on a desktop, because nothing here would
// ever re-measure and the game would boot at 0x0 and stay there.
//
// The same guard also covers the routine case of the canvas being `hidden`
// behind a menu/game-over overlay: ResizeObserver reports a zero content
// rect the moment an observed element stops rendering.
function handleCanvasMeasurement(widthPx, heightPx) {
  if (widthPx < 1 || heightPx < 1) return;
  lastGoodCssSize = { width: widthPx, height: heightPx };
  // #overlay (css/style.css) has no way of its own to know how wide the
  // canvas actually renders -- it can be width- or height-constrained
  // depending on the viewport's aspect ratio -- so that is shared through a
  // custom property instead of duplicating the sizing logic in CSS. Without
  // this, the shop stays a small card next to a large board on a wide
  // screen: the two halves of the game visibly disagree.
  document.documentElement.style.setProperty('--canvas-css-width', `${widthPx}px`);
  applyBackingStoreSize();
  // js/background.js's halo is centred on the board -- cached here (this
  // function already early-returns on a zero rect) rather than measured per
  // frame, so the halo stays where the board was even while canvas.hidden
  // makes getBoundingClientRect() return zero (behind the menu).
  setBoardRect(canvas.getBoundingClientRect());
}

function measureCanvasNow() {
  const rect = canvas.getBoundingClientRect();
  handleCanvasMeasurement(rect.width, rect.height);
}

// Extra Row changes canvasHeightFor(state), which changes the aspect ratio
// CSS derives the canvas's (and, via --canvas-css-width above, the
// overlay's) on-screen size from. Set on :root rather than on the canvas
// element itself, which is what lets #overlay share it.
//
// Two custom properties, not one: --canvas-aspect (a <ratio>, "384 / N") is
// what the `aspect-ratio` property consumes; --canvas-ratio (a plain number,
// 384/N) is what css/style.css's width formula multiplies a length by. Both
// come from this one logicalH so they can never drift apart -- see that
// rule's own comment for why width has to be computed this way at all.
function syncCanvasAspect() {
  const logicalH = canvasHeightFor(state);
  document.documentElement.style.setProperty('--canvas-aspect', `${CANVAS_WIDTH} / ${logicalH}`);
  document.documentElement.style.setProperty('--canvas-ratio', `${CANVAS_WIDTH / logicalH}`);
  // The aspect-ratio change lands synchronously in this same task, but
  // ResizeObserver callbacks fire asynchronously -- measure immediately too,
  // so a screen transition or an Extra Row run does not show one stale frame
  // at the previous size first.
  measureCanvasNow();
}

if (typeof ResizeObserver === 'function') {
  const canvasResizeObserver = new ResizeObserver((entries) => {
    const box = entries[entries.length - 1].contentRect;
    handleCanvasMeasurement(box.width, box.height);
  });
  canvasResizeObserver.observe(canvas);
} else {
  // Support is broad enough (every target here: Chromium-based WebViews,
  // Safari 13.1+) that this should not happen -- but "should not happen" and
  // "a game that renders nothing" are a bad combination to leave unhandled.
  // A window resize listener does not catch a container-only resize with the
  // window unchanged, but it is a real measurement rather than no measurement
  // at all, and syncCanvasAspect()'s own explicit calls (screen transitions,
  // Extra Row) still fire regardless of which sizing path is active.
  window.addEventListener('resize', measureCanvasNow);
}

// There is no "devicePixelRatio changed" event -- moving a window between
// monitors changes it without resizing any element. The standard workaround:
// watch a matchMedia query pinned to the CURRENT ratio, and re-pin a new one
// each time it fires (a change means the ratio is no longer what the query
// was watching for).
function watchDevicePixelRatio() {
  if (typeof window.matchMedia !== 'function') return;
  const mql = window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
  mql.addEventListener('change', () => {
    applyBackingStoreSize();
    watchDevicePixelRatio();
  }, { once: true });
}
watchDevicePixelRatio();

// Tells index.html whether it is safe to reload for a service worker update.
// A refresh mid-run would discard the player's game, so updates wait for a menu.
function syncReloadGuard() {
  const playing = state.screen === SCREEN.PLAYING;
  window.__poofDeferReload = playing;
  if (!playing) window.__poofApplyPendingUpdate?.();
}

// Music shares audio.js's context, which only exists after a user gesture, so
// this is called at every point where a gesture has just happened.
function syncMusic() {
  unlockAudio();
  attachContext(getAudioContext());
  if (state.screen === SCREEN.PLAYING) startMusic();
  else stopMusic();
}

// The single point every persisted field flows through on its way to
// platform.save()/flush(). state.js stays free of platform imports (and of
// audio.js/music.js imports) -- this is where those two halves meet.
function currentSaveBlob() {
  return toSaveBlob(state, { musicOn: isMusicOn(), sfxOn: !isMuted(), hapticsOn: isHapticsOn() });
}

// Debounced. Not called directly from anywhere else -- state.dirty is the
// single trigger (checked once a frame in loop(), below), set by whichever
// state.js export just changed a persisted field, or directly by input.js/
// shop.js for the mute/music toggles, which live in audio.js/music.js rather
// than state.js and so have no export to get the flag from for free.
function persist() {
  state.dirty = false;
  platform.save(currentSaveBlob());
}

// Immediate -- call at the specific moments platform.js's contract requires
// it: endRun, and the pause handler.
function persistNow() {
  state.dirty = false;
  platform.save(currentSaveBlob());
  return platform.flush();
}

// 11.2: js/background.js's drawBackground(theme, timeSec) has no `state`
// parameter to call js/state.js's skinColor from, so the live skin's tier
// colours (for the backdrop's decorative shapes) ride on the theme object
// instead, built here where `state` is in scope. Score is forced to 0 on the
// menu the same way showScreen's own applyPageTheme call is: state.score
// stays at the previous run's value until the NEXT startRun (see endRun),
// so using it unconditionally here would show the backdrop's ground and
// halo in the last run's palette while the DOM/CSS are already back to the
// menu's -- a visible seam between the canvas and everything around it.
function backgroundTheme() {
  const score = state.screen === SCREEN.MENU ? 0 : state.score;
  return { ...themeForScore(score), skinColors: TIERS.map((_, i) => skinColor(state, i)) };
}

function showScreen() {
  syncReloadGuard();
  // The overlay screens use the same CSS variables as the board, so they need
  // the theme applied too. Previously applyPageTheme ran only inside the
  // PLAYING branch of the loop, leaving the palette frozen at the run's final
  // value behind the game-over screen and never returning to base on the menu.
  applyPageTheme(themeForScore(state.screen === SCREEN.MENU ? 0 : state.score));
  if (state.screen === SCREEN.MENU) {
    overlay.hidden = false;
    canvas.hidden = true;
    // startRun is called inside shop.js now, so the menu's run toggles (Slow
    // Drop / Extra Row / Rainbow) actually reach it.
    renderMenu(overlay, state, () => {
      clearEffects(fx);
      overlay.hidden = true;
      canvas.hidden = false;
      // After unhiding, not before: measuring a still-hidden canvas would
      // hit the zero-viewport guard and just keep the previous size.
      syncCanvasAspect();
      syncReloadGuard();
      syncMusic();
      // 12.1(a): startRun (called inside shop.js, before this callback runs)
      // just set state.paused = false and state.screen = PLAYING. Normally
      // the loop is already ticking -- it keeps running on the menu to
      // animate the backdrop -- but if it had died for any reason (a host
      // pause whose resume never fired, say), nothing else here would ever
      // re-arm it. Guarded on rafHandle === null: the common case is a
      // no-op read.
      if (rafHandle === null) startLoop();
    });
  } else if (state.screen === SCREEN.GAMEOVER) {
    overlay.hidden = false;
    canvas.hidden = true;
    renderGameOver(overlay, state, () => {
      clearEffects(fx);
      overlay.hidden = true;
      canvas.hidden = false;
      syncCanvasAspect();
      syncReloadGuard();
      syncMusic();
      // 12.1(a): see the identical comment in renderMenu's callback above --
      // this is the Play Again path, the one the freeze's reproduction
      // actually hits.
      if (rafHandle === null) startLoop();
    });
  }
}

// 14.1: was a local wrapper that handled the rainbow sentinel and not the
// bomb, while js/render.js carried a second copy that handled both. See
// state.js's tierColor, which is now the only one.
function colorForTier(tier) {
  return tierColor(state, tier);
}

// Turns queued physics events into sound and visual feedback. Physics never
// imports audio, effects, or the DOM, so this is the single place gameplay
// becomes audible and tactile.
function drainEvents() {
  // Decided once per frame, not inside effects.js -- that module stays free
  // of a theme.js dependency, and the board's brightness cannot change
  // mid-frame anyway. theme.boardTop, not boardBot: particles spawn near
  // where the merge happened, closer to the top of whichever cell it was in
  // than the very bottom of the board.
  const bright = relativeLuminance(themeForScore(state.score).boardTop) >= 0.5;

  // 14.1: the loop is wrapped so the queue is cleared even if a handler
  // throws. It used to clear only on the way out, which turned any single bad
  // event into a permanent one: the throw skipped the clear, the same event
  // was still at the head of the queue on the next frame, and it threw again,
  // every frame, for the rest of the run. Phase 12.1's try/catch around the
  // loop body kept the game DRAWING, which is why it never looked broken --
  // but every merge sound, particle, squash, haptic and chip pulse behind
  // that event was dead, and so was the pause button, since
  // openPauseMenu()'s only caller is the `pauseRequested` branch below.
  //
  // A dropped frame of effects is a bad outcome. A dropped RUN is a different
  // kind of bad, and the difference is this `finally`.
  try {
    for (const event of state.events) {
      if (event.type === 'merge') {
        playMerge(event.tier);
        spawnMergeEffects(fx, {
          row: event.row,
          col: event.col,
          x: event.x,
          y: event.y,
          tier: event.tier,
          color: colorForTier(event.tier),
          bright,
        });
      } else if (event.type === 'reachedTop' || event.type === 'topTier') {
        playCelebration();
        spawnMergeEffects(fx, {
          row: event.row,
          col: event.col,
          x: event.x,
          y: event.y,
          tier: TIERS.length - 1,
          color: colorForTier(TIERS.length - 1),
          bright,
        });
      } else if (event.type === 'bombCleared') {
        // One max-intensity burst per destroyed fruit, plus one expanding ring
        // centred on the target. Detonation previously produced no visual or
        // tactile response at all, despite clearing up to nine cells -- the
        // loudest action in the game happened in silence.
        const topTier = TIERS.length - 1;
        for (const cell of event.cells) {
          spawnMergeEffects(fx, {
            row: cell.row,
            col: cell.col,
            tier: topTier,
            color: colorForTier(cell.tier),
            silent: true, // one pulse for the batch, fired below
            bright,
          });
        }
        spawnBombRing(fx, event.col * CELL + CELL / 2, event.row * CELL + CELL / 2);
        vibrate(HAPTIC_BOMB_MS);
      } else if (event.type === 'removerUsed') {
        spawnMergeEffects(fx, {
          row: event.row,
          col: event.col,
          tier: event.tier,
          bright,
          color: colorForTier(event.tier),
        });
      } else if (event.type === 'lockedPowerUp') {
        playUiTick();
        triggerLockedFlash(state, event.id);
      } else if (event.type === 'chargeEarned') {
        // 8.1: a reward moment, announced -- the chip's own pulse is already
        // set by grantEarnedCharge (state.js); this is just the sound/haptic.
        playChargeEarned();
        vibrate(HAPTIC_CHARGE_EARNED_MS);
      } else if (event.type === 'pauseRequested') {
        // 9.3: routed through state.events (not a callback) so input.js's
        // attachInput can stay exactly (canvas, state) -- see its own comment
        // at the push site.
        openPauseMenu();
      }
    }
  } finally {
    state.events.length = 0;
  }
}

let lastTime = performance.now();
// Tracks the live requestAnimationFrame handle so onPause can actually cancel
// it. Gating loop()'s body behind a flag would leave the loop itself still
// waking 60 times a second -- paused means not executing, not just idling.
let rafHandle = null;

// 12.1: the freeze's backstop. Every known way the rAF chain could die
// without a genuine pause -- Play/Play Again after a host pause whose resume
// never arrived, a throw inside loop() -- is fixed at its own source below,
// but the bug that prompted this phase proved a path nobody had found yet.
// This is what catches the next one: while paused, poll for the specific
// contradiction "should be running (screen playing, not paused) but isn't
// (no rAF handle)" and re-arm if so. 500ms, not a 60Hz loop -- the
// certification concern about polling loops (see platform.js) still holds,
// and this is a low-rate correctness check, not a render path.
let watchdogHandle = null;

function startWatchdog() {
  if (watchdogHandle !== null) return;
  watchdogHandle = setInterval(() => {
    if (state.screen === SCREEN.PLAYING && !state.paused && rafHandle === null) startLoop();
  }, 500);
}

function stopWatchdog() {
  if (watchdogHandle === null) return;
  clearInterval(watchdogHandle);
  watchdogHandle = null;
}

function startLoop() {
  rafHandle = requestAnimationFrame(loop);
  // The loop is confirmed running again -- the watchdog's job is done until
  // the next pause.
  stopWatchdog();
}

function loop(now) {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;

  // 12.1(d): one bad frame must not brick the game. Without this, a throw
  // anywhere in update()/drawFrame()/drawBackground() would skip the tail
  // startLoop() call below and cancel the rAF chain for good -- identical to
  // the freeze this phase exists to fix, just from a different cause.
  try {
    if (state.screen === SCREEN.PLAYING && !state.paused) {
      update(dt);
      drawFrame(ctx, state, fx);
      applyPageTheme(themeForScore(state.score));
    }

    // 11.2 landmine (docs/phase11brief.md L2): deliberately OUTSIDE the
    // branch above. That branch only runs while actively playing; the
    // backdrop must keep animating behind the menu, the shop and the
    // game-over screen too -- exactly where a player deciding whether to
    // play again is looking. A genuine pause (below) stops this the same
    // way it stops everything else in loop(): by the whole function not
    // running, not by a flag here.
    drawBackground(backgroundTheme(), now / 1000);

    // Checked regardless of screen: most persisted-field changes (buying,
    // picking a skin, toggling sound) happen on the menu/game-over overlays,
    // not mid-run. Cheap when clean -- one boolean read most frames.
    if (state.dirty) persist();
  } catch (err) {
    console.error('[poof-poof] loop() threw; recovering', err);
  }

  // 9.3: openPauseMenu (via drainEvents, inside update() above) can set
  // state.paused mid-frame, cancelling rafHandle as part of pauseRun() --
  // without this guard, this unconditional call would immediately re-arm it
  // again before the function even returns, undoing that cancellation in the
  // SAME frame. A host-driven pause never hits this: it fires from an event
  // listener between frames, with no trailing startLoop() call of its own to
  // undo. Outside the try/catch above (12.1(d)) so a throw can never skip it.
  if (!state.paused) startLoop();
}

function update(dt) {
  tickCombo(state, dt);
  tickLockedFlash(state, dt);
  tickChipPulse(state, dt);
  updateEffects(fx, dt);

  if (state.active) {
    stepPhysics(state, dt);
  } else {
    const result = spawnFruit(state);
    if (result.blocked || isGameOver(state)) {
      endRun(state, 'grid-full');
      persistNow();
      // The save's highScore, not this run's score -- that is the value the
      // requirement asks to match, and it is already what endRun just wrote.
      // localImpl no-ops; ytgameImpl reports it to the host leaderboard.
      platform.submitScore(state.highScore);
      playGameOver();
      stopMusic();
      showScreen();
    }
  }

  drainEvents();
}

// 9.3: the ONLY two functions that ever stop or restart the run -- a
// host-driven pause (platform.onPause/onResume) and the in-game pause panel
// both call exactly these, never a second, parallel mechanism. Extracted
// from what used to be platform.onPause/onResume's own callback bodies
// unchanged; openPauseMenu/closePauseMenu below are what's new.
function pauseRun() {
  if (rafHandle !== null) {
    cancelAnimationFrame(rafHandle);
    rafHandle = null;
  }
  suspendAudio();
  pauseMusicScheduler();
  state.paused = true;
  persistNow();
  // 12.1(c): armed for exactly as long as the game claims to be paused --
  // stopWatchdog() (in startLoop) disarms it the moment the loop is
  // confirmed running again, whether that happens via resumeRun, the Play/
  // Play Again re-arm below, or the watchdog catching itself.
  startWatchdog();
}
function resumeRun() {
  lastTime = performance.now(); // avoid a huge dt spike on the first frame back
  state.paused = false;
  resumeAudio();
  resumeMusicScheduler();
  if (rafHandle === null) startLoop();
}

// Triggered by input.js's pauseRequested event (the HUD button), never
// called while already open or off the PLAYING screen.
function openPauseMenu() {
  if (state.screen !== SCREEN.PLAYING || pausePanelOpen) return;
  pausePanelOpen = true;
  pauseRun();
  pausePanelRoot.hidden = false;
  renderPausePanel(pausePanelRoot, state, {
    onResume: closePauseMenu,
    onBackToMenu: backToMenuFromPause,
  });
}

function closePauseMenu() {
  if (!pausePanelOpen) return;
  pausePanelOpen = false;
  pausePanelRoot.hidden = true;
  pausePanelRoot.innerHTML = '';
  resumeRun();
}

// "Back to menu" means the game's OWN menu (a Playables hard requirement --
// no exit/quit control of any kind may leave the Playable itself), not the
// results screen endRun normally leads to next. The score/coins/unlock
// tallying endRun does still has to run -- leaving voluntarily should not
// erase progress this run already earned -- only the SCREEN it chose is
// overridden here, straight to the menu instead of showScreen()'s GAMEOVER
// branch. closePauseMenu runs first so the loop/audio are back in their
// normal always-on state before this screen transition -- otherwise the
// NEXT run would start with a permanently cancelled rAF loop.
function backToMenuFromPause() {
  closePauseMenu();
  endRun(state, 'quit-to-menu');
  persistNow();
  platform.submitScore(state.highScore);
  stopMusic();
  state.screen = SCREEN.MENU;
  clearEffects(fx);
  showScreen();
}

// Order: SDK script tag (index.html, before this module) -> platform.init()
// -> platform.load() -> build state and hydrate audio/music -> first paint ->
// platform.firstFrameReady() -> menu rendered and interactive ->
// platform.gameReady(). gameReady() must not fire while a loading or splash
// screen is visible -- there is none here, so it fires as soon as the first
// showScreen() has actually reached the screen.
async function boot() {
  initBackground();

  // MUST run before createInitialState(): dev mode inflates inventory and
  // highScore in memory, and if a fresh save's starter-Remover grant sets
  // state.dirty (see createInitialState), the loop's first persist() would
  // otherwise write that inflated stock over the player's real save.
  platform.setReadOnly(devModeEnabled());

  await platform.init();
  const save = await platform.load();

  state = createInitialState(save);
  // Test-only hook: lets an automated check (e.g. "state survives a resize")
  // read the running game's actual state without a bespoke IPC channel for
  // it. Gated out of the Playables container at runtime (defense in depth)
  // AND stripped from dist/playables/ entirely by tools/build-playables.js
  // -- the container should never see this identifier at all, not just have
  // it be inert. Pages-only, where tests/verify-features.js uses it.
  if (!platform.isPlayablesEnv) window.__poofDebugState = state;
  hydrateAudio(save);
  hydrateMusic(save);
  hydrateHaptics(save);

  // Effective audio state is platform.audioEnabled() ANDed with the player's
  // own sfxOn/musicOn toggles (js/audio.js, js/music.js) -- never the other
  // way around, and the host's half is never written into the save; it
  // belongs to YouTube, not to the player's persisted preferences.
  const hostAudio = platform.audioEnabled();
  setAudioHostEnabled(hostAudio);
  setMusicHostEnabled(hostAudio);
  platform.onAudioEnabledChange((enabled) => {
    setAudioHostEnabled(enabled);
    setMusicHostEnabled(enabled);
    if (enabled) unlockAudio();
  });

  // The named certification failure: "YouTube Playables may be given focus
  // automatically, so the game must handle this case" -- i.e. without ever
  // waiting for a gesture. Attempt unconditionally when the host allows it;
  // unlockAudio() is idempotent and safe to call again from a real gesture
  // later (the pointerdown listener below), which is what actually starts
  // audio on the Pages build, where a browser autoplay policy can still
  // block a gesture-less resume.
  if (hostAudio) unlockAudio();

  syncCanvasAspect();
  attachInput(canvas, state);

  showScreen();

  // showScreen() only queued a DOM/canvas update; it has not painted yet.
  // firstFrameReady() waits for the rAF callback that fires right before that
  // paint, and gameReady() waits for a second one, so it fires only once the
  // browser has actually painted at least once -- not in the same tick as
  // firstFrameReady(), and not before either.
  requestAnimationFrame(() => {
    platform.firstFrameReady();
    requestAnimationFrame(() => {
      // The menu showScreen() rendered is already interactive by construction
      // (its button listeners are wired synchronously in shop.js) -- nothing
      // further loads between the two ready calls.
      platform.gameReady();
    });
  });

  platform.onPause(pauseRun);
  // Guarded: a host resume (e.g. the tab regaining visibility) firing while
  // the player has the in-game pause panel open must not silently un-freeze
  // gameplay out from under a screen that still says "Paused" -- the player
  // resumes it themselves, via the panel's own Resume button.
  platform.onResume(() => {
    if (pausePanelOpen) return;
    resumeRun();
  });

  // Any first interaction anywhere is a valid moment to start audio.
  window.addEventListener('pointerdown', unlockAudio, { once: true });

  // 12.1(b): the host visibility signal's resume half is exactly the
  // unreliable one in an in-app WebView, which is what the freeze's
  // reproduction turned out to be. pageshow/focus (wired in js/platform.js,
  // the one file allowed to touch document-level lifecycle events) cover
  // most of that, but this is the unconditional backstop: a tap anywhere
  // must always be able to wake the game, regardless of which lifecycle
  // signal did or didn't fire.
  // Excludes the in-game pause panel on purpose -- see pausePanelOpen's own
  // comment above -- and goes through the same resumeRun() every other
  // resume path uses, never a second mechanism.
  //
  // Pages-only. Inside the Playables container platform.onPause/onResume are
  // the real ytgame.system signals, not the WebView-unreliable visibility
  // event this fallback was written for -- the host owns that lifecycle
  // there. Letting a stray tap silently resume ahead of (or instead of) the
  // host's own onResume call would let the game's local paused state drift
  // out of sync with what YouTube believes it told the Playable, which is a
  // worse failure than the one this fallback exists to catch.
  if (!platform.isPlayablesEnv) {
    document.addEventListener('pointerdown', () => {
      if (state.paused && !pausePanelOpen) resumeRun();
    });
  }

  applyPageTheme(themeForScore(0));
  // So the menu is never shown against a bare --page-bg before the loop's
  // own recurring call (in loop(), outside the PLAYING branch) gets there.
  drawBackground(backgroundTheme(), performance.now() / 1000);

  // ctx.font silently falls back when the face has not loaded -- canvas has no
  // equivalent of font-display -- so starting the loop immediately would paint
  // the first frames in system-ui and then snap to Fredoka. Wait for fonts, but
  // never let a font failure stop the game starting.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(startLoop).catch(startLoop);
  } else {
    startLoop();
  }
}

boot();
