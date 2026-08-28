// Core tunable configuration for Poof Poof.
// Keeping every magic number here means physics.js / render.js / state.js
// can be edited independently without hunting for hardcoded values.

export const COLS = 6;
export const ROWS = 7;
export const CELL = 64; // px, size of one grid cell

export const BOARD_WIDTH = COLS * CELL;
export const BOARD_HEIGHT = ROWS * CELL;

export const HUD_HEIGHT = 96; // top area for score / coins / next-fruit preview
export const CANVAS_WIDTH = BOARD_WIDTH;
export const CANVAS_HEIGHT = HUD_HEIGHT + BOARD_HEIGHT;

// Tier progression: cherry -> grape -> lemon -> orange -> apple -> pear -> peach -> pineapple -> watermelon
//
// `shape` is per-tier on purpose rather than derived from the index, so the
// alternation can be broken for any single tier later without touching
// render.js. Valid values: 'circle' | 'flower'.
export const TIERS = [
  { name: 'cherry', color: '#e0435a', radius: 15, points: 1, shape: 'circle' },
  { name: 'grape', color: '#8e44ad', radius: 18, points: 3, shape: 'flower' },
  { name: 'lemon', color: '#f2d43d', radius: 21, points: 6, shape: 'circle' },
  { name: 'orange', color: '#f2960b', radius: 23, points: 10, shape: 'flower' },
  { name: 'apple', color: '#e0342a', radius: 25, points: 15, shape: 'circle' },
  { name: 'pear', color: '#b8d94f', radius: 27, points: 21, shape: 'flower' },
  { name: 'peach', color: '#f5a3ad', radius: 28, points: 28, shape: 'circle' },
  { name: 'pineapple', color: '#e2b23a', radius: 29, points: 36, shape: 'flower' },
  { name: 'watermelon', color: '#3fae5c', radius: 30, points: 45, shape: 'circle' },
];

export const MAX_TIER = TIERS.length - 1;

// Which tiers can spawn as a new falling fruit, and their relative odds.
export const SPAWN_POOL = [0, 0, 0, 1, 1, 2];

export const GRAVITY_PX_PER_SEC = 260;
export const SLOW_DROP_MULTIPLIER = 0.5;
export const DRAG_LERP = 0.35; // how quickly the falling fruit follows the pointer horizontally

export const WATERMELON_CLEAR_BONUS = 200;

export const COINS_PER_SCORE = 1 / 25; // score-to-coin conversion at run end

// --- Combo ---------------------------------------------------------------
// Every merge extends the window. Cascades within a single drop always chain
// (they resolve in one tick); chaining ACROSS drops has to be earned.
//
// Tuned against simulated runs: a fruit falling to an empty board takes ~1.7s,
// but only ~0.5s to a tall stack. A window below that spread means steady safe
// play breaks the streak, while playing with a high (dangerous) stack chains
// merges -- so the combo pays for risk instead of paying for patience. At 2.0s
// a competent player simply never dropped out of the streak and the multiplier
// degenerated into a flat 3x bonus.
export const COMBO_WINDOW_SEC = 1.2;
export const COMBO_STEP = 0.25; // multiplier gained per extra merge in the streak
export const COMBO_MAX_MULTIPLIER = 3;

// --- Skins ---------------------------------------------------------------
// Each skin supplies one color per tier, in tier order. Unlocks are checked
// against the player's best score, so a skin stays earned once earned.
//
// Thresholds are calibrated against 250-run simulations at three skill levels
// (median score: novice ~1000, casual ~3000, expert ~9000) so each skin lands
// at the next rung of the curve rather than all three falling out of one run:
//   Blossom  1000 -- a typical first-few-runs reward
//   Neon     3000 -- requires genuinely improving
//   Midnight 8000 -- expert territory, rare for a casual player
export const SKINS = [
  {
    id: 'classic',
    name: 'Classic',
    unlockScore: 0,
    colors: ['#e0435a', '#8e44ad', '#f2d43d', '#f2960b', '#e0342a', '#b8d94f', '#f5a3ad', '#e2b23a', '#3fae5c'],
  },
  {
    id: 'blossom',
    name: 'Blossom',
    unlockScore: 1000,
    colors: ['#ff8fab', '#c77dff', '#ffe066', '#ffb56b', '#ff6b81', '#c7f2a4', '#ffc2d1', '#ffd97d', '#7bd389'],
  },
  {
    id: 'neon',
    name: 'Neon',
    unlockScore: 3000,
    colors: ['#ff2e63', '#b026ff', '#f9f871', '#ff9f1c', '#ff1e56', '#adff2f', '#ff6ec7', '#ffd300', '#00f5a0'],
  },
  {
    id: 'midnight',
    name: 'Midnight',
    unlockScore: 8000,
    colors: ['#6c7ae0', '#8e6fd8', '#7fd1d9', '#5aa9e6', '#4c6ef5', '#63c7b2', '#a5b4fc', '#7dd3c0', '#2f9e8f'],
  },
];

export const DEFAULT_SKIN_ID = 'classic';

export const POWERUP_COSTS = {
  slowDrop: 30,
  remover: 20,
  extraRow: 50,
};

// Tap target for the mute toggle, in canvas space within the HUD.
export const MUTE_RECT = { x: BOARD_WIDTH - 34, y: 62, w: 26, h: 26 };

export const STORAGE_KEYS = {
  highScore: 'poofpoof.highScore',
  coins: 'poofpoof.coins',
  inventory: 'poofpoof.inventory',
  unlockedSkins: 'poofpoof.unlockedSkins',
  selectedSkin: 'poofpoof.selectedSkin',
  muted: 'poofpoof.muted',
};
