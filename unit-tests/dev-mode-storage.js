// Regression test for 0.1.3 / 1.5, updated for phase 2: `?dev=1` must still
// never write its inflated inventory/highScore into the player's real save,
// now that persistence goes through js/platform.js's localImpl instead of
// js/storage.js (deleted this phase -- its guarded design and its read-only
// mode both moved here intact).
//
// Ordering note: like the old version of this file, this should be the first
// unit-tests file to touch a real 'poofpoof.save' key in this run, since
// localImpl caches whether a localStorage backend exists on first probe. It
// sorts after migration.js and before platform.js/rainbow.js alphabetically;
// none of those touch localStorage, so this is safe regardless.
import assert from 'node:assert/strict';
import * as platform from '../js/platform.js';
import { MILESTONE_SCORES } from '../js/constants.js';
import {
  devModeEnabled, createInitialState, toSaveBlob, startRun, endRun, buyPowerUp,
  armSwap, plantBomb, consumeRemover, selectSkin,
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

const realSave = {
  v: 1,
  highScore: 500,
  coins: 20,
  inventory: { slowDrop: 0, remover: 1, extraRow: 0, swap: 0, bomb: 0, rainbow: 0 },
  unlockedSkins: ['classic'],
  selectedSkin: 'classic',
  musicOn: true,
  sfxOn: true,
};
const fakeLocalStorage = makeFakeLocalStorage({ 'poofpoof.save': JSON.stringify(realSave) });
globalThis.window = { localStorage: fakeLocalStorage, location: { search: '?dev=1' } };

try {
  assert.equal(devModeEnabled(), true, 'the ?dev=1 cheat is still present and live in this build');

  const impl = platform._createLocalImpl();
  // Exactly main.js's boot order: setReadOnly before init()/load().
  impl.setReadOnly(devModeEnabled());
  await impl.init();
  const save = await impl.load();
  assert.deepEqual(save, realSave, 'a read-only load should still see the real save');

  const state = createInitialState(save);
  // Read from MILESTONE_SCORES rather than repeating its top value: dev mode
  // inflates highScore to the LAST milestone, whatever that is, and 13.2
  // retuned the ladder. A test that hardcodes the number fails on a change
  // it is not actually testing.
  assert.equal(state.highScore, MILESTONE_SCORES[MILESTONE_SCORES.length - 1],
    'dev mode should inflate highScore in memory to the top milestone');
  assert.ok(state.inventory.bomb >= 5, 'dev mode should inflate inventory in memory');

  const before = fakeLocalStorage.snapshot();

  // A representative dev session touching every mutating state.js export,
  // persisted exactly the way main.js's persist()/persistNow() would.
  startRun(state, {});
  buyPowerUp(state, 'bomb', 0);
  armSwap(state, true);
  plantBomb(state);
  consumeRemover(state);
  selectSkin(state, 'classic');
  endRun(state, 'test');
  impl.save(toSaveBlob(state, { musicOn: true, sfxOn: true }));
  await impl.flush();

  const after = fakeLocalStorage.snapshot();
  assert.deepEqual(after, before, 'a dev session must not write anything to the real save');

  // In-session values still round-trip via the memory store.
  const sessionSave = await impl.load();
  assert.notEqual(sessionSave.inventory.bomb, realSave.inventory.bomb,
    'in-session reads should still reflect this session\'s state, not the untouched real save');

  console.log('dev-mode storage: real save untouched across a full dev session; in-session reads still work');
} finally {
  delete globalThis.window;
}
