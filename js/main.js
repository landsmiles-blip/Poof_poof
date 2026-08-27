// Entry point: owns the requestAnimationFrame loop and wires state,
// physics, render, input, and the shop screens together.

import { CANVAS_WIDTH } from './constants.js';
import { createInitialState, SCREEN, startRun, endRun } from './state.js';
import { spawnFruit, stepPhysics, isGameOver } from './physics.js';
import { drawFrame, canvasHeightFor } from './render.js';
import { attachInput } from './input.js';
import { renderMenu, renderGameOver } from './shop.js';

const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');

const state = createInitialState();

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
      resizeCanvasToState();
      overlay.hidden = true;
      canvas.hidden = false;
    });
  } else if (state.screen === SCREEN.GAMEOVER) {
    overlay.hidden = false;
    canvas.hidden = true;
    renderGameOver(overlay, state, () => {
      resizeCanvasToState();
      overlay.hidden = true;
      canvas.hidden = false;
    });
  }
}

showScreen();

let lastTime = performance.now();

function loop(now) {
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;

  if (state.screen === SCREEN.PLAYING) {
    update(dt);
    drawFrame(ctx, state);
  }

  requestAnimationFrame(loop);
}

function update(dt) {
  if (state.active) {
    stepPhysics(state, dt);
  } else {
    const result = spawnFruit(state);
    if (result.blocked || isGameOver(state)) {
      endRun(state, 'grid-full');
      showScreen();
    }
  }
}

requestAnimationFrame(loop);
