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
  suspendAudio, resumeAudio, unlockAudio,
} from './audio.js';
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

function showScreen() {
  if (state.screen === SCREEN.MENU) {
    overlay.hidden = false;
    canvas.hidden = true;
    renderMenu(overlay, state, () => {
      startRun(state);
      clearEffects(fx);
      resizeCanvasToState();
      overlay.hidden = true;
      canvas.hidden = false;
    });
  } else if (state.screen === SCREEN.GAMEOVER) {
    overlay.hidden = false;
    canvas.hidden = true;
    renderGameOver(overlay, state, () => {
      clearEffects(fx);
      resizeCanvasToState();
      overlay.hidden = true;
      canvas.hidden = false;
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
