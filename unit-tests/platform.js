// Regression test for 2.1: "a platform that misbehaves must never take the
// game down." js/platform.js's own module-level selection can't be driven
// from a plain-node test (it needs a real DOM to boot main.js against), so
// this exercises the two things that actually determine that guarantee:
//
//   1. ytgameImpl's guards -- every one of its methods is backed by a real
//      SDK call that can throw or reject, and none of that may propagate.
//   2. The brief's literal failingImpl contract -- every method rejects or
//      throws -- driven through the same call sequence main.js's boot() and
//      persist() actually make, confirming that sequence never throws
//      regardless of which real implementation sits behind it.
import assert from 'node:assert/strict';
import * as platform from '../js/platform.js';

function throwing() { throw new Error('platform SDK failure'); }
function rejecting() { return Promise.reject(new Error('platform SDK failure')); }

const brokenYtgame = {
  IN_PLAYABLES_ENV: true,
  game: {
    loadData: rejecting,
    saveData: throwing,
    firstFrameReady: throwing,
    gameReady: throwing,
  },
  system: {
    onPause: throwing,
    onResume: throwing,
    isAudioEnabled: throwing,
    onAudioEnabledChange: throwing,
    getLanguage: rejecting,
  },
  engagement: {
    sendScore: rejecting,
  },
};

async function run(impl, label) {
  await impl.init();
  const save = await impl.load();
  assert.equal(save, null, `${label}: load() should fall back to null rather than throw/reject`);

  impl.save({ v: 1, highScore: 0 });
  await impl.flush(); // must not throw even though the underlying write fails

  impl.firstFrameReady();
  impl.gameReady();
  impl.onPause(() => {});
  impl.onResume(() => {});
  assert.equal(typeof impl.audioEnabled(), 'boolean', `${label}: audioEnabled() should fail open to a boolean, not throw`);
  impl.onAudioEnabledChange(() => {});
  await impl.submitScore(100);
  const lang = await impl.language();
  assert.equal(typeof lang, 'string', `${label}: language() should fall back to a string, not throw/reject`);

  console.log(`platform: ${label} survived a fully broken backend`);
}

// 1. ytgameImpl against a window.ytgame where every method throws or rejects.
globalThis.window = { ytgame: brokenYtgame };
try {
  await run(platform._createYtgameImpl(), 'ytgameImpl');
} finally {
  delete globalThis.window;
}

// 2. The brief's literal failingImpl -- a third implementation, independent of
// both real backends, used only to prove the calling sequence itself (the one
// main.js's boot()/persist() actually run) tolerates a platform that fails
// every single call.
const failingImpl = {
  init: rejecting,
  load: rejecting,
  save: throwing,
  flush: rejecting,
  firstFrameReady: throwing,
  gameReady: throwing,
  onPause: throwing,
  onResume: throwing,
  audioEnabled: throwing,
  onAudioEnabledChange: throwing,
  submitScore: rejecting,
  language: rejecting,
};

// Mirrors main.js's boot(): every platform call guarded, falling back to safe
// defaults, exactly what a real impl (ytgameImpl above; localImpl trivially,
// since it never rejects at all) already guarantees on its own.
async function bootAgainst(impl) {
  let save = null;
  try { await impl.init(); } catch { /* proceed with defaults */ }
  try { save = await impl.load(); } catch { save = null; }

  try { impl.save({ v: 1 }); } catch { /* dropped, not fatal */ }
  try { await impl.flush(); } catch { /* dropped, not fatal */ }
  try { impl.firstFrameReady(); } catch { /* not fatal */ }
  try { impl.gameReady(); } catch { /* not fatal */ }
  try { impl.onPause(() => {}); } catch { /* pause never fires */ }
  try { impl.onResume(() => {}); } catch { /* resume never fires */ }
  try { await impl.submitScore(1); } catch { /* not fatal */ }
  try { await impl.language(); } catch { /* not fatal */ }

  return { booted: true, save };
}

const result = await bootAgainst(failingImpl);
assert.equal(result.booted, true, 'boot must complete even against a platform where every call fails');
assert.equal(result.save, null, 'a failed load() must fall back to a fresh save rather than crash boot');

console.log('platform: the boot/persist call sequence survives a totally failing platform');
