// Regression test for 1.4 (bomb/remover/locked-power-up feedback rides
// state.events). Phase 2 briefly added a third `persist` argument to
// attachInput; that was moved into state.js instead (state.dirty, set by the
// mutating export itself) so attachInput could go back to exactly the
// (canvas, state) shape phase 1 already established and tested here.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CANVAS_WIDTH, HUD_HEIGHT, CELL, POWER_SLOT, powerSlotRect } from '../js/constants.js';
import { canvasHeightFor } from '../js/render.js';
import { startRun } from '../js/state.js';
import { attachInput } from '../js/input.js';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function freshState() {
  const state = {
    inventory: { slowDrop: 0, extraRow: 0, rainbow: 0, remover: 0, magnet: 0, bomb: 0 },
    highScore: 0,
    coins: 0,
    unlockedSkins: ['classic'],
    events: [],
  };
  startRun(state, {});
  state.dirty = false; // startRun itself marks dirty; each check below wants a clean slate
  return state;
}

function makeFakeCanvas(state) {
  const listeners = {};
  return {
    style: {},
    addEventListener(type, fn) { listeners[type] = fn; },
    removeEventListener() {},
    getBoundingClientRect() {
      return { left: 0, top: 0, width: CANVAS_WIDTH, height: canvasHeightFor(state) };
    },
    fire(type, evt) { listeners[type](evt); },
  };
}

assert.equal(attachInput.length, 2, 'attachInput should take exactly (canvas, state) -- no callbacks, no persist function');

// Bomb: place a fruit, arm the bomb, tap its cell (press then release, since
// 7.3 moved the commit to pointerup -- see the aiming test below) -- event
// rides state.events, and consumeBomb() (js/state.js) marks state.dirty.
{
  const state = freshState();
  state.grid[0][0] = 0;
  state.bombArmed = true;
  state.inventory.bomb = 1;
  const canvas = makeFakeCanvas(state);
  attachInput(canvas, state);
  canvas.fire('pointerdown', { clientX: 0 * CELL + CELL / 2, clientY: HUD_HEIGHT + 0 * CELL + CELL / 2 });
  canvas.fire('pointerup', {});
  const events = state.events.filter((e) => e.type === 'bombCleared');
  assert.equal(events.length, 1, 'a bombCleared event should be pushed when a bomb clears fruit');
  assert.ok(events[0].cells.length >= 1, 'the event should carry the cleared cells');
  assert.equal(state.dirty, true, 'consuming a bomb should mark state.dirty');
}

// Remover: place a fruit, arm the remover, tap its cell.
{
  const state = freshState();
  state.grid[0][1] = 3;
  state.removerArmed = true;
  state.inventory.remover = 1;
  const canvas = makeFakeCanvas(state);
  attachInput(canvas, state);
  canvas.fire('pointerdown', { clientX: 1 * CELL + CELL / 2, clientY: HUD_HEIGHT + 0 * CELL + CELL / 2 });
  canvas.fire('pointerup', {});
  const events = state.events.filter((e) => e.type === 'removerUsed');
  assert.equal(events.length, 1, 'a removerUsed event should be pushed when the remover removes a fruit');
  assert.deepEqual(
    { row: events[0].row, col: events[0].col, tier: events[0].tier },
    { row: 0, col: 1, tier: 3 },
    'the event should carry where and what was removed',
  );
  assert.equal(state.dirty, true, 'consuming the remover should mark state.dirty');
}

// Regression test for 7.3: bomb/remover commit on RELEASE, using wherever the
// finger last was, not on the initial press -- the footprint/crosshair can
// then genuinely follow a drag before it commits.
{
  const state = freshState();
  state.grid[0][0] = 5;
  state.grid[0][2] = 5;
  state.removerArmed = true;
  state.inventory.remover = 1;
  const canvas = makeFakeCanvas(state);
  attachInput(canvas, state);

  canvas.fire('pointerdown', { clientX: 0 * CELL + CELL / 2, clientY: HUD_HEIGHT + 0 * CELL + CELL / 2 });
  assert.equal(state.events.filter((e) => e.type === 'removerUsed').length, 0,
    'pressing down must not commit by itself');
  assert.deepEqual(state.armPreviewCell, { row: 0, col: 0 }, 'the preview cell should track the press position');

  canvas.fire('pointermove', { clientX: 2 * CELL + CELL / 2, clientY: HUD_HEIGHT + 0 * CELL + CELL / 2 });
  assert.equal(state.events.filter((e) => e.type === 'removerUsed').length, 0,
    'dragging while armed must not commit either');
  assert.deepEqual(state.armPreviewCell, { row: 0, col: 2 }, 'the preview cell should follow the drag');

  canvas.fire('pointerup', {});
  const events = state.events.filter((e) => e.type === 'removerUsed');
  assert.equal(events.length, 1, 'releasing should commit exactly once');
  assert.deepEqual({ row: events[0].row, col: events[0].col }, { row: 0, col: 2 },
    'the commit should land wherever the finger was released, not where it was first pressed');
}

