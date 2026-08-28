// Core tunable configuration for Poof Poof.
// Keeping every magic number here means physics.js / render.js / state.js
// can be edited independently without hunting for hardcoded values.

export const COLS = 6;
export const ROWS = 7;
export const CELL = 64; // px, size of one grid cell

export const BOARD_WIDTH = COLS * CELL;
export const BOARD_HEIGHT = ROWS * CELL;

export const HUD_HEIGHT = 118; // score / coins / combo / next preview + power-up bar
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

// --- Milestones ----------------------------------------------------------
// ONE source of truth for progression. Skins, power-up availability, and the
// visual theme all key off these same four stops -- adding a milestone here
// extends every gated system at once rather than needing a parallel ladder.
//
// Calibrated against 250-run simulations at three skill levels (median score:
// novice ~1000, casual ~3000, expert ~9000) so each stop lands on the next
// rung of the skill curve rather than all of them falling out of one run.
export const MILESTONE_SCORES = [0, 1000, 3000, 8000];

// --- Skins ---------------------------------------------------------------
// Each skin supplies one color per tier, in tier order. Unlocks are checked
// against the player's best score, so a skin stays earned once earned.
export const SKINS = [
  {
    id: 'classic',
    name: 'Classic',
    unlockScore: MILESTONE_SCORES[0],
    colors: ['#e0435a', '#8e44ad', '#f2d43d', '#f2960b', '#e0342a', '#b8d94f', '#f5a3ad', '#e2b23a', '#3fae5c'],
  },
  {
    id: 'blossom',
    name: 'Blossom',
    unlockScore: MILESTONE_SCORES[1],
    colors: ['#ff8fab', '#c77dff', '#ffe066', '#ffb56b', '#ff6b81', '#c7f2a4', '#ffc2d1', '#ffd97d', '#7bd389'],
  },
  {
    id: 'neon',
    name: 'Neon',
    unlockScore: MILESTONE_SCORES[2],
    colors: ['#ff2e63', '#b026ff', '#f9f871', '#ff9f1c', '#ff1e56', '#adff2f', '#ff6ec7', '#ffd300', '#00f5a0'],
  },
  {
    id: 'midnight',
    name: 'Midnight',
    unlockScore: MILESTONE_SCORES[3],
    colors: ['#6c7ae0', '#8e6fd8', '#7fd1d9', '#5aa9e6', '#4c6ef5', '#63c7b2', '#a5b4fc', '#7dd3c0', '#2f9e8f'],
  },
];

export const DEFAULT_SKIN_ID = 'classic';

// --- Power-ups -----------------------------------------------------------
// The original three stay available from the start so existing progression is
// unchanged; the three new ones unlock on the same milestones as the skins.
// `icon` names a vector drawn in icons.js -- no image files, matching how the
// fruit shapes are done.
export const POWERUPS = [
  {
    id: 'slowDrop', name: 'Slow Drop', cost: 30, unlockScore: 0, icon: 'slowDrop',
    desc: 'Fruits fall slower for one run.',
    usage: 'run', // toggled on before a run
  },
  {
    id: 'remover', name: 'Fruit Remover', cost: 20, unlockScore: 0, icon: 'remover',
    desc: 'Tap to delete one fruit mid-run.',
    usage: 'tap',
  },
  {
    id: 'extraRow', name: 'Extra Row', cost: 50, unlockScore: 0, icon: 'extraRow',
    desc: 'One extra row of headroom for one run.',
    usage: 'run',
  },
  {
    id: 'magnet', name: 'Magnet', cost: 40, unlockScore: MILESTONE_SCORES[1], icon: 'magnet',
    desc: 'Briefly draws matching fruit toward the one you are holding.',
    usage: 'activate',
  },
  {
    id: 'bomb', name: 'Bomb', cost: 60, unlockScore: MILESTONE_SCORES[2], icon: 'bomb',
    desc: 'Tap a cell to clear the fruit around it. No points awarded.',
    usage: 'tap',
  },
  {
    id: 'rainbow', name: 'Rainbow Fruit', cost: 80, unlockScore: MILESTONE_SCORES[3], icon: 'rainbow',
    desc: 'Drops a wild fruit that merges with whatever it touches.',
    usage: 'run',
  },
];

