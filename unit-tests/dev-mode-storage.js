// Regression test for 0.1.3 / 1.5: `?dev=1` must never write its inflated
// inventory/highScore into the player's real save. storage.js's writeRaw is
// the single choke point every save* export funnels through, gated by
// setStorageReadOnly -- this simulates a real dev session end-to-end (the
// same boot order main.js uses: setStorageReadOnly(devModeEnabled()) BEFORE
// createInitialState()) and asserts the underlying "localStorage" never
// changes.
//
// Ordering note: this must be the first test file to touch js/storage.js in
// this run (it sorts right after constants.js, before input-callbacks.js and
// rainbow.js, both of which also exercise save* calls) -- storage.js caches
// whether a localStorage backend exists on its first probe, and the fake
// `window` this file installs must be in place for that first probe to be
// meaningful. Later files calling save* after this one's cleanup harmlessly
// hit a caught ReferenceError and fall back to the in-memory store.
import assert from 'node:assert/strict';
import { setStorageReadOnly, loadInventory } from '../js/storage.js';
import {
  devModeEnabled, createInitialState, startRun, endRun, buyPowerUp,
  activateMagnet, consumeBomb, consumeRemover, selectSkin,
} from '../js/state.js';

function makeFakeLocalStorage(seed) {
  const store = new Map(Object.entries(seed));
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    snapshot: () => Object.fromEntries(store),
  };
}

const seed = {
  'poofpoof.highScore': '500',
  'poofpoof.coins': '20',
  'poofpoof.inventory': JSON.stringify({
    slowDrop: 0, remover: 1, extraRow: 0, magnet: 0, bomb: 0, rainbow: 0,
  }),
};
const fakeLocalStorage = makeFakeLocalStorage(seed);
globalThis.window = { localStorage: fakeLocalStorage, location: { search: '?dev=1' } };

try {
  assert.equal(devModeEnabled(), true, 'the ?dev=1 cheat is still present and live in this build');

  // Exactly main.js's boot order (js/main.js:29-30).
  setStorageReadOnly(devModeEnabled());
  const state = createInitialState();

  assert.equal(state.highScore, 8000, 'dev mode should inflate highScore in memory');
  assert.ok(state.inventory.bomb >= 5, 'dev mode should inflate inventory in memory');

  const before = fakeLocalStorage.snapshot();

  // A representative dev session touching every save* call site.
  startRun(state, {});
  buyPowerUp(state, 'bomb', 0);
  activateMagnet(state);
  consumeBomb(state);
  consumeRemover(state);
  selectSkin(state, 'classic');
  endRun(state, 'test');

  const after = fakeLocalStorage.snapshot();
  assert.deepEqual(after, before, 'a dev session must not write anything to the real save');

  // In-session values still round-trip via the memory store.
  const sessionInventory = loadInventory();
  assert.notEqual(sessionInventory.bomb, 0, 'in-session reads should still reflect this session\'s state');

  console.log('dev-mode storage: real save untouched across a full dev session; in-session reads still work');
} finally {
  setStorageReadOnly(false);
  delete globalThis.window;
}
