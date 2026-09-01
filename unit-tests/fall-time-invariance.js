// 14.2: gravity is derived from the board's height so that TIME-TO-LAND does
// not move when ROWS does.
//
// The bug this prevents is not a crash, which is why it needs a test rather
// than a comment. Phase 14 raised ROWS 7 -> 10 with gravity left at a fixed
// 260 px/s, and measured over three played runs of 180s that halved an active
// player's drops (135 -> 70) and their score (~1600 -> ~700). Nothing threw;
// nothing looked wrong; the game just quietly became a different game. A
// board-size change had silently become a difficulty and economy change.
//
// Two assertions, and the first one is what makes the second safe to trust.
import assert from 'node:assert/strict';
import {
  ROWS, CELL, TIERS, GRAVITY_PX_PER_SEC, GRAVITY_BASELINE_FALL_SEC,
} from '../js/constants.js';

// The same expression js/state.js's emptyBoardFallSec uses, restated here on
// purpose rather than imported: if the two ever drift apart, the combo window
// (which is derived from that function) silently stops sitting just above one
// real fall, and this file should be what notices.
const fallDistance = (rows) => (rows - 1) * CELL + CELL / 2 + TIERS[0].radius;

// --- 1. The derivation reproduces the tuned value at the board it was tuned on
// Every number in js/constants.js -- the ramp, the combo window, the spawn
// pool, the milestones -- was tuned against a seven-row board at 260 px/s. If
// the derivation did not reproduce that exactly, 14.2 would be a silent
// retune of all of them rather than a refactor plus a fix.
{
  const atSeven = fallDistance(7) / GRAVITY_BASELINE_FALL_SEC;
  assert.ok(Math.abs(atSeven - 260) < 0.001,
    `the derivation must reproduce the historically tuned 260 px/s at seven rows, got ${atSeven}`);
}

// --- 2. Time to land is the same at every board height --------------------
// This is the actual invariant. Extra Row makes the live board ROWS + 1, and
// a future phase may move ROWS again, so it is checked across a range rather
// than at today's value.
{
  const seconds = [];
  for (const rows of [5, 6, 7, 8, 9, 10, 11, 12, 16, 20]) {
    const gravity = fallDistance(rows) / GRAVITY_BASELINE_FALL_SEC;
    seconds.push({ rows, sec: fallDistance(rows) / gravity });
  }
  for (const { rows, sec } of seconds) {
    assert.ok(Math.abs(sec - GRAVITY_BASELINE_FALL_SEC) < 1e-9,
      `an empty-board fall must take ${GRAVITY_BASELINE_FALL_SEC.toFixed(4)}s at every board height; `
      + `${rows} rows gave ${sec.toFixed(4)}s`);
  }
}

// --- 3. Today's board actually uses it -------------------------------------
// Sections 1 and 2 would both still pass if someone re-hardcoded
// GRAVITY_PX_PER_SEC and left the constant above as decoration. This is the
// line that ties the exported value to the derivation.
{
  const expected = fallDistance(ROWS) / GRAVITY_BASELINE_FALL_SEC;
  assert.ok(Math.abs(GRAVITY_PX_PER_SEC - expected) < 1e-9,
    `GRAVITY_PX_PER_SEC (${GRAVITY_PX_PER_SEC}) must be derived from ROWS (${ROWS}), expected ${expected} `
    + '-- if this fails, someone has pinned it back to a literal');
  const sec = fallDistance(ROWS) / GRAVITY_PX_PER_SEC;
  assert.ok(Math.abs(sec - GRAVITY_BASELINE_FALL_SEC) < 1e-9,
    `the shipped board's empty fall must still be ${GRAVITY_BASELINE_FALL_SEC.toFixed(4)}s, got ${sec.toFixed(4)}s`);
}

console.log(`fall-time-invariance: an empty-board fall takes ${GRAVITY_BASELINE_FALL_SEC.toFixed(4)}s at every board height `
  + `(${ROWS} rows -> ${GRAVITY_PX_PER_SEC.toFixed(1)} px/s), and the derivation still reproduces 260 px/s at seven rows`);
