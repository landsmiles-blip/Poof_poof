// Regression test for 1.3: a purchased Rainbow charge must never be silently
// lost, and the HUD's "Next" preview must never lie about what actually
// spawns.
//
// Simulates 1,000 runs of 8 drops each (short on purpose -- RAINBOW_SCHEDULE_
// BANDS's second band is [7, 12], so an 8-drop run frequently ends before the
// second wild's scheduled index is reached, which is exactly the case the
// plan's "return the unspent portion to inventory in endRun" fix targets).
import assert from 'node:assert/strict';
import { RAINBOW_TIER, RAINBOW_PER_CHARGE } from '../js/constants.js';
import { startRun, endRun } from '../js/state.js';
import { spawnFruit } from '../js/physics.js';

const RUNS = 1000;
const DROPS = 8;

let lostCharges = 0;
let previewMismatches = 0;

for (let i = 0; i < RUNS; i++) {
  const state = {
    inventory: {
      slowDrop: 0, extraRow: 0, rainbow: 1, remover: 0, magnet: 0, bomb: 0,
    },
    highScore: 0,
    coins: 0,
    unlockedSkins: ['classic'],
    events: [],
  };

  startRun(state, { useRainbow: true });
  assert.equal(state.inventory.rainbow, 0, 'the charge should be spent up front');

  let delivered = 0;
  for (let drop = 0; drop < DROPS; drop++) {
    const previewedTier = state.nextTier;
    const result = spawnFruit(state);
    if (result.blocked) break;
    const spawnedTier = state.active.tier;
    if (spawnedTier === RAINBOW_TIER) delivered += 1;
    if (spawnedTier !== previewedTier) previewMismatches += 1;
    state.active = null; // only the spawn/schedule logic is under test here
  }

  endRun(state, 'test');

  if (delivered < RAINBOW_PER_CHARGE && (state.inventory.rainbow || 0) <= 0) {
    lostCharges += 1;
  }
}

console.log(`rainbow: ${lostCharges}/${RUNS} runs lost a charge, ${previewMismatches} spawns mismatched their preview`);

assert.equal(lostCharges, 0,
  `${lostCharges}/${RUNS} runs delivered fewer than ${RAINBOW_PER_CHARGE} wilds AND ended with the charge unrefunded -- endRun does not return unspent schedule entries to inventory`);
assert.equal(previewMismatches, 0,
  `${previewMismatches} spawns did not match their previewed tier -- spawnFruit still overrides nextTier at spawn time instead of deciding the wild when nextTier is rolled`);

console.log('rainbow: every charge delivered or refunded, every preview accurate');
