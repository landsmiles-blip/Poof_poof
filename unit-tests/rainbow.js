// Regression test for 1.3, updated for the phase-1 brief's revised contract:
// delivery is a fixed schedule (spawn indices 3 and 8), the preview must
// always be honest, and a charge is refunded only when a run delivers
// NOTHING -- refunding on partial delivery would be farmable (buy a charge,
// take the wild at spawn 3, end the run on purpose, repeat).
import assert from 'node:assert/strict';
import { RAINBOW_TIER, RAINBOW_SCHEDULE } from '../js/constants.js';
import { startRun, endRun } from '../js/state.js';
import { spawnFruit } from '../js/physics.js';

function freshState() {
  return {
    inventory: {
      slowDrop: 0, extraRow: 0, rainbow: 1, remover: 0, magnet: 0, bomb: 0,
    },
    highScore: 0,
    coins: 0,
    unlockedSkins: ['classic'],
    events: [],
  };
}

const RUNS = 1000;
const DROPS = 8;

let lostCharges = 0;
let wrongRefunds = 0; // refunded despite at least one delivered wild
let previewMismatches = 0;

for (let i = 0; i < RUNS; i++) {
  const state = freshState();
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
  const refunded = (state.inventory.rainbow || 0) > 0;

  if (delivered === 0 && !refunded) lostCharges += 1;
  if (delivered > 0 && refunded) wrongRefunds += 1;
}

console.log(`rainbow: ${lostCharges}/${RUNS} runs lost a charge, ${wrongRefunds} wrongly refunded a partial delivery, ${previewMismatches} spawns mismatched their preview`);

assert.equal(lostCharges, 0,
  `${lostCharges}/${RUNS} runs delivered nothing and were not refunded -- a charge was silently lost`);
assert.equal(wrongRefunds, 0,
  `${wrongRefunds}/${RUNS} runs delivered at least one wild but were refunded anyway -- farmable`);
assert.equal(previewMismatches, 0,
  `${previewMismatches} spawns did not match their previewed tier`);

// A run that survives to the first scheduled wild (spawn index 3) and then
// ends must NOT be refunded, even though the second wild (spawn 8) never
// arrives -- this is the specific case the zero-delivery-only rule exists to
// distinguish from a true zero-delivery run.
{
  const state = freshState();
  startRun(state, { useRainbow: true });
  for (let drop = 0; drop <= RAINBOW_SCHEDULE[0]; drop++) {
    spawnFruit(state);
    state.active = null;
  }
  assert.equal(state.rainbowDelivered, 1, 'the first scheduled wild should have been delivered by now');
  endRun(state, 'test');
  assert.equal(state.inventory.rainbow, 0, 'a run with at least one delivered wild must not be refunded');
}

console.log('rainbow: every charge delivered or refunded (never both), every preview accurate');
