// Pointer input (unifies mouse + touch) for dragging the falling fruit,
// using power-ups, and toggling sound.

import { CELL, HUD_HEIGHT, COLS, MUTE_RECT, powerSlotRect } from './constants.js';
import { removeFruitAt, detonateBomb, setDragTarget } from './physics.js';
import {
  hudPowerUps, canUsePowerUp, activateMagnet, armBomb, armRemover,
  consumeBomb, consumeRemover,
} from './state.js';
import { unlockAudio, toggleMuted, playUiTick } from './audio.js';

function inRect(point, rect) {
  return point.x >= rect.x && point.x <= rect.x + rect.w
    && point.y >= rect.y && point.y <= rect.y + rect.h;
}

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

  function cellAt(point) {
    const col = Math.floor(point.x / CELL);
    const row = Math.floor((point.y - HUD_HEIGHT) / CELL);
    const inBounds = col >= 0 && col < COLS && row >= 0 && row < state.grid.length;
    return inBounds ? { row, col } : null;
  }

  // Returns true if the tap was consumed by a power-up slot.
  //
  // Slots are drawn for every tappable power-up including locked and empty
  // ones, so the chip is discoverable; this is where a tap on one of those is
  // absorbed harmlessly instead of acting.
  function handlePowerSlot(point) {
    const items = hudPowerUps();
    for (let i = 0; i < items.length; i++) {
      if (!inRect(point, powerSlotRect(i))) continue;
      const item = items[i];
      if (!canUsePowerUp(state, item)) {
        callbacks.onLockedPowerUp?.(item);
        return true;
      }
      if (item.id === 'magnet') {
        if (activateMagnet(state)) playUiTick();
      } else if (item.id === 'bomb') {
        armBomb(state, !state.bombArmed);
        playUiTick();
      } else if (item.id === 'remover') {
        armRemover(state, !state.removerArmed);
        playUiTick();
      }
      return true;
    }
    return false;
  }

  function onPointerDown(evt) {
    // Browsers only allow audio to start from a user gesture.
    unlockAudio();

    const point = toCanvasPoint(evt);

    if (inRect(point, MUTE_RECT)) {
      toggleMuted();
      playUiTick();
      return;
    }

    if (point.y <= HUD_HEIGHT) {
      handlePowerSlot(point);
      return;
    }

    // Armed targeting modes are mutually exclusive, so at most one applies.
    if (state.bombArmed) {
      const cell = cellAt(point);
      if (cell) {
        const cleared = detonateBomb(state, cell.row, cell.col);
        if (cleared) {
          consumeBomb(state);
          playUiTick();
          callbacks.onBombUsed?.(cleared);
        }
      }
      return;
    }

    if (state.removerArmed) {
      const cell = cellAt(point);
      if (cell && removeFruitAt(state, cell.row, cell.col)) {
        consumeRemover(state);
        playUiTick();
        callbacks.onRemoverUsed?.();
      }
      return;
    }

    if (state.active) {
      dragging = true;
      // Via setDragTarget rather than assigning targetX directly: it clamps to
      // the fruit's radius, so dragging to the edge no longer renders the fruit
      // half off-screen.
      setDragTarget(state, point.x);
    }
  }

  function onPointerMove(evt) {
    if (!dragging || !state.active) return;
    const point = toCanvasPoint(evt);
    setDragTarget(state, point.x);
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
