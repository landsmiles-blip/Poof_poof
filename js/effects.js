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
    bombRings: [], // { x, y, t, duration } -- 7.3
    levelCallout: null, // { level, t } -- 15, see triggerLevelUp
  };
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
  fx.levelCallout = { level, t: 0 };
}

// Expanding ring on a bomb detonation -- the loudest action in the game
// otherwise had no visual beyond the particle bursts per cleared cell.
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
export function spawnMergeEffects(fx, { row, col, tier, color, silent = false, x, y, bright = false }) {
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
    t: 0,
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
      t: 0,
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
    if (p.t >= p.life) {
      fx.particles.splice(i, 1);
      continue;
    }
    p.vy += PARTICLE_GRAVITY * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
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
    if (fx.levelCallout.t >= LEVEL_CALLOUT_SEC) fx.levelCallout = null;
  }
}

// Scale factors for the fruit at (row, col), if it is mid-pop.
// Overshoots outward then settles, preserving area so it reads as squash.
export function squashScaleAt(fx, row, col, tier) {
  for (const s of fx.squashes) {
    if (s.row !== row || s.col !== col) continue;
    // Reject if the cell no longer holds the fruit this pop belongs to.
    if (tier !== undefined && s.tier !== tier) continue;
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
}
