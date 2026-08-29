// Entry point: owns the requestAnimationFrame loop and wires state, physics,
// render, input, audio, effects, theme, platform, and the shop screens together.

import {
  CANVAS_WIDTH, TIERS, RAINBOW_TIER, RAINBOW_DEF, HAPTIC_BOMB_MS, RENDER_SCALE,
} from './constants.js';
import {
  createInitialState, SCREEN, startRun, endRun, tickCombo, skinColor, devModeEnabled,
  triggerLockedFlash, tickLockedFlash, toSaveBlob,
} from './state.js';
import * as platform from './platform.js';
import { spawnFruit, stepPhysics, isGameOver, stepMagnet } from './physics.js';
import { drawFrame, canvasHeightFor } from './render.js';
import { attachInput } from './input.js';
import { renderMenu, renderGameOver } from './shop.js';
import {
  playMerge, playCelebration, playGameOver, playUiTick,
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
  hydrate as hydrateHaptics, isHapticsOn,
} from './effects.js';
import { themeForScore, applyPageTheme } from './theme.js';

const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');

// Assigned once, in boot(), once platform.load() resolves -- everything below
// that references `state` is only ever called after that has happened.
let state;
const fx = createEffects();

// The canvas has two sizes that must not be confused:
//   - the BACKING STORE (canvas.width/height), in device pixels, scaled up by
//     RENDER_SCALE so text and hairlines stay sharp when the board is displayed
//     larger than its 384px logical width;
//   - the LOGICAL size the game draws in, always 384 x canvasHeightFor(state).
// CSS sizing is left to the stylesheet, which fits the board to the viewport.
function sizeCanvas() {
  const logicalH = canvasHeightFor(state);
  const w = CANVAS_WIDTH * RENDER_SCALE;
  const h = logicalH * RENDER_SCALE;
  // Compare against the backing size, not the logical one: the old guard
  // compared canvas.height to the logical height, so under scaling it never
  // matched and reassigned (resetting the context) on every call.
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  canvas.style.setProperty('--canvas-aspect', `${CANVAS_WIDTH} / ${logicalH}`);
}

function resizeCanvasToState() {
  sizeCanvas();
}

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
      resizeCanvasToState();
      overlay.hidden = true;
      canvas.hidden = false;
      syncReloadGuard();
      syncMusic();
    });
  } else if (state.screen === SCREEN.GAMEOVER) {
    overlay.hidden = false;
    canvas.hidden = true;
    renderGameOver(overlay, state, () => {
      clearEffects(fx);
      resizeCanvasToState();
      overlay.hidden = true;
      canvas.hidden = false;
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
  for (const event of state.events) {
    if (event.type === 'merge') {
      playMerge(event.tier);
      spawnMergeEffects(fx, {
        row: event.row,
        col: event.col,
        tier: event.tier,
        color: colorForTier(event.tier),
      });
    } else if (event.type === 'reachedTop' || event.type === 'topTier') {
      playCelebration();
      spawnMergeEffects(fx, {
        row: event.row,
        col: event.col,
        tier: TIERS.length - 1,
        color: colorForTier(TIERS.length - 1),
      });
    } else if (event.type === 'bombCleared') {
      // One max-intensity burst per destroyed fruit. Detonation previously
      // produced no visual or tactile response at all, despite clearing up to
      // nine cells -- the loudest action in the game happened in silence.
      const topTier = TIERS.length - 1;
      for (const cell of event.cells) {
        spawnMergeEffects(fx, {
          row: cell.row,
          col: cell.col,
          tier: topTier,
          color: colorForTier(cell.tier),
          silent: true, // one pulse for the batch, fired below
        });
      }
      vibrate(HAPTIC_BOMB_MS);
    } else if (event.type === 'removerUsed') {
      spawnMergeEffects(fx, {
        row: event.row,
        col: event.col,
        tier: event.tier,
        color: colorForTier(event.tier),
      });
    } else if (event.type === 'lockedPowerUp') {
      playUiTick();
      triggerLockedFlash(state, event.id);
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
  updateEffects(fx, dt);

  if (state.active) {
    stepMagnet(state, dt);
    stepPhysics(state, dt);
  } else {
    const result = spawnFruit(state);
    if (result.blocked || isGameOver(state)) {
      endRun(state, 'grid-full');
      persistNow();
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

  sizeCanvas();
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
