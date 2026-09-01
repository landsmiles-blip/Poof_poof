// Game state container + lifecycle transitions (menu -> playing -> gameover/shop).
// No rendering, input, or audio logic here, just plain data and state transitions.

import {
  COLS, ROWS, CELL, SPAWN_POOL, COINS_PER_SCORE, TIERS,
  COMBO_WINDOW_FALL_MULTIPLIER, COMBO_STEP, COMBO_MAX_MULTIPLIER,
  SKINS, DEFAULT_SKIN_ID, POWERUPS, MILESTONE_SCORES,
  RAINBOW_TIER, RAINBOW_DEF, RAINBOW_SCHEDULE, BOMB_TIER, BOMB_DEF,
  LOCKED_FLASH_DURATION_SEC, SAVE_VERSION, MERGE_METER_MAX, CHIP_PULSE_DURATION_SEC,
  GRAVITY_PX_PER_SEC, GRAVITY_RAMP_START_MULTIPLIER, GRAVITY_RAMP_BASE_MULTIPLIER,
  GRAVITY_RAMP_CAP_MULTIPLIER, GRAVITY_RAMP_DROPS_TO_BASE, GRAVITY_RAMP_DROPS_TO_CAP,
  GRAVITY_RAMP_EASE_POWER,
} from './constants.js';

// --- Difficulty ramp -------------------------------------------------------
// Lives here rather than physics.js so state.js can stay the single source of
// truth for anything comboWindowSecFor also needs -- physics.js already
// imports from state.js, and the reverse would be a cycle.
//
// START -> BASE over [0, DROPS_TO_BASE] (8.2: eased in, not linear -- nearly
// flat for the first ~15 drops of that stretch, then climbing), then BASE ->
// CAP over [DROPS_TO_BASE, DROPS_TO_CAP] (still linear -- only the opening
// needed to feel generous), flat at CAP after that.
export function gravityRampMultiplier(spawnIndex) {
  const drops = Math.max(0, spawnIndex);
  if (drops >= GRAVITY_RAMP_DROPS_TO_CAP) return GRAVITY_RAMP_CAP_MULTIPLIER;
  if (drops >= GRAVITY_RAMP_DROPS_TO_BASE) {
    const t = (drops - GRAVITY_RAMP_DROPS_TO_BASE) / (GRAVITY_RAMP_DROPS_TO_CAP - GRAVITY_RAMP_DROPS_TO_BASE);
    return GRAVITY_RAMP_BASE_MULTIPLIER + (GRAVITY_RAMP_CAP_MULTIPLIER - GRAVITY_RAMP_BASE_MULTIPLIER) * t;
  }
  const t = drops / GRAVITY_RAMP_DROPS_TO_BASE;
  const eased = t ** GRAVITY_RAMP_EASE_POWER;
  return GRAVITY_RAMP_START_MULTIPLIER + (GRAVITY_RAMP_BASE_MULTIPLIER - GRAVITY_RAMP_START_MULTIPLIER) * eased;
}

export function currentGravityPxPerSec(state) {
  return GRAVITY_PX_PER_SEC * gravityRampMultiplier(state.spawnIndex);
}

// Time for a fruit to fall the full board height at a given gravity -- the
// "empty-board fall" the combo-window comment in constants.js refers to.
// The +TIERS[0].radius term is the same one the pre-existing "Combo
// multiplier" e2e test used: a fruit's centre travels to rows-1 cells plus
// half a cell plus its own radius before its bottom edge reaches the floor.
//
// 10.2 LANDMINE, found by the phase's own required grep sweep before
// touching ROWS: this used to read the ROWS *constant* directly instead of
// effectiveRows(state) -- correct for a normal run, silently wrong for one
// with Extra Row active, where the board is genuinely ROWS+1 tall. The
// combo window would then be derived from a fall one row SHORTER than the
// one actually happening, undermining the exact "window > one real fall"
// invariant this function exists to guarantee. Takes rows as a parameter
// (not effectiveRows(state) directly) so this stays a pure function of its
// inputs, callable from a test with any row count without needing a full
// state object.
function emptyBoardFallSec(gravityPxPerSec, rows) {
  const distance = (rows - 1) * CELL + CELL / 2 + TIERS[0].radius;
  return distance / gravityPxPerSec;
}

