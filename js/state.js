// Game state container + lifecycle transitions (menu -> playing -> gameover/shop).
// No rendering, input, or audio logic here, just plain data and state transitions.

import {
  COLS, ROWS, SPAWN_POOL, COINS_PER_SCORE,
  COMBO_WINDOW_SEC, COMBO_STEP, COMBO_MAX_MULTIPLIER,
  SKINS, DEFAULT_SKIN_ID, POWERUPS, MILESTONE_SCORES,
  MAGNET_DURATION_SEC, MAGNET_STEP_SEC, RAINBOW_TIER, RAINBOW_SCHEDULE,
  LOCKED_FLASH_DURATION_SEC, SAVE_VERSION,
} from './constants.js';

const DEFAULT_INVENTORY = {
  slowDrop: 0, remover: 0, extraRow: 0, magnet: 0, bomb: 0, rainbow: 0,
};

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

// `save` is the blob platform.load() resolved to (or null/undefined for a
// genuinely fresh player) -- this function never touches storage itself. See
// toSaveBlob() for the inverse: state -> the shape platform.save() persists.
export function createInitialState(save) {
  const blob = save || {};
  const dev = devModeEnabled();
  const storedHigh = Number.isFinite(blob.highScore) ? blob.highScore : 0;
  const highScore = dev ? Math.max(storedHigh, MILESTONE_SCORES[MILESTONE_SCORES.length - 1]) : storedHigh;
  const storedSkins = Array.isArray(blob.unlockedSkins) ? blob.unlockedSkins : [DEFAULT_SKIN_ID];
  const unlockedSkins = reconcileUnlocks(storedSkins, highScore);
  const selectedSkin = validSkinId(blob.selectedSkin || DEFAULT_SKIN_ID, unlockedSkins);
  const storedInventory = (blob.inventory && typeof blob.inventory === 'object')
    ? { ...DEFAULT_INVENTORY, ...blob.inventory }
    : { ...DEFAULT_INVENTORY };
  const { inventory, freshGrant } = startingInventory(dev, storedInventory, storedHigh);

  return {
    screen: SCREEN.MENU,
    highScore,
    coins: Number.isFinite(blob.coins) ? blob.coins : 0,
    inventory,
    // Only true when this boot just granted the starter Remover -- nothing
    // else about loading a save is a change that needs writing back out.
    // Every later mutator below sets this the same way; main.js's loop is the
    // only place that ever reads and clears it.
    dirty: freshGrant,

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
    rainbowSchedule: [],
    rainbowChargeSpent: false,
    rainbowDelivered: 0,
    spawnIndex: 0,
    lockedFlash: null, // { id, t } while a locked/out-of-stock chip is flashing

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
//
// Pure: this used to persist the grant itself (saveInventory), but state.js no
// longer touches storage at all. Returns freshGrant so createInitialState can
// mark state.dirty -- persisting is conditional on an actual change, not
// unconditional on every boot.
function startingInventory(dev, storedInventory, storedHigh) {
  const inv = { ...storedInventory };
  if (dev) {
    for (const p of POWERUPS) inv[p.id] = Math.max(inv[p.id] || 0, 5);
    return { inventory: inv, freshGrant: false };
  }
  const isFreshSave = Object.values(inv).every((n) => !n) && storedHigh === 0;
  if (isFreshSave) inv.remover = 1;
  return { inventory: inv, freshGrant: isFreshSave };
}

// The inverse of reading `save` in createInitialState: shapes the current
// state into the blob platform.save()/platform.flush() persist. Audio/music
// flags live outside `state` (js/audio.js, js/music.js own them), so the
// caller passes them in rather than this function reaching for those modules
// -- state.js stays free of audio imports.
export function toSaveBlob(state, { musicOn, sfxOn }) {
  return {
    v: SAVE_VERSION,
    highScore: state.highScore,
    coins: state.coins,
    inventory: state.inventory,
    unlockedSkins: state.unlockedSkins,
    selectedSkin: state.selectedSkin,
    musicOn,
    sfxOn,
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

// Decides the tier for the fruit that will spawn at state.spawnIndex --
// called both for the very first spawn (startRun) and, one spawn ahead of
// time, at the end of every spawnFruit() call. Deciding it here, before it is
// ever shown as the "Next" preview, is what makes the preview honest: nothing
// downstream is allowed to override state.nextTier once this has run.
//
// Mutates state.rainbowSchedule (shifting off the claimed index) so a slot is
// never reconsidered, independent of whether that fruit ever actually spawns
// -- see endRun's refund, which tracks *delivery* separately.
export function nextTierFor(state) {
  const schedule = state.rainbowSchedule;
  if (schedule && schedule.length > 0 && schedule[0] === state.spawnIndex) {
    schedule.shift();
    return RAINBOW_TIER;
  }
  return randomSpawnTier();
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
  state.dirty = true;
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

// --- Locked power-up tap feedback ----------------------------------------
// A tap on a locked/out-of-stock chip changes no board state, so unlike the
// remover or bomb this has no physics event to ride -- input.js pushes the
// 'lockedPowerUp' event straight onto state.events itself, and main.js's
// drainEvents calls triggerLockedFlash in response.

export function triggerLockedFlash(state, id) {
  state.lockedFlash = { id, t: 0 };
}

export function tickLockedFlash(state, dt) {
  if (!state.lockedFlash) return;
  state.lockedFlash.t += dt;
  if (state.lockedFlash.t >= LOCKED_FLASH_DURATION_SEC) state.lockedFlash = null;
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

  // Rainbow charges are spent up front and delivered on a fixed schedule, so a
  // paid charge always arrives. Previously this set a 12% per-spawn roll that
  // could deliver nothing at all. rainbowChargeSpent/rainbowDelivered track,
  // independent of the schedule array itself, whether this run owes a refund
  // -- see endRun.
  state.rainbowSchedule = (useRainbow && state.inventory.rainbow > 0)
    ? [...RAINBOW_SCHEDULE]
    : [];
  state.rainbowChargeSpent = state.rainbowSchedule.length > 0;
  state.rainbowDelivered = 0;
  if (state.rainbowChargeSpent) state.inventory.rainbow -= 1;
  state.spawnIndex = 0;

  state.removerArmed = false;
  state.bombArmed = false;
  state.magnetActive = false;
  state.magnetTimer = 0;
  state.magnetStepTimer = 0;
  state.lockedFlash = null;

  state.grid = makeEmptyGrid(effectiveRows(state));
  state.stackHeight = new Array(COLS).fill(0);
  state.score = 0;
  state.active = null;
  state.nextTier = nextTierFor(state);
  state.gameOverReason = null;
  state.newlyUnlockedSkins = [];
  state.newlyUnlockedPowerUps = [];
  state.events.length = 0;
  state.bestComboThisRun = 0;
  resetCombo(state);
  state.screen = SCREEN.PLAYING;
  state.dirty = true; // inventory (slowDrop/extraRow/rainbow) may have changed
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
  }

  const earned = Math.floor(state.score * COINS_PER_SCORE);
  state.lastRunCoinsEarned = earned;
  state.coins += earned;

  // Refund a Rainbow charge only when the run ended having delivered NOTHING.
  // Refunding on partial delivery (one of two wilds) would be farmable: buy a
  // charge, take the first wild at spawn 3, end the run on purpose, get the
  // coins back, repeat. Zero-delivery-only closes that; with wilds scheduled
  // at spawn indices 3 and 8, a zero-delivery run should be rare.
  if (state.rainbowChargeSpent && state.rainbowDelivered === 0) {
    state.inventory.rainbow = (state.inventory.rainbow || 0) + 1;
  }

  // main.js calls persistNow() (immediate, not debounced) right after this --
  // set unconditionally anyway so nothing else has to know that.
  state.dirty = true;
}

export function buyPowerUp(state, key, cost) {
  if (state.coins < cost) return false;
  state.coins -= cost;
  state.inventory[key] = (state.inventory[key] || 0) + 1;
  state.dirty = true;
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
  state.dirty = true;
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
  state.dirty = true;
  return true;
}

export function consumeRemover(state) {
  if ((state.inventory.remover || 0) <= 0) return false;
  state.inventory.remover -= 1;
  state.removerArmed = false;
  state.dirty = true;
  return true;
}
