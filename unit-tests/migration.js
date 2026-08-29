// Regression test for 2.2's migration requirement: an existing Pages player's
// seven independent keys must become the versioned blob on first boot under
// localImpl, without losing coins, skins, or inventory -- and must be written
// back so the migration only ever runs once.
import assert from 'node:assert/strict';
import * as platform from '../js/platform.js';

function makeFakeLocalStorage(seed) {
  const store = new Map(Object.entries(seed));
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    snapshot: () => Object.fromEntries(store),
  };
}

const legacySeed = {
  'poofpoof.highScore': '4200',
  'poofpoof.coins': '37',
  'poofpoof.inventory': JSON.stringify({
    slowDrop: 2, remover: 0, extraRow: 1, magnet: 3, bomb: 0, rainbow: 1,
  }),
  'poofpoof.unlockedSkins': JSON.stringify(['classic', 'blossom', 'neon']),
  'poofpoof.selectedSkin': 'neon',
  'poofpoof.muted': '0', // not muted -> sfxOn: true
  'poofpoof.musicOn': '0', // off -> musicOn: false
};

globalThis.window = { localStorage: makeFakeLocalStorage(legacySeed) };
try {
  const impl = platform._createLocalImpl();
  const blob = await impl.load();

  assert.ok(blob, 'a migrated blob should be returned, not null');
  assert.equal(blob.highScore, 4200);
  assert.equal(blob.coins, 37);
  assert.deepEqual(blob.inventory, {
    slowDrop: 2, remover: 0, extraRow: 1, magnet: 3, bomb: 0, rainbow: 1,
  });
  assert.deepEqual(blob.unlockedSkins, ['classic', 'blossom', 'neon']);
  assert.equal(blob.selectedSkin, 'neon');
  assert.equal(blob.sfxOn, true, 'legacy muted=0 (not muted) should migrate to sfxOn=true');
  assert.equal(blob.musicOn, false, 'legacy musicOn=0 should migrate to musicOn=false');

  // Written back once, under the versioned key, so the next load reads the
  // blob directly and never touches the legacy keys again.
  const raw = window.localStorage.getItem('poofpoof.save');
  assert.ok(raw, 'the migrated blob should be persisted under the versioned key');
  assert.deepEqual(JSON.parse(raw), blob);

  console.log('migration: legacy keys became the versioned blob with nothing lost, and were persisted once');

  // A fresh save (no versioned key, no legacy keys at all) migrates to null,
  // not an empty/garbage blob -- createInitialState's own defaults apply.
  const emptyImpl = platform._createLocalImpl();
  globalThis.window = { localStorage: makeFakeLocalStorage({}) };
  const freshBlob = await emptyImpl.load();
  assert.equal(freshBlob, null, 'a genuinely fresh save should load as null, not a migrated blob');
  console.log('migration: a genuinely fresh save loads as null');
} finally {
  delete globalThis.window;
}
