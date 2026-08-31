// Regression test for 1.4 (bomb/remover/locked-power-up feedback rides
// state.events). Phase 2 briefly added a third `persist` argument to
// attachInput; that was moved into state.js instead (state.dirty, set by the
// mutating export itself) so attachInput could go back to exactly the
// (canvas, state) shape phase 1 already established and tested here.
import assert from 'node:assert/strict';
import { MILESTONE_SCORES } from '../js/constants.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CANVAS_WIDTH, HUD_HEIGHT, CELL, POWER_SLOT, powerSlotRect, BOMB_TIER,
} from '../js/constants.js';
import { canvasHeightFor } from '../js/render.js';
import { startRun } from '../js/state.js';
import { attachInput } from '../js/input.js';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function freshState() {
  const state = {
    inventory: { slowDrop: 0, extraRow: 0, rainbow: 0, remover: 0, swap: 0, bomb: 0 },
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

// 8.4: tapping the bomb chip plants it as the falling fruit (or the next
// spawn, if nothing is currently falling) instead of arming a tap-target --
// there is no board-side gesture to test here at all any more.
{
  const state = freshState();
  state.inventory.bomb = 1;
  state.highScore = 3000; // bomb unlocks at MILESTONE_SCORES[2]
  state.active = { tier: 0, col: 3, x: 3 * CELL + CELL / 2, targetX: 3 * CELL + CELL / 2, y: 0 };
  const canvas = makeFakeCanvas(state);
  attachInput(canvas, state);

  const bombSlot = powerSlotRect(2); // [remover, swap, bomb] -- see constants.POWERUPS order
  canvas.fire('pointerdown', { clientX: bombSlot.x + bombSlot.w / 2, clientY: bombSlot.y + bombSlot.h / 2 });

  assert.equal(state.active.tier, BOMB_TIER, 'tapping the chip should transform the currently-falling fruit into a bomb');
  assert.equal(state.bombInPlay, true, 'a planted bomb should read as in play');
  assert.equal(state.dirty, true, 'planting from purchased inventory should mark state.dirty');

  // Tapping again while one is already in play must be a no-op.
  canvas.fire('pointerup', {});
  state.active.tier = 0; // put a normal fruit back so a second plant would be observable
  canvas.fire('pointerdown', { clientX: bombSlot.x + bombSlot.w / 2, clientY: bombSlot.y + bombSlot.h / 2 });
  assert.equal(state.active.tier, 0, 'a second tap while a bomb is already in play must not plant another');
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

// Regression test for a real touch bug found after 7.3 (bomb/remover, at the
// time): a real finger arms the chip AND aims in one motion -- press the
// chip, slide straight onto the board without lifting, release -- since
// nothing about a touchscreen requires lifting between the two. The chip's
// own pointerdown returns early (js/input.js's `point.y <= HUD_HEIGHT`
// branch) before reaching the code that used to gate committing on an
// `aiming` flag set only when a gesture's OWN pointerdown already landed on
// the board while armed -- so this exact sequence silently did nothing.
// Mouse-click testing could not have caught it: a click's down and up land
// on the same point by construction, so a chip click never continues onto
// the board within one gesture. 8.4 moved the bomb off this path entirely
// (it plants instead of arming), so only the remover still exercises it.
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
  state.inventory.remover = 1;
  const canvas = makeFakeCanvas(state);
  attachInput(canvas, state);

  const removerSlot = powerSlotRect(0);
  canvas.fire('pointerdown', { clientX: removerSlot.x + removerSlot.w / 2, clientY: removerSlot.y + removerSlot.h / 2 });
  canvas.fire('pointerup', {});

  assert.equal(state.events.filter((e) => e.type === 'removerUsed').length, 0,
    'arming alone, with no drag onto the board, must not commit');
  assert.equal(state.removerArmed, true, 'the remover should still be armed, waiting for an actual target');
}

// Locked power-up: swap unlocks at a score this fresh state has not reached
// (it takes the Magnet's old milestone slot). No persisted field changes,
// so state.dirty must NOT be set.
{
  const state = freshState();
  const canvas = makeFakeCanvas(state);
  attachInput(canvas, state);
  const swapSlotRect = powerSlotRect(1); // [remover, swap, bomb] -- see constants.POWERUPS order
  canvas.fire('pointerdown', {
    clientX: swapSlotRect.x + POWER_SLOT.size / 2,
    clientY: swapSlotRect.y + POWER_SLOT.size / 2,
  });
  const events = state.events.filter((e) => e.type === 'lockedPowerUp');
  assert.equal(events.length, 1, 'a lockedPowerUp event should be pushed for a locked/out-of-stock slot');
  assert.equal(events[0].id, 'swap');
  // Swap unlocks on MILESTONE_SCORES[1] (see constants.POWERUPS); read it
  // rather than repeating the number, which 13.2 changed.
  assert.equal(events[0].unlockScore, MILESTONE_SCORES[1]);
  assert.equal(state.dirty, false, 'a locked-power-up tap changes no persisted field and must not mark state.dirty');
}

console.log('input.js: bomb, remover, and locked-power-up all push their event onto state.events; state.dirty set only where warranted');

// --- 10.1: Swap -------------------------------------------------------------
// Reuses the remover's exact tap-a-cell shape (arm via chip, commit on
// release), but is a two-tap tool: the first tap on the board selects, the
// second resolves it (swap, deselect, or move the selection), so these
// tests exercise a full gesture-then-gesture sequence, not one gesture.
function tapCell(canvas, row, col) {
  const clientX = col * CELL + CELL / 2;
  const clientY = HUD_HEIGHT + row * CELL + CELL / 2;
  canvas.fire('pointerdown', { clientX, clientY });
  canvas.fire('pointerup', {});
}

// Two separate taps: select, then swap an adjacent occupied cell.
{
  const state = freshState();
  state.grid[0][0] = 3;
  state.grid[0][1] = 5;
  state.swapArmed = true;
  state.inventory.swap = 1;
  const canvas = makeFakeCanvas(state);
  attachInput(canvas, state);

  tapCell(canvas, 0, 0);
  assert.deepEqual(state.swapSelectedCell, { row: 0, col: 0 }, 'the first tap should select that fruit');

  tapCell(canvas, 0, 1);
  assert.equal(state.grid[0][0], 5, 'the two cells should have traded tiers');
  assert.equal(state.grid[0][1], 3, 'the two cells should have traded tiers');
  assert.equal(state.swapSelectedCell, null, 'the selection should clear once the swap completes');
  assert.equal(state.swapArmed, false, 'a completed swap should consume the charge and un-arm, same as the remover');
  assert.equal(state.dirty, true, 'consuming from purchased inventory should mark state.dirty');
}

// A tap on the already-selected fruit deselects, at no cost.
{
  const state = freshState();
  state.grid[0][0] = 3;
  state.swapArmed = true;
  state.inventory.swap = 1;
  const canvas = makeFakeCanvas(state);
  attachInput(canvas, state);

  tapCell(canvas, 0, 0);
  assert.deepEqual(state.swapSelectedCell, { row: 0, col: 0 });
  tapCell(canvas, 0, 0);
  assert.equal(state.swapSelectedCell, null, 'tapping the same fruit again should deselect');
  assert.equal(state.swapArmed, true, 'deselecting must not consume a charge or un-arm the tool');
  assert.equal(state.dirty, false, 'selecting and cancelling must cost nothing');
}

// A tap on a non-adjacent fruit moves the selection there instead of failing.
{
  const state = freshState();
  state.grid[0][0] = 3;
  state.grid[0][3] = 5; // three columns away -- not adjacent
  state.swapArmed = true;
  state.inventory.swap = 1;
  const canvas = makeFakeCanvas(state);
  attachInput(canvas, state);

  tapCell(canvas, 0, 0);
  tapCell(canvas, 0, 3);
  assert.deepEqual(state.swapSelectedCell, { row: 0, col: 3 }, 'the selection should move to the non-adjacent fruit, not fail silently');
  assert.equal(state.grid[0][0], 3, 'nothing should have been swapped');
  assert.equal(state.grid[0][3], 5, 'nothing should have been swapped');
  assert.equal(state.swapArmed, true, 'moving the selection must not consume a charge');
}

// A tap on an empty cell is silently ignored -- the pending selection, if
// any, is left exactly as it was.
{
  const state = freshState();
  state.grid[0][0] = 3;
  // grid[0][1] left empty
  state.swapArmed = true;
  state.inventory.swap = 1;
  const canvas = makeFakeCanvas(state);
  attachInput(canvas, state);

  tapCell(canvas, 0, 0);
  tapCell(canvas, 0, 1);
  assert.deepEqual(state.swapSelectedCell, { row: 0, col: 0 }, 'tapping an empty cell must not disturb an existing selection');
  assert.equal(state.swapArmed, true, 'tapping an empty cell must not consume a charge');
}

// The two things it must refuse (brief, 10.1): a planted bomb, checked
// before anything else -- rejected by swapFruits itself, but the input
// layer must not get stuck: the selection still clears so the player is not
// left in limbo.
{
  const state = freshState();
  state.grid[0][0] = 3;
  state.grid[0][1] = BOMB_TIER;
  state.swapArmed = true;
  state.inventory.swap = 1;
  const canvas = makeFakeCanvas(state);
  attachInput(canvas, state);

  tapCell(canvas, 0, 0);
  tapCell(canvas, 0, 1);
  assert.equal(state.grid[0][0], 3, 'a bomb-adjacent swap must be rejected -- nothing should move');
  assert.equal(state.grid[0][1], BOMB_TIER, 'the bomb must stay exactly where it was');
  assert.equal(state.swapSelectedCell, null, 'the selection should still clear after a rejected attempt');
  assert.equal(state.swapArmed, true, 'a rejected swap must not consume a charge or un-arm the tool');
  assert.equal(state.dirty, false, 'a rejected swap must not mark state.dirty');
}

// Regression coverage for the SAME real-touch bug class 7.3 found for the
// remover: press the chip, drag straight onto the board without lifting,
// release -- must still register as the FIRST tap (a selection), not
// silently do nothing.
{
  const state = freshState();
  state.highScore = 1000; // Swap unlocks at MILESTONE_SCORES[1]
  state.grid[0][2] = 5;
  state.inventory.swap = 1;
  const canvas = makeFakeCanvas(state);
  attachInput(canvas, state);

  const swapSlot = powerSlotRect(1);
  canvas.fire('pointerdown', { clientX: swapSlot.x + swapSlot.w / 2, clientY: swapSlot.y + swapSlot.h / 2 });
  assert.equal(state.swapArmed, true, 'pressing the chip should arm Swap');

  canvas.fire('pointermove', { clientX: 2 * CELL + CELL / 2, clientY: HUD_HEIGHT + 0 * CELL + CELL / 2 });
  canvas.fire('pointerup', {});

  assert.deepEqual(state.swapSelectedCell, { row: 0, col: 2 },
    'a continuous press-chip-then-drag-to-board-then-release must still register as a selection');
  assert.equal(state.swapArmed, true, 'a single selection must not consume a charge or un-arm the tool');
}

// A plain chip tap alone, no drag onto the board, must select nothing.
{
  const state = freshState();
  state.highScore = 1000;
  state.inventory.swap = 1;
  const canvas = makeFakeCanvas(state);
  attachInput(canvas, state);

  const swapSlot = powerSlotRect(1);
  canvas.fire('pointerdown', { clientX: swapSlot.x + swapSlot.w / 2, clientY: swapSlot.y + swapSlot.h / 2 });
  canvas.fire('pointerup', {});

  assert.equal(state.swapSelectedCell, null, 'arming alone, with no drag onto the board, must select nothing');
  assert.equal(state.swapArmed, true, 'Swap should still be armed, waiting for an actual target');
}

// Arming Remover and Swap can never both be live -- a single board tap would
// otherwise resolve as BOTH a removal and a swap attempt against the same
// cell (js/state.js's armRemover/armSwap cross-disarm).
{
  const state = freshState();
  state.highScore = 1000;
  state.inventory.remover = 1;
  state.inventory.swap = 1;
  const canvas = makeFakeCanvas(state);
  attachInput(canvas, state);

  const removerSlot = powerSlotRect(0);
  const swapSlot = powerSlotRect(1);
  canvas.fire('pointerdown', { clientX: removerSlot.x + removerSlot.w / 2, clientY: removerSlot.y + removerSlot.h / 2 });
  assert.equal(state.removerArmed, true);

  canvas.fire('pointerup', {});
  canvas.fire('pointerdown', { clientX: swapSlot.x + swapSlot.w / 2, clientY: swapSlot.y + swapSlot.h / 2 });
  assert.equal(state.swapArmed, true, 'arming Swap should succeed');
  assert.equal(state.removerArmed, false, 'arming Swap must disarm the Remover');
}

console.log('input.js: Swap selects on the first tap, swaps/deselects/moves the selection on the second, rejects a bomb without getting stuck, survives the same continuous-drag touch bug remover had, and can never be armed alongside the remover');

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
