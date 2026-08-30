// Regression test for 9.5's invariant, re-driven for 10.1: a real-device
// screenshot once showed a fruit floating with an empty cell beneath it,
// caused by the Magnet design that has since been deleted entirely. Swap
// replaces it and is invariant-safe BY CONSTRUCTION (two occupied cells
// trade tiers; nothing is ever cleared or created, so column heights cannot
// change) -- but the brief is explicit that Swap must be covered by this
// same check too, not exempted because the mechanism looks safe on paper.
//
// "No floating fruit" means: within any one column, once you scan up from
// the bottom (row rows-1) and hit an empty cell, every cell further up in
// that same column must also be empty -- there is no non-null fruit resting
// above a gap.
import assert from 'node:assert/strict';
import { COLS } from '../js/constants.js';
import { createInitialState, startRun, armSwap } from '../js/state.js';
import { spawnFruit, stepPhysics, swapFruits } from '../js/physics.js';

function noFloatingFruit(state) {
  const rows = state.grid.length;
  for (let c = 0; c < COLS; c++) {
    let seenGap = false;
    for (let r = rows - 1; r >= 0; r--) {
      if (state.grid[r][c] === null) {
        seenGap = true;
      } else if (seenGap) {
        return { ok: false, col: c, row: r };
      }
    }
  }
  return { ok: true };
}

// Prove the detector itself actually detects the thing it claims to, before
// trusting it to police many drops of real gameplay below -- a checker that
// silently never fires would make every assertion after it worthless.
{
  const emptyRow = () => new Array(COLS).fill(null);
  const clean = { grid: [emptyRow(), emptyRow()] };
  clean.grid[0][1] = 0; clean.grid[1][1] = 1; // column 1 fully packed from the bottom, no gap
  assert.equal(noFloatingFruit(clean).ok, true, 'sanity: a genuinely gap-free board must read as ok');

  const holed = { grid: [emptyRow(), emptyRow()] };
  holed.grid[0][1] = 0; // column 1: a fruit at the top row with nothing beneath it (row 1 left null)
  const result = noFloatingFruit(holed);
  assert.equal(result.ok, false, 'a fruit resting above an empty cell in the same column must be detected');
  assert.equal(result.col, 1, 'the detector should report which column the hole is in');
}

// Deterministic PRNG for picking which cells to attempt a swap against.
// spawnFruit's own tier choice is real Math.random(), same caveat as before
// -- this only seeds the SWAP side of the drive.
let seed = 7;
function rand() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}

const ATTEMPTS = 8;
const DROPS_PER_ATTEMPT = 40;
const DT = 1 / 60;
let totalDropsPlayed = 0;
let totalSwapAttempts = 0;

for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
  const state = createInitialState(null);
  startRun(state, {});
  state.inventory.swap = 1000; // effectively unlimited -- this drives the mechanism, not the economy
  armSwap(state, true);

  for (let i = 0; i < DROPS_PER_ATTEMPT; i++) {
    const result = spawnFruit(state);
    if (result.blocked) break; // this board filled up -- move to the next attempt, not a failure
    totalDropsPlayed += 1;

    for (let guard = 0; guard < 1000 && state.active; guard++) {
      stepPhysics(state, DT);
    }
    assert.equal(state.active, null, 'sanity: the fruit should have landed well within the guard budget');

    // Attempt a handful of swaps against RANDOM cell pairs -- most will be
    // rejected (empty, non-adjacent, or occasionally a no-op against
    // themselves), which is exactly the point: swapFruits' own guards are
    // what this test is really exercising, the same way a real player would
    // tap around the board rather than always picking a valid pair.
    const rows = state.grid.length;
    for (let s = 0; s < 3; s++) {
      const r1 = Math.floor(rand() * rows);
      const c1 = Math.floor(rand() * COLS);
      const r2 = Math.floor(rand() * rows);
      const c2 = Math.floor(rand() * COLS);
      swapFruits(state, r1, c1, r2, c2);
      totalSwapAttempts += 1;
    }

    const check = noFloatingFruit(state);
    assert.ok(check.ok,
      `hole found beneath a landed fruit at column ${check.col}, row ${check.row}, attempt ${attempt}, drop ${i}`);
  }
}

// Random (not merge-seeking) swap attempts can occasionally scatter a board
// toward filling up faster than plain drops alone would -- observed 76-126
// total drops across many manual runs, so the floor here sits comfortably
// below that, not at the average.
assert.ok(totalDropsPlayed >= 50,
  `sanity: too few drops actually played across ${ATTEMPTS} attempts to be a meaningful exercise (${totalDropsPlayed} total)`);
assert.ok(totalSwapAttempts >= 100, 'sanity: too few swap attempts to be a meaningful exercise');

console.log(`board-integrity: no floating fruit (a hole beneath a landed one) across ${totalDropsPlayed} drops and ${totalSwapAttempts} swap attempts (valid and rejected) over ${ATTEMPTS} independent boards`);
