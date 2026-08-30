// Regression test for 9.5: a real-device screenshot showed a fruit floating
// with an empty cell beneath it. The old magnet design (deleted in 9.2)
// could leave exactly this kind of hole when one column was both a move's
// source and another move's destination in the same step. Fixed BY
// CONSTRUCTION once 9.2 removed the mechanism that could ever create it (see
// js/physics.js's own header comment on stepMagnet) -- but the invariant
// itself was never actually checked anywhere. This drives real gameplay,
// with the magnet continuously active and retargeted mid-fall the same way a
// player dragging it would, and asserts the invariant after every single
// landing, not just once.
//
// "No floating fruit" means: within any one column, once you scan up from
// the bottom (row rows-1) and hit an empty cell, every cell further up in
// that same column must also be empty -- there is no non-null fruit resting
// above a gap.
import assert from 'node:assert/strict';
import { COLS } from '../js/constants.js';
import { createInitialState, startRun, activateMagnet } from '../js/state.js';
import { spawnFruit, stepPhysics, stepMagnet, setMagnetColumn } from '../js/physics.js';

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
// trusting it to police 60 drops of real gameplay below -- a checker that
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

// Deterministic PRNG for the magnet's own retargeting -- but spawnFruit's
// tier choice (state.js's randomSpawnTier) genuinely uses Math.random(), so
// how many drops a single board survives before filling up is NOT
// reproducible from this seed alone: an unlucky run of non-matching tiers
// can fill a board in well under half of DROPS_PER_ATTEMPT. Multiple
// independent attempts, summed, is what makes the exercise robust to that --
// not any one board finishing.
let seed = 42;
function rand() {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}

const ATTEMPTS = 8;
const DROPS_PER_ATTEMPT = 40;
const DT = 1 / 60;
let totalDropsPlayed = 0;

for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
  const state = createInitialState(null);
  startRun(state, {});
  state.inventory.magnet = 1;
  activateMagnet(state);
  assert.equal(state.magnetActive, true, 'sanity: the magnet should be active for this drive');

  for (let i = 0; i < DROPS_PER_ATTEMPT; i++) {
    // Keep the magnet exercised across the whole attempt -- energy can drain
    // to zero and retract it, and that must not stop this test from
    // continuing to hammer the mechanism for the remaining drops.
    if (!state.magnetActive) {
      state.inventory.magnet = 1;
      activateMagnet(state);
    }

    const result = spawnFruit(state);
    if (result.blocked) break; // this board filled up -- move to the next attempt, not a failure
    totalDropsPlayed += 1;

    // Retarget the magnet before, and occasionally during, the fall -- same
    // as a player dragging the companion along its rail. Deliberately not on
    // every tick: a magnet yanked to a fresh random column every 16ms
    // scatters landings so wildly that the board fills before merges have a
    // realistic chance to happen -- a real drag is nowhere near that erratic.
    if (rand() < 0.5) setMagnetColumn(state, Math.floor(rand() * COLS));

    // Advance exactly the way main.js's update() does -- stepMagnet before
    // stepPhysics, every tick -- until this fruit lands.
    for (let guard = 0; guard < 1000 && state.active; guard++) {
      if (rand() < 0.05) setMagnetColumn(state, Math.floor(rand() * COLS));
      stepMagnet(state, DT);
      stepPhysics(state, DT);
    }
    assert.equal(state.active, null, 'sanity: the fruit should have landed well within the guard budget');

    const check = noFloatingFruit(state);
    assert.ok(check.ok,
      `hole found beneath a landed fruit at column ${check.col}, row ${check.row}, attempt ${attempt}, drop ${i}`);
  }
}

assert.ok(totalDropsPlayed >= 100,
  `sanity: too few drops actually played across ${ATTEMPTS} attempts to be a meaningful exercise (${totalDropsPlayed} total)`);

console.log(`board-integrity: no floating fruit (a hole beneath a landed one) across ${totalDropsPlayed} drops total over ${ATTEMPTS} independent boards, magnet continuously active and retargeted mid-fall`);
