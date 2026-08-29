// The platform adapter. One interface, two implementations, chosen once at
// boot depending on whether the game is running inside the YouTube Playables
// container.
//
// This is the ONLY file in the codebase permitted to reference `ytgame`,
// `localStorage`, or `visibilitychange`. Everything else -- including
// js/state.js -- goes through the exported functions below.
//
// Built as an adapter, not a port: `ytgame` is undefined outside the
// Playables container, so ytgameImpl can never actually run here and cannot
// be exercised by a unit test. What unit-tests/platform.js verifies instead
// is the contract every implementation must honor: a platform that rejects or
// throws on every call must never take the game down (see failingImpl there).

import { SAVE_KEY, LEGACY_STORAGE_KEYS } from './constants.js';

const SAVE_DEBOUNCE_MS = 1000;

// Wraps a raw (possibly async) persist function with the save()/flush()
// contract both implementations share: save() marks an object dirty and
// schedules a write; flush() writes immediately (cancelling any pending
// timer) and returns a promise that resolves once that write completes.
function createDebouncedSaver(persistFn) {
  let pending = null;
  let timer = null;
  let inFlight = null;

  function runNow() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending === null) return inFlight || Promise.resolve();
    const obj = pending;
    pending = null;
    inFlight = Promise.resolve(persistFn(obj)).finally(() => { inFlight = null; });
    return inFlight;
  }

  return {
    save(obj) {
      pending = obj;
      if (timer !== null) return;
      timer = setTimeout(runNow, SAVE_DEBOUNCE_MS);
    },
    flush() {
      return Promise.resolve(runNow());
    },
  };
}

// --- localImpl -------------------------------------------------------------
// Wraps today's guarded-localStorage behaviour (moved here from the old
// js/storage.js, defensive design intact) behind load/save, visibilitychange
// behind onPause/onResume, and the ?dev=1 read-only mode.

function createLocalImpl() {
  const memoryStore = new Map();
  let backendChecked = false;
  let hasLocalStorage = false;
  let readOnly = false;

  // Sandboxed iframes, Safari private mode, and browsers with site data
  // blocked can make `localStorage` throw on *access*, not just on read or
  // write. When storage is unavailable we fall back to an in-memory store:
  // progress stops surviving a reload, but the game still runs.
  function localStorageAvailable() {
    if (backendChecked) return hasLocalStorage;
    backendChecked = true;
    try {
      const probe = '__poofpoof_probe__';
      if (readOnly) {
        // The usual probe writes and removes a key. In read-only mode that
        // would still be a write, so confirm access with a read instead --
        // reads must keep working, since dev mode should show the real save.
        window.localStorage.getItem(probe);
      } else {
        window.localStorage.setItem(probe, '1');
        window.localStorage.removeItem(probe);
      }
      hasLocalStorage = true;
    } catch {
      hasLocalStorage = false;
    }
    return hasLocalStorage;
  }

  function readRaw(key) {
    // In read-only mode anything written this session lives only in the
    // memory store, and must win over the real save -- otherwise a dev
    // session value would read back as the untouched old one.
    if (readOnly && memoryStore.has(key)) return memoryStore.get(key);
    if (localStorageAvailable()) {
      try {
        return window.localStorage.getItem(key);
      } catch {
        // Fall through to the memory store rather than crashing.
      }
    }
    return memoryStore.has(key) ? memoryStore.get(key) : null;
  }

  function writeRaw(key, value) {
    memoryStore.set(key, value);
    if (readOnly) return;
    if (!localStorageAvailable()) return;
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Quota exceeded or storage revoked mid-session; memory store holds it.
    }
  }

  function numberOr(raw, fallback) {
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : fallback;
  }

  function jsonOr(raw, fallback) {
    if (raw === null) return fallback;
    try {
      const parsed = JSON.parse(raw);
      return parsed === null || typeof parsed !== 'object' ? fallback : parsed;
    } catch {
      return fallback;
    }
  }

  // Migrates the seven pre-platform keys into the versioned blob shape, once.
  // Returns null when there is nothing to migrate (a genuinely fresh save).
  function migrateLegacy() {
    const rawHigh = readRaw(LEGACY_STORAGE_KEYS.highScore);
    const rawCoins = readRaw(LEGACY_STORAGE_KEYS.coins);
    const rawInventory = readRaw(LEGACY_STORAGE_KEYS.inventory);
    const rawSkins = readRaw(LEGACY_STORAGE_KEYS.unlockedSkins);
    const rawSelected = readRaw(LEGACY_STORAGE_KEYS.selectedSkin);
    const rawMuted = readRaw(LEGACY_STORAGE_KEYS.muted);
    const rawMusicOn = readRaw(LEGACY_STORAGE_KEYS.musicOn);

    const anyPresent = [rawHigh, rawCoins, rawInventory, rawSkins, rawSelected, rawMuted, rawMusicOn]
      .some((v) => v !== null);
    if (!anyPresent) return null;

    return {
      v: 1,
      highScore: numberOr(rawHigh, 0),
      coins: numberOr(rawCoins, 0),
      inventory: jsonOr(rawInventory, {}),
      unlockedSkins: jsonOr(rawSkins, ['classic']),
      selectedSkin: rawSelected || 'classic',
      // Legacy stored "muted" (true = silent); the blob stores "sfxOn" (true
      // = sound on) -- inverted on the way through, once, here.
      musicOn: rawMusicOn === null ? true : rawMusicOn !== '0',
      sfxOn: rawMuted === null ? true : rawMuted !== '1',
    };
  }

  async function load() {
    const raw = readRaw(SAVE_KEY);
    if (raw !== null) {
      const parsed = jsonOr(raw, null);
      if (parsed) return parsed;
    }
    const migrated = migrateLegacy();
    if (migrated) writeRaw(SAVE_KEY, JSON.stringify(migrated));
    return migrated;
  }

  const saver = createDebouncedSaver((obj) => writeRaw(SAVE_KEY, JSON.stringify(obj)));

  const pauseHandlers = [];
  const resumeHandlers = [];
  let lifecycleWired = false;

  function wireLifecycle() {
    if (lifecycleWired) return;
    // Guarded, not just for browsers without the API: it also lets this impl
    // be exercised directly by a plain-node unit test with no DOM at all.
    if (typeof document === 'undefined' || !document.addEventListener) return;
    lifecycleWired = true;
    document.addEventListener('visibilitychange', () => {
      const handlers = document.hidden ? pauseHandlers : resumeHandlers;
      for (const cb of handlers) cb();
    });
  }

  return {
    async init() { wireLifecycle(); },
    load,
    save: saver.save,
    flush: saver.flush,
    firstFrameReady() {},
    gameReady() {},
    onPause(cb) { pauseHandlers.push(cb); },
    onResume(cb) { resumeHandlers.push(cb); },
    audioEnabled() { return true; },
    onAudioEnabledChange() {}, // never fires locally -- audio is always enabled
    async submitScore() {},
    async language() { return 'en'; },
    // Not part of the Playables-facing interface -- a local-only extension so
    // ?dev=1 (js/state.js's devModeEnabled) can keep inflating inventory and
    // highScore in memory without ever persisting it over a real save.
    setReadOnly(value) { readOnly = Boolean(value); },
    isReadOnly() { return readOnly; },
  };
}

