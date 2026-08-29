// Core tunable configuration for Poof Poof.
// Keeping every magic number here means physics.js / render.js / state.js
// can be edited independently without hunting for hardcoded values.

// Shown in the HUD and on the menu, and used to derive the service worker's
// cache name. Bump this on every deploy: it is the only way either a player or
// a developer can tell which build a browser is actually running, which is
// exactly the question that went unanswerable across three earlier deploys.
export const BUILD_VERSION = '2026.08.28-5';

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

export const GRAVITY_PX_PER_SEC = 260; // the baseline the ramp below reaches at drop GRAVITY_RAMP_DROPS_TO_BASE
export const SLOW_DROP_MULTIPLIER = 0.5;
export const DRAG_LERP = 0.35; // how quickly the falling fruit follows the pointer horizontally

// --- Difficulty ramp -------------------------------------------------------
// Found by playing rather than reading: gravity was a flat 260 px/s from the
// first drop of a run to the last -- a new player's first drop fell exactly
// as fast as an expert's hundredth. Keyed off state.spawnIndex (drops so
// far), not score: score already drives the milestones and the theme
// interpolation, and coupling a third system to it makes all three harder to
// reason about, whereas "the more you play" is exactly what a drop count
// measures. state.spawnIndex is reset to 0 in startRun, so the ramp resets
// with every run for free.
//
// A starting point, tuned by feel, not derived from simulation like the
// combo/milestone constants. The cap is load-bearing, not just restraint --
// see stepPhysics's dt clamp, which is what keeps even the capped speed free
// of any tunnelling risk. Do not remove it on the grounds that it "seems
// fine"; the clamp is what makes it fine.
//
// 8.2: the first version of this ramp reached today's baseline speed by drop
// 20 -- roughly ninety seconds in. That is not a ramp, it is a short runway,
// and it read as one immediately. Stretched hard: the opening is now eased
// in (see gravityRampMultiplier's `t ** GRAVITY_RAMP_EASE_POWER`, not a
// straight line) so the first ~15 drops are nearly flat before it starts
// climbing, baseline speed does not arrive until drop 40, and the cap -- now
// slightly lower, since a much longer runway needs a gentler ceiling to
// still feel like ONE curve -- is not reached until drop 120.
export const GRAVITY_RAMP_START_MULTIPLIER = 0.6;
export const GRAVITY_RAMP_BASE_MULTIPLIER = 1.0;
export const GRAVITY_RAMP_CAP_MULTIPLIER = 1.3;
export const GRAVITY_RAMP_DROPS_TO_BASE = 40;
export const GRAVITY_RAMP_DROPS_TO_CAP = 120;
// Power for the ease-in curve over [0, DROPS_TO_BASE]: quadratic. At 15/40 of
// the way through that stretch, an eased quadratic has covered only ~14% of
// the distance from START to BASE -- genuinely flat, not merely slower.
export const GRAVITY_RAMP_EASE_POWER = 2;

// The run ends when the spawn column's stack reaches the top; this is how
// many rows of headroom remain when the danger warning (render.js) starts
// pulsing that column's outline.
export const DANGER_ROWS_REMAINING = 2;

// prefers-reduced-motion (js/effects.js): shake and particles are cut
// entirely, but a merge should still read as a merge, so squash is scaled
// down rather than removed -- a much smaller pop, not a dead board.
export const REDUCED_MOTION_SQUASH_SCALE = 0.35;

