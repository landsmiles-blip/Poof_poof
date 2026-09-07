// Regression test for 6.6: a merge event now carries an (x, y) pixel position
// frozen at the instant of that merge, alongside row/col. The point of
// freezing it as a position rather than a cell reference: a later merge
// elsewhere in the same cascade can call settleColumns again and shift an
// earlier merge's result down the column to close a gap below it, so row/col
// alone -- correct at push time -- can describe a cell whose contents move on
// before the event is drained.
//
// Fixture: one column (col 3), packed to the full height of the board so no
// unrelated merges are possible in any other column. Two mergeable pairs,
// arranged so resolving the first (rows 0-1) leaves its result sitting
// directly above a second pair (rows 3-4) which merges afterward in the same
// cascade. Closing the gap left by the second merge shifts the first merge's
// result down by one row -- proving the row recorded on the first event no
// longer matches where that fruit now sits, while its frozen (x, y) still
// correctly marks where the merge itself actually happened.
//
// 14: the fixture's first five rows are the test's actual subject and are
// still written out by hand; everything BELOW them was a hardcoded
// `[..., 4, 5]` tail that happened to be exactly ROWS long when ROWS was 7,
// so raising ROWS to 10 failed this file on its own fixture check rather
// than on anything it is testing. Same class of bug as phase 13's two tests
// that hardcoded a MILESTONE_SCORES value: repeating a constant WAS the bug,
// and the tail is now generated to whatever height the board is.
import assert from 'node:assert/strict';
import { CELL, COLS, ROWS, MAX_TIER } from '../js/constants.js';
import { createInitialState, startRun } from '../js/state.js';
import { resolveMerges } from '../js/physics.js';
import {
  createEffects, spawnMergeEffects, updateEffects, squashScaleAt, _setReducedMotion,
} from '../js/effects.js';

const state = createInitialState(null);
const col = 3;
// [tier0, tier0, tier3, tier0, tier0] top to bottom: the two intended pairs
// and the blocker between them.
const values = [0, 0, 3, 0, 0];
// Filler beneath, cycling 4..8 so no two vertically adjacent cells ever match
// (the first filler is 4 against the pair's 0 above it) and nothing down
// there can merge on its own or settle in a way this test did not ask for.
// Capped at MAX_TIER so the cycle can never emit a tier that does not exist.
const FILL_LOW = 4;
const FILL_SPAN = MAX_TIER - FILL_LOW + 1;
const FILL_FROM = values.length;
assert.ok(FILL_SPAN >= 2, 'the filler cycle needs at least two distinct tiers to avoid adjacent matches');
for (let i = FILL_FROM; i < ROWS; i++) values.push(FILL_LOW + ((i - FILL_FROM) % FILL_SPAN));
assert.equal(values.length, ROWS, 'fixture must fill the whole column so no unwanted settling happens beyond what the test expects');
// Only the generated tail: rows 0-1 and 3-4 are the two pairs this test is
// built around and are SUPPOSED to match.
for (let r = FILL_FROM; r < values.length; r++) {
  assert.notEqual(values[r], values[r - 1], `generated filler rows ${r - 1}/${r} must differ, or the tail merges on its own`);
}
for (let r = 0; r < ROWS; r++) {
  for (let c = 0; c < COLS; c++) state.grid[r][c] = c === col ? values[r] : null;
}
state.stackHeight[col] = ROWS;

resolveMerges(state);

const mergeEvents = state.events.filter((e) => e.type === 'merge');
assert.equal(mergeEvents.length, 2, 'exactly two merges should have resolved');
const [first, second] = mergeEvents;

// The first merge's own row (recorded at push time) must no longer match
// where that fruit ended up once the whole cascade has settled -- otherwise
// this fixture is not exercising the shift at all and the test proves nothing.
const stillThere = state.grid[first.row][col] === first.tier;
assert.equal(stillThere, false, 'fixture check: the first merge\'s result must have moved off its recorded row by the end of the cascade');

