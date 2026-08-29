// Pointer input (unifies mouse + touch) for dragging the falling fruit and
// using power-ups. No master mute here -- Playables requirements prohibit an
// in-game master mute button; see js/shop.js for the granular Sound/Music
// (and, since phase 3.4, Haptics) toggles the requirements do permit.

import { CELL, HUD_HEIGHT, COLS, powerSlotRect, CANVAS_WIDTH } from './constants.js';
import { removeFruitAt, detonateBomb, setDragTarget, hardDrop } from './physics.js';
import { canvasHeightFor } from './render.js';
import {
  hudPowerUps, canUsePowerUp, activateMagnet, armBomb, armRemover,
  consumeBomb, consumeRemover,
} from './state.js';
import { unlockAudio, playUiTick } from './audio.js';

function inRect(point, rect) {
  return point.x >= rect.x && point.x <= rect.x + rect.w
    && point.y >= rect.y && point.y <= rect.y + rect.h;
}

export function attachInput(canvas, state) {
  let dragging = false;

  // Maps a pointer position to GAME coordinates (0..CANVAS_WIDTH).
  //
  // Deliberately derived from the logical size, not `canvas.width`. The
  // backing store is some device-pixel-per-logical-pixel multiple larger
  // (js/main.js, DPR-driven and responsive since phase 4), so dividing by it
  // would return backing-store pixels -- a uniform error that silently
  // breaks every hit target: taps in the right half of the board fall
  // outside COLS and do nothing, the whole power-up bar drops below the HUD
  // gate and becomes untappable, and dragging pins the fruit against the
  // right wall. Using the logical size stays correct regardless of the
  // backing store's actual resolution.
  function toCanvasPoint(evt) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = CANVAS_WIDTH / rect.width;
    const scaleY = canvasHeightFor(state) / rect.height;
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
        // No board state changes here, so there is no physics event to ride --
        // push straight onto the same presentation queue main.js already
        // drains everything else from.
        state.events.push({ type: 'lockedPowerUp', id: item.id, unlockScore: item.unlockScore || 0 });
        return true;
      }
      if (item.id === 'magnet') {
        if (activateMagnet(state)) playUiTick(); // activateMagnet marks state.dirty
      } else if (item.id === 'bomb') {
        armBomb(state, !state.bombArmed);
        // A fresh arm (or a cancel) must never inherit a stale target left
        // over from a previous aim -- see the touch bug this is part of
        // fixing below.
        state.armPreviewCell = null;
        playUiTick();
      } else if (item.id === 'remover') {
        armRemover(state, !state.removerArmed);
        state.armPreviewCell = null;
        playUiTick();
      }
      return true;
    }
    return false;
  }

  // 7.3: bomb/remover commit on release, not on the initial touch, so the
  // footprint/crosshair (js/render.js, reading state.armPreviewCell) can
  // genuinely follow the finger before committing rather than flashing into
  // existence and firing in the same instant.
  //
  // Bug found on real touch (not caught by mouse-click testing, since a mouse
  // click's down and up land on the same point by construction): arming the
  // chip and then, in ONE continuous press -- finger never lifting --
  // dragging onto the board never committed. The chip's own pointerdown
  // returns early (the `point.y <= HUD_HEIGHT` branch above) without ever
  // reaching the code that used to set an `aiming` flag, so the later
  // pointerup on the board had nothing telling it this gesture was allowed to
  // commit, even though armPreviewCell had been updated correctly by the
  // pointermove in between. A real finger naturally does exactly this --
  // press the chip, slide straight down onto a target, release -- since nothing
  // requires lifting between arming and aiming.
  //
  // Fixed by dropping the `aiming` flag entirely: armPreviewCell itself is
  // now the only thing that decides whether a release commits. It starts (or
  // resets to) null the moment arming changes (above, and in onPointerUp
  // below), so a plain tap that never touches the board still commits
  // nothing -- there's no gap where a stale cell from a previous aim could.
  function onPointerDown(evt) {
    // Browsers only allow audio to start from a user gesture.
    unlockAudio();

    const point = toCanvasPoint(evt);

    if (point.y <= HUD_HEIGHT) {
      handlePowerSlot(point);
      return;
    }

    // Armed targeting modes are mutually exclusive, so at most one applies.
    if (state.bombArmed || state.removerArmed) {
      state.armPreviewCell = cellAt(point);
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
    const point = toCanvasPoint(evt);
    if (state.bombArmed || state.removerArmed) {
      // Updated on every move so a mouse hovering before it ever clicks also
      // sees the footprint, and so a touch that presses the chip and slides
      // straight onto the board without lifting tracks correctly too.
      state.armPreviewCell = cellAt(point);
      return;
    }
    if (!dragging || !state.active) return;
    setDragTarget(state, point.x);
  }

  function onPointerUp() {
    // armPreviewCell alone decides whether this release commits -- see the
    // long comment above onPointerDown for why an `aiming` flag keyed to
    // where THIS gesture's own pointerdown landed was wrong. It is null
    // whenever there is nothing valid to act on (arming or cancelling always
    // resets it, and a plain chip tap that never touches the board never
    // sets it), so this is safe to check unconditionally.
    if (state.bombArmed || state.removerArmed) {
      const cell = state.armPreviewCell;
      state.armPreviewCell = null;
      if (state.bombArmed && cell) {
        const cleared = detonateBomb(state, cell.row, cell.col);
        if (cleared) {
          consumeBomb(state); // marks state.dirty
          playUiTick();
        }
      } else if (state.removerArmed && cell) {
        if (removeFruitAt(state, cell.row, cell.col)) {
          consumeRemover(state); // marks state.dirty
          playUiTick();
        }
      }
    }
    dragging = false;
  }

  // Keyboard (6.4): left/right steer via the same setDragTarget the pointer
  // path uses (one CELL per press, rather than a per-frame held-key tracker --
  // the browser's own key repeat gives held-key movement for free), space or
  // down hard-drops, Escape cancels an armed power-up.
  //
  // Phase 6 noted Escape had no overlay to dismiss, since js/shop.js's
  // overlay is never shown DURING a run -- it fills the screen only on the
  // menu/game-over transition, mutually exclusive with the canvas. Phase 7.1
  // gave it a real job there instead: js/shop.js's own Escape handler closes
  // an open Cart/Palette/Gear panel back to the hub. The two handlers are
  // independent (each listens on window and checks only its own precondition)
  // and never actually compete, because the states they react to -- an armed
  // power-up, an open panel -- cannot coexist: one requires a run in
  // progress, the other requires the overlay that only shows when no run is.
  function onKeyDown(evt) {
    if (evt.key === 'Escape') {
      if (state.bombArmed) armBomb(state, false);
      if (state.removerArmed) armRemover(state, false);
      state.armPreviewCell = null;
      return;
    }

    if (!state.active) return;

    if (evt.key === 'ArrowLeft') {
      evt.preventDefault();
      setDragTarget(state, state.active.targetX - CELL);
    } else if (evt.key === 'ArrowRight') {
      evt.preventDefault();
      setDragTarget(state, state.active.targetX + CELL);
    } else if (evt.key === ' ' || evt.key === 'Spacebar' || evt.key === 'ArrowDown') {
      evt.preventDefault();
      hardDrop(state);
    }
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.style.touchAction = 'none';

  // Keyboard events don't target the canvas (a <canvas> isn't focusable
  // without a tabindex), so this listens on window like main.js's own
  // resize/DPR watchers do -- window is not the storage/lifecycle surface
  // js/platform.js guards, just an input source.
  if (typeof window !== 'undefined') window.addEventListener('keydown', onKeyDown);

  return () => {
    canvas.removeEventListener('pointerdown', onPointerDown);
    canvas.removeEventListener('pointermove', onPointerMove);
    canvas.removeEventListener('pointerup', onPointerUp);
    canvas.removeEventListener('pointercancel', onPointerUp);
    if (typeof window !== 'undefined') window.removeEventListener('keydown', onKeyDown);
  };
}
