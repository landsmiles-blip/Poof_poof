// Core tunable configuration for Poof Poof.
// Keeping every magic number here means physics.js / render.js / state.js
// can be edited independently without hunting for hardcoded values.

// Shown in the HUD and on the menu, and used to derive the service worker's
// cache name. Bump this on every deploy: it is the only way either a player or
// a developer can tell which build a browser is actually running, which is
// exactly the question that went unanswerable across three earlier deploys.
export const BUILD_VERSION = '2026.08.28-17';

export const COLS = 6;
// 11.1: back to 7. 10.2 cut this to 5 to force the danger state to fire more
// often -- the observation behind that (a seven-row board's top half sits
// empty in ordinary play) was correct, and the fix was not.
//
// Two things a simulation of danger-state frequency could not see. The fall
// from spawn to an empty floor is ~(ROWS - 0.5) * CELL + radius; at 5 rows
// that is ~310px / ~1.19s against 7 rows' ~438px / ~1.68s. That fall is not
// dead time -- it is the entire steering interaction, and 10.2 removed 29%
// of it. And css/style.css sizes the canvas from 384 / (HUD_HEIGHT + ROWS *
// CELL); on a phone the width term always wins, so FEWER rows makes the game
// physically SHORTER on screen: 51% of a 390x844 phone at 5 rows against 65%
// at 7. That file's own 9.9 comment says so in as many words.
//
// The original complaint stands and is NOT addressed here. If the board
// should feel tighter, the levers are the gravity ramp and SPAWN_POOL, not
// the ceiling -- lowering the ceiling punishes the player for merging well,
// which is the one thing the game is asking them to do. Do not re-shrink
// this to fix difficulty.
//
// 14: 7 -> 10. This is the THIRD time this constant has moved (7 -> 5 ->
// 7 -> 10), so it carries its evidence rather than an opinion.
//
// Against the genre, measured from the games' own published boards rather
// than from memory:
//
//   Tetris (Guideline)   10 x 20 visible  1:2.0
//   Puyo Puyo             6 x 12          1:2.0
//   Dr. Mario             8 x 11..16      1:1.4 .. 1:2.0
//   Poof Poof at 7 rows   6 x 7           1:1.17   <- shortest of the lot
//   Poof Poof at 10 rows  6 x 10          1:1.67   <- inside the range
//
// Every successful faller is roughly twice as tall as it is wide. Ours was
// not, and the two complaints this phase answers -- "the fruit dropping
// from every which way is not making sense" and "is it supposed to cover
// all the way to the floor of the phone" -- are both downstream of that one
// number. A short board cannot afford a fixed spawn column (see
// chooseSpawnColumn in js/physics.js); a tall one can, which is why Puyo has
// had one since 1991.
//
// Against the screen, computed from css/style.css's ACTUAL sizing formula
// (min(100vw - 16, min(100vh - 16, 1600) * ratio)), not estimated:
//
//   rows   390x844   412x915   375x667 (SE)   fruit cell (390 / 412 / SE)
//    7       65%       64%        79%          62.3 / 66.0 / 59.8 px
//    8       73%       71%        88%          62.3 / 66.0 / 59.8 px
//    9       80%       78%        97%          62.3 / 66.0 / 55.9 px
//   10       87%       85%        98%          62.3 / 66.0 / 55.0 px
//   12       98%       98%        98%          59.8 / 64.9 / 47.0 px
//
// The load-bearing row is that the FRUIT DOES NOT SHRINK up to ten rows on
// an ordinary phone. The canvas is six columns wide whatever the row count,
// width is the binding constraint on a phone, so extra rows consume
// currently-empty backdrop rather than cell size. Twelve rows is where the
// height term finally wins and the fruit starts shrinking; ten is the last
// stop before that, which is why it is ten and not twelve.
//
// YouTube Playables' design requirements say a game SHOULD fill the
// viewport, and MUST otherwise be centred with pillarbox/letterbox. We were
// compliant at 65% via the second clause. At 87% we satisfy the first.
//
// KNOWN CONSEQUENCE, not hidden: an empty-board fall goes from ~1.66s to
// ~2.40s at baseline gravity, and ~2.76s to ~3.99s at the ramp's slow
// opening. GRAVITY_PX_PER_SEC is deliberately NOT touched to compensate --
// see its own comment, and §5 of docs/phase14brief.md for the measurement
// that decision rests on. Do not "fix" the fall time without re-measuring.
export const ROWS = 10;
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

