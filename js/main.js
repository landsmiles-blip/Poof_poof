// Entry point: owns the requestAnimationFrame loop and wires state, physics,
// render, input, audio, effects, theme, platform, and the shop screens together.

import {
  CANVAS_WIDTH, TIERS, RAINBOW_TIER, RAINBOW_DEF, HAPTIC_BOMB_MS, HAPTIC_CHARGE_EARNED_MS, CELL,
  MIN_BACKING_SCALE, MAX_BACKING_SCALE,
} from './constants.js';
import {
  createInitialState, SCREEN, startRun, endRun, tickCombo, skinColor, devModeEnabled,
  triggerLockedFlash, tickLockedFlash, tickChipPulse, toSaveBlob,
} from './state.js';
import * as platform from './platform.js';
import { spawnFruit, stepPhysics, isGameOver, stepMagnet } from './physics.js';
import { drawFrame, canvasHeightFor } from './render.js';
import { attachInput } from './input.js';
import { renderMenu, renderGameOver } from './shop.js';
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
  hydrate as hydrateHaptics, isHapticsOn, spawnMagnetSlides, spawnBombRing,
} from './effects.js';
import { themeForScore, applyPageTheme, relativeLuminance } from './theme.js';

const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');

// Assigned once, in boot(), once platform.load() resolves -- everything below
// that references `state` is only ever called after that has happened.
let state;
const fx = createEffects();

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
}

function measureCanvasNow() {
  const rect = canvas.getBoundingClientRect();
  handleCanvasMeasurement(rect.width, rect.height);
}

// Extra Row changes canvasHeightFor(state), which changes the aspect ratio
// CSS derives the canvas's (and, via --canvas-css-width above, the
// overlay's) on-screen size from. Set on :root rather than on the canvas
// element itself, which is what lets #overlay share it.
function syncCanvasAspect() {
  const logicalH = canvasHeightFor(state);
  document.documentElement.style.setProperty('--canvas-aspect', `${CANVAS_WIDTH} / ${logicalH}`);
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
    });
  }
}

function colorForTier(tier) {
  return tier === RAINBOW_TIER ? RAINBOW_DEF.color : skinColor(state, tier);
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
    }
  }
  state.events.length = 0;
}

let lastTime = performance.now();
// Tracks the live requestAnimationFrame handle so onPause can actually cancel
// it. Gating loop()'s body behind a flag would leave the loop itself still
// waking 60 times a second -- paused means not executing, not just idling.
let rafHandle = null;

function startLoop() {
  rafHandle = requestAnimationFrame(loop);
}

function loop(now) {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;

  if (state.screen === SCREEN.PLAYING) {
    update(dt);
    drawFrame(ctx, state, fx);
    applyPageTheme(themeForScore(state.score));
  }

  // Checked regardless of screen: most persisted-field changes (buying,
  // picking a skin, toggling sound) happen on the menu/game-over overlays,
  // not mid-run. Cheap when clean -- one boolean read most frames.
  if (state.dirty) persist();

  startLoop();
}

function update(dt) {
  tickCombo(state, dt);
  tickLockedFlash(state, dt);
  tickChipPulse(state, dt);
  updateEffects(fx, dt);

  if (state.active) {
    const moves = stepMagnet(state, dt);
    if (moves.length > 0) spawnMagnetSlides(fx, state, moves);
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

// Order: SDK script tag (index.html, before this module) -> platform.init()
// -> platform.load() -> build state and hydrate audio/music -> first paint ->
// platform.firstFrameReady() -> menu rendered and interactive ->
// platform.gameReady(). gameReady() must not fire while a loading or splash
// screen is visible -- there is none here, so it fires as soon as the first
// showScreen() has actually reached the screen.
async function boot() {
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

  platform.onPause(() => {
    if (rafHandle !== null) {
      cancelAnimationFrame(rafHandle);
      rafHandle = null;
    }
    suspendAudio();
    pauseMusicScheduler();
    persistNow();
  });
  platform.onResume(() => {
    lastTime = performance.now(); // avoid a huge dt spike on the first frame back
    resumeAudio();
    resumeMusicScheduler();
    if (rafHandle === null) startLoop();
  });

  // Any first interaction anywhere is a valid moment to start audio.
  window.addEventListener('pointerdown', unlockAudio, { once: true });

  applyPageTheme(themeForScore(0));

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
