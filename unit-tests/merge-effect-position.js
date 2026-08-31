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
import { createInitialState } from '../js/state.js';
import { resolveMerges } from '../js/physics.js';

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

console.log('merge-effect-position: a merge event\'s (x, y) stays pinned to where it happened, even after a later merge in the same cascade shifts that cell');