// --- ytgameImpl --------------------------------------------------------
// Maps straight onto the SDK. Selected only when window.ytgame.IN_PLAYABLES_ENV
// is true, so `ytgame` is guaranteed to exist wherever this code actually runs
// -- but a real SDK call can still fail (a host-side error, a bad response),
// and this is the one implementation with no local fallback behind it, so
// every call is guarded the same way js/storage.js's localStorage access
// always was: a platform that misbehaves must never take the game down.
// Guarded failure modes are chosen to fail open -- load() falls back to a
// fresh save, audioEnabled() falls back to true -- rather than leaving the
// player worse off than an impl that was never called at all.

function createYtgameImpl() {
  const saver = createDebouncedSaver((obj) => {
    try {
      return Promise.resolve(window.ytgame.game.saveData(JSON.stringify(obj))).catch(() => {});
    } catch {
      return Promise.resolve();
    }
  });

  return {
    async init() {},
    async load() {
      try {
        const raw = await window.ytgame.game.loadData();
        if (!raw) return null;
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        return (parsed && typeof parsed === 'object') ? parsed : null;
      } catch {
        return null;
      }
    },
    save: saver.save,
    flush: saver.flush,
    firstFrameReady() { try { window.ytgame.game.firstFrameReady(); } catch { /* not fatal */ } },
    gameReady() { try { window.ytgame.game.gameReady(); } catch { /* not fatal */ } },
    onPause(cb) { try { window.ytgame.system.onPause(cb); } catch { /* pause simply never fires */ } },
    onResume(cb) { try { window.ytgame.system.onResume(cb); } catch { /* resume simply never fires */ } },
    audioEnabled() {
      try { return window.ytgame.system.isAudioEnabled(); } catch { return true; }
    },
    onAudioEnabledChange(cb) {
      try { window.ytgame.system.onAudioEnabledChange(cb); } catch { /* never fires */ }
    },
    async submitScore(n) {
      try { await window.ytgame.engagement.sendScore({ value: n }); } catch { /* not fatal */ }
    },
    async language() {
      try { return await window.ytgame.system.getLanguage(); } catch { return 'en'; }
    },
    setReadOnly() {}, // ?dev=1 is a Pages-only testing affordance
    isReadOnly() { return false; },
  };
}

// Exposed so other files can tell the two targets apart without reaching for
// `window.ytgame` themselves -- this remains the only file that does that.
// Used by js/main.js (5.0.2) to keep a Pages-only debug hook out of the
// container entirely, not just inert inside it.
export const isPlayablesEnv = typeof window !== 'undefined' && Boolean(window.ytgame?.IN_PLAYABLES_ENV);

const impl = isPlayablesEnv ? createYtgameImpl() : createLocalImpl();

export const init = impl.init;
export const load = impl.load;
export const save = impl.save;
export const flush = impl.flush;
export const firstFrameReady = impl.firstFrameReady;
export const gameReady = impl.gameReady;
export const onPause = impl.onPause;
export const onResume = impl.onResume;
export const audioEnabled = impl.audioEnabled;
export const onAudioEnabledChange = impl.onAudioEnabledChange;
export const submitScore = impl.submitScore;
export const language = impl.language;
export const setReadOnly = impl.setReadOnly;
export const isReadOnly = impl.isReadOnly;

// Exposed for unit-tests/platform.js only: lets the test drive a specific
// implementation (including a third, failing one it defines itself) without
// depending on window.ytgame, which does not exist in Node.
export const _createLocalImpl = createLocalImpl;
export const _createYtgameImpl = createYtgameImpl;
export const _createDebouncedSaver = createDebouncedSaver;
