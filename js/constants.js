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
export const TIERS = [
  { name: 'cherry', color: '#e0435a', radius: 15, points: 1 },
  { name: 'grape', color: '#8e44ad', radius: 18, points: 3 },
  { name: 'lemon', color: '#f2d43d', radius: 21, points: 6 },
  { name: 'orange', color: '#f2960b', radius: 23, points: 10 },
  { name: 'apple', color: '#e0342a', radius: 25, points: 15 },
  { name: 'pear', color: '#b8d94f', radius: 27, points: 21 },
  { name: 'peach', color: '#f5a3ad', radius: 28, points: 28 },
  { name: 'pineapple', color: '#e2b23a', radius: 29, points: 36 },
  { name: 'watermelon', color: '#3fae5c', radius: 30, points: 45 },
];

export const MAX_TIER = TIERS.length - 1;

// Which tiers can spawn as a new falling fruit, and their relative odds.
export const SPAWN_POOL = [0, 0, 0, 1, 1, 2];

export const GRAVITY_PX_PER_SEC = 260;
export const SLOW_DROP_MULTIPLIER = 0.5;
export const DRAG_LERP = 0.35; // how quickly the falling fruit follows the pointer horizontally

export const WATERMELON_CLEAR_BONUS = 200;

export const COINS_PER_SCORE = 1 / 25; // score-to-coin conversion at run end

export const POWERUP_COSTS = {
  slowDrop: 30,
  remover: 20,
  extraRow: 50,
};

export const STORAGE_KEYS = {
  highScore: 'poofpoof.highScore',
  coins: 'poofpoof.coins',
  inventory: 'poofpoof.inventory',
};
