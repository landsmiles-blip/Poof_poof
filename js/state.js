// Game state container + lifecycle transitions (menu -> playing -> gameover/shop).
// No rendering or input logic here, just plain data and state transitions.

import { COLS, ROWS, SPAWN_POOL, COINS_PER_SCORE } from './constants.js';
import { loadHighScore, saveHighScore, loadCoins, saveCoins, loadInventory, saveInventory } from './storage.js';

export const SCREEN = {
  MENU: 'menu',
  PLAYING: 'playing',
  GAMEOVER: 'gameover',
};

export function createInitialState() {
  return {
    screen: SCREEN.MENU,
    highScore: loadHighScore(),
    coins: loadCoins(),
    inventory: loadInventory(),

    grid: makeEmptyGrid(),
    stackHeight: new Array(COLS).fill(0),
    extraRowActive: false,

    score: 0,
    active: null, // the currently falling fruit
    nextTier: randomSpawnTier(),

    slowDropActive: false,
    removerArmed: false,

    lastRunCoinsEarned: 0,
    gameOverReason: null,
  };
}

export function makeEmptyGrid(rows = ROWS) {
  return Array.from({ length: rows }, () => new Array(COLS).fill(null));
}

export function randomSpawnTier() {
  return SPAWN_POOL[Math.floor(Math.random() * SPAWN_POOL.length)];
}

export function effectiveRows(state) {
  return state.extraRowActive ? ROWS + 1 : ROWS;
}

// Starts a new run, consuming any power-ups the player toggled on in the shop.
export function startRun(state, { useSlowDrop, useExtraRow } = {}) {
  if (useSlowDrop && state.inventory.slowDrop > 0) {
    state.inventory.slowDrop -= 1;
    state.slowDropActive = true;
  } else {
    state.slowDropActive = false;
  }

  if (useExtraRow && state.inventory.extraRow > 0) {
    state.inventory.extraRow -= 1;
    state.extraRowActive = true;
  } else {
    state.extraRowActive = false;
  }

  state.removerArmed = false;

  saveInventory(state.inventory);

  state.grid = makeEmptyGrid(effectiveRows(state));
  state.stackHeight = new Array(COLS).fill(0);
  state.score = 0;
  state.active = null;
  state.nextTier = randomSpawnTier();
  state.gameOverReason = null;
  state.screen = SCREEN.PLAYING;
}

export function endRun(state, reason) {
  state.screen = SCREEN.GAMEOVER;
  state.gameOverReason = reason;
  state.active = null;

  if (state.score > state.highScore) {
    state.highScore = state.score;
    saveHighScore(state.highScore);
  }

  const earned = Math.floor(state.score * COINS_PER_SCORE);
  state.lastRunCoinsEarned = earned;
  state.coins += earned;
  saveCoins(state.coins);
}

export function buyPowerUp(state, key, cost) {
  if (state.coins < cost) return false;
  state.coins -= cost;
  state.inventory[key] = (state.inventory[key] || 0) + 1;
  saveCoins(state.coins);
  saveInventory(state.inventory);
  return true;
}

export function addScore(state, points) {
  state.score += points;
}
