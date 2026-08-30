// Regression tests for 9.2's magnet redesign: the companion no longer moves
// settled fruit (deleted entirely, not disabled -- see physics.js's own
// header comment on the old design's board-corruption bug). It now curves
// the CURRENTLY FALLING fruit's targetX toward its own column, falls off
// with distance, has a hard range cutoff, and steps aside completely once
// the player has steered that fruit.
import assert from 'node:assert/strict';
import { COLS, CELL, MAGNET_ENERGY_MAX, MAGNET_DRAIN_PER_SEC, MAGNET_PULL_RANGE_PX } from '../js/constants.js';
import { stepMagnet, magnetPullFor, setDragTarget } from '../js/physics.js';

function baseState(overrides = {}) {
  return {
    grid: [[null, null, null, null, null, null]],
    stackHeight: new Array(COLS).fill(0),
    magnetActive: true,
    magnetEnergy: MAGNET_ENERGY_MAX,
    magnetCol: 3,
    magnetX: 3 * CELL + CELL / 2,
    active: null,
    score: 0,
    events: [],
    suppressCombo: false,
    comboCount: 0,
    comboTimer: 0,
    bestComboThisRun: 0,
    ...overrides,
  };
}

function activeAtX(targetX) {
  return { tier: 0, col: 0, x: targetX, targetX, y: 0, playerSteered: false };
}

const magnetCenterX = 3 * CELL + CELL / 2; // magnetCol: 3, matching baseState's default

// --- Within range, targetX drifts toward the magnet's column ---------------
{
  const state = baseState({ active: activeAtX(magnetCenterX - 100) });
  const before = state.active.targetX;
  stepMagnet(state, 0.1);
  assert.ok(state.active.targetX > before, 'targetX should drift toward the magnet (rightward here)');
  assert.ok(state.active.targetX < magnetCenterX, 'one small tick must not overshoot the magnet\'s own column');
}

// --- It never resolves a merge, scores, or touches the grid -----------------
{
  const state = baseState({ active: activeAtX(magnetCenterX - 100) });
  stepMagnet(state, 0.1);
  assert.equal(state.score, 0, 'the magnet must not score -- it repositions, it does not merge');
  assert.equal(state.events.length, 0, 'the magnet must not emit merge events');
  assert.deepEqual(state.grid, [[null, null, null, null, null, null]], 'stepMagnet must never touch the grid at all');
}

// --- 9.6: a hard range cutoff -- no pull at all beyond MAGNET_PULL_RANGE_PX
{
  const justInside = activeAtX(magnetCenterX - MAGNET_PULL_RANGE_PX + 1);
  const justOutside = activeAtX(magnetCenterX - MAGNET_PULL_RANGE_PX - 1);
  const state = baseState();
  assert.ok(magnetPullFor(state, justInside) !== null, 'just inside the range boundary, there should be a pull');
  assert.equal(magnetPullFor(state, justOutside), null, 'just outside the range boundary, there must be no pull at all');

  const outState = baseState({ active: justOutside });
  const before = outState.active.targetX;
  stepMagnet(outState, 1); // a full second -- if any pull leaked through, this would move it a lot
  assert.equal(outState.active.targetX, before, 'out of range, targetX must not move even over a full second');
}

// --- Pull strength falls off with distance ----------------------------------
{
  const state = baseState();
  const near = magnetPullFor(state, activeAtX(magnetCenterX - CELL)); // 1 column away
  const far = magnetPullFor(state, activeAtX(magnetCenterX - MAGNET_PULL_RANGE_PX * 0.9)); // near the edge of range
  assert.ok(near && far, 'sanity: both fixtures should be in range');
  assert.ok(near.strength > far.strength, 'a closer fruit should feel a stronger pull than a farther one');
}

// --- Dragging always overrides: once steered, the magnet leaves it alone ---
{
  const state = baseState({ active: activeAtX(magnetCenterX - 100) });
  setDragTarget(state, state.active.targetX); // the player steers it, even to the same spot
  assert.equal(state.active.playerSteered, true, 'setDragTarget should mark the fruit as player-steered');
  const before = state.active.targetX;
  stepMagnet(state, 1); // a full second -- if the magnet were still active this would move it a lot
  assert.equal(state.active.targetX, before, 'once player-steered, the magnet must not move this fruit at all, ever again this drop');
}

// --- Energy drains only while actually pulling, by the documented rate -----
{
  const state = baseState({ active: activeAtX(magnetCenterX - 100) });
  const dt = 0.1;
  stepMagnet(state, dt);
  const expected = MAGNET_ENERGY_MAX - MAGNET_DRAIN_PER_SEC * dt;
  assert.ok(Math.abs(state.magnetEnergy - expected) < 1e-9,
    `energy should drain by MAGNET_DRAIN_PER_SEC * dt while pulling (expected ${expected}, got ${state.magnetEnergy})`);
}

// --- Energy regenerates once out of range or nothing is falling ------------
{
  const state = baseState({ magnetEnergy: 10, active: null });
  stepMagnet(state, 0.1);
  assert.ok(state.magnetEnergy > 10, 'idle (nothing falling) should regenerate energy, not drain it');
}

// --- It never overshoots past the magnet's own column in one tick ----------
{
  const state = baseState({ active: activeAtX(magnetCenterX - 100) });
  stepMagnet(state, 100); // an absurdly large dt -- must clamp, not fly past
  assert.equal(state.active.targetX, magnetCenterX, 'a huge dt must land exactly on the magnet\'s column, never past it');
}

console.log('magnet: the falling fruit curves toward the magnet\'s column, falls off with distance, has a hard range cutoff, never overshoots, never touches the grid, and steps aside for good once the player steers');
