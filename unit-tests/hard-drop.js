// Regression test for 6.4: keyboard's "drop it" control calls hardDrop(),
// which must land the active fruit at its current column immediately, using
// the same landing row stepPhysics would eventually reach on its own.
import assert from 'node:assert/strict';
import { CELL } from '../js/constants.js';
import { createInitialState } from '../js/state.js';
import { hardDrop } from '../js/physics.js';

{
  const state = createInitialState(null);
  state.stackHeight[2] = 3; // three fruits already stacked in column 2
  state.active = { tier: 0, col: 2, x: 2 * CELL + CELL / 2, targetX: 2 * CELL + CELL / 2, y: -15 };

  const landed = hardDrop(state);
  assert.equal(landed, true, 'hardDrop should report a landing when a fruit is active');
  assert.equal(state.active, null, 'the active fruit should be cleared after a hard drop');
  const rows = state.grid.length;
  const expectedRow = rows - 1 - 3; // same formula stepPhysics uses
  assert.equal(state.grid[expectedRow][2], 0, 'the fruit should land on top of the existing stack in its column');
  assert.equal(state.stackHeight[2], 4, 'the column height should increase by one');
}

{
  const state = createInitialState(null);
  state.active = null;
  assert.equal(hardDrop(state), false, 'hardDrop must no-op safely with no active fruit');
}

console.log('hard-drop: hardDrop lands the active fruit at its current column immediately, using the normal landing math');