// 14 DELIBERATELY DID NOT TOUCH THIS, and the reasoning is here rather than
// in a commit message because the temptation to "fix" it will recur.
//
// ROWS 7 -> 10 made the board 45% taller, so a fall to an empty floor takes
// 45% longer at the same speed. Measured in the browser, spawn to the next
// spawn on the very first drop of a fresh run: 2426ms at 7 rows, 3675ms at
// 10. That is a real cost and it lands on the worst possible drop -- the
// first one a new player ever sees -- because the gravity ramp's eased
// opening (GRAVITY_RAMP_START_MULTIPLIER, 0.6x) is ALSO at its slowest
// there. The two gentle-opening mechanisms now stack.
//
// Scaling this constant by the board height would hold time-to-land
// constant, and that is arguably the better long-term shape for it. It was
// not done here for two reasons. First, one lever at a time: changing the
// board's size and the fall's speed in the same phase makes it impossible to
// tell which one is responsible for how the result plays. Second, the
// genre's own answer to "the natural fall is slow" is not faster gravity, it
// is a drop control -- every faller has a soft drop and a hard drop, and so
// does this one (js/physics.js's hardDrop) except that it is bound to the
// keyboard only. On a phone, the platform this is being certified for, there
// is currently no way to skip the wait at all.
//
// So the honest fix is a touch drop control, not a bigger number here. If
// the opening reads as sluggish, reach for that first.
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

// 12.2: the danger warning's headroom, applied to EVERY column rather than
// only the spawn column. 14 restored the fixed spawn column but NOT the
// old game-over rule, so this still stands: the run ends when the last
// column fills, so any column can be the one that ends it, and there is no
// single column to warn about.
export const DANGER_ROWS_REMAINING = 2;

// --- Where a fruit comes from (12.2, revised by 14) ------------------------
// Two separate rules, changed together in 12.2 and separated again in 14.
// They are separate and the distinction is the whole point:
//
//   A. WHICH COLUMN a fruit arrives in.
//   B. WHEN THE RUN ENDS.
//
// Before 12.2 both were "column 3". Every fruit spawned at
// Math.floor(COLS / 2) and isGameOver read that one column and nothing else.
// Measured in the real game, touching nothing: six runs, median 13.5s, every
// single one ending on stacks 0,0,0,7,0,0 -- seventeen percent of the board
// used, five columns completely empty, run over.
//
// 12.2 fixed that by changing BOTH rules: a uniform random spawn column, and
// a whole-board game over. It worked on the numbers (13.5s median to still
// alive past 150s) and it was wrong on the feel, in the player's own words:
// "the fruit dropping from every which way is not making sense."
//
// They are right, and the genre agrees. Puyo Puyo has spawned every pair at
// one fixed column since 1991, marks that square on the board, and ends the
// run when it fills. Tetris spawns in a fixed centred position. NONE of them
// spawn at random. What made a fixed spawn unbearable here was not the fixed
// spawn -- it was rule B, plus a UI failure: we never showed the player which
// column mattered. Puyo draws its death square from second one; we drew
// nothing.
//
// So 14 keeps rule B's fix and reverts rule A:
//
//   A. The spawn column is FIXED at Math.floor(COLS / 2), and the board
//      draws the chute above it (js/render.js's drawSpawnChute) so it is
//      never a hidden rule. When that column is genuinely full the spawn is
//      redirected outward to the nearest column with room -- and the chute
//      moves with it, so the marker is never a lie.
//   B. The run still ends only when NO column has room. Five empty columns
//      never count for nothing again.
//
// Deterministic, so the chute can be drawn from the same function the spawn
// uses -- see spawnColumnFor in js/physics.js, which both call. Two
// implementations of "where does the next fruit go" would eventually
// disagree, and the one the player can see would be the one that was wrong.
// A floor on how long the player has between a fruit appearing and it
// landing. If the natural fall is shorter than this, the fruit holds at the
// top of its column for the difference before gravity engages; if it is
// already longer, nothing happens at all.
//
// A floor rather than a flat delay, deliberately. A flat 0.3s hold on every
// drop would add roughly ninety seconds of pure waiting to a three-hundred
// drop run and slow the whole game down to fix a problem that only exists on
// short falls. It costs nothing on an empty board (a fall to the floor of a
// ten-row board takes ~2.4s) and pays out exactly where the fall is short.
//
// 12.2 introduced this to cover the 30-38% of drops a RANDOM spawn column
// dropped over a nearly-full column. 14's fixed spawn cuts that back to the
// 8-13% a fixed column produces, so it now fires much more rarely -- but it
// is kept, not reverted, because the case it covers still exists and is
// nastier now: a fruit arriving over a tall CENTRE column, or redirected
// onto a tall neighbour, is exactly where the player most needs the time.
//
// The player can steer during the hold -- that is the entire point. It is
// reaction time, not a pause.
export const SPAWN_MIN_REACTION_SEC = 0.8;

