// Regression tests for 6.1: gravity now ramps with state.spawnIndex instead
// of sitting at a flat GRAVITY_PX_PER_SEC, and COMBO_WINDOW_SEC (a constant)
// was replaced by comboWindowSecFor(state) (derived from the ramped gravity)
// specifically to avoid re-breaking the arithmetic-impossibility bug the
// original COMBO_WINDOW_SEC comment in constants.js describes: a flat window
// sits below one fall once gravity is slowed at the start of the ramp.
import assert from 'node:assert/strict';
import {
  GRAVITY_PX_PER_SEC, GRAVITY_RAMP_START_MULTIPLIER, GRAVITY_RAMP_CAP_MULTIPLIER,
  GRAVITY_RAMP_DROPS_TO_BASE, GRAVITY_RAMP_DROPS_TO_CAP,
} from '../js/constants.js';
import {
  gravityRampMultiplier, currentGravityPxPerSec, comboWindowSecFor, startRun, createInitialState,
} from '../js/state.js';

// --- Gravity rises with drop count and never exceeds the cap ---------------
{
  assert.equal(gravityRampMultiplier(0), GRAVITY_RAMP_START_MULTIPLIER, 'drop 0 should be the start multiplier');
  assert.equal(gravityRampMultiplier(GRAVITY_RAMP_DROPS_TO_BASE), 1, 'baseline should land exactly on 1x');
  assert.equal(gravityRampMultiplier(GRAVITY_RAMP_DROPS_TO_CAP), GRAVITY_RAMP_CAP_MULTIPLIER, 'the cap drop should land exactly on the cap multiplier');
  assert.equal(gravityRampMultiplier(GRAVITY_RAMP_DROPS_TO_CAP + 500), GRAVITY_RAMP_CAP_MULTIPLIER, 'far beyond the cap drop, the multiplier must not keep climbing');

  let prev = -Infinity;
  for (let drop = 0; drop <= GRAVITY_RAMP_DROPS_TO_CAP + 50; drop += 1) {
    const m = gravityRampMultiplier(drop);
    assert.ok(m >= prev, `multiplier must never decrease as drops increase (drop ${drop})`);
    assert.ok(m <= GRAVITY_RAMP_CAP_MULTIPLIER + 1e-9, `multiplier must never exceed the cap (drop ${drop})`);
    prev = m;
  }

  const state = { spawnIndex: GRAVITY_RAMP_DROPS_TO_BASE };
  assert.equal(currentGravityPxPerSec(state), GRAVITY_PX_PER_SEC, 'at the baseline drop, ramped gravity should equal the flat constant it replaced');
}

// --- The invariant test: one fall < window < two falls, everywhere on the ramp
{
  for (let drop = 0; drop <= GRAVITY_RAMP_DROPS_TO_CAP + 20; drop += 1) {
    const state = { spawnIndex: drop };
    const gravity = currentGravityPxPerSec(state);
    const window = comboWindowSecFor(state);
    // Same distance formula the window itself is derived from, computed
    // independently here so the test can't pass merely by mirroring the
    // implementation's own arithmetic back at itself.
    const fallSec = ((7 - 1) * 64 + 64 / 2 + 15) / gravity;
    assert.ok(window > fallSec, `drop ${drop}: window (${window.toFixed(3)}) must be longer than one empty-board fall (${fallSec.toFixed(3)})`);
    assert.ok(window < 2 * fallSec, `drop ${drop}: window (${window.toFixed(3)}) must be shorter than two empty-board falls (${(2 * fallSec).toFixed(3)})`);
  }
}

// --- A run's ramp resets on startRun ----------------------------------------
{
  const state = createInitialState(null);
  state.spawnIndex = 45; // deep into a previous run's ramp
  assert.notEqual(gravityRampMultiplier(state.spawnIndex), GRAVITY_RAMP_START_MULTIPLIER, 'sanity: 45 drops in should not read as the ramp start');

  startRun(state, {});
  assert.equal(state.spawnIndex, 0, 'startRun must reset spawnIndex');
  assert.equal(gravityRampMultiplier(state.spawnIndex), GRAVITY_RAMP_START_MULTIPLIER, 'a fresh run must read back at the ramp start, not wherever the previous run left off');
}

console.log('difficulty-ramp: gravity ramps with drop count, caps correctly, preserves the combo-window invariant across the whole ramp, and resets on startRun');
