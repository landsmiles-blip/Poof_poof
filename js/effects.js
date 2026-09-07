// Transient merge feedback: squash-and-stretch, particle bursts, screen shake,
// and haptics. Purely presentational -- nothing here affects game state, so a
// dropped or skipped effect can never change the outcome of a run.
//
// Intensity scales with tier across the board, mirroring the way merge pitch
// already climbs, so a watermelon merge reads as bigger than a cherry merge in
// every channel at once.

import {
  CELL, HUD_HEIGHT, MAX_TIER,
  SQUASH_DURATION_SEC, SQUASH_MIN, SQUASH_MAX,
  PARTICLE_MIN, PARTICLE_MAX, PARTICLE_LIFE_SEC, PARTICLE_SPEED, PARTICLE_GRAVITY,
  SHAKE_MIN_TIER, SHAKE_DURATION_SEC, SHAKE_MAX_PX,
  HAPTIC_MERGE_MS, HAPTIC_TOP_TIER_MS, REDUCED_MOTION_SQUASH_SCALE,
  PARTICLE_BRIGHT_VIBRANCE_BOOST, PARTICLE_BRIGHT_LIFE_SCALE,
  BOMB_RING_DURATION_SEC, LEVEL_CALLOUT_SEC,
} from './constants.js';

// Crude vibrance boost: pushes each channel away from the colour's own grey
// point (its average) by a fixed factor. Cheaper than a full hex->hsl->hex
// round trip and good enough for the small nudge 7.2 asks for -- this is not
// meant to hit an exact saturation percentage, just to keep particle colours
// from reading as pale against the brighter boards.
function boostVibrance(hex, factor) {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const avg = (r + g + b) / 3;
  const push = (c) => Math.max(0, Math.min(255, Math.round(avg + (c - avg) * factor)));
  const toHex = (c) => c.toString(16).padStart(2, '0');
  return `#${toHex(push(r))}${toHex(push(g))}${toHex(push(b))}`;
}

export function createEffects() {
  return {
    squashes: [], // { row, col, t, duration, amount }
    particles: [], // { x, y, vx, vy, t, life, color, size }
    shake: { t: 0, duration: 0, magnitude: 0 },
    // 21: fruit that have already left the grid but have not popped yet --
    // see spawnGhost and js/render.js's drawGhosts.
    ghosts: [],
    bombRings: [], // { x, y, t, duration } -- 7.3
    levelCallout: null, // the callout SHOWING now -- 15, see triggerLevelUp
    // 21.1: the ones waiting their turn. Until now this was a single slot and
    // every trigger simply assigned to it, so two callouts in one event batch
    // meant one of them was never seen. Proven, not theorised: a drop that
    // both levels up and crosses a milestone puts levelUp and unlocked in the
    // SAME batch, main.js drains them in order, and the unlock silently ate
    // the level-up. Level 3 makes it worse -- the floor starts, the first
    // stone arrives and the level-up fires together.
    calloutQueue: [], // [{ callout, priority }]
  };
}

// 21.1: how a callout gets in line.
//
// The shake is deliberately NOT queued -- it stays on the event that caused
// it, because a jolt arriving 1.2s after the board moved would read as a
// glitch. Only the words wait.
//
// Priority decides who loses when several arrive at once. A level-up happens
// again next level; an unlock or a teach happens ONCE in the player's life,
// so those must never be the ones dropped.
const CALLOUT_PRIORITY = { level: 0, unlock: 1, teach: 2 };
const CALLOUT_QUEUE_MAX = 2; // pending, so at most 3 x 1.2s of callout in a row

function pushCallout(fx, callout) {
  const entry = { callout, priority: CALLOUT_PRIORITY[callout.kind] ?? 0 };
  if (!fx.levelCallout) {
    fx.levelCallout = callout;
    return;
  }
  fx.calloutQueue.push(entry);
  while (fx.calloutQueue.length > CALLOUT_QUEUE_MAX) {
    // Drop the least important thing waiting -- which may be the one just
    // added. Last index among equals, so the oldest of a tie survives.
    let worst = 0;
    for (let i = 1; i < fx.calloutQueue.length; i++) {
      if (fx.calloutQueue[i].priority <= fx.calloutQueue[worst].priority) worst = i;
    }
    fx.calloutQueue.splice(worst, 1);
  }
}

