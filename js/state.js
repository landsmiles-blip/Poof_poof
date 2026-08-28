// Game state container + lifecycle transitions (menu -> playing -> gameover/shop).
// No rendering, input, or audio logic here, just plain data and state transitions.

import {
  COLS, ROWS, SPAWN_POOL, COINS_PER_SCORE,
  COMBO_WINDOW_SEC, COMBO_STEP, COMBO_MAX_MULTIPLIER,
  SKINS, DEFAULT_SKIN_ID,
} from './constants.js';
import {
  loadHighScore, saveHighScore, loadCoins, saveCoins,
  loadInventory, saveInventory,
  loadUnlockedSkins, saveUnlockedSkins,
  loadSelectedSkin, saveSelectedSkin,
} from './storage.js';

export const SCREEN = {
  MENU: 'menu',
  PLAYING: 'playing',
  GAMEOVER: 'gameover',
};

export function createInitialState() {
  const highScore = loadHighScore();
  const unlockedSkins = reconcileUnlocks(loadUnlockedSkins(), highScore);
  const selectedSkin = validSkinId(loadSelectedSkin(), unlockedSkins);

  return {
    screen: SCREEN.MENU,
    highScore,
    coins: loadCoins(),
    inventory: loadInventory(),

    unlockedSkins,
    selectedSkin,
    newlyUnlockedSkins: [], // skins earned by the run that just ended

    grid: makeEmptyGrid(),
    stackHeight: new Array(COLS).fill(0),
    extraRowActive: false,

    score: 0,
    active: null, // the currently falling fruit
    nextTier: randomSpawnTier(),

    slowDropActive: false,
    removerArmed: false,

    comboCount: 0,
    comboTimer: 0,
    bestComboThisRun: 0,

    // Physics pushes {type, ...} here; main.js drains it each frame and turns
    // entries into sound. Keeps physics.js free of audio/DOM imports.
    events: [],

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

// --- Skins ---------------------------------------------------------------

function reconcileUnlocks(stored, highScore) {
  const ids = new Set(stored);
  ids.add(DEFAULT_SKIN_ID);
  // Re-derive from the best score so a stored list can never lag behind
  // (or be missing an unlock the player has clearly earned).
  for (const skin of SKINS) {
    if (highScore >= skin.unlockScore) ids.add(skin.id);
  }
  return SKINS.filter((s) => ids.has(s.id)).map((s) => s.id);
}

function validSkinId(id, unlocked) {
  return unlocked.includes(id) ? id : DEFAULT_SKIN_ID;
}

export function getSkin(state) {
  return SKINS.find((s) => s.id === state.selectedSkin) || SKINS[0];
}

export function skinColor(state, tierIndex) {
  const skin = getSkin(state);
  return skin.colors[tierIndex] || SKINS[0].colors[tierIndex];
}

export function selectSkin(state, id) {
  if (!state.unlockedSkins.includes(id)) return false;
  state.selectedSkin = id;
  saveSelectedSkin(id);
  return true;
}

// --- Combo ---------------------------------------------------------------

export function comboMultiplier(comboCount) {
  if (comboCount <= 1) return 1;
  return Math.min(COMBO_MAX_MULTIPLIER, 1 + (comboCount - 1) * COMBO_STEP);
}

// Called on every merge: extends the streak and returns the multiplier that
// should apply to this merge's points.
export function registerComboHit(state) {
  state.comboCount += 1;
  state.comboTimer = COMBO_WINDOW_SEC;
  if (state.comboCount > state.bestComboThisRun) {
    state.bestComboThisRun = state.comboCount;
  }
  return comboMultiplier(state.comboCount);
}

export function tickCombo(state, dt) {
  if (state.comboCount === 0) return;
  state.comboTimer -= dt;
  if (state.comboTimer <= 0) {
    state.comboTimer = 0;
    state.comboCount = 0;
  }
}

export function resetCombo(state) {
  state.comboCount = 0;
  state.comboTimer = 0;
}

// --- Run lifecycle -------------------------------------------------------

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
  state.newlyUnlockedSkins = [];
  state.events.length = 0;
  state.bestComboThisRun = 0;
  resetCombo(state);
  state.screen = SCREEN.PLAYING;
}

export function endRun(state, reason) {
  state.screen = SCREEN.GAMEOVER;
  state.gameOverReason = reason;
  state.active = null;
  resetCombo(state);

  if (state.score > state.highScore) {
    state.highScore = state.score;
    saveHighScore(state.highScore);
  }

  // Unlock any skin whose milestone this run's score reached.
  const before = new Set(state.unlockedSkins);
  const after = reconcileUnlocks(state.unlockedSkins, state.highScore);
  state.newlyUnlockedSkins = after.filter((id) => !before.has(id));
  if (state.newlyUnlockedSkins.length > 0) {
    state.unlockedSkins = after;
    saveUnlockedSkins(after);
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
