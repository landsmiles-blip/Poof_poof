// Regression test: persist() must not run on every boot regardless of
// whether anything changed. createInitialState() only marks state.dirty when
// it actually changed something (the fresh-save starter-Remover grant);
// every mutating state.js export marks it on success and leaves it alone on
// a no-op failure (insufficient coins, nothing to remove, etc).
import assert from 'node:assert/strict';
import {
  createInitialState, startRun, endRun, buyPowerUp, activateMagnet,
  consumeBomb, consumeRemover, selectSkin, armBomb,
} from '../js/state.js';

// A genuinely fresh save grants the starter Remover -- that IS a change.
{
  const state = createInitialState(null);
  assert.equal(state.dirty, true, 'a fresh save granting the starter Remover should start dirty');
}

// An existing save with no grant to make should NOT start dirty.
{
  const state = createInitialState({
    v: 1, highScore: 500, coins: 10,
    inventory: { slowDrop: 0, remover: 0, extraRow: 0, magnet: 0, bomb: 0, rainbow: 0 },
    unlockedSkins: ['classic'], selectedSkin: 'classic', musicOn: true, sfxOn: true,
  });
  assert.equal(state.dirty, false, 'loading an existing save with nothing to migrate/grant should not start dirty');
}

// ?dev=1 inflates everything in memory, but that must never itself trigger a
// write attempt (setReadOnly already blocks it, but there is nothing to mark
// dirty about either -- it is not a real change to the save).
{
  globalThis.window = { location: { search: '?dev=1' } };
  try {
    const state = createInitialState(null);
    assert.equal(state.dirty, false, 'dev-mode inflation should not mark state.dirty');
  } finally {
    delete globalThis.window;
  }
}

console.log('dirty-flag: createInitialState only starts dirty on a genuine fresh-save grant');

// Every mutating export marks dirty on success, and a no-op failure leaves a
// clean flag alone (it must not go back to false if something else was
// already pending, but starting clean each time isolates that).
function freshRunningState() {
  const state = createInitialState({
    v: 1, highScore: 0, coins: 100,
    inventory: { slowDrop: 0, remover: 1, extraRow: 0, magnet: 1, bomb: 1, rainbow: 0 },
    unlockedSkins: ['classic'], selectedSkin: 'classic', musicOn: true, sfxOn: true,
  });
  startRun(state, {});
  state.dirty = false; // startRun itself marks dirty; start each check clean
  return state;
}

{
  const state = freshRunningState();
  assert.equal(buyPowerUp(state, 'bomb', 1000), false, 'insufficient coins should fail');
  assert.equal(state.dirty, false, 'a failed buyPowerUp must not mark dirty');
  assert.equal(buyPowerUp(state, 'bomb', 10), true);
  assert.equal(state.dirty, true, 'a successful buyPowerUp should mark dirty');
}

{
  const state = freshRunningState();
  assert.equal(activateMagnet(state), true);
  assert.equal(state.dirty, true, 'activateMagnet should mark dirty');
}

{
  const state = freshRunningState();
  armBomb(state, true);
  state.dirty = false; // arming is transient, not persisted -- confirm separately below
  assert.equal(consumeBomb(state), true);
  assert.equal(state.dirty, true, 'consumeBomb should mark dirty');
}

{
  const state = freshRunningState();
  assert.equal(armBomb(state, true), true);
  assert.equal(state.dirty, false, 'arming (transient, unpersisted) must not mark dirty');
}

{
  const state = freshRunningState();
  assert.equal(consumeRemover(state), true);
  assert.equal(state.dirty, true, 'consumeRemover should mark dirty');
}

{
  const state = freshRunningState();
  state.unlockedSkins = ['classic', 'blossom'];
  assert.equal(selectSkin(state, 'blossom'), true);
  assert.equal(state.dirty, true, 'selectSkin should mark dirty');
}

{
  const state = freshRunningState();
  endRun(state, 'test');
  assert.equal(state.dirty, true, 'endRun should mark dirty (main.js flushes it immediately)');
}

// 8.1: spending an EARNED (run-scoped, never persisted) charge must not mark
// dirty -- nothing that needs saving changed. Spending purchased inventory
// still must, exactly as above.
{
  const state = freshRunningState();
  state.inventory.bomb = 0; // force the spend to come from earnedCharges only
  state.earnedCharges.bomb = 1;
  armBomb(state, true);
  state.dirty = false;
  assert.equal(consumeBomb(state), true);
  assert.equal(state.dirty, false, 'consuming an earned (unpersisted) charge must not mark dirty');
  assert.equal(state.inventory.bomb, 0, 'purchased inventory must be untouched when an earned charge covers the spend');
}

console.log('dirty-flag: every mutating export marks dirty on success, transient/no-op actions leave it alone');
