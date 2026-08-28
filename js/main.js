// Entry point: owns the requestAnimationFrame loop and wires state, physics,
// render, input, audio, effects, theme, and the shop screens together.

import { CANVAS_WIDTH, TIERS, RAINBOW_TIER, RAINBOW_DEF } from './constants.js';
import { createInitialState, SCREEN, startRun, endRun, tickCombo, skinColor } from './state.js';
import { spawnFruit, stepPhysics, isGameOver, stepMagnet } from './physics.js';
import { drawFrame, canvasHeightFor } from './render.js';
import { attachInput } from './input.js';
import { renderMenu, renderGameOver } from './shop.js';
import {
  playMerge, playCelebration, playGameOver,
  suspendAudio, resumeAudio, unlockAudio, getAudioContext,
} from './audio.js';
import { attachContext, startMusic, stopMusic } from './music.js';
import { createEffects, updateEffects, spawnMergeEffects, clearEffects } from './effects.js';
import { themeForScore, applyPageTheme } from './theme.js';

const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');

const state = createInitialState();
const fx = createEffects();

canvas.width = CANVAS_WIDTH;
canvas.height = canvasHeightFor(state);

attachInput(canvas, state);

function resizeCanvasToState() {
  const h = canvasHeightFor(state);
  if (canvas.height !== h) canvas.height = h;
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
requestAnimationFrame(loop);
