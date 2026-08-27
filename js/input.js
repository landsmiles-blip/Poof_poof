// Pointer input (unifies mouse + touch) for dragging the falling fruit
// and using the Fruit Remover power-up.

import { CELL, HUD_HEIGHT, BOARD_WIDTH } from './constants.js';
import { removeFruitAt } from './physics.js';
import { saveInventory } from './storage.js';

export function attachInput(canvas, state, callbacks = {}) {
  let dragging = false;

  function toCanvasPoint(evt) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (evt.clientX - rect.left) * scaleX,
      y: (evt.clientY - rect.top) * scaleY,
    };
  }

  function onPointerDown(evt) {
    const point = toCanvasPoint(evt);

    if (state.removerArmed && point.y > HUD_HEIGHT) {
      const col = Math.floor(point.x / CELL);
      const row = Math.floor((point.y - HUD_HEIGHT) / CELL);
      if (col >= 0 && col < 6 && row >= 0 && row < state.grid.length) {
        if (removeFruitAt(state, row, col)) {
          state.inventory.remover -= 1;
          state.removerArmed = false;
          saveInventory(state.inventory);
          callbacks.onRemoverUsed?.();
        }
      }
      return;
    }

    // Tap the HUD remover label to arm it.
    if (point.y <= HUD_HEIGHT && state.inventory.remover > 0 && point.x < BOARD_WIDTH / 2) {
      state.removerArmed = !state.removerArmed;
      return;
    }

    if (state.active) {
      dragging = true;
      state.active.targetX = point.x;
    }
  }

  function onPointerMove(evt) {
    if (!dragging || !state.active) return;
    const point = toCanvasPoint(evt);
    state.active.targetX = point.x;
  }

  function onPointerUp() {
    dragging = false;
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.style.touchAction = 'none';

  return () => {
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerUp);
  };
}