// 15: the level-up reaction's two purely-visual pieces (the sound and the
// haptic are main.js's job, same seam as every other event). Ambient shake
// during ordinary play was rejected in docs/phase15-spec.md section 6.2 --
// shake already means "you just did something big," and a level change is
// exactly the kind of instant that is true of, not a state to hold shake
// under. A single pulse here, not a comparison against the current shake the
// way spawnMergeEffects' top-tier pulse is (that one only grows if the new
// hit is bigger; this one always fires, since a level-up is not competing
// with a merge for "biggest thing on screen right now" -- it wins by
// definition).
//
// Reduced motion cuts the shake (mirroring spawnMergeEffects' own gate) but
// NOT the callout -- js/render.js still draws it, fading without scaling, per
// docs/phase15-spec.md section 6.3. The sound and haptic are unaffected
// either way; only motion is what this preference asks to remove.
export function triggerLevelUp(fx, level) {
  if (!reducedMotion) {
    fx.shake.t = 0;
    fx.shake.duration = SHAKE_DURATION_SEC;
    fx.shake.magnitude = SHAKE_MAX_PX;
  }
  pushCallout(fx, { kind: 'level', level, t: 0 });
}

// 20: the same callout, carrying an unlock instead of a level. Reuses the
// whole envelope, shake and draw path rather than growing a second one -- the
// only difference on screen is what it says and that it names the reward on a
// second line. Fired the instant the score crosses the threshold; see
// announceUnlocks in js/state.js.
export function triggerUnlock(fx, name) {
  if (!reducedMotion) {
    fx.shake.t = 0;
    fx.shake.duration = SHAKE_DURATION_SEC;
    fx.shake.magnitude = SHAKE_MAX_PX;
  }
  pushCallout(fx, { kind: 'unlock', unlock: name, t: 0 });
}

// 21.1: the same envelope again, carrying a rule the player has to be told
// once. There is no shake and no sound of its own: a teach rides an event
// that already made a noise (a floor rise, a stone cracking), and stacking a
// third cue on top of those reads as chaos rather than emphasis.
//
// Why this exists at all: 21 put a grey slab on the board that never merges
// and breaks only when a merge lands beside it. The second half of that rule
// is not discoverable by accident inside a five-minute session, and an
// unexplained thing appearing on the board is the exact complaint this phase
// was built to fix. Reviewed and reported as a gap in the phase 21 diff, and
// it was right.
export function triggerTeach(fx, title, line) {
  pushCallout(fx, { kind: 'teach', teach: title, line, t: 0 });
}

// Expanding ring on a bomb detonation -- the loudest action in the game
// otherwise had no visual beyond the particle bursts per cleared cell.
// 21: a fruit that a merge has already removed from the grid, still drawn at
// the spot it was in, until its link of the chain actually pops.
//
// This is the half of the cascade fix that matters. The grid still resolves a
// whole chain inside one frame -- physics stays synchronous and the entire
// difficulty design depends on it -- but the PLAYER now sees the chain travel,
// because each fruit waits its turn to disappear instead of all of them going
// at once. `delay` is the same staged offset the burst uses, so a fruit and
// its own confetti always leave together.
export function spawnGhost(fx, { x, y, tier, color, delay }) {
  if (delay <= 0) return;            // nothing to hold back
  fx.ghosts.push({ x, y, tier, color, t: -delay });
}

export function spawnBombRing(fx, x, y) {
  fx.bombRings.push({ x, y, t: 0, duration: BOMB_RING_DURATION_SEC });
}

let hapticsOn = true;

// Sets the flag from the loaded save (main.js's boot, before the first
// frame). This module never reads storage itself -- see js/platform.js.
export function hydrate(save) {
  hapticsOn = save ? save.hapticsOn !== false : true;
}

export function isHapticsOn() {
  return hapticsOn;
}

export function toggleHaptics() {
  hapticsOn = !hapticsOn;
  return hapticsOn;
}

// Read once at startup, the same as devicePixelRatio -- an OS-level
// accessibility preference, not a player-facing toggle like sound, music or
// haptics, so there is no in-game control for it. Feature-checked and
// swallowed the same way vibrate() is below: an environment with no
// matchMedia (or one that throws under a restrictive permissions policy)
// simply gets full motion, matching how those environments behaved before
// this existed.
let reducedMotion = false;
try {
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }
} catch {
  reducedMotion = false;
}

export function isReducedMotion() {
  return reducedMotion;
}

// Test-only: unit tests run under plain Node, with no window/matchMedia to
// read a real preference from.
export function _setReducedMotion(value) {
  reducedMotion = value;
}

// 0 at tier 0, 1 at the top tier.
function tierRatio(tier) {
  return Math.max(0, Math.min(1, tier / MAX_TIER));
}

