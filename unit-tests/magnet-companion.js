// Regression tests for 8.3: the magnet becomes a companion with its own
// energy instead of a fixed timer -- "always present, never simply spent".
// Energy drains only while actively pulling a matching fruit and regenerates
// whenever idle; the companion auto-retracts only once energy actually
// reaches zero, not on a countdown independent of use.
import assert from 'node:assert/strict';
import {
  COLS, CELL, MAGNET_ENERGY_MAX, MAGNET_DRAIN_PER_SEC, MAGNET_REGEN_PER_SEC, MAGNET_STEP_SEC,
} from '../js/constants.js';
import { stepMagnet, setMagnetColumn } from '../js/physics.js';

function emptyGrid(rows = 3) {
  return Array.from({ length: rows }, () => new Array(COLS).fill(null));
}

function baseState(overrides = {}) {
  return {
    grid: emptyGrid(),
    stackHeight: new Array(COLS).fill(0),
    magnetActive: true,
    magnetEnergy: MAGNET_ENERGY_MAX,
    magnetCol: 3,
    magnetX: 3 * CELL + CELL / 2,
    magnetStepTimer: MAGNET_STEP_SEC,
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

// --- Idle regenerates, at the documented rate -------------------------------
{
  const state = baseState({ magnetEnergy: 10, active: null }); // nothing falling -> idle by construction
  const dt = 0.1;
  stepMagnet(state, dt);
  const expected = Math.min(MAGNET_ENERGY_MAX, 10 + MAGNET_REGEN_PER_SEC * dt);
  assert.ok(Math.abs(state.magnetEnergy - expected) < 1e-9,
    `idle energy should regenerate at MAGNET_REGEN_PER_SEC (expected ${expected}, got ${state.magnetEnergy})`);
}

// --- Idle even WITH a held fruit, if nothing matches it ---------------------
{
  const grid = emptyGrid();
  grid[2][0] = 5; // present, but does not match the held tier below
  const state = baseState({
    grid,
    stackHeight: [1, 0, 0, 0, 0, 0],
    magnetEnergy: 10,
    active: { tier: 0, col: 3 },
  });
  stepMagnet(state, 0.1);
  assert.ok(state.magnetEnergy > 10, 'a held fruit with no matching exposed fruit anywhere is still idle -- energy should regenerate, not drain');
}

// --- Energy never regenerates past the cap ----------------------------------
{
  const state = baseState({ magnetEnergy: MAGNET_ENERGY_MAX, active: null });
  stepMagnet(state, 1);
  assert.equal(state.magnetEnergy, MAGNET_ENERGY_MAX, 'regeneration must not push energy above MAGNET_ENERGY_MAX');
}

// --- Draining to zero retracts the companion --------------------------------
{
  const grid = emptyGrid();
  grid[2][2] = 0; // matches the held tier, so this is a real, continuous pull
  const state = baseState({
    grid,
    stackHeight: [0, 0, 1, 0, 0, 0],
    magnetEnergy: MAGNET_DRAIN_PER_SEC * 0.05, // just barely enough for one more small tick
    active: { tier: 0, col: 3 },
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

console.log('magnet-companion: energy drains only while actually pulling, regenerates (capped) while idle, retracts at zero, setMagnetColumn clamps, and the puck tweens rather than jumping');
