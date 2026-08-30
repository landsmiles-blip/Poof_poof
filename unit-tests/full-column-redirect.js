// Regression test for a pre-existing crash surfaced (not caused) by 9.5's
// board-integrity stress test: only the SPAWN column governs isGameOver, so
// a non-spawn column can already be completely full while play continues
// normally. Dragging (or the magnet pulling, since 9.2) a falling fruit over
// that column crashed lockFruit outright -- landingRow went negative,
// state.grid[-1] is undefined. Fixed at the root in columnForX: a full
// column is never a valid landing column, redirected to the nearest one
// (checked left/right alternately, outward) that still has room.
//
// Every fixture here keeps all OTHER columns strictly empty (not merely
// "not full") so the redirected fruit has nothing adjacent to merge with --
// a real merge is entirely legitimate normal play, but it is a separate
// concern from this bug fix and would make these assertions depend on
// cascade specifics that have nothing to do with columnForX itself.
import assert from 'node:assert/strict';
import { CELL } from '../js/constants.js';
import { createInitialState, startRun } from '../js/state.js';
import { stepPhysics, hardDrop } from '../js/physics.js';

// Checkerboarded on (row + col), not a flat r%2 -- two ADJACENT full columns
// both using a plain r%2 pattern would match at every row and cascade-merge
// horizontally the instant resolveMerges ran, which is a real but entirely
// separate concern from the redirect this file is actually testing.
function fillColumn(state, col) {
  const rows = state.grid.length;
  for (let r = 0; r < rows; r++) state.grid[r][col] = (r + col) % 2;
  state.stackHeight[col] = rows;
}

// Tier 5 -- disjoint from fillColumn's 0/1 -- so a fruit landing beside a
// full column can never merge across the boundary and confound what this
// file is actually testing (the redirect itself, not merge cascades).
function activeOverColumn(state, col, tier = 5) {
  const x = col * CELL + CELL / 2;
  return { tier, col, x, targetX: x, y: state.grid.length * CELL - 5, playerSteered: true };
}

// --- Directly over a full column, redirects instead of crashing -----------
{
  const state = createInitialState(null);
  startRun(state, {});
  fillColumn(state, 2);
  state.active = activeOverColumn(state, 2);

  assert.doesNotThrow(() => stepPhysics(state, 0.1),
    'a fruit falling directly over an already-full column must not crash');
  assert.equal(state.stackHeight[2], state.grid.length,
    'the originally-full column must stay exactly full, untouched by the redirect');
  assert.equal(state.active, null, 'the fruit should have landed (somewhere), not been left dangling');
  const totalElsewhere = state.stackHeight.reduce((sum, h, c) => sum + (c === 2 ? 0 : h), 0);
  assert.equal(totalElsewhere, 1, 'the redirected fruit should have landed in exactly one other column');
}

// --- Redirects to the CLOSER side when only one neighbour has room --------
{
  const state = createInitialState(null);
  startRun(state, {});
  fillColumn(state, 3);
  fillColumn(state, 4); // column to the right of 3 is ALSO full
  state.active = activeOverColumn(state, 3);
  hardDrop(state);
  // 4 was already full and 3 itself was full, so 2 (one step further left)
  // is the nearest column with room.
  assert.equal(state.stackHeight[2], 1, 'should redirect left to column 2, the nearest column with room');
  assert.equal(state.stackHeight[3], state.grid.length, 'the originally-full column must stay exactly full, not overflow');
  assert.equal(state.stackHeight[4], state.grid.length, 'the other full column must also stay untouched');
}

// --- hardDrop (not just the per-tick stepPhysics path) also redirects -----
{
  const state = createInitialState(null);
  startRun(state, {});
  fillColumn(state, 0); // an edge column -- only rightward redirection is possible
  state.active = activeOverColumn(state, 0);
  const landed = hardDrop(state);
  assert.equal(landed, true, 'hardDrop should still land the fruit somewhere, not silently fail');
  assert.equal(state.stackHeight[1], 1, 'should redirect right to column 1, the only column with room next to an edge');
}

console.log('full-column-redirect: a falling fruit steered over an already-full column redirects to the nearest column with room instead of crashing, for both stepPhysics and hardDrop');