// Regression test for a real touch bug found after 7.3, missed by every test
// above: they all start with the power-up already armed (`state.bombArmed =
// true` set directly) and press DIRECTLY on the board, which was never
// broken. A real finger arms the chip AND aims in one motion -- press the
// chip, slide straight onto the board without lifting, release -- since
// nothing about a touchscreen requires lifting between the two. The chip's
// own pointerdown returns early (js/input.js's `point.y <= HUD_HEIGHT`
// branch) before reaching the code that used to gate committing on an
// `aiming` flag set only when a gesture's OWN pointerdown already landed on
// the board while armed -- so this exact sequence silently did nothing.
// Mouse-click testing could not have caught it: a click's down and up land
// on the same point by construction, so a chip click never continues onto
// the board within one gesture.
{
  const state = freshState();
  state.grid[0][2] = 5;
  state.inventory.bomb = 1;
  state.highScore = 3000; // bomb unlocks at MILESTONE_SCORES[2]
  const canvas = makeFakeCanvas(state);
  attachInput(canvas, state);

  const bombSlot = powerSlotRect(2); // [remover, magnet, bomb] -- see constants.POWERUPS order
  canvas.fire('pointerdown', { clientX: bombSlot.x + bombSlot.w / 2, clientY: bombSlot.y + bombSlot.h / 2 });
  assert.equal(state.bombArmed, true, 'pressing the chip should arm the bomb');

  // Same gesture continues: no intervening pointerup, straight to the board.
  canvas.fire('pointermove', { clientX: 2 * CELL + CELL / 2, clientY: HUD_HEIGHT + 0 * CELL + CELL / 2 });
  canvas.fire('pointerup', {});

  const events = state.events.filter((e) => e.type === 'bombCleared');
  assert.equal(events.length, 1, 'a continuous press-chip-then-drag-to-board-then-release must still commit');
  assert.equal(state.bombArmed, false, 'a successful commit should consume the bomb and un-arm it');
}

// Same continuous chip-to-board drag, for the remover.
{
  const state = freshState();
  state.grid[0][2] = 5;
  state.inventory.remover = 1;
  const canvas = makeFakeCanvas(state);
  attachInput(canvas, state);

  const removerSlot = powerSlotRect(0);
  canvas.fire('pointerdown', { clientX: removerSlot.x + removerSlot.w / 2, clientY: removerSlot.y + removerSlot.h / 2 });
  assert.equal(state.removerArmed, true, 'pressing the chip should arm the remover');

  canvas.fire('pointermove', { clientX: 2 * CELL + CELL / 2, clientY: HUD_HEIGHT + 0 * CELL + CELL / 2 });
  canvas.fire('pointerup', {});

  const events = state.events.filter((e) => e.type === 'removerUsed');
  assert.equal(events.length, 1, 'a continuous press-chip-then-drag-to-board-then-release must still commit');
  assert.equal(state.removerArmed, false, 'a successful commit should consume the remover and un-arm it');
}

// A plain chip tap alone (no drag onto the board at all) must still commit
// nothing -- guards against the obvious wrong fix of just dropping the
// armPreviewCell null-check.
{
  const state = freshState();
  state.inventory.bomb = 1;
  state.highScore = 3000;
  const canvas = makeFakeCanvas(state);
  attachInput(canvas, state);

  const bombSlot = powerSlotRect(2);
  canvas.fire('pointerdown', { clientX: bombSlot.x + bombSlot.w / 2, clientY: bombSlot.y + bombSlot.h / 2 });
  canvas.fire('pointerup', {});

  assert.equal(state.events.filter((e) => e.type === 'bombCleared').length, 0,
    'arming alone, with no drag onto the board, must not commit');
  assert.equal(state.bombArmed, true, 'the bomb should still be armed, waiting for an actual target');
}

// Locked power-up: magnet unlocks at a score this fresh state has not reached.
// No persisted field changes, so state.dirty must NOT be set.
{
  const state = freshState();
  const canvas = makeFakeCanvas(state);
  attachInput(canvas, state);
  const magnetSlotRect = powerSlotRect(1); // [remover, magnet, bomb] -- see constants.POWERUPS order
  canvas.fire('pointerdown', {
    clientX: magnetSlotRect.x + POWER_SLOT.size / 2,
    clientY: magnetSlotRect.y + POWER_SLOT.size / 2,
  });
  const events = state.events.filter((e) => e.type === 'lockedPowerUp');
  assert.equal(events.length, 1, 'a lockedPowerUp event should be pushed for a locked/out-of-stock slot');
  assert.equal(events[0].id, 'magnet');
  assert.equal(events[0].unlockScore, 1000);
  assert.equal(state.dirty, false, 'a locked-power-up tap changes no persisted field and must not mark state.dirty');
}

console.log('input.js: bomb, remover, and locked-power-up all push their event onto state.events; state.dirty set only where warranted');

// --- Is the shipped main.js actually wired to all three? -------------------

const mainSrc = readFileSync(path.join(repoRoot, 'js/main.js'), 'utf8');

const attachInputCall = mainSrc.match(/attachInput\(([^)]*)\)/);
assert.ok(attachInputCall, 'main.js should call attachInput');
const argCount = attachInputCall[1].split(',').filter((s) => s.trim()).length;
assert.equal(argCount, 2, 'main.js should call attachInput with exactly (canvas, state)');

for (const eventType of ['bombCleared', 'removerUsed', 'lockedPowerUp']) {
  assert.ok(mainSrc.includes(`'${eventType}'`), `main.js's drainEvents should handle a '${eventType}' event`);
}

assert.ok(mainSrc.includes('state.dirty'), 'main.js should check state.dirty somewhere (the loop) to trigger persist()');

// Regression test for 6.5: platform.submitScore() must be called from
// endRun's call site with the save's highScore, not the just-finished run's
// (possibly lower) score.
assert.ok(/endRun\([^)]*\)[\s\S]{0,400}?platform\.submitScore\(state\.highScore\)/.test(mainSrc),
  'main.js should call platform.submitScore(state.highScore) shortly after endRun');

console.log('main.js: attachInput called with (canvas, state); drainEvents handles all three event types; state.dirty drives persistence');
