// Regression tests for 15: the level system that replaces the continuous
// difficulty ramp. Two curves changed shape here (gravity, from continuous to
// stepped; the spawn pool, from one fixed table to six escalating bands) and
// this file is what proves neither one silently got worse than what shipped
// before -- see docs/phase15-spec.md section 7.1, which this file implements
// point for point.
import assert from 'node:assert/strict';
import {
  LEVEL_DROPS, LEVEL_SPEED_START, LEVEL_SPEED_STEP, LEVEL_SPEED_CAP_LEVEL,
  SPAWN_POOL_BY_BAND, LEVELS_PER_SPAWN_BAND, TIERS,
} from '../js/constants.js';
import {
  levelFor, gravityRampMultiplier, createInitialState, startRun,
} from '../js/state.js';

// --- 1. The level boundary -- the off-by-one lives here ---------------------
{
  assert.equal(levelFor(0), 1, 'drop 0 should be level 1');
  assert.equal(levelFor(LEVEL_DROPS - 1), 1, 'the last drop of level 1 should still read as level 1');
  assert.equal(levelFor(LEVEL_DROPS), 2, 'the first drop of the next band should read as level 2');
}

// --- 2. levelFor never decreases ---------------------------------------------
{
  let prev = -Infinity;
  for (let drop = 0; drop <= 500; drop++) {
    const level = levelFor(drop);
    assert.ok(level >= prev, `level must never decrease as drops increase (drop ${drop}: ${level} < ${prev})`);
    prev = level;
  }
}

// --- 3. gravityRampMultiplier never decreases, never exceeds the level-10 value
{
  const capValue = LEVEL_SPEED_START * Math.pow(LEVEL_SPEED_STEP, LEVEL_SPEED_CAP_LEVEL - 1);
  let prev = -Infinity;
  for (let drop = 0; drop <= 500; drop++) {
    const m = gravityRampMultiplier(drop);
    assert.ok(m >= prev, `multiplier must never decrease as drops increase (drop ${drop})`);
    assert.ok(m <= capValue + 1e-9, `multiplier must never exceed the level-${LEVEL_SPEED_CAP_LEVEL} value (drop ${drop}: ${m} > ${capValue})`);
    prev = m;
  }
  assert.equal(gravityRampMultiplier(0), LEVEL_SPEED_START, 'drop 0 (level 1) should be exactly the start multiplier');
  const capDrop = (LEVEL_SPEED_CAP_LEVEL - 1) * LEVEL_DROPS;
  assert.equal(gravityRampMultiplier(capDrop), capValue, 'the first drop of the cap level should land exactly on the capped multiplier');
  assert.equal(gravityRampMultiplier(capDrop + 1000), capValue, 'far beyond the cap level, the multiplier must not keep climbing');
}

// --- 4. The curve is never below the 14.2 ramp it replaced -------------------
// The OLD formula, hardcoded as literal reference data -- NOT imported,
// because 15 deletes the constants it was built from (GRAVITY_RAMP_START_
// MULTIPLIER and friends). This is deliberately the exact shape those
// constants described: 0.6 -> 1.0 eased quadratic over 40 drops, then linear
// 1.0 -> 1.3 over the next 80, flat after.
function oldRampMultiplier(spawnIndex) {
  const OLD_START = 0.6, OLD_BASE = 1.0, OLD_CAP = 1.3;
  const OLD_DROPS_TO_BASE = 40, OLD_DROPS_TO_CAP = 120, OLD_EASE_POWER = 2;
  const drops = Math.max(0, spawnIndex);
  if (drops >= OLD_DROPS_TO_CAP) return OLD_CAP;
  if (drops >= OLD_DROPS_TO_BASE) {
    const t = (drops - OLD_DROPS_TO_BASE) / (OLD_DROPS_TO_CAP - OLD_DROPS_TO_BASE);
    return OLD_BASE + (OLD_CAP - OLD_BASE) * t;
  }
  const t = drops / OLD_DROPS_TO_BASE;
  return OLD_START + (OLD_BASE - OLD_START) * Math.pow(t, OLD_EASE_POWER);
}

{
  // Sanity check first: this comparison must actually be capable of catching
  // a regression, or it proves nothing. A deliberately-worse fake curve (90%
  // of the real one) must fail against the same old-ramp reference.
  let caught = false;
  try {
    for (let drop = 0; drop <= 200; drop++) {
      assert.ok(gravityRampMultiplier(drop) * 0.9 >= oldRampMultiplier(drop) - 1e-9,
        `sanity fixture: drop ${drop}`);
    }
  } catch {
    caught = true;
  }
  assert.ok(caught, 'sanity check: a 10%-worse curve must fail this comparison, or the comparison has no teeth');

  let worstGap = Infinity;
  let worstDrop = -1;
  for (let drop = 0; drop <= 200; drop++) {
    const gap = gravityRampMultiplier(drop) - oldRampMultiplier(drop);
    if (gap < worstGap) { worstGap = gap; worstDrop = drop; }
    assert.ok(gap >= -1e-9,
      `drop ${drop}: the new curve (${gravityRampMultiplier(drop).toFixed(4)}) must not fall below the old ramp `
      + `(${oldRampMultiplier(drop).toFixed(4)}) it replaced -- a future retune must not silently slow the game `
      + `below a build already played and approved`);
  }
  console.log(`levels: worst (new - old) gap across drops 0-200 was ${worstGap.toFixed(4)} at drop ${worstDrop}`);
}

// --- 5. The spawn band advances at the right levels, every tier is valid ----
{
  function bandForLevel(level) {
    return Math.min(SPAWN_POOL_BY_BAND.length - 1, Math.floor((level - 1) / LEVELS_PER_SPAWN_BAND));
  }
  // Band 0 covers levels 1-2, band 1 covers 3-4, and so on -- checked at both
  // ends of each band, not just one point, so an off-by-one at a boundary
  // cannot hide between sample points.
  const expected = [
    [1, 0], [2, 0], [3, 1], [4, 1], [5, 2], [6, 2], [7, 3], [8, 3], [9, 4], [10, 4],
    [11, 5], [12, 5], [13, 6], [14, 6], [50, 6], // past the table: clamped to the last band
  ];
  for (const [level, band] of expected) {
    assert.equal(bandForLevel(level), band, `level ${level} should draw from band ${band}`);
  }

  for (let b = 0; b < SPAWN_POOL_BY_BAND.length; b++) {
    for (const tier of SPAWN_POOL_BY_BAND[b]) {
      assert.ok(Number.isInteger(tier) && tier >= 0 && tier < TIERS.length,
        `band ${b} contains tier ${tier}, which is not a valid index into TIERS (0-${TIERS.length - 1})`);
    }
  }
}

// --- 6. A fresh startRun reads back at level 1 -------------------------------
{
  const state = createInitialState(null);
  state.spawnIndex = 45; // deep into a previous run
  assert.notEqual(levelFor(state.spawnIndex), 1, 'sanity: 45 drops in should not read as level 1');

  startRun(state, {});
  assert.equal(state.spawnIndex, 0, 'startRun must reset spawnIndex');
  assert.equal(levelFor(state.spawnIndex), 1, 'a fresh run must read back at level 1, not wherever the previous run left off');
}

console.log('levels: level boundary correct, level and gravity multiplier both monotonic and capped, '
  + 'new curve never below the old ramp, spawn bands advance correctly with valid tiers, run resets to level 1');
