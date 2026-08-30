// Regression tests for 10.1: Swap replaces the Magnet. Tap two adjacent,
// already-settled fruit and they trade places -- the one thing dragging the
// falling fruit fundamentally cannot do (act on the board after something
// has landed).
import assert from 'node:assert/strict';
import { COLS, BOMB_TIER } from '../js/constants.js';
import { swapFruits } from '../js/physics.js';

function emptyGrid(rows = 3) {
  return Array.from({ length: rows }, () => new Array(COLS).fill(null));
}

function baseState(overrides = {}) {
  return {
    grid: emptyGrid(),
    stackHeight: new Array(COLS).fill(0),
    score: 0,
    events: [],
    suppressCombo: false,
    comboCount: 0,
    comboTimer: 0,
    bestComboThisRun: 0,
    mergeMeter: 0,
    earnedCharges: { remover: 0, swap: 0, bomb: 0 },
    ...overrides,
  };
}

// --- Two adjacent, non-matching fruit simply trade places -------------------
{
  const grid = emptyGrid();
  grid[2][0] = 3; // apple, column 0
  grid[2][1] = 5; // pear, column 1 -- orthogonally adjacent, no merge possible
  const state = baseState({ grid, stackHeight: [1, 1, 0, 0, 0, 0] });

  const ok = swapFruits(state, 2, 0, 2, 1);

  assert.equal(ok, true, 'swapping two adjacent occupied cells should succeed');
  assert.equal(state.grid[2][0], 5, 'the first cell should now hold the second cell\'s tier');
  assert.equal(state.grid[2][1], 3, 'the second cell should now hold the first cell\'s tier');
  assert.equal(state.stackHeight[0], 1, 'column heights must be preserved exactly -- nothing is cleared or created');
  assert.equal(state.stackHeight[1], 1, 'column heights must be preserved exactly -- nothing is cleared or created');
}

// --- Orthogonal adjacency only -- no diagonals ------------------------------
{
  const grid = emptyGrid();
  grid[1][0] = 2;
  grid[2][1] = 2; // diagonal to (1,0), not orthogonally adjacent
  const state = baseState({ grid, stackHeight: [2, 1, 0, 0, 0, 0] });

  const ok = swapFruits(state, 1, 0, 2, 1);

  assert.equal(ok, false, 'a diagonal pair must be rejected -- adjacency is orthogonal only');
  assert.equal(state.grid[1][0], 2, 'a rejected swap must leave the grid completely untouched');
  assert.equal(state.grid[2][1], 2, 'a rejected swap must leave the grid completely untouched');
}

// --- Non-adjacent (same row, two apart) is also rejected --------------------
{
  const grid = emptyGrid();
  grid[2][0] = 2;
  grid[2][2] = 2;
  const state = baseState({ grid, stackHeight: [1, 0, 1, 0, 0, 0] });

  assert.equal(swapFruits(state, 2, 0, 2, 2), false, 'cells two apart in the same row are not adjacent');
}

// --- Both cells must be occupied: an empty target is rejected ---------------
{
  const grid = emptyGrid();
  grid[2][0] = 4;
  // grid[2][1] left null
  const state = baseState({ grid, stackHeight: [1, 0, 0, 0, 0, 0] });

  const ok = swapFruits(state, 2, 0, 2, 1);

  assert.equal(ok, false, 'swapping with an empty cell must be rejected -- it would create a hole');
  assert.equal(state.grid[2][0], 4, 'a rejected swap must leave the occupied side untouched');
  assert.equal(state.stackHeight[0], 1, 'a rejected swap must not change any column height');
}

// --- The two things it must refuse, per the brief: BOMB_TIER, checked FIRST
{
  const grid = emptyGrid();
  grid[2][0] = BOMB_TIER;
  grid[2][1] = 3;
  const state = baseState({ grid, stackHeight: [1, 1, 0, 0, 0, 0] });

  const ok = swapFruits(state, 2, 0, 2, 1);

  assert.equal(ok, false, 'swapping a planted bomb must be rejected -- it would move a live fuse the player did not plant it at');
  assert.equal(state.grid[2][0], BOMB_TIER, 'the bomb must stay exactly where it was');
  assert.equal(state.grid[2][1], 3, 'the other fruit must stay exactly where it was too');
}
{
  // Symmetric: the bomb on the OTHER side of the pair must also be caught.
  const grid = emptyGrid();
  grid[2][0] = 3;
  grid[2][1] = BOMB_TIER;
  const state = baseState({ grid, stackHeight: [1, 1, 0, 0, 0, 0] });
  assert.equal(swapFruits(state, 2, 0, 2, 1), false, 'a bomb as EITHER side of the pair must be rejected');
}

// --- Resolves merges after the swap -- that is the point of the tool -------
{
  const grid = emptyGrid();
  grid[2][0] = 2; // lemon
  grid[1][1] = 2; // lemon, one row up in the adjacent column
  grid[2][1] = 7; // filler -- swaps into column 0
  const state = baseState({ grid, stackHeight: [1, 2, 0, 0, 0, 0] });

  const ok = swapFruits(state, 2, 0, 2, 1);

  assert.equal(ok, true, 'sanity: this swap should succeed');
  // After the swap, column 0 holds [null, null, 7] and column 1 holds
  // [null, 2, 2] top-to-bottom -- the two lemons in column 1 are now
  // vertically adjacent and should have merged into an orange (tier 3).
  assert.equal(state.grid[2][1], 3, 'the swap should have created and then resolved a real merge');
  assert.equal(state.stackHeight[1], 1, 'the merged column should have settled down to one fruit');
}

// --- Swap-caused merges feed the combo -- unlike a Bomb's collapse ---------
// (documented distinction: js/physics.js's swapFruits header comment)
{
  const grid = emptyGrid();
  grid[2][0] = 2;
  grid[1][1] = 2;
  grid[2][1] = 7;
  const state = baseState({ grid, stackHeight: [1, 2, 0, 0, 0, 0] });

  swapFruits(state, 2, 0, 2, 1);

  assert.equal(state.comboCount, 1, 'a swap-caused merge must register a combo hit, unlike a suppressed bomb cascade');
  assert.equal(state.score > 0, true, 'a swap-caused merge must award score');
}

// --- Never scores or merges on a rejected swap ------------------------------
{
  const grid = emptyGrid();
  grid[2][0] = BOMB_TIER;
  grid[2][1] = 3;
  const state = baseState({ grid, stackHeight: [1, 1, 0, 0, 0, 0] });
  const scoreBefore = state.score;

  swapFruits(state, 2, 0, 2, 1);

  assert.equal(state.score, scoreBefore, 'a rejected swap must never award score');
  assert.equal(state.comboCount, 0, 'a rejected swap must never register a combo hit');
}

console.log('swap: trades two orthogonally-adjacent occupied cells, rejects diagonals/non-adjacent/empty/bomb (either side, bomb checked first), preserves column heights exactly, resolves and scores any resulting merge, and feeds the combo normally');
