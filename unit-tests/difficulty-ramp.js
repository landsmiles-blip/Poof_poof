// Regression tests for 6.1: gravity now ramps with state.spawnIndex instead
// of sitting at a flat GRAVITY_PX_PER_SEC, and COMBO_WINDOW_SEC (a constant)
// was replaced by comboWindowSecFor(state) (derived from the ramped gravity)
// specifically to avoid re-breaking the arithmetic-impossibility bug the
// original COMBO_WINDOW_SEC comment in constants.js describes: a flat window
// sits below one fall once gravity is slowed at the start of the ramp.
import assert from 'node:assert/strict';
import {
  GRAVITY_PX_PER_SEC, LEVEL_DROPS, LEVEL_SPEED_START, LEVEL_SPEED_STEP, LEVEL_SPEED_CAP_LEVEL,
  ROWS, CELL, TIERS,
} from '../js/constants.js';
import {
  gravityRampMultiplier, currentGravityPxPerSec, comboWindowSecFor, startRun, createInitialState,
} from '../js/state.js';

// --- Gravity rises with drop count and never exceeds the cap (15: rewritten
// for the stepped level curve -- see unit-tests/levels.js for the full level
// system test suite; this section only re-covers what this file already
// covered before, now in terms of levels rather than the deleted GRAVITY_
// RAMP_* constants) ----------------------------------------------------------
{
  const capMultiplier = LEVEL_SPEED_START * Math.pow(LEVEL_SPEED_STEP, LEVEL_SPEED_CAP_LEVEL - 1);
  const capDrop = (LEVEL_SPEED_CAP_LEVEL - 1) * LEVEL_DROPS;

  assert.equal(gravityRampMultiplier(0), LEVEL_SPEED_START, 'drop 0 should be the start multiplier');
  assert.equal(gravityRampMultiplier(capDrop), capMultiplier, 'the first drop of the cap level should land exactly on the capped multiplier');
  assert.equal(gravityRampMultiplier(capDrop + 500), capMultiplier, 'far beyond the cap level, the multiplier must not keep climbing');

  // 15: the ramp is now STEPPED, not continuous -- every drop within one
  // level shares exactly one multiplier, and it only changes at a level
  // boundary. This is a genuine behaviour change from the old continuous
  // ramp this section used to test, so it gets its own assertion rather than
  // being left implicit in the monotonic sweep below.
  assert.equal(gravityRampMultiplier(0), gravityRampMultiplier(LEVEL_DROPS - 1),
    'every drop within one level must share the same multiplier');
  assert.notEqual(gravityRampMultiplier(LEVEL_DROPS - 1), gravityRampMultiplier(LEVEL_DROPS),
    'the multiplier must actually change at a level boundary');

  let prev = -Infinity;
  for (let drop = 0; drop <= capDrop + 50; drop += 1) {
    const m = gravityRampMultiplier(drop);
    assert.ok(m >= prev, `multiplier must never decrease as drops increase (drop ${drop})`);
    assert.ok(m <= capMultiplier + 1e-9, `multiplier must never exceed the cap (drop ${drop})`);
    prev = m;
  }

  const state = { spawnIndex: 0 };
  assert.equal(currentGravityPxPerSec(state), GRAVITY_PX_PER_SEC * LEVEL_SPEED_START,
    'at drop 0, ramped gravity should be the flat constant times the level-1 (start) multiplier');
}

// --- The invariant test: one fall < window < two falls, everywhere on the ramp
//
// 8.2 stretched the ramp hard (cap now reached at drop 120, not 60) and eased
// the opening instead of leaving it linear -- sweeping the full new range
// explicitly (0 through 150, not a range derived from the constants) is the
// point: this must keep catching a regression even if DROPS_TO_CAP itself
// changes again later.
//
// 10.2 LANDMINE: this used to hardcode the fall-distance formula's inputs as
// bare numbers (7, 64, 15) -- exactly the kind of hardcoded board height the
// phase brief warned would silently stop tracking ROWS the moment it
// changed. Reading the live constants instead means this keeps meaning the
// same thing (an INDEPENDENT re-derivation, not a call to the
// implementation's own emptyBoardFallSec) regardless of what ROWS becomes
// later -- independence here is about not calling the function under test,
// not about avoiding the constants it's built from.
function independentFallSec(gravityPxPerSec, rows) {
  return ((rows - 1) * CELL + CELL / 2 + TIERS[0].radius) / gravityPxPerSec;
}

{
  for (let drop = 0; drop <= 150; drop += 1) {
    const state = { spawnIndex: drop };
    const gravity = currentGravityPxPerSec(state);
    const window = comboWindowSecFor(state);
    const fallSec = independentFallSec(gravity, ROWS);
    assert.ok(window > fallSec, `drop ${drop}: window (${window.toFixed(3)}) must be longer than one empty-board fall (${fallSec.toFixed(3)})`);
    assert.ok(window < 2 * fallSec, `drop ${drop}: window (${window.toFixed(3)}) must be shorter than two empty-board falls (${(2 * fallSec).toFixed(3)})`);
  }
}

// --- The SAME invariant, with Extra Row active (board is ROWS+1 tall) ------
// The actual bug this landmine check found: comboWindowSecFor used to read
// the ROWS constant directly instead of the board's live height, so an
// Extra Row run's genuinely taller (and thus longer) empty-board fall was
// silently measured against the SHORTER base-board window -- undermining
// the exact invariant this whole file exists to protect, only in the one
// mode nothing here had ever swept.
{
  for (let drop = 0; drop <= 150; drop += 10) {
    const state = { spawnIndex: drop, extraRowActive: true };
    const gravity = currentGravityPxPerSec(state);
    const window = comboWindowSecFor(state);
    const fallSec = independentFallSec(gravity, ROWS + 1);
    assert.ok(window > fallSec,
      `Extra Row, drop ${drop}: window (${window.toFixed(3)}) must be longer than one empty-board fall (${fallSec.toFixed(3)})`);
    assert.ok(window < 2 * fallSec,
      `Extra Row, drop ${drop}: window (${window.toFixed(3)}) must be shorter than two empty-board falls (${(2 * fallSec).toFixed(3)})`);
  }
}

// --- A run's ramp resets on startRun ----------------------------------------
{
  const state = createInitialState(null);
  state.spawnIndex = 45; // deep into a previous run's ramp
  assert.notEqual(gravityRampMultiplier(state.spawnIndex), LEVEL_SPEED_START, 'sanity: 45 drops in should not read as the ramp start');

  startRun(state, {});
  assert.equal(state.spawnIndex, 0, 'startRun must reset spawnIndex');
  assert.equal(gravityRampMultiplier(state.spawnIndex), LEVEL_SPEED_START, 'a fresh run must read back at the ramp start, not wherever the previous run left off');
}

console.log('difficulty-ramp: gravity ramps with drop count, caps correctly, preserves the combo-window invariant across the whole ramp, and resets on startRun');