// Kept as a derived lookup so existing cost references keep working.
export const POWERUP_COSTS = Object.fromEntries(POWERUPS.map((p) => [p.id, p.cost]));

// --- Magnet --------------------------------------------------------------
// Grid-coherent pull: while active, the exposed (top-of-column) fruit matching
// the held fruit's tier slides ONE column closer, one step at a time. It never
// teleports fruit into a merge and never touches buried fruit.
export const MAGNET_DURATION_SEC = 6;
export const MAGNET_STEP_SEC = 0.45;

// --- Bomb ----------------------------------------------------------------
export const BOMB_RADIUS = 1; // Chebyshev radius: 1 => up to a 3x3 clear

// --- Rainbow -------------------------------------------------------------
// Sentinel stored in the grid alongside normal tier indices. Chosen well past
// MAX_TIER so it can never collide with a real tier.
export const RAINBOW_TIER = 99;
export const RAINBOW_DEF = { name: 'rainbow', color: '#ffffff', radius: 22, points: 0, shape: 'rainbow' };
export const RAINBOW_PER_CHARGE = 2; // wild fruits injected into a run per charge

// --- Merge feel ----------------------------------------------------------
// All three scale with tier so the visuals escalate in step with merge pitch.
export const SQUASH_DURATION_SEC = 0.26;
export const SQUASH_MIN = 0.18; // scale overshoot at tier 0
export const SQUASH_MAX = 0.42; // ...and at the top tier
export const PARTICLE_MIN = 5;
export const PARTICLE_MAX = 16;
export const PARTICLE_LIFE_SEC = 0.5;
export const PARTICLE_SPEED = 130;
export const PARTICLE_GRAVITY = 420;
export const SHAKE_MIN_TIER = 6; // top three tiers only (peach, pineapple, watermelon)
export const SHAKE_DURATION_SEC = 0.22;
export const SHAKE_MAX_PX = 5; // deliberately small -- readable, not disorienting

// Haptics, in ms. Only fires where navigator.vibrate exists.
export const HAPTIC_MERGE_MS = 12;
export const HAPTIC_TOP_TIER_MS = 45;

// --- Theme ---------------------------------------------------------------
// One palette per milestone; the live palette is interpolated continuously
// between them from the current run score, so the world warms up gradually
// instead of snapping at each threshold.
export const THEMES = [
  { page: '#2b1d14', board: '#fff6e8', text: '#3a2b20', grid: 'rgba(58,43,32,0.08)', accent: '#c0392b' },
  { page: '#3a2033', board: '#fff0f3', text: '#4a2436', grid: 'rgba(74,36,54,0.09)', accent: '#d6336c' },
  { page: '#1b2340', board: '#eef3ff', text: '#25325c', grid: 'rgba(37,50,92,0.10)', accent: '#4c6ef5' },
  { page: '#0d1f24', board: '#e8fbf6', text: '#12403a', grid: 'rgba(18,64,58,0.11)', accent: '#0ca678' },
];

// Tap target for the mute toggle, in canvas space within the HUD.
export const MUTE_RECT = { x: BOARD_WIDTH - 32, y: 58, w: 24, h: 24 };

// Power-up bar along the bottom of the HUD. Slots are laid out left to right;
// render.js and input.js both derive hit boxes from these so they cannot drift.
export const POWER_SLOT = { y: 86, size: 26, gap: 8, x0: 10 };

export function powerSlotRect(index) {
  return {
    x: POWER_SLOT.x0 + index * (POWER_SLOT.size + POWER_SLOT.gap),
    y: POWER_SLOT.y,
    w: POWER_SLOT.size,
    h: POWER_SLOT.size,
  };
}

export const STORAGE_KEYS = {
  highScore: 'poofpoof.highScore',
  coins: 'poofpoof.coins',
  inventory: 'poofpoof.inventory',
  unlockedSkins: 'poofpoof.unlockedSkins',
  selectedSkin: 'poofpoof.selectedSkin',
  muted: 'poofpoof.muted',
};
