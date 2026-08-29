// Regression test for 1.1: stepMagnet() must reposition fruit toward the held
// column without ever resolving the merge itself -- that used to happen via a
// resolveMerges() call at the end of stepMagnet, cashing in a merge (and any
// chain behind it) with no further player input.
//
// 8.3: targeting comes from state.magnetCol (dragged along the companion's
// rail), not automatically from state.active.col -- the fixture parks the
// companion over column 3 explicitly, independent of the held fruit's own
// column, to prove the two are genuinely decoupled.
//
// Fixture: cherries sit one column away from the magnet's column on both
// sides (columns 2 and 4, magnet parked at column 3). In one magnet step both
// slide toward column 3 and land there stacked -- a genuine same-tier
// adjacency that must be left for the player's next drop to resolve.
import assert from 'node:assert/strict';
import { COLS, CELL, MAGNET_ENERGY_MAX, MAGNET_DRAIN_PER_SEC } from '../js/constants.js';
import { stepMagnet } from '../js/physics.js';

const rows = 3;
const grid = Array.from({ length: rows }, () => new Array(COLS).fill(null));
grid[rows - 1][2] = 0; // cherry, column 2
grid[rows - 1][4] = 0; // cherry, column 4

const state = {
  grid,
  stackHeight: [0, 0, 1, 0, 1, 0],
  magnetActive: true,
  magnetEnergy: MAGNET_ENERGY_MAX,
  magnetCol: 3,
  magnetX: 3 * CELL + CELL / 2,
  magnetStepTimer: 0.001, // small enough that this tick fires the step
  active: { tier: 0, col: 3 },
  score: 0,
  events: [],
  suppressCombo: false,
  comboCount: 0,
  comboTimer: 0,
  bestComboThisRun: 0,
};

const dt = 0.016;
const moves = stepMagnet(state, dt); // one 16ms tick

assert.equal(moves.length, 2, 'both matching cherries should move one column toward the magnet');
assert.equal(state.grid[1][3], 0, 'a cherry should now sit in the magnet\'s column');
assert.equal(state.grid[2][3], 0, 'a second, adjacent cherry should sit in the magnet\'s column');
assert.equal(state.stackHeight[3], 2, 'the column should hold two un-merged cherries, not one merged grape');
assert.equal(state.score, 0, 'the magnet must not score -- it repositions, it does not merge');
assert.equal(state.events.length, 0, 'the magnet must not emit merge events');

// 8.3: energy drains while actually pulling (two real targets existed this
// tick), by exactly the documented per-second rate scaled by dt.
const expectedEnergy = MAGNET_ENERGY_MAX - MAGNET_DRAIN_PER_SEC * dt;
assert.ok(Math.abs(state.magnetEnergy - expectedEnergy) < 1e-9,
  `energy should drain by MAGNET_DRAIN_PER_SEC * dt while pulling (expected ${expectedEnergy}, got ${state.magnetEnergy})`);
assert.equal(state.magnetActive, true, 'draining a little energy must not retract the companion');

console.log('magnet: adjacency created by a magnet step is left for the next drop, and energy drains only while actually pulling');
