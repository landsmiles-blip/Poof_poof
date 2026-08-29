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
  HAPTIC_MERGE_MS, HAPTIC_TOP_TIER_MS,
} from './constants.js';

export function createEffects() {
  return {
    squashes: [], // { row, col, t, duration, amount }
    particles: [], // { x, y, vx, vy, t, life, color, size }
    shake: { t: 0, duration: 0, magnitude: 0 },
  };
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
export function spawnMergeEffects(fx, { row, col, tier, color, silent = false }) {
  const ratio = tierRatio(tier);

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
    amount: SQUASH_MIN + (SQUASH_MAX - SQUASH_MIN) * ratio,
  });

  const count = Math.round(PARTICLE_MIN + (PARTICLE_MAX - PARTICLE_MIN) * ratio);
  const cx = col * CELL + CELL / 2;
  const cy = row * CELL + CELL / 2;
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
      life: PARTICLE_LIFE_SEC * (0.7 + 0.6 * Math.random()),
      color,
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

export function clearEffects(fx) {
  fx.squashes.length = 0;
  fx.particles.length = 0;
  fx.shake.t = 0;
  fx.shake.duration = 0;
  fx.shake.magnitude = 0;
}
