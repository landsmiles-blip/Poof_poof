// Pointer input (unifies mouse + touch) for dragging the falling fruit and
// using power-ups. No master mute here -- Playables requirements prohibit an
// in-game master mute button; see js/shop.js for the granular Sound/Music
// (and, since phase 3.4, Haptics) toggles the requirements do permit.

import {
  CELL, HUD_HEIGHT, COLS, powerSlotRect, pauseButtonRect, CANVAS_WIDTH,
} from './constants.js';
import { removeFruitAt, setDragTarget, hardDrop, swapFruits } from './physics.js';
import {
  hudPowerUps, canUsePowerUp, armRemover, consumeRemover, plantBomb, armSwap, consumeSwap,
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
  // ONE scale, from rect.width alone, drives BOTH axes -- deliberately not
  // rect.height/canvasHeightFor(state), even though that looks like the
  // obvious symmetric choice. js/render.js's drawFrame computes a single
  // scale from canvas.width (backing store) over CANVAS_WIDTH and applies it
  // uniformly to x AND y, anchored top-left; js/main.js's applyBackingStoreSize
  // always derives canvas.width/height from the SAME devicePixelRatio times
  // the measured CSS rect, so the backing store's aspect always matches the
  // rect's aspect and the canvas is never stretched non-uniformly on screen.
  // Composing those two facts algebraically, the correct inverse is this
  // single width-derived scale for both axes -- rect.height never enters it.
  //
  // A real phone found the bug this avoids: css/style.css's #game-canvas
  // rect can end up TALLER than the logical 384-wide aspect on a very tall
  // viewport (max-width binding while height stays fixed, both now fixed
  // together -- see that rule's own comment), so rect.height stopped
  // matching what the board actually rendered at. The old scaleY, built from
  // rect.height, put every HUD tap above its real hit box; dragging the
  // falling fruit survived it purely because column clamping papers over an
  // x-only error. Deriving y from rect.width instead is correct regardless
  // of whether the element ever goes off-ratio again -- it doesn't depend on
  // that CSS invariant holding, only on drawFrame's own (separately tested)
  // transform, which is the one fact that's actually load-bearing here.
  function toCanvasPoint(evt) {
    const rect = canvas.getBoundingClientRect();
    const scale = CANVAS_WIDTH / rect.width;
    return {
      x: (evt.clientX - rect.left) * scale,
      y: (evt.clientY - rect.top) * scale,
    };
  }

  function cellAt(point) {
    const col = Math.floor(point.x / CELL);
    const row = Math.floor((point.y - HUD_HEIGHT) / CELL);
    const inBounds = col >= 0 && col < COLS && row >= 0 && row < state.grid.length;
    return inBounds ? { row, col } : null;
  }

  // Orthogonal adjacency only -- the same rule merges already use. A cell is
  // adjacent to itself at distance 0, which this deliberately excludes (a
  // tap on the already-selected cell is handled as "deselect", not "swap").
  function isAdjacent(a, b) {
    return Math.abs(a.row - b.row) + Math.abs(a.col - b.col) === 1;
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
      if (item.id === 'bomb') {
        // 8.4: plants as the next drop instead of arming a tap-target -- see
        // js/state.js's plantBomb. No-ops (silently) if one is already in play.
        if (plantBomb(state)) playUiTick();
      } else if (item.id === 'remover') {
        armRemover(state, !state.removerArmed);
        state.armPreviewCell = null;
        playUiTick();
      } else if (item.id === 'swap') {
        // 10.1: armSwap already clears swapSelectedCell on every toggle, so
        // tapping the chip while a selection is pending cleanly cancels it,
        // same as re-tapping the remover's own chip.
        armSwap(state, !state.swapArmed);
        playUiTick();
      }
      return true;
    }
    return false;
  }

  // 7.3: the remover commits on release, not on the initial touch, so the
  // crosshair (js/render.js, reading state.armPreviewCell) can genuinely
  // follow the finger before committing rather than flashing into existence
  // and firing in the same instant. The bomb used this same path until 8.4,
  // which replaced arm-then-tap with planting it as a falling fruit instead
  // -- see plantBomb in js/state.js.
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
    // 9.3: the run is frozen while paused (host-driven or the in-game panel)
    // -- nothing on the canvas should react, including a stray gesture that
    // technically still reaches it underneath the panel.
    if (state.paused) return;

    // Browsers only allow audio to start from a user gesture.
    unlockAudio();

    const point = toCanvasPoint(evt);

    if (point.y <= HUD_HEIGHT) {
      if (inRect(point, pauseButtonRect())) {
        // Routed through state.events, not a direct callback -- attachInput
        // stays (canvas, state) only (see input-callbacks.js's own
        // regression test for why a third argument was rejected before).
        // main.js's drainEvents is what actually opens the panel.
        state.events.push({ type: 'pauseRequested' });
        return;
      }
      handlePowerSlot(point);
      return;
    }

    if (state.removerArmed || state.swapArmed) {
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
    if (state.paused) return;
    const point = toCanvasPoint(evt);
    if (state.removerArmed || state.swapArmed) {
      // Updated on every move so a mouse hovering before it ever clicks also
      // sees the crosshair/selection, and so a touch that presses the chip
      // and slides straight onto the board without lifting tracks correctly
      // too.
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
    if (state.removerArmed) {
      const cell = state.armPreviewCell;
      state.armPreviewCell = null;
      if (cell && removeFruitAt(state, cell.row, cell.col)) {
        consumeRemover(state); // marks state.dirty
        playUiTick();
      }
    }

    // 10.1: Swap. cell is wherever the finger was released (same
    // commit-on-release shape as the remover above), but unlike the remover
    // this is a TWO-tap tool -- a tap on an empty cell is silently ignored
    // (nothing to select there), a tap on the already-selected fruit
    // deselects, a tap on a non-adjacent fruit moves the selection there
    // instead of failing, and only a tap on an adjacent occupied fruit
    // actually swaps. swapSelectedCell persists ACROSS separate gestures on
    // purpose -- the player lifts their finger between the two taps.
    if (state.swapArmed) {
      const cell = state.armPreviewCell;
      state.armPreviewCell = null;
      if (cell && state.grid[cell.row][cell.col] !== null) {
        const selected = state.swapSelectedCell;
        if (!selected) {
          state.swapSelectedCell = cell;
          playUiTick();
        } else if (selected.row === cell.row && selected.col === cell.col) {
          state.swapSelectedCell = null;
          playUiTick();
        } else if (isAdjacent(selected, cell)) {
          if (swapFruits(state, selected.row, selected.col, cell.row, cell.col)) {
            consumeSwap(state); // marks state.dirty
            playUiTick();
          }
          state.swapSelectedCell = null;
        } else {
          state.swapSelectedCell = cell;
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
    // 9.3: while paused, Escape belongs entirely to the pause panel's own
    // listener (js/shop.js's renderPausePanel) -- closing the panel, not
    // cancelling an armed power-up, takes priority. Simplest way to
    // guarantee that priority is for this handler to do nothing at all
    // while paused, Escape included; every other key is meaningless mid-
    // freeze anyway (nothing is ticking to steer).
    if (state.paused) return;

    if (evt.key === 'Escape') {
      if (state.removerArmed) armRemover(state, false);
      if (state.swapArmed) armSwap(state, false);
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