// --- The chute (14) --------------------------------------------------------
// The marker over the spawn column. Puyo draws a red X on its death square;
// we deliberately do not, for one hard reason: DANGER_COLOR's own comment
// says it "appears nowhere except the danger state -- one colour, one
// meaning," and the chute is a RESTING-state fact, not a warning. Spending
// the game's only red on something that is true for the whole run would
// leave nothing to shout with, which is exactly the mistake milestone 0's
// old alarm-red accent made.
//
// So the chute is drawn in theme.text -- the ink already chosen to read
// against the current board, on light boards and dark ones alike -- at an
// alpha low enough to sit under the fruit rather than compete with them.
// The escalation is then free and unambiguous: quiet ink while the column
// has room, drawDangerState's red over the top of it when it does not.
export const SPAWN_CHUTE_TINT_ALPHA = 0.055; // column wash at the top edge, fading to 0
export const SPAWN_CHUTE_FADE_ROWS = 2; // ...over this many rows
export const SPAWN_CHUTE_MARK_ALPHA = 0.30; // the chevron and the two lip ticks
export const SPAWN_CHUTE_MARK_INSET = 7; // px from the column's side walls to a lip tick

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
// 13.2: was [0, 1000, 3000, 8000]. Those were calibrated against simulated
// runs (median score: novice ~1000, casual ~3000, expert ~9000) -- against a
// BOT, which never misreads the board and never fumbles a drag. Measured
// against a real player the ladder was simply out of reach: a personal best
// of 2,127 means stops 2 and 3 had never once been seen, so the Dusk and
// Midnight palettes, the Bomb and the Rainbow Fruit were all built, tested,
// shipped -- and invisible. Content nobody can reach is content that does
// not exist.
//
// Halved and then some. At a 2,127 best the player now sits inside stop 2
// (Dusk + Bomb) immediately, with stop 3 one good run away rather than four
// times their lifetime best.
//
// PROVISIONAL, and say so out loud: phase 12.2 (the spawn column) will
// lengthen runs and therefore raise every score in the game. These four
// numbers must be re-checked against real scores once that lands, not left
// to drift. They are deliberately one line so that re-check is cheap.
export const MILESTONE_SCORES = [0, 500, 1500, 4000];

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
//
// `desc` must describe the power-up's ACTUAL current behaviour. A redesign
// that changes what a power-up does has to update this in the SAME commit --
// found stale once already (9.8: the Magnet's copy still described a
// design two redesigns gone). Copy that lies is worse than no copy.
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
    id: 'swap', name: 'Swap', cost: 40, unlockScore: MILESTONE_SCORES[1], icon: 'swap',
    desc: 'Tap two adjacent fruit to trade places.',
    usage: 'tap',
  },
  {
    id: 'bomb', name: 'Bomb', cost: 60, unlockScore: MILESTONE_SCORES[2], icon: 'bomb',
    desc: 'Plants as your next drop. Clears a 3x3 blast when its fuse ends.',
    usage: 'activate',
  },
  {
    id: 'rainbow', name: 'Rainbow Fruit', cost: 80, unlockScore: MILESTONE_SCORES[3], icon: 'rainbow',
    desc: 'Drops a wild fruit that merges with whatever it touches.',
    usage: 'run',
  },
];