// `silent: true` skips the haptic only -- visuals still fire. Used when a batch
// of bursts is spawned in one frame (a bomb clears up to nine cells): each
// navigator.vibrate() cancels the one in flight, so nine calls would collapse
// into a single arbitrary-length tick decided by whichever cell the scan
// visited last. The caller fires one deliberate pulse for the whole batch
// instead. Mirrors the state.suppressCombo pattern used for the same reason.
// 20: `delay` staggers this burst by that many seconds, used to play a merge
// CHAIN out in the order it happened -- see CASCADE_STEP_SEC in constants.js.
// Implemented as a negative start time rather than a queue: every effect
// already has a clock, so "not yet" is just t < 0, and updateEffects/
// squashScaleAt/drawParticles each skip an effect that has not started.
export function spawnMergeEffects(fx, { row, col, tier, color, silent = false, x, y, bright = false, delay = 0 }) {
  const ratio = tierRatio(tier);
  const squashScale = reducedMotion ? REDUCED_MOTION_SQUASH_SCALE : 1;

  fx.squashes.push({
    row,
    col,
    // Recorded so the lookup can reject a cell whose contents changed. During a
    // cascade, settleColumns can drop a different fruit into a cell that still
    // has a live squash, and matching on position alone made that fruit inherit
    // a pop it never earned.
    tier,
    t: -delay,
    duration: SQUASH_DURATION_SEC,
    amount: (SQUASH_MIN + (SQUASH_MAX - SQUASH_MIN) * ratio) * squashScale,
  });

  // Reduced motion: no particles, no shake -- a merge should still register
  // (the squash above still fires, just smaller), but the moving, flying
  // pieces are exactly what the preference asks to remove.
  if (reducedMotion) {
    if (!silent) vibrate(tier >= SHAKE_MIN_TIER ? HAPTIC_TOP_TIER_MS : HAPTIC_MERGE_MS);
    return;
  }

  const count = Math.round(PARTICLE_MIN + (PARTICLE_MAX - PARTICLE_MIN) * ratio);
  // Prefer the caller's own frozen (x, y) when it has one -- see the comment
  // on mergeCells in physics.js for why row/col alone is not safe here during
  // a cascade. Callers with no cascade risk (remover, bomb) just pass row/col.
  const cx = x ?? (col * CELL + CELL / 2);
  const cy = y ?? (row * CELL + CELL / 2);
  // Against the brighter boards, plain particle colours read as pale and
  // linger -- a touch more vibrance and a shorter life keeps a burst popping
  // rather than turning to mush (7.2). Decided by the caller (js/main.js),
  // not looked up here, so this module stays free of a theme.js dependency.
  const particleColor = bright ? boostVibrance(color, PARTICLE_BRIGHT_VIBRANCE_BOOST) : color;
  const lifeScale = bright ? PARTICLE_BRIGHT_LIFE_SCALE : 1;
  for (let i = 0; i < count; i++) {
    // Spread evenly around the circle with jitter so bursts don't look banded.
    const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
    const speed = PARTICLE_SPEED * (0.45 + 0.75 * Math.random()) * (0.7 + 0.5 * ratio);
    fx.particles.push({
      x: cx,
      y: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 40,
      t: -delay,
      life: PARTICLE_LIFE_SEC * lifeScale * (0.7 + 0.6 * Math.random()),
      color: particleColor,
      size: 1.8 + 2.6 * ratio * Math.random() + 1,
    });
  }

  if (tier >= SHAKE_MIN_TIER) {
    // Scale within the top three tiers only, and cap hard: this should register
    // as impact, not as the screen coming loose.
    const topRatio = (tier - SHAKE_MIN_TIER) / Math.max(1, MAX_TIER - SHAKE_MIN_TIER);
    const magnitude = SHAKE_MAX_PX * (0.55 + 0.45 * topRatio);
    if (magnitude > fx.shake.magnitude || fx.shake.t >= fx.shake.duration) {
      fx.shake.t = 0;
      fx.shake.duration = SHAKE_DURATION_SEC;
      fx.shake.magnitude = Math.min(SHAKE_MAX_PX, magnitude);
    }
  }

  if (!silent) vibrate(tier >= SHAKE_MIN_TIER ? HAPTIC_TOP_TIER_MS : HAPTIC_MERGE_MS);
}

