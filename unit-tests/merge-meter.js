// Acceptance tests for 8.1 -- power-ups become play, not just inventory.
// "Merging enough grants a charge; the charge is usable in the same run."
// "After endRun, earned charges are gone and inventory is byte-identical to
// what it was before the run started." "A locked power-up is never granted."
import assert from 'node:assert/strict';
import { MERGE_METER_MAX, POWERUPS } from '../js/constants.js';
import { createInitialState, startRun, endRun, canUsePowerUp } from '../js/state.js';
import { resolveMerges } from '../js/physics.js';

const HUD_IDS = ['remover', 'swap', 'bomb']; // usable mid-run -- see hudPowerUps()

function itemFor(id) {
  return POWERUPS.find((p) => p.id === id);
}

// Merges enough tier-0 pairs in one column to cross MERGE_METER_MAX at least
// once, using the real merge pipeline (resolveMerges), not a hand call to a
// meter function -- this is meant to prove the wiring from an actual merge,
// not just the arithmetic.
function forceMerges(state, count) {
  const rows = state.grid.length;
  for (let i = 0; i < count; i++) {
    // Two fresh tier-0 fruits stacked at the top of column 0 merge into
    // whatever is already there, one pair at a time, each call settling
    // before the next -- avoids relying on a specific final tier ladder.
    state.grid[0][0] = 0;
    state.grid[1][0] = 0;
    state.stackHeight[0] = Math.max(state.stackHeight[0], 2);
    resolveMerges(state);
  }
  void rows;
}

// --- Merging enough grants a charge, usable the same run --------------------
{
  const state = createInitialState(null);
  state.highScore = 8000; // every power-up unlocked, so any of the three may be picked
  startRun(state, {});
  // Zeroed explicitly (a fresh save otherwise grants one starter Remover) so
  // "usable" below can only be explained by the earned charge, not stock
  // that was already there.
  state.inventory.remover = 0;
  state.inventory.swap = 0;
  state.inventory.bomb = 0;
  assert.equal(state.mergeMeter, 0, 'a fresh run should start with an empty meter');

  forceMerges(state, 30);

  const totalEarned = HUD_IDS.reduce((sum, id) => sum + (state.earnedCharges[id] || 0), 0);
  assert.ok(totalEarned > 0, 'enough merging should have granted at least one earned charge');
  assert.ok(state.mergeMeter < MERGE_METER_MAX, 'the meter should never sit at/above the threshold after granting');

  const grantedId = HUD_IDS.find((id) => state.earnedCharges[id] > 0);
  assert.equal(state.inventory[grantedId], 0, 'sanity: this charge came from earning, not purchased stock');
  assert.equal(canUsePowerUp(state, itemFor(grantedId)), true,
    'a power-up with only an earned charge (zero purchased inventory) must read as usable in this same run');
}

// --- After endRun: earned charges gone, inventory byte-identical -----------
{
  const state = createInitialState(null);
  state.highScore = 8000;
  state.inventory = { slowDrop: 2, remover: 1, extraRow: 0, swap: 3, bomb: 0, rainbow: 1 };
  const before = JSON.stringify(state.inventory);
  startRun(state, {});

  forceMerges(state, 40);
  const earnedSomething = HUD_IDS.some((id) => state.earnedCharges[id] > 0);
  assert.ok(earnedSomething, 'fixture check: this many merges should have earned something to lose at endRun');

  endRun(state, 'test');

  for (const id of HUD_IDS) {
    assert.equal(state.earnedCharges[id], 0, `earnedCharges.${id} must be zero the instant the run ends`);
  }
  assert.equal(JSON.stringify(state.inventory), before,
    'inventory must be byte-identical to what it was before the run started -- earning charges must never touch it');
}

// --- A locked power-up is never granted -------------------------------------
{
  const state = createInitialState(null);
  state.highScore = 0; // swap (1000) and bomb (3000) are locked; only remover (0) is not
  startRun(state, {});

  forceMerges(state, 100); // many grants over the course of this loop

  assert.equal(state.earnedCharges.swap, 0, 'a locked power-up (swap) must never be granted');
  assert.equal(state.earnedCharges.bomb, 0, 'a locked power-up (bomb) must never be granted');
  assert.ok(state.earnedCharges.remover > 0, 'fixture check: something must have been granted, and remover is the only eligible one');
}

console.log('merge-meter: merging grants a usable same-run charge, endRun clears it without touching inventory, and a locked power-up is never granted');
