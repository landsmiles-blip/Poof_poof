// Core tunable configuration for Poof Poof.
// Keeping every magic number here means physics.js / render.js / state.js
// can be edited independently without hunting for hardcoded values.

// Shown in the HUD and on the menu, and used to derive the service worker's
// cache name. Bump this on every deploy: it is the only way either a player or
// a developer can tell which build a browser is actually running, which is
// exactly the question that went unanswerable across three earlier deploys.
export const BUILD_VERSION = '2026.08.28-6';

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
// A fruit falling to an empty board takes ~1.66s; to a tall stack, ~0.4s.
//
// This was 1.2s, which sat BELOW the empty-board fall time and so made early
// combos arithmetically impossible: a new player could not chain across drops
// at all until a column was three high, and simulation put the first sighting
// of the combo meter at a median of drop 13.
//
// 1.8s sits just above one fall, which gives a clean, learnable rule: two
// merges in a row chain, and any drop that fails to merge breaks the streak
// (two falls is ~3.3s, well past the window). That keeps the multiplier honest
// -- it still measures merge consistency rather than mere patience, so it
// cannot degenerate into the permanent flat 3x an earlier 2.0s value produced
// -- while letting a first-run player actually see a combo.
export const COMBO_WINDOW_SEC = 1.8;
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

// Fixed spawn indices at which a charge's wilds arrive, decided once at run
// start. Both early enough that even a short run gets value from the charge --
// the whole point of paying for it.
//
// This replaces a 12% per-spawn roll that could simply fail to deliver: a paid
// 80-coin charge was consumed up front and then, in 7-28% of runs depending on
// length, produced nothing. A purchased consumable must never silently not
// arrive.
//
// Fixed rather than randomised within a band (an earlier version of this
// comment described bands, still randomised): a random offset made "was this
// run's charge ever refunded" impossible to reason about from the schedule
// alone, and two constants this small don't need randomising to keep runs from
// feeling identical. See endRun's refund: only a run that never reaches index
// 3 -- vanishingly rare -- delivers nothing and gets its charge back.
export const RAINBOW_SCHEDULE = [3, 8];

// --- Merge feel ----------------------------------------------------------
// All three scale with tier so the visuals escalate in step with merge pitch.
export const SQUASH_DURATION_SEC = 0.26;
// Floors raised from 0.18 / 5. A new player spends their whole first run on
// tier 0-2 merges, and at the old floor those produced ~6 small particles and a
// 21% squash -- technically present, but easy to miss entirely, which is most of
// why the merge feel went unnoticed. The top-end values are unchanged, so the
// escalation with tier still reads.
export const SQUASH_MIN = 0.26; // scale overshoot at tier 0
export const SQUASH_MAX = 0.42; // ...and at the top tier
export const PARTICLE_MIN = 9;
export const PARTICLE_MAX = 18;
export const PARTICLE_LIFE_SEC = 0.5;
export const PARTICLE_SPEED = 130;
export const PARTICLE_GRAVITY = 420;
export const SHAKE_MIN_TIER = 6; // top three tiers only (peach, pineapple, watermelon)
export const SHAKE_DURATION_SEC = 0.22;
export const SHAKE_MAX_PX = 5; // deliberately small -- readable, not disorienting

// How long a locked/out-of-stock power-up chip's tap flash stays lit.
export const LOCKED_FLASH_DURATION_SEC = 0.35;

// Haptics, in ms. Only fires where navigator.vibrate exists.
export const HAPTIC_MERGE_MS = 12;
export const HAPTIC_TOP_TIER_MS = 45;
// One deliberate pulse for a whole bomb detonation. Longer than a top-tier
// merge because clearing nine fruit is the biggest single thing a player can do.
export const HAPTIC_BOMB_MS = 70;

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

// Canvas text face. Single source of truth -- the family string used to be
// repeated verbatim in seven separate ctx.font assignments in render.js.
// system-ui is a fallback only; the face itself is self-hosted in assets/fonts.
export const FONT_FAMILY = "'Fredoka', system-ui, sans-serif";

// Clamp for the canvas backing store's device-pixel-per-logical-pixel ratio
// (js/main.js derives the actual value from window.devicePixelRatio; js/
// render.js reads it back from canvas.width at draw time, so nothing else
// needs to know the number itself). Unclamped DPR on a cheap 3x phone would
// triple fill-rate and memory for no visible gain, and the certification
// ceiling is a 512 MB JS heap, which Google attributes to iOS limits.
export const MIN_BACKING_SCALE = 1;
export const MAX_BACKING_SCALE = 3;

// The top-right HUD corner previously held the in-game master mute toggle
// (MUTE_RECT), removed in phase 3: Playables requirements prohibit an
// in-game master mute (the host has its own), and the Sound/Music buttons in
// the shop are the granular controls the requirements do permit. Left empty
// deliberately -- phase 6 has candidates -- do not fill it in the meantime.

// Power-up bar along the bottom of the HUD. Slots are laid out left to right;
// render.js and input.js both derive hit boxes from these so they cannot drift.
//
// y is chosen so the slot (y..y+size) AND the count label drawn beneath it both
// finish above HUD_HEIGHT -- at y=86 the digits spilled ~6px over the top of the
// board and sat still while the board shook beneath them.
export const POWER_SLOT = { y: 80, size: 26, gap: 8, x0: 10 };

export function powerSlotRect(index) {
  return {
    x: POWER_SLOT.x0 + index * (POWER_SLOT.size + POWER_SLOT.gap),
    y: POWER_SLOT.y,
    w: POWER_SLOT.size,
    h: POWER_SLOT.size,
  };
}

// The versioned save blob's shape version (js/platform.js). Bump when the
// blob's fields change shape in a way old saves can't just merge-default
// into; a version bump plus a branch in platform.js's load() is a non-event.
export const SAVE_VERSION = 1;

// Where localImpl (js/platform.js) persists the blob, and the seven
// independent keys a pre-platform save used -- read once, at migration, and
// never written again.
export const SAVE_KEY = 'poofpoof.save';
export const LEGACY_STORAGE_KEYS = {
  highScore: 'poofpoof.highScore',
  coins: 'poofpoof.coins',
  inventory: 'poofpoof.inventory',
  unlockedSkins: 'poofpoof.unlockedSkins',
  selectedSkin: 'poofpoof.selectedSkin',
  muted: 'poofpoof.muted',
  musicOn: 'poofpoof.musicOn',
};
