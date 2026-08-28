// All persistence lives here so the rest of the game never touches the
// storage API directly.
//
// Every call is guarded. Sandboxed iframes, Safari private mode, and
// browsers with site-data blocked can make `localStorage` throw on *access*,
// not just on read/write -- and since createInitialState() runs at module
// load, an unguarded throw here would blank the whole game before a single
// frame renders. When storage is unavailable we fall back to an in-memory
// store: progress stops surviving a reload, but the game still runs.

import { STORAGE_KEYS } from './constants.js';

const memoryStore = new Map();
let backendChecked = false;
let hasLocalStorage = false;
let readOnly = false;

// Read-only mode: reads still come from the real save, but nothing is ever
// written back to it. Used by `?dev=1`, which inflates inventory and highScore
// in memory purely for testing.
//
// This is enforced HERE rather than at the call sites on purpose. Dev mode used
// to corrupt real saves through six separate paths -- startRun, buyPowerUp,
// activateMagnet, consumeBomb, consumeRemover and selectSkin -- with startRun
// firing unconditionally on the very first Play tap. Guarding the single choke
// point every save funnels through means no present or future call site can
// bypass it.
export function setStorageReadOnly(value) {
  readOnly = Boolean(value);
}

export function isStorageReadOnly() {
  return readOnly;
}

function localStorageAvailable() {
  if (backendChecked) return hasLocalStorage;
  backendChecked = true;
  try {
    const probe = '__poofpoof_probe__';
    if (readOnly) {
      // The usual probe writes and removes a key. In read-only mode that would
      // still be a write, so confirm access with a read instead -- reads must
      // keep working, since dev mode should show the real save's contents.
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

export function storageIsPersistent() {
  return localStorageAvailable();
}

function readRaw(key) {
  // In read-only mode anything written this session lives only in the memory
  // store, and must win over the real save we are deliberately not updating --
  // otherwise a dev-session value would read back as the untouched old one.
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
  // Memory store first, so an in-session value still round-trips (dev progress
  // survives screen transitions) even when the real save is off limits.
  memoryStore.set(key, value);
  if (readOnly) return;
  if (!localStorageAvailable()) return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Quota exceeded or storage revoked mid-session; memory store still holds it.
  }
}

function readNumber(key, fallback) {
  const raw = readRaw(key);
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function readJSON(key, fallback) {
  try {
    const raw = readRaw(key);
    if (raw === null) return { ...fallback };
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object') return { ...fallback };
    return { ...fallback, ...parsed };
  } catch {
    return { ...fallback };
  }
}

function readArray(key, fallback) {
  try {
    const raw = readRaw(key);
    if (raw === null) return [...fallback];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [...fallback];
  } catch {
    return [...fallback];
  }
}

export function loadHighScore() {
  return readNumber(STORAGE_KEYS.highScore, 0);
}

export function saveHighScore(value) {
  writeRaw(STORAGE_KEYS.highScore, String(value));
}

export function loadCoins() {
  return readNumber(STORAGE_KEYS.coins, 0);
}

export function saveCoins(value) {
  writeRaw(STORAGE_KEYS.coins, String(value));
}

const DEFAULT_INVENTORY = {
  slowDrop: 0, remover: 0, extraRow: 0,
  magnet: 0, bomb: 0, rainbow: 0,
};

export function loadInventory() {
  return readJSON(STORAGE_KEYS.inventory, DEFAULT_INVENTORY);
}

export function saveInventory(inventory) {
  writeRaw(STORAGE_KEYS.inventory, JSON.stringify(inventory));
}

export function loadUnlockedSkins() {
  return readArray(STORAGE_KEYS.unlockedSkins, ['classic']);
}

export function saveUnlockedSkins(ids) {
  writeRaw(STORAGE_KEYS.unlockedSkins, JSON.stringify(ids));
}

export function loadSelectedSkin() {
  return readRaw(STORAGE_KEYS.selectedSkin) || 'classic';
}

export function saveSelectedSkin(id) {
  writeRaw(STORAGE_KEYS.selectedSkin, String(id));
}

export function loadMuted() {
  return readRaw(STORAGE_KEYS.muted) === '1';
}

export function saveMuted(muted) {
  writeRaw(STORAGE_KEYS.muted, muted ? '1' : '0');
}

// Music is tracked separately from the sound-effect mute: wanting the merge
// pops without a backing loop is a common preference. Defaults to on.
export function loadMusicOn() {
  return readRaw(STORAGE_KEYS.musicOn) !== '0';
}

export function saveMusicOn(on) {
  writeRaw(STORAGE_KEYS.musicOn, on ? '1' : '0');
}