// Kept as a derived lookup so existing cost references keep working.
export const POWERUP_COSTS = Object.fromEntries(POWERUPS.map((p) => [p.id, p.cost]));

// --- Swap ------------------------------------------------------------------
// 10.1: replaces the Magnet entirely. The Magnet did what dragging already
// does -- help a fruit reach a chosen column -- and no implementation of
// that idea was ever going to be more than a slower duplicate of a control
// that already exists for free. Swap acts on the board AFTER a fruit has
// landed, which dragging fundamentally cannot do, and has no per-frame
// behaviour at all: it is a single, instant grid mutation, gated by the same
// adjacency rule merges already use. No tunable constants of its own -- see
// js/physics.js's swapFruits.

// 7.3: bomb footprint + detonation ring, remover crosshair, rainbow spin --
// all drawn in js/render.js, on top of the board so arming or activating a
// power-up changes what the board itself looks like, not just a HUD chip.
export const BOMB_RING_DURATION_SEC = 0.35;
export const REMOVER_CROSSHAIR_SIZE = 0.7; // fraction of CELL
export const RAINBOW_SPIN_RADIANS_PER_SEC = 0.8;

// --- Bomb ----------------------------------------------------------------
export const BOMB_RADIUS = 1; // Chebyshev radius: 1 => up to a 3x3 clear

// 8.4: instead of arm-then-tap, the bomb drops into the board like a fruit,
// with a lit fuse that burns down over a few DROPS (not wall-clock time --
// js/physics.js's spawnFruit decrements it, so it only burns while the game
// is actually being played, and a run does not lose a bomb to idling). It
// detonates automatically, wherever it currently sits, when the fuse ends.
//
// A second sentinel alongside RAINBOW_TIER, and just as dangerous: pairTier
// must reject it BEFORE the rainbow wildcard check, or a held/board rainbow
// would treat the bomb as mergeable. See physics.js's pairTier and the tests
// named after this comment.
export const BOMB_TIER = 98;
export const BOMB_DEF = { name: 'bomb', color: '#2b2118', radius: 27, points: 0, shape: 'bomb' };
export const BOMB_FUSE_DROPS = 4;

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

// 13.1: the DISPLAY face, used for the wordmark on the menu and nothing
// else. Deliberately NOT wired into FONT_FAMILY above: every ctx.font in
// js/render.js reads that one constant, and the HUD layout is tuned to
// Fredoka's exact metrics -- see POWER_SLOT's comment about digits spilling
// over the board edge at y=86. Pointing FONT_FAMILY at a different face
// would silently move every number in the HUD. Canvas keeps Fredoka; this
// is a DOM-only face. SIL OFL, self-hosted beside Fredoka (assets/fonts).
export const DISPLAY_FONT_FAMILY = "'Titan One', 'Fredoka', system-ui, sans-serif";

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

