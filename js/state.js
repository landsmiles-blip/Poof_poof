// Game state container + lifecycle transitions (menu -> playing -> gameover/shop).
// No rendering, input, or audio logic here, just plain data and state transitions.

import {
  COLS, ROWS, SPAWN_POOL, COINS_PER_SCORE,
  COMBO_WINDOW_SEC, COMBO_STEP, COMBO_MAX_MULTIPLIER,
  SKINS, DEFAULT_SKIN_ID, POWERUPS, MILESTONE_SCORES,
  MAGNET_DURATION_SEC, MAGNET_STEP_SEC, RAINBOW_PER_CHARGE,
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

// `?dev=1` unlocks and stocks everything. Purely a testing affordance -- it
// only ever reads the URL, never storage, so a normal load is unaffected.
export function devModeEnabled() {
  try {
    return new URLSearchParams(window.location.search).get('dev') === '1';
  } catch {
    return false;
  }
}

export function createInitialState() {
  const dev = devModeEnabled();
  const storedHigh = loadHighScore();
  const highScore = dev ? Math.max(storedHigh, MILESTONE_SCORES[MILESTONE_SCORES.length - 1]) : storedHigh;
  const unlockedSkins = reconcileUnlocks(loadUnlockedSkins(), highScore);
  const selectedSkin = validSkinId(loadSelectedSkin(), unlockedSkins);

  return {
    screen: SCREEN.MENU,
    highScore,
    coins: loadCoins(),
    inventory: startingInventory(dev),

    unlockedSkins,
    selectedSkin,
    newlyUnlockedSkins: [], // skins earned by the run that just ended
    newlyUnlockedPowerUps: [], // power-ups earned by the same milestones

    grid: makeEmptyGrid(),
    stackHeight: new Array(COLS).fill(0),
    extraRowActive: false,

    score: 0,
    active: null, // the currently falling fruit
    nextTier: randomSpawnTier(),

    slowDropActive: false,
    removerArmed: false,

    bombArmed: false,
    magnetActive: false,
    magnetTimer: 0,
    magnetStepTimer: 0,
    rainbowRemaining: 0,
    rainbowChance: 0,

    comboCount: 0,
    comboTimer: 0,
    bestComboThisRun: 0,
    // Set while a bomb's collapse resolves, so those merges score at 1x and do
    // not extend the streak.
    suppressCombo: false,

    // Physics pushes {type, ...} here; main.js drains it each frame and turns
    // entries into sound. Keeps physics.js free of audio/DOM imports.
    events: [],

    lastRunCoinsEarned: 0,
    gameOverReason: null,
  };
}

// A brand-new save gets one Fruit Remover. Without it the HUD power bar is
// empty for the whole of a player's first run -- and since coins only arrive at
// game over, the earliest a chip could otherwise appear was run 2. One free
// charge means the bar is populated and tappable from the very first drop.
function startingInventory(dev) {
  const inv = loadInventory();
  if (dev) {
    for (const p of POWERUPS) inv[p.id] = Math.max(inv[p.id] || 0, 5);
    return inv;
  }
  const isFreshSave = Object.values(inv).every((n) => !n) && loadHighScore() === 0;
  if (isFreshSave) {
    inv.remover = 1;
    saveInventory(inv);
  }
  return inv;
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

// --- Milestone gating ----------------------------------------------------
// Skins and power-ups share one ladder (MILESTONE_SCORES), so both ask the
// same question: has the player's best score reached this item's threshold?

export function isUnlockedByScore(item, highScore) {
  return highScore >= (item.unlockScore || 0);
}

export function unlockedPowerUps(state) {
  return POWERUPS.filter((p) => isUnlockedByScore(p, state.highScore));
}

// Power-ups that get a chip in the HUD bar.
//
// This deliberately includes ones that are locked or out of stock, rendered
// greyed. The previous version filtered on `inventory > 0`, which had two bad
// consequences: a brand-new player saw a completely empty bar and had no way to
// learn power-ups existed at all, and activating the Magnet -- which decrements
// stock to zero -- made its own chip disappear at the instant of use, so its
// six-second duration ran with no indicator anywhere on screen.
export function hudPowerUps() {
  return POWERUPS.filter((p) => p.usage === 'tap' || p.usage === 'activate');
}

// Whether a chip is actually actionable right now. Rendering asks hudPowerUps()
// what to draw; input asks this what a tap may do. Keeping them separate is what
// lets a locked chip be visible but inert.
export function canUsePowerUp(state, item) {
  if (!isUnlockedByScore(item, state.highScore)) return false;
  return (state.inventory[item.id] || 0) > 0;
}

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

export function startRun(state, { useSlowDrop, useExtraRow, useRainbow } = {}) {
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

  // Rainbow charges are spent up front and then dribbled into the run through
  // the ordinary spawn path, rather than all arriving at once.
  if (useRainbow && state.inventory.rainbow > 0) {
    state.inventory.rainbow -= 1;
    state.rainbowRemaining = RAINBOW_PER_CHARGE;
    state.rainbowChance = 0.12;
  } else {
    state.rainbowRemaining = 0;
    state.rainbowChance = 0;
  }

  state.removerArmed = false;
  state.bombArmed = false;
  state.magnetActive = false;
  state.magnetTimer = 0;
  state.magnetStepTimer = 0;

  saveInventory(state.inventory);

  state.grid = makeEmptyGrid(effectiveRows(state));
  state.stackHeight = new Array(COLS).fill(0);
  state.score = 0;
  state.active = null;
  state.nextTier = randomSpawnTier();
  state.gameOverReason = null;
  state.newlyUnlockedSkins = [];
  state.newlyUnlockedPowerUps = [];
  state.events.length = 0;
  state.bestComboThisRun = 0;
  resetCombo(state);
  state.screen = SCREEN.PLAYING;
}

export function endRun(state, reason) {
  state.screen = SCREEN.GAMEOVER;
  state.gameOverReason = reason;
  state.active = null;
  state.magnetActive = false;
  state.magnetTimer = 0;
  state.bombArmed = false;
  state.removerArmed = false;
  resetCombo(state);

  const previousBest = state.highScore;

  if (state.score > state.highScore) {
    state.highScore = state.score;
    saveHighScore(state.highScore);
  }

  // Power-ups unlock off the same milestones as skins, so a crossed threshold
  // reports both halves. Availability is derived from highScore rather than
  // stored, so there is nothing extra to persist or keep in sync.
  state.newlyUnlockedPowerUps = POWERUPS
    .filter((p) => p.unlockScore > 0
      && previousBest < p.unlockScore
      && state.highScore >= p.unlockScore)
    .map((p) => p.id);

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

// --- In-run power-up activation -----------------------------------------

export function activateMagnet(state) {
  if ((state.inventory.magnet || 0) <= 0) return false;
  if (state.magnetActive) return false;
  state.inventory.magnet -= 1;
  state.magnetActive = true;
  state.magnetTimer = MAGNET_DURATION_SEC;
  state.magnetStepTimer = MAGNET_STEP_SEC;
  saveInventory(state.inventory);
  return true;
}

// Arming is exclusive: two armed targeting modes at once would make the next
// tap ambiguous.
export function armBomb(state, armed) {
  if (armed && (state.inventory.bomb || 0) <= 0) return false;
  state.bombArmed = armed;
  if (armed) state.removerArmed = false;
  return true;
}

export function armRemover(state, armed) {
  if (armed && (state.inventory.remover || 0) <= 0) return false;
  state.removerArmed = armed;
  if (armed) state.bombArmed = false;
  return true;
}

export function consumeBomb(state) {
  if ((state.inventory.bomb || 0) <= 0) return false;
  state.inventory.bomb -= 1;
  state.bombArmed = false;
  saveInventory(state.inventory);
  return true;
}

export function consumeRemover(state) {
  if ((state.inventory.remover || 0) <= 0) return false;
  state.inventory.remover -= 1;
  state.removerArmed = false;
  saveInventory(state.inventory);
  return true;
}
