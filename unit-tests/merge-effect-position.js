// Regression test for 6.6: a merge event now carries an (x, y) pixel position
// frozen at the instant of that merge, alongside row/col. The point of
// freezing it as a position rather than a cell reference: a later merge
// elsewhere in the same cascade can call settleColumns again and shift an
// earlier merge's result down the column to close a gap below it, so row/col
// alone -- correct at push time -- can describe a cell whose contents move on
// before the event is drained.
//
// Fixture: one column (col 3), fully packed with 7 cells so no unrelated
// merges are possible in any other column. Two mergeable pairs, arranged so
// resolving the first (rows 0-1) leaves its result sitting directly above a
// second pair (rows 3-4) which merges afterward in the same cascade. Closing
// the gap left by the second merge shifts the first merge's result down by
// one row -- proving the row recorded on the first event no longer matches
// where that fruit now sits, while its frozen (x, y) still correctly marks
// where the merge itself actually happened.
import assert from 'node:assert/strict';
import { CELL, COLS, ROWS } from '../js/constants.js';
import { createInitialState } from '../js/state.js';
import { resolveMerges } from '../js/physics.js';

const state = createInitialState(null);
const col = 3;
// [tier0, tier0, tier3, tier0, tier0, tier4, tier5] top to bottom -- distinct
// filler tiers so nothing merges except the two intended pairs.
const values = [0, 0, 3, 0, 0, 4, 5];
assert.equal(values.length, ROWS, 'fixture must fill the whole column so no unwanted settling happens beyond what the test expects');
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