// Feature-checked and fully swallowed: unsupported browsers, and the ones that
// throw when vibration is blocked by permissions policy, must not surface here.
export function vibrate(ms) {
  try {
    if (!hapticsOn) return false;
    if (typeof navigator === 'undefined') return false;
    if (typeof navigator.vibrate !== 'function') return false;
    return navigator.vibrate(ms) === true;
  } catch {
    return false;
  }
}

export function hasHaptics() {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

export function updateEffects(fx, dt) {
  for (let i = fx.squashes.length - 1; i >= 0; i--) {
    const s = fx.squashes[i];
    s.t += dt;
    if (s.t >= s.duration) fx.squashes.splice(i, 1);
  }

  for (let i = fx.particles.length - 1; i >= 0; i--) {
    const p = fx.particles[i];
    p.t += dt;
    // 20: a staggered burst starts at a negative t. It must not drift or age
    // while it waits, or a delayed pop would arrive already half spent and
    // in the wrong place.
    if (p.t < 0) continue;
    if (p.t >= p.life) {
      fx.particles.splice(i, 1);
      continue;
    }
    p.vy += PARTICLE_GRAVITY * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }

  // A ghost lives only until its own pop -- t reaching zero IS the pop, and
  // the burst it was waiting for fires on the same frame.
  for (let i = fx.ghosts.length - 1; i >= 0; i--) {
    fx.ghosts[i].t += dt;
    if (fx.ghosts[i].t >= 0) fx.ghosts.splice(i, 1);
  }

  if (fx.shake.t < fx.shake.duration) {
    fx.shake.t += dt;
    if (fx.shake.t >= fx.shake.duration) fx.shake.magnitude = 0;
  }

  for (let i = fx.bombRings.length - 1; i >= 0; i--) {
    const r = fx.bombRings[i];
    r.t += dt;
    if (r.t >= r.duration) fx.bombRings.splice(i, 1);
  }

  if (fx.levelCallout) {
    fx.levelCallout.t += dt;
    if (fx.levelCallout.t >= LEVEL_CALLOUT_SEC) {
      const next = fx.calloutQueue.shift();
      fx.levelCallout = next ? next.callout : null;
    }
  }
}

// Scale factors for the fruit at (row, col), if it is mid-pop.
// Overshoots outward then settles, preserving area so it reads as squash.
export function squashScaleAt(fx, row, col, tier) {
  for (const s of fx.squashes) {
    if (s.row !== row || s.col !== col) continue;
    // Reject if the cell no longer holds the fruit this pop belongs to.
    if (tier !== undefined && s.tier !== tier) continue;
    if (s.t < 0) continue; // staggered: this link of the chain has not popped yet
    const p = Math.min(1, s.t / s.duration);
    // One damped oscillation: big overshoot, quick settle.
    const wave = Math.sin(p * Math.PI * 1.5) * (1 - p);
    const k = s.amount * wave;
    return { sx: 1 + k, sy: 1 - k * 0.85 };
  }
  return null;
}

export function shakeOffset(fx) {
  const s = fx.shake;
  if (s.t >= s.duration || s.magnitude <= 0) return { x: 0, y: 0 };
  const decay = 1 - s.t / s.duration;
  const m = s.magnitude * decay * decay;
  return {
    x: (Math.random() * 2 - 1) * m,
    y: (Math.random() * 2 - 1) * m,
  };
}

export function drawParticles(ctx, fx) {
  ctx.save();
  ctx.translate(0, HUD_HEIGHT);
  for (const p of fx.particles) {
    if (p.t < 0) continue; // staggered: not started
    const life = 1 - p.t / p.life;
    ctx.globalAlpha = Math.max(0, life);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * (0.4 + 0.6 * life), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// Expanding, fading rings from a bomb detonation (7.3). Drawn in the board's
// own colour-neutral way (white, alpha-faded) so it reads on every skin.
export function drawBombRings(ctx, fx) {
  ctx.save();
  ctx.translate(0, HUD_HEIGHT);
  for (const r of fx.bombRings) {
    const p = Math.min(1, r.t / r.duration);
    ctx.globalAlpha = Math.max(0, 1 - p) * 0.6;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 3 * (1 - p) + 1;
    ctx.beginPath();
    ctx.arc(r.x, r.y, CELL * 0.4 + CELL * 2.2 * p, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

export function clearEffects(fx) {
  fx.squashes.length = 0;
  fx.particles.length = 0;
  fx.shake.t = 0;
  fx.shake.duration = 0;
  fx.shake.magnitude = 0;
  fx.bombRings.length = 0;
  fx.levelCallout = null;
  fx.calloutQueue.length = 0;
}
