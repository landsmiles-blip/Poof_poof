// All localStorage reads/writes live here so the rest of the game
// never touches the storage API directly.

import { STORAGE_KEYS } from './constants.js';

function readNumber(key, fallback) {
  const raw = localStorage.getItem(key);
  const n = raw === null ? NaN : Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : { ...fallback, ...JSON.parse(raw) };
  } catch {
    return fallback;
  }
}

export function loadHighScore() {
  return readNumber(STORAGE_KEYS.highScore, 0);
}

export function saveHighScore(value) {
  localStorage.setItem(STORAGE_KEYS.highScore, String(value));
}

export function loadCoins() {
  return readNumber(STORAGE_KEYS.coins, 0);
}

export function saveCoins(value) {
  localStorage.setItem(STORAGE_KEYS.coins, String(value));
}

const DEFAULT_INVENTORY = { slowDrop: 0, remover: 0, extraRow: 0 };

export function loadInventory() {
  return readJSON(STORAGE_KEYS.inventory, DEFAULT_INVENTORY);
}

export function saveInventory(inventory) {
  localStorage.setItem(STORAGE_KEYS.inventory, JSON.stringify(inventory));
}