// The frozen pixel position must still point at the row it was recorded
// against, independent of anything that happened to the grid afterward.
assert.equal(first.x, col * CELL + CELL / 2, 'x must be derived from the merge\'s own column');
assert.equal(first.y, first.row * CELL + CELL / 2, 'y must match the row this event itself recorded, regardless of later shifts');
assert.equal(second.x, col * CELL + CELL / 2, 'second merge x must also be derived from its own column');
assert.equal(second.y, second.row * CELL + CELL / 2, 'second merge y must match its own recorded row');

// --- 20: a chain has to be watchable ----------------------------------------
// resolveMerges is one synchronous loop, so a whole cascade lands in a single
// frame and the player sees fruit vanish in columns they never touched with
// no visible cause -- reported as "fruits start popping randomly... is that a
// glitch?" The grid still resolves in one frame (physics stays deterministic,
// and the difficulty design depends on that); the FEEDBACK is staged instead.
// These check the two halves of that: physics numbers the links, and the
// effects layer actually holds a delayed burst back.
{
  const state = createInitialState();
  startRun(state, {});
  const rows = state.grid.length;
  // 0,0 stacked in column 2, a 1 beside it, a 2 beside that: merging the pair
  // makes a 1, which merges with the 1, which makes a 2, which merges with
  // the 2 -- a three-link chain that ends two columns away from where it
  // started, which is exactly the shape that looked like a bug.
  state.grid[rows - 1][2] = 0;
  state.grid[rows - 2][2] = 0;
  state.stackHeight[2] = 2;
  state.grid[rows - 1][3] = 1;
  state.stackHeight[3] = 1;
  state.grid[rows - 1][4] = 2;
  state.stackHeight[4] = 1;
  state.events.length = 0;

  resolveMerges(state);

  const merges = state.events.filter((e) => e.type === 'merge' || e.type === 'topTier');
  assert.ok(merges.length >= 3, `the chain really does travel (got ${merges.length} merges)`);
  merges.forEach((e, i) => {
    assert.equal(e.step, i, `merge ${i} must carry its position in the chain, not a bare event`);
  });
  const cols = new Set(merges.map((m) => m.col));
  assert.ok(cols.size > 1, 'and it really does reach columns the player never dropped into');

  // 20: the results screen reports THIS -- the biggest chain one action set
  // off. It used to report the timer-based combo streak, which does not lapse
  // between drops and so just counted every merge in the run: a real played
  // run reported "530x chain". A number that only ever goes up is not a
  // result, and it told the player something false about what they did.
  assert.equal(state.bestCascade, merges.length,
    'the run records the size of the chain, not a streak that never lapses');
}
{
  // A fresh cascade must start numbering from zero, or the second chain of a
  // run would be delayed by the length of the first.
  const state = createInitialState();
  startRun(state, {});
  const rows = state.grid.length;
  state.grid[rows - 1][0] = 3;
  state.grid[rows - 2][0] = 3;
  state.stackHeight[0] = 2;
  state.events.length = 0;
  resolveMerges(state);
  assert.equal(state.events.find((e) => e.type === 'merge').step, 0,
    'each cascade is numbered from its own start');
}
{
  // The delay has to actually hold the burst back, and the burst has to be
  // intact when it arrives -- not aged or drifted while it waited.
  _setReducedMotion(false);
  const fx = createEffects();
  spawnMergeEffects(fx, { row: 1, col: 1, tier: 3, color: '#f00', x: 96, y: 96, delay: 0.14 });
  const before = fx.particles.length;
  assert.ok(before > 0, 'particles were created');
  const startX = fx.particles[0].x;

  updateEffects(fx, 0.05);
  assert.equal(fx.particles.length, before, 'a waiting burst is not expired early');
  assert.equal(fx.particles[0].x, startX, 'and does not drift while it waits');
  assert.equal(squashScaleAt(fx, 1, 1, 3), null, 'and its squash has not started');

  updateEffects(fx, 0.12); // now past the delay
  assert.ok(squashScaleAt(fx, 1, 1, 3) !== null, 'once the delay passes, the link pops');
}

console.log('merge-effect-position: a merge event\'s (x, y) stays pinned to where it happened, even after a later merge in the same cascade shifts that cell');