// 9.3: the pause control. Same size and vertical band as the power-up chips
// (POWER_SLOT.y), right-aligned instead of left -- the whole y:80-106 strip
// on the right side of the HUD is otherwise empty (the chips occupy the
// left, "Next" and its preview fruit sit well above at y:6-68), verified
// against the actual drawHUD layout rather than assumed.
export function pauseButtonRect() {
  return {
    x: CANVAS_WIDTH - POWER_SLOT.x0 - POWER_SLOT.size,
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

// --- Board panel (11.2) -----------------------------------------------------
// js/render.js's drawFrame gives the play area a defined top edge: a shadow
// cast onto the board below the HUD, and a highlight along the seam. §4.1 of
// docs/phase11brief.md also specified a tint across the HUD strip itself,
// but the crossing segment's text/board contrast (unit-tests/theme-contrast.js)
// sits only 0.06 above the 4.5:1 floor with NO tint at all, and any tint
// strength greater than zero can only move a board colour further from its
// own ink (never closer -- the tint always pushes toward whichever colour
// is NOT the current ink). No strength could reach the brief's required 0.3
// margin; confirmed by sweeping alpha down to 0.01 and finding the worst
// case still below 4.65:1. Per the brief's own §5.2 decision tree, the tint
// was dropped entirely -- this section intentionally holds no tint alpha
// constants.

// --- Backdrop (11.2) ---------------------------------------------------------
// js/background.js: a lit ground, a halo behind the board, drifting
// decorative fruit silhouettes, and a page-level vignette, all on a
// full-viewport canvas behind #app. See docs/phase11brief.md section 3.
// 13.3: one flat population of shapes drifting UPWARD is replaced by three
// depth bands falling DOWNWARD.
//
// Two ideas, both taken from the reference image of Tetris blocks tumbling
// through a sunset. First, they fall: the backdrop becomes a slower, larger
// echo of the thing the player is actually doing, instead of decoration that
// happens to move. Second, depth is built from SCALE and SPEED, not from
// alpha alone -- small/faint/slow reads as far away, large/faster/tumbling
// reads as close, and the near band passing behind the board panel is what
// sells it. Uniform sizes drifting at a uniform speed cannot read as depth
// no matter how they are coloured.
//
// 18 shapes total, up from 16. Still one soft-gradient canvas at DPR 1
// redrawn ~15 times a second; the cost difference is not measurable.
export const BG_BANDS = [
  // far: barely there, the parallax floor
  { count: 8, minRadius: 10, maxRadius: 22, alpha: 0.045, minSpeed: 4, maxSpeed: 8, spin: 0.05, pops: false },
  { count: 6, minRadius: 28, maxRadius: 48, alpha: 0.070, minSpeed: 10, maxSpeed: 18, spin: 0.12, pops: true },
  // near: large, faster, visibly tumbling -- the band that creates the depth
  { count: 4, minRadius: 62, maxRadius: 112, alpha: 0.095, minSpeed: 24, maxSpeed: 40, spin: 0.22, pops: true },
];

// 13.4: every so often one of the bigger shapes puffs out of existence --
// a quick fade with a soft expanding ring behind it, then it is back. The
// game is called Poof Poof and its one verb is "two things meet and vanish";
// the backdrop should say that too, not merely drift.
//
// Deliberately rare. Periods are spread across this range per shape, and
// only the mid and near bands pop (see `pops` above), which works out at
// roughly one puff every three seconds somewhere on a phone screen -- often
// enough to notice while waiting on the menu, rare enough that it never
// becomes the thing you are looking at instead of the game.
export const BG_POP_MIN_PERIOD_SEC = 18;
export const BG_POP_MAX_PERIOD_SEC = 40;
export const BG_POP_DURATION_SEC = 0.9;
export const BG_POP_RING_SCALE = 2.4; // ring grows to this x the shape's radius
export const BG_HALO_PEAK_ALPHA = 0.13; // brief: "keep it under 0.15"

// 13.3: the Midnight stop's page colour is #05080F -- already all but black.
// Darkening it a further BG_GROUND_DARKEN erases the ground gradient, the
// drifting shapes and most of the halo, so the best-looking board in the
// game arrives on a dead backdrop exactly when the player is most invested.
// Rather than special-case one theme index, both values are interpolated by
// how dark the page colour ALREADY is (js/background.js reads its relative
// luminance), so a future palette gets the same treatment for free.
export const BG_DARK_PAGE_LUMINANCE = 0.02; // at or below this, fully "dark"
export const BG_DARK_GROUND_DARKEN = 0.08;  // instead of BG_GROUND_DARKEN
export const BG_DARK_HALO_PEAK_ALPHA = 0.18; // instead of BG_HALO_PEAK_ALPHA
// 0.24 first time out. Midnight's accent is a teal (#00D9C0) and at that
// strength over a near-black page the whole surround took on a green cast
// -- atmospheric, but reading as a colour wash rather than as light.
export const BG_DARK_HALO_MID_ALPHA = 0.075; // instead of BG_HALO_MID_ALPHA
export const BG_HALO_MID_ALPHA = 0.05; // the wider, fainter of the two passes

// 14: BG_HALO_RADIUS_SCALE (0.9 x the board's own diagonal, as one radial
// gradient centred on the board) is GONE, and a measurement killed it rather
// than a preference.
//
// A radial gradient centred on the board falls off over a distance set by
// the BOARD's size -- but the only part of it anyone can see is the margin
// AROUND the board, and ROWS 7 -> 10 shrank that margin on a 390x844 phone
// from 146px to 53px while making the board's diagonal larger. Sampling the
// backdrop canvas itself up the centre line, screen edge to board edge:
//
//    7 rows:  rgb(57,43,32) -> rgb(71,51,34)   largest channel step: 14
//   10 rows:  rgb(60,45,32) -> rgb(63,47,32)   largest channel step:  3
//
// Three levels across the whole visible strip is not a glow, it is a flat
// tint. The board would have arrived at 87% of the screen sitting on a
// backdrop that had quietly stopped doing its job.
//
// So the halo is no longer a gradient sized by the board; it is a glow that
// hugs the board's rectangle, with a falloff length -- the SPILL -- measured
// in pixels. That is independent of how big the board is, which is the whole
// point: a future ROWS change cannot flatten it again.
//
// Measured again after the change, the same way: a spread of 13 across the
// visible strip at 10 rows, against the 7-row build's 14. The glow is back
// to the strength it had before the board grew.
//
// The spill grows with whatever margin is actually there (a desktop window
// has hundreds of pixels of surround and should get a broad glow; a phone
// has fifty and should get a rim), with a floor so the phone case still
// clears the board's own 24px CSS drop shadow, and a ceiling because
// shadowBlur's cost scales with the blurred AREA.
//
// That ceiling is 240 because it was measured, not because it is a round
// number. Whole-backdrop redraw cost, forced to flush -- Chromium's canvas
// is GPU-backed and queues draw calls, so timing the calls alone reports a
// meaningless 0.10ms -- against the ~66ms one redraw gets at
// BG_MIN_REDRAW_INTERVAL_SEC's ~15fps:
//
//   ceiling   phone 390x844   desktop 1280x800
//   (before)     4.03 ms          10.19 ms      <- the old radial halo
//     320        3.75 ms          26.94 ms
//     240        3.78 ms          20.61 ms      <- here
//     180        3.78 ms          17.77 ms
//
// The phone -- the certification target, and the only place the low-end GPU
// and the 512 MB heap actually bite -- is unaffected at every ceiling,
// because its spill is set by the FLOOR above and never reaches this. The
// ceiling exists only so a desktop does not spend 27ms of every redraw on a
// gradient, and 240 keeps the broad desktop glow while giving back most of
// the cost. See drawHalo in js/background.js.
export const BG_HALO_MIN_SPILL_PX = 90;
export const BG_HALO_MAX_SPILL_PX = 240;
export const BG_HALO_SPILL_SCALE = 1.6; // x the larger of the two margins around the board
export const BG_HALO_INNER_SPILL_SCALE = 0.45; // the tighter, brighter of the two passes
export const BG_GROUND_LIGHTEN = 0.10; // top of the ground gradient, from theme.page
export const BG_GROUND_DARKEN = 0.30; // bottom of the ground gradient, from theme.page
export const BG_VIGNETTE_INNER_SCALE = 0.30; // x outer radius, transparent inside this
export const BG_VIGNETTE_OUTER_SCALE = 0.78; // x max(viewport width, height)
export const BG_VIGNETTE_EDGE_ALPHA = 0.45;
// ~15fps: redraw only if this much time has passed since the last frame.
// 13.3: even the near band's fastest shapes (BG_BANDS, up to 40px/s) move
// under 3px between redraws at this rate, so there is nothing to gain from
// matching the board's own 60fps loop.
export const BG_MIN_REDRAW_INTERVAL_SEC = 0.066;
// Fixed, not time-seeded: the decorative layout must be identical on every
// load so a screenshot diff against it means something.
export const BG_SHAPE_SEED = 0x9E3779B9;
