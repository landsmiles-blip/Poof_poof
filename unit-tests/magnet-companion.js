// Regression tests for 8.3's companion energy model, carried over by 9.2's
// redesign of what "pulling" actually means: energy drains only while
// actively curving the falling fruit toward the magnet's column, and
// regenerates whenever idle -- no falling fruit, or one already out of range
// or already player-steered. The companion auto-retracts only once energy
// actually reaches zero, not on a countdown independent of use.
import assert from 'node:assert/strict';
import { COLS, CELL, MAGNET_ENERGY_MAX, MAGNET_DRAIN_PER_SEC, MAGNET_REGEN_PER_SEC, MAGNET_PULL_RANGE_PX } from '../js/constants.js';
import { stepMagnet, setMagnetColumn } from '../js/physics.js';

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

const magnetCenterX = 3 * CELL + CELL / 2;

// --- Idle regenerates, at the documented rate -------------------------------
{
  const state = baseState({ magnetEnergy: 10, active: null }); // nothing falling -> idle by construction
  const dt = 0.1;
  stepMagnet(state, dt);
  const expected = Math.min(MAGNET_ENERGY_MAX, 10 + MAGNET_REGEN_PER_SEC * dt);
  assert.ok(Math.abs(state.magnetEnergy - expected) < 1e-9,
    `idle energy should regenerate at MAGNET_REGEN_PER_SEC (expected ${expected}, got ${state.magnetEnergy})`);
}

// --- Idle even WITH a held fruit, if it is out of the magnet's range --------
{
  const state = baseState({
    magnetEnergy: 10,
    active: activeAtX(magnetCenterX - MAGNET_PULL_RANGE_PX - 20),
  });
  stepMagnet(state, 0.1);
  assert.ok(state.magnetEnergy > 10, 'a held fruit outside range is still idle -- energy should regenerate, not drain');
}

// --- Idle once the player has steered the falling fruit ---------------------
{
  const active = activeAtX(magnetCenterX - 50);
  active.playerSteered = true;
  const state = baseState({ magnetEnergy: 10, active });
  stepMagnet(state, 0.1);
  assert.ok(state.magnetEnergy > 10, 'a player-steered fruit is not being pulled -- energy should regenerate, not drain');
}

// --- Energy never regenerates past the cap ----------------------------------
{
  const state = baseState({ magnetEnergy: MAGNET_ENERGY_MAX, active: null });
  stepMagnet(state, 1);
  assert.equal(state.magnetEnergy, MAGNET_ENERGY_MAX, 'regeneration must not push energy above MAGNET_ENERGY_MAX');
}

// --- Draining to zero retracts the companion --------------------------------
{
  const state = baseState({
    magnetEnergy: MAGNET_DRAIN_PER_SEC * 0.05, // just barely enough for one more small tick
    active: activeAtX(magnetCenterX - 50), // in range -> a real, continuous pull
  });
  stepMagnet(state, 1); // a full second of continuous pulling -- far more than remains
  assert.equal(state.magnetEnergy, 0, 'energy must clamp at zero, never go negative');
  assert.equal(state.magnetActive, false, 'the companion must retract once energy actually reaches zero');
}

// --- setMagnetColumn clamps to the board ------------------------------------
{
  const state = baseState();
  setMagnetColumn(state, -3);
  assert.equal(state.magnetCol, 0, 'a column below 0 should clamp to 0');
  setMagnetColumn(state, 99);
  assert.equal(state.magnetCol, COLS - 1, 'a column past the last one should clamp to COLS - 1');
  setMagnetColumn(state, 2.7);
  assert.equal(state.magnetCol, 3, 'a fractional column should round to the nearest one');
}

// --- The puck's draw position tweens, it does not jump ----------------------
{
  const state = baseState({ magnetCol: 0, magnetX: 0 * CELL + CELL / 2, active: null });
  setMagnetColumn(state, 5); // drag straight across the whole rail
  stepMagnet(state, 0.016);
  const targetX = 5 * CELL + CELL / 2;
  assert.ok(state.magnetX > 0 * CELL + CELL / 2 && state.magnetX < targetX,
    'after one 16ms tick the drawn position should have moved partway toward the new column, not landed on it instantly');
}

console.log('magnet-companion: energy drains only while actually pulling the falling fruit, regenerates (capped) while idle -- including out-of-range or player-steered -- retracts at zero, setMagnetColumn clamps, and the puck tweens rather than jumping');
