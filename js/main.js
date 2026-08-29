// Entry point: owns the requestAnimationFrame loop and wires state, physics,
// render, input, audio, effects, theme, and the shop screens together.

import {
  CANVAS_WIDTH, TIERS, RAINBOW_TIER, RAINBOW_DEF, HAPTIC_BOMB_MS, RENDER_SCALE,
} from './constants.js';
import {
  createInitialState, SCREEN, startRun, endRun, tickCombo, skinColor, devModeEnabled,
  triggerLockedFlash, tickLockedFlash,
} from './state.js';
import { setStorageReadOnly } from './storage.js';
import { spawnFruit, stepPhysics, isGameOver, stepMagnet } from './physics.js';
import { drawFrame, canvasHeightFor } from './render.js';
import { attachInput } from './input.js';
import { renderMenu, renderGameOver } from './shop.js';
import {
  playMerge, playCelebration, playGameOver, playUiTick,
  suspendAudio, resumeAudio, unlockAudio, getAudioContext,
} from './audio.js';
import { attachContext, startMusic, stopMusic } from './music.js';
import { createEffects, updateEffects, spawnMergeEffects, clearEffects, vibrate } from './effects.js';
import { themeForScore, applyPageTheme } from './theme.js';

const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');

// MUST run before createInitialState(): dev mode inflates inventory and
// highScore in memory, and the very first startRun() would otherwise persist
// that inflated stock over the player's real save.
setStorageReadOnly(devModeEnabled());

const state = createInitialState();
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

sizeCanvas();

attachInput(canvas, state);

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

showScreen();

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

function loop(now) {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;

  if (state.screen === SCREEN.PLAYING) {
    update(dt);
    drawFrame(ctx, state, fx);
    applyPageTheme(themeForScore(state.score));
  }

  requestAnimationFrame(loop);
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
      playGameOver();
      stopMusic();
      showScreen();
    }
  }

  drainEvents();
}

// Respect the host environment: stop animating and silence audio while the
// tab or embedding frame is hidden, and pick back up on return. This is also
// the hook a host platform's pause/resume command would drive.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    suspendAudio();
  } else {
    lastTime = performance.now(); // avoid a huge dt spike on the first frame back
    resumeAudio();
  }
});

// Any first interaction anywhere is a valid moment to start audio.
window.addEventListener('pointerdown', unlockAudio, { once: true });

applyPageTheme(themeForScore(0));

// ctx.font silently falls back when the face has not loaded -- canvas has no
// equivalent of font-display -- so starting the loop immediately would paint
// the first frames in system-ui and then snap to Fredoka. Wait for fonts, but
// never let a font failure stop the game starting.
if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(() => requestAnimationFrame(loop)).catch(() => requestAnimationFrame(loop));
} else {
  requestAnimationFrame(loop);
}
