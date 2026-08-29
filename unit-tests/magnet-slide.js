// Regression test for 7.3: a magnet-moved fruit's GRID position updates
// instantly (stepMagnet is unchanged), but its DRAW position must ease from
// the old column to the new one rather than snapping a full cell between two
// frames. spawnMagnetSlides/magnetSlideOffsetAt carry that lag; this checks
// the offset starts at the full column gap, eases toward zero, and (like
// squash's tier guard) refuses to apply to a cell whose contents changed.
import assert from 'node:assert/strict';
import { CELL } from '../js/constants.js';
import { createEffects, spawnMagnetSlides, magnetSlideOffsetAt, updateEffects } from '../js/effects.js';

const state = {
  grid: [[null, null, null]],
  stackHeight: [0, 1, 0],
};

const fx = createEffects();
spawnMagnetSlides(fx, state, [{ from: 0, to: 1, tier: 2 }]);

const row = state.grid.length - state.stackHeight[1]; // matches spawnMagnetSlides' own formula

const atStart = magnetSlideOffsetAt(fx, row, 1, 2);
assert.ok(atStart !== null, 'a fresh slide should apply at its recorded (row, col, tier)');
assert.ok(Math.abs(atStart - (0 * CELL - 1 * CELL)) < 1e-9, 'the offset should start at the full column gap (fromX - toX)');

updateEffects(fx, fx.magnetSlides[0].duration * 0.5);
const atHalf = magnetSlideOffsetAt(fx, row, 1, 2);
assert.ok(Math.abs(atHalf) < Math.abs(atStart), 'the offset should ease toward zero as the slide progresses');
assert.ok(atHalf !== 0, 'sanity: the fixture duration should not have already finished at the halfway tick');

updateEffects(fx, fx.magnetSlides[0] ? fx.magnetSlides[0].duration : 0);
assert.equal(magnetSlideOffsetAt(fx, row, 1, 2), null, 'a finished slide should be cleaned up and stop applying');

// Tier guard: a later fruit occupying the same cell with a different tier
// must not inherit a stale slide it never earned.
const fx2 = createEffects();
spawnMagnetSlides(fx2, state, [{ from: 0, to: 1, tier: 2 }]);
assert.equal(magnetSlideOffsetAt(fx2, row, 1, 3), null, 'a mismatched tier at the same cell must not match a stale slide');

console.log('magnet-slide: draw offset starts at the full column gap, eases to zero, cleans up, and guards on tier');