// See the extended COMBO_WINDOW_FALL_MULTIPLIER comment in constants.js: the
// window must track the CURRENT (ramped) gravity, not a fixed one, or the
// early, slower part of the ramp falls outside it again -- and now also the
// CURRENT board height, for the same reason (see emptyBoardFallSec above).
export function comboWindowSecFor(state) {
  return emptyBoardFallSec(currentGravityPxPerSec(state), effectiveRows(state)) * COMBO_WINDOW_FALL_MULTIPLIER;
}

const DEFAULT_INVENTORY = {
  slowDrop: 0, remover: 0, extraRow: 0, swap: 0, bomb: 0, rainbow: 0,
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
    // 9.3: true while the run is frozen for ANY reason -- a host-driven pause
    // (platform.onPause) or the in-game pause panel, both funnelled through
    // main.js's shared pauseRun()/resumeRun() so there is exactly one place
    // that ever sets this. js/input.js gates all keyboard/pointer handling
    // on it; main.js's loop() gates re-arming its own requestAnimationFrame
    // on it. Never persisted -- a save always resumes unpaused.
    paused: false,

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

    // Cell the pointer is currently over while the remover (or, since 10.1,
    // Swap) is armed -- purely a render/input hint for whichever gesture is
    // currently in progress; never persisted. Written directly by
    // js/input.js, not through a state.js mutator: it carries no game-state
    // meaning of its own, the same way `dragging` in input.js's own closure
    // never needed one either. The bomb stopped using this in 8.4 -- it
    // plants as a falling fruit instead of an armed tap-target.
    armPreviewCell: null,
    // 8.4: true from the moment a bomb is planted until it actually
    // detonates (or is defused early -- see spawnFruit's fuse check),
    // covering falling, resting, and counting down as ONE state so only one
    // can ever be in play. bombFuseDrops is null until it lands (see
    // lockFruit) and counts DOWN, not time, toward zero.
    bombInPlay: false,
    bombFuseDrops: null,

    // 10.1: Swap. armSwap toggles this like armRemover; the first tap on an
    // occupied cell while armed fills swapSelectedCell (persists ACROSS
    // separate gestures, unlike armPreviewCell above, which is per-gesture)
    // and a second tap on an adjacent occupied cell performs the swap.
    swapArmed: false,
    swapSelectedCell: null,

    rainbowSchedule: [],
    rainbowChargeSpent: false,
    rainbowDelivered: 0,
    spawnIndex: 0,
    lockedFlash: null, // { id, t } while a locked/out-of-stock chip is flashing

    // 8.1: fills as you merge (see fillMergeMeter) and grants a free,
    // run-scoped charge on every fill. Deliberately separate from
    // `inventory`: these never persist and are discarded at endRun -- see
    // the long comment on grantEarnedCharge for why that separation matters.
    mergeMeter: 0,
    earnedCharges: { remover: 0, swap: 0, bomb: 0 },
    chipPulse: null, // { id, t } while a chip is announcing an earned charge

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
export function toSaveBlob(state, { musicOn, sfxOn, hapticsOn }) {
  return {
    v: SAVE_VERSION,
    highScore: state.highScore,
    coins: state.coins,
    inventory: state.inventory,
    unlockedSkins: state.unlockedSkins,
    selectedSkin: state.selectedSkin,
    musicOn,
    sfxOn,
    hapticsOn,
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
// learn power-ups existed at all, and planting the Bomb -- which decrements
// stock to zero -- made its own chip disappear at the instant of use, so its
// fuse countdown ran with no indicator anywhere on screen.
export function hudPowerUps() {
  return POWERUPS.filter((p) => p.usage === 'tap' || p.usage === 'activate');
}

// Whether a chip is actually actionable right now. Rendering asks hudPowerUps()
// what to draw; input asks this what a tap may do. Keeping them separate is what
// lets a locked chip be visible but inert.
export function canUsePowerUp(state, item) {
  if (!isUnlockedByScore(item, state.highScore)) return false;
  // 8.1: purchased stock and this run's earned charges are both spendable --
  // see consumeCharge for which one actually gets decremented first.
  return ((state.inventory[item.id] || 0) + (state.earnedCharges[item.id] || 0)) > 0;
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

// 14.1: the colour of ANY tier, sentinels included. skinColor above indexes
// straight into a nine-entry palette, so it answers `undefined` for the
// rainbow (99) and the bomb (98) -- correct for what it is, useless to a
// caller that only has "a tier".
//
// This exists because there were TWO copies of that wrapper: render.js's
// colorFor handled both sentinels, main.js's colorForTier handled only the
// rainbow. The bomb branch was simply missing from one of them, and the
// consequence was not cosmetic -- see docs/phase14-1brief.md. Two copies of a
// lookup eventually disagree, and the copy that disagrees is the one nobody
// is looking at. There is now one, here, beside the palette it reads.
//
// In state.js rather than render.js because it is a pure read of state plus
// constants with no drawing in it, and main.js should not have to import the
// renderer to ask what colour something is.
export function tierColor(state, tierIndex) {
  if (tierIndex === RAINBOW_TIER) return RAINBOW_DEF.color;
  if (tierIndex === BOMB_TIER) return BOMB_DEF.color;
  return skinColor(state, tierIndex);
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
  state.comboTimer = comboWindowSecFor(state);
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

// --- Merge meter / earned charges (8.1) -----------------------------------
// The problem this solves: power-ups were inventory, not play. Coins arrive
// only at endRun and get spent only before the NEXT run, so during the run
// where a player is actually in trouble, nothing could arrive to help. This
// meter fills as you merge and grants a free charge on every fill, moving the
// reward loop inside the run it rewards.

// Which power-ups a merge can possibly earn: unlocked, and usable mid-run
// (the same tap/activate set hudPowerUps() draws a chip for -- earning a
// charge for a 'run' power-up like Slow Drop would be unusable until the
// NEXT run anyway, defeating the entire point of this mechanic).
function earnableCandidates(state) {
  return hudPowerUps().filter((p) => isUnlockedByScore(p, state.highScore));
}

// Deliberately separate from buyPowerUp: earned charges are NOT inventory.
// They live in state.earnedCharges, never touch state.dirty (nothing
// persisted changed), and startRun/endRun both discard them unconditionally.
// If earned charges entered `inventory` instead, the shop would stop meaning
// anything -- coins would no longer be the only way to build permanent stock.
function grantEarnedCharge(state) {
  const candidates = earnableCandidates(state);
  // Never actually empty in practice -- Fruit Remover unlocks at score 0 --
  // but a meter with nothing eligible to grant must not throw.
  if (candidates.length === 0) return;
  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  state.earnedCharges[pick.id] = (state.earnedCharges[pick.id] || 0) + 1;
  state.chipPulse = { id: pick.id, t: 0 };
  // main.js turns this into a rising sound + haptic tick -- physics/state
  // stay free of audio imports, as everywhere else events are used for this.
  state.events.push({ type: 'chargeEarned', id: pick.id });
}

// Called from physics.js's mergeCells on every merge that is not part of a
// suppressed (bomb-cascade) cascade -- same gate registerComboHit's caller
// already applies to the combo streak, for the same anti-farming reason: a
// bomb clears the board with no further player input, so letting its
// cascade also fill this meter would make detonating free charges.
export function fillMergeMeter(state, tier) {
  state.mergeMeter += TIERS[tier].points;
  while (state.mergeMeter >= MERGE_METER_MAX) {
    state.mergeMeter -= MERGE_METER_MAX;
    grantEarnedCharge(state);
  }
}

export function tickChipPulse(state, dt) {
  if (!state.chipPulse) return;
  state.chipPulse.t += dt;
  if (state.chipPulse.t >= CHIP_PULSE_DURATION_SEC) state.chipPulse = null;
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
  state.bombInPlay = false;
  state.bombFuseDrops = null;
  state.swapArmed = false;
  state.swapSelectedCell = null;
  state.lockedFlash = null;
  state.paused = false;

  // 8.1: a fresh run starts with an empty meter and no earned charges,
  // regardless of what the previous run left behind -- see endRun, which
  // also clears these the instant a run ends, and the acceptance test that
  // checks inventory is byte-identical across a run with charges earned.
  state.mergeMeter = 0;
  state.earnedCharges = { remover: 0, swap: 0, bomb: 0 };
  state.chipPulse = null;

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
  // 8.1: earned charges are run-scoped and must never survive to the next
  // run or leak into anything persisted -- explicit here (not left to the
  // next startRun) so "gone the instant the run ends" is true even before
  // another run begins.
  state.mergeMeter = 0;
  state.earnedCharges = { remover: 0, swap: 0, bomb: 0 };
  state.chipPulse = null;
  state.bombInPlay = false;
  state.bombFuseDrops = null;
  state.removerArmed = false;
  state.swapArmed = false;
  state.swapSelectedCell = null;
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

// 8.1: total spendable stock for one power-up id -- purchased inventory plus
// whatever this run has earned. Arming and canUsePowerUp both need this same
// combined figure, so it lives in one place.
function totalCharges(state, id) {
  return (state.inventory[id] || 0) + (state.earnedCharges[id] || 0);
}

// Spends one charge for `id`, preferring the run-scoped earned pool first: it
// evaporates at endRun regardless of whether it gets used, so spending it
// ahead of permanent stock never costs the player anything, and it means a
// rescue charge is never wasted while paid-for stock sits untouched.
// state.dirty is set only when inventory (persisted) actually changes --
// spending an earned charge changes nothing that needs saving.
function consumeCharge(state, id) {
  if ((state.earnedCharges[id] || 0) > 0) {
    state.earnedCharges[id] -= 1;
    return true;
  }
  if ((state.inventory[id] || 0) > 0) {
    state.inventory[id] -= 1;
    state.dirty = true;
    return true;
  }
  return false;
}

// Remover and Swap (10.1) are the only two power-ups that both aim at a
// board cell via armPreviewCell and commit on release -- arming one while
// the other is already armed would make a single tap resolve as BOTH
// (remove the cell AND attempt a swap against it) since onPointerUp checks
// each independently. Arming either one here disarms the other, so only one
// "aiming mode" can ever be live at a time.
export function armRemover(state, armed) {
  if (armed && totalCharges(state, 'remover') <= 0) return false;
  state.removerArmed = armed;
  if (armed) {
    state.swapArmed = false;
    state.swapSelectedCell = null;
  }
  return true;
}

export function consumeRemover(state) {
  if (!consumeCharge(state, 'remover')) return false;
  state.removerArmed = false;
  return true;
}

// 10.1: Swap, same arm/consume shape as the Remover -- including disarming
// the Remover in turn (see armRemover's own comment on why only one
// board-aiming tool may ever be armed at once). Arming (and re-arming after
// a completed swap) never marks state.dirty -- it is transient, not
// persisted. Clears swapSelectedCell whenever the armed state changes so a
// stale selection from a previous arm-cycle can never carry over into a new
// one.
export function armSwap(state, armed) {
  if (armed && totalCharges(state, 'swap') <= 0) return false;
  state.swapArmed = armed;
  state.swapSelectedCell = null;
  if (armed) state.removerArmed = false;
  return true;
}

export function consumeSwap(state) {
  if (!consumeCharge(state, 'swap')) return false;
  state.swapArmed = false;
  state.swapSelectedCell = null;
  return true;
}

// 8.4: plants a bomb as the next thing to drop -- instead of arm-then-tap, it
// falls and is steered like any other fruit, then detonates on its own where
// it sits once the fuse (physics.js's spawnFruit/lockFruit) ends. Only one
// may ever be in play (bombInPlay covers the whole lifecycle: falling,
// resting, and counting down), so a second tap while one is already out is a
// no-op.
export function plantBomb(state) {
  if (state.bombInPlay) return false;
  if (!consumeCharge(state, 'bomb')) return false;
  state.bombInPlay = true;
  if (state.active) {
    state.active.tier = BOMB_TIER;
  } else {
    state.nextTier = BOMB_TIER;
  }
  return true;
}