// 7.2: against the brighter boards (milestones 0-2's light creams/pinks/
// lavenders), particle colours read as pale and linger -- "bursts turn to
// mush" per the brief. A touch more saturation and a shorter life keeps them
// popping rather than fading into the board. Only applied when the current
// board is bright (js/main.js decides via theme.js's relativeLuminance);
// the dark milestone-3 board doesn't need it.
export const PARTICLE_BRIGHT_VIBRANCE_BOOST = 1.35;
export const PARTICLE_BRIGHT_LIFE_SCALE = 0.8;

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
//
// Phase 6's gravity ramp broke this the moment gravity stopped being a
// constant: at the ramp's 0.7x starting speed, an empty-board fall takes
// ~2.5s, well past a flat 1.8s window -- the exact bug this comment
// describes, reintroduced for anyone playing their first thirty drops. So
// the window is no longer a constant; it is FALL_MULTIPLIER times whatever
// the CURRENT empty-board fall time is (see comboWindowSecFor in state.js),
// which reproduces today's 1.8s at today's 260 px/s gravity and preserves
// the same "just above one fall, below two" relationship at every point on
// the ramp instead of only at the ramp's baseline.
export const COMBO_WINDOW_FALL_MULTIPLIER = 1.08;
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
  // 6.7: every other skin separates tiers by hue alone, which is exactly what
  // collapses under deuteranopia/protanopia -- reds, greens and browns fold
  // together. Built from the Okabe-Ito palette (the standard reference for
  // colorblind-safe qualitative color), extended by two (grey, dark brown)
  // to cover all nine tiers, and varied in lightness as well as hue so two
  // adjacent tiers stay distinguishable even under red-green confusion.
  // Unlocked from the start, matching Classic: an accessibility option gated
  // behind score progress is not actually accessible to the player who needs
  // it on their first run.
  {
    id: 'clarity',
    name: 'Clarity',
    unlockScore: MILESTONE_SCORES[0],
    colors: ['#0072B2', '#E69F00', '#F0E442', '#D55E00', '#009E73', '#56B4E9', '#CC79A7', '#999999', '#5C4033'],
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
export const MAGNET_STEP_SEC = 0.45;

// 8.3: stop treating it as a consumable that ticks down invisibly -- it
// becomes a thing on the board, ridden along a rail across the top of the
// play area and dragged to whichever column it should pull toward, with its
// own energy instead of a fixed timer. "Always present, never simply spent":
// energy drains only while it is actually pulling a matching fruit, and
// regenerates whenever it is idle (no match in reach, or nothing currently
// falling to match against) -- a patient player who is not constantly
// finding a match can keep it out far longer than one spamming it into
// every column, rather than a hard countdown that ends regardless of use.
export const MAGNET_ENERGY_MAX = 100;
export const MAGNET_DRAIN_PER_SEC = 12.5; // empties in 8s of continuous pulling
export const MAGNET_REGEN_PER_SEC = 25; // refills in 4s of continuous idling
// Height of the draggable rail strip at the top of the board, and how
// quickly the drawn puck glides toward wherever it was last dragged --
// reuses DRAG_LERP's own smoothing feel (see js/physics.js's setDragTarget)
// so the two draggable things in the game move consistently.
export const MAGNET_RAIL_HEIGHT = 22;
// 7.3: a magnet-moved fruit used to snap a full 64px cell between two frames,
// which read as a rendering glitch rather than attraction -- the grid stays
// authoritative (this never changes stepMagnet's actual mechanics), only the
// DRAW position eases from the old column to the new one, the same way
// squash already lags the grid for a merge pop. Comfortably shorter than
// MAGNET_STEP_SEC so one slide always finishes before the same fruit could
// plausibly be picked up again.
export const MAGNET_SLIDE_DURATION_SEC = 0.22;

// 7.3: bomb footprint + detonation ring, remover crosshair, rainbow spin --
// all drawn in js/render.js, on top of the board so arming or activating a
// power-up changes what the board itself looks like, not just a HUD chip.
export const BOMB_RING_DURATION_SEC = 0.35;
export const REMOVER_CROSSHAIR_SIZE = 0.7; // fraction of CELL
export const RAINBOW_SPIN_RADIANS_PER_SEC = 0.8;

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

// How long a chip's "you just earned this" pulse lasts (8.1). Longer than the
// locked-flash above and a distinct visual (see render.js) -- this is a
// reward, not a denial, and should read as one.
export const CHIP_PULSE_DURATION_SEC = 0.6;

// Haptics, in ms. Only fires where navigator.vibrate exists.
export const HAPTIC_MERGE_MS = 12;
export const HAPTIC_TOP_TIER_MS = 45;
// One deliberate pulse for a whole bomb detonation. Longer than a top-tier
// merge because clearing nine fruit is the biggest single thing a player can do.
export const HAPTIC_BOMB_MS = 70;
// A charge earned mid-run (8.1) is a reward moment, not a hazard -- a single
// crisp tick, shorter than the bomb's but distinct from a plain merge's.
export const HAPTIC_CHARGE_EARNED_MS = 30;

// --- Merge meter (8.1) -----------------------------------------------------
// Power-ups used to be inventory, not play: coins arrive only at endRun and
// get spent only before the NEXT run, so during the run where a player is
// actually in trouble, nothing can arrive to help. This meter fills as you
// merge and grants a free, run-scoped charge on every fill -- the reward loop
// moves inside the run it rewards.
//
// Fill is weighted by tier using TIERS[].points directly (already a tuned
// per-tier scale, 1..45) rather than a second parallel weight table. At those
// weights, MERGE_METER_MAX is a starting point tuned by feel: roughly ten to
// fifteen mixed merges per fill, so a run sees a handful of grants rather than
// zero or ten.
export const MERGE_METER_MAX = 75;

// --- Theme ---------------------------------------------------------------
// One palette per milestone; the live palette is interpolated continuously
// between them from the current run score, so the world warms up gradually
// instead of snapping at each threshold. 7.2: a day turning to night -- warm
// and forgiving at the start, sweet and saturated once the rhythm is there,
// cooling and heightening as it tightens, finally a dark board where the
// fruit glow. Each board is two stops (top/bottom), blended as a vertical
// gradient in js/render.js and js/style.css, not a flat fill.
//
// THE LANDMINE: stop 2 is dark ink on a light board; stop 3 is light ink on a
// dark board. `text` here is NOT interpolated directly between them -- lerping
// a dark-ink hex toward a light-ink hex arrives at the same mid-grey the
// board itself passes through at t=0.5, and the score readout disappears
// exactly there. js/theme.js's themeForScore() derives text from the CURRENT
// interpolated board's own relative luminance instead (light board -> dark
// ink, dark board -> light ink), with a hysteresis band so it does not
// flicker right at the crossover, and only falls back to plain interpolation
// within a segment where both endpoints already agree on which ink reads
// (stops 0-1-2, all light boards, safe to blend their tuned per-stop hues).
// See unit-tests/theme-contrast.js, which samples the whole 0-10000 score
// range and asserts text-on-board contrast never drops below 4.5:1.
export const THEMES = [
  { boardTop: '#FFF6EA', boardBot: '#FFE4CB', page: '#2A1A12', text: '#4A3122', grid: 'rgba(74,49,34,0.08)', accent: '#F2960B' },
  { boardTop: '#FFF1F4', boardBot: '#FFD6E2', page: '#3A1526', text: '#5A2438', grid: 'rgba(90,36,56,0.09)', accent: '#E8368F' },
  { boardTop: '#F3EEFF', boardBot: '#D9CCFF', page: '#1E1338', text: '#3A2A6B', grid: 'rgba(58,42,107,0.10)', accent: '#7C4DFF' },
  { boardTop: '#1E2947', boardBot: '#0C1122', page: '#05080F', text: '#D2E6FF', grid: 'rgba(210,230,255,0.12)', accent: '#00D9C0' },
];

// Fixed, non-interpolated -- appears nowhere except the danger state (6.2).
// One colour, one meaning. Milestone 0 used to spend an alarm red (#c0392b)
// on its resting-state accent, which is why the game had nothing left to
// shout with; that accent is now the warm orange above, and this is the only
// red in the game.
export const DANGER_COLOR = '#FF3B30';

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
