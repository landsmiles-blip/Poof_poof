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

// --- Static Object Pools (Zero GC in 60 FPS loop) ----------------------------
const PARTICLE_POOL_SIZE = 768;
const SQUASH_POOL_SIZE = 64;
const GHOST_POOL_SIZE = 64;
const BOMB_RING_POOL_SIZE = 48;

const particlePool = [];
for (let i = 0; i < PARTICLE_POOL_SIZE; i++) {
  particlePool.push({
    x: 0, y: 0, vx: 0, vy: 0, t: 0, life: 0, color: '', size: 0,
    kind: 0, rot: 0, vRot: 0,
  });
}

const squashPool = [];
for (let i = 0; i < SQUASH_POOL_SIZE; i++) {
  squashPool.push({ row: 0, col: 0, tier: 0, t: 0, duration: 0, amount: 0 });
}

const ghostPool = [];
for (let i = 0; i < GHOST_POOL_SIZE; i++) {
  ghostPool.push({ x: 0, y: 0, tier: 0, color: '', t: 0 });
}

const bombRingPool = [];
for (let i = 0; i < BOMB_RING_POOL_SIZE; i++) {
  bombRingPool.push({ x: 0, y: 0, t: 0, duration: 0 });
}

function allocParticle() {
  return particlePool.pop() || {
    x: 0, y: 0, vx: 0, vy: 0, t: 0, life: 0, color: '', size: 0,
    kind: 0, rot: 0, vRot: 0,
  };
}

function freeParticle(p) {
  if (particlePool.length < PARTICLE_POOL_SIZE) particlePool.push(p);
}

function allocSquash() {
  return squashPool.pop() || { row: 0, col: 0, tier: 0, t: 0, duration: 0, amount: 0 };
}

function freeSquash(s) {
  if (squashPool.length < SQUASH_POOL_SIZE) squashPool.push(s);
}

function allocGhost() {
  return ghostPool.pop() || { x: 0, y: 0, tier: 0, color: '', t: 0 };
}

function freeGhost(g) {
  if (ghostPool.length < GHOST_POOL_SIZE) ghostPool.push(g);
}

function allocBombRing() {
  return bombRingPool.pop() || { x: 0, y: 0, t: 0, duration: 0 };
}

function freeBombRing(r) {
  if (bombRingPool.length < BOMB_RING_POOL_SIZE) bombRingPool.push(r);
}

// Cached return structures to eliminate per-frame object literal instantiations
const SQUASH_RESULT = { sx: 1, sy: 1 };
const SHAKE_RESULT = { x: 0, y: 0 };

const VIBRANCE_CACHE = new Map();

function boostVibrance(hex, factor) {
  const key = `${hex}|${factor}`;
  const cached = VIBRANCE_CACHE.get(key);
  if (cached) return cached;

  const n = parseInt(hex.replace('#', ''), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const avg = (r + g + b) / 3;
  const push = (c) => Math.max(0, Math.min(255, Math.round(avg + (c - avg) * factor)));
  const toHex = (c) => c.toString(16).padStart(2, '0');
  const res = `#${toHex(push(r))}${toHex(push(g))}${toHex(push(b))}`;
  if (VIBRANCE_CACHE.size < 256) VIBRANCE_CACHE.set(key, res);
  return res;
}

export function createEffects() {
  return {
    squashes: [], // { row, col, tier, t, duration, amount }
    particles: [], // { x, y, vx, vy, t, life, color, size, kind, rot, vRot }
    shake: { t: 0, duration: 0, magnitude: 0 },
    // 21: fruit that have already left the grid but have not popped yet --
    // see spawnGhost and js/render.js's drawGhosts.
    ghosts: [],
    bombRings: [], // { x, y, t, duration } -- 7.3
    levelCallout: null, // the callout SHOWING now -- 15, see triggerLevelUp
    // 21.1: the ones waiting their turn. Until now this was a single slot and
    // every trigger simply assigned to it, so two callouts in one event batch
    // meant one of them was never seen.
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

// 15: the level-up reaction's two purely-visual pieces
export function triggerLevelUp(fx, level) {
  if (!reducedMotion) {
    fx.shake.t = 0;
    fx.shake.duration = SHAKE_DURATION_SEC;
    fx.shake.magnitude = SHAKE_MAX_PX;
  }
  pushCallout(fx, { kind: 'level', level, t: 0 });
}

// 20: the same callout, carrying an unlock instead of a level.
export function triggerUnlock(fx, name) {
  if (!reducedMotion) {
    fx.shake.t = 0;
    fx.shake.duration = SHAKE_DURATION_SEC;
    fx.shake.magnitude = SHAKE_MAX_PX;
  }
  pushCallout(fx, { kind: 'unlock', unlock: name, t: 0 });
}

// 21.1: the same envelope again, carrying a rule the player has to be told once.
export function triggerTeach(fx, title, line) {
  pushCallout(fx, { kind: 'teach', teach: title, line, t: 0 });
}

// 21: a fruit that a merge has already removed from the grid, still drawn at
// the spot it was in, until its link of the chain actually pops.
export function spawnGhost(fx, { x, y, tier, color, delay }) {
  if (delay <= 0) return; // nothing to hold back
  const g = allocGhost();
  g.x = x;
  g.y = y;
  g.tier = tier;
  g.color = color;
  g.t = -delay;
  fx.ghosts.push(g);
}

// Expanding ring on a bomb detonation or apex merge
export function spawnBombRing(fx, x, y) {
  const r = allocBombRing();
  r.x = x;
  r.y = y;
  r.t = 0;
  r.duration = BOMB_RING_DURATION_SEC;
  fx.bombRings.push(r);
}

let hapticsOn = true;

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

export function _setReducedMotion(value) {
  reducedMotion = value;
}

function tierRatio(tier) {
  return Math.max(0, Math.min(1, tier / MAX_TIER));
}

// Spawns merge bursts with high-velocity directional particle elongation,
// sparkling starbursts, splash micro-droplets, and expanding shockwave rings.
export function spawnMergeEffects(fx, { row, col, tier, color, silent = false, x, y, bright = false, delay = 0 }) {
  const ratio = tierRatio(tier);
  const squashScale = reducedMotion ? REDUCED_MOTION_SQUASH_SCALE : 1;

  const s = allocSquash();
  s.row = row;
  s.col = col;
  s.tier = tier;
  s.t = -delay;
  s.duration = SQUASH_DURATION_SEC;
  s.amount = (SQUASH_MIN + (SQUASH_MAX - SQUASH_MIN) * ratio) * squashScale;
  fx.squashes.push(s);

  if (reducedMotion) {
    if (!silent) vibrate(tier >= SHAKE_MIN_TIER ? HAPTIC_TOP_TIER_MS : HAPTIC_MERGE_MS);
    return;
  }

  const count = Math.round(PARTICLE_MIN + (PARTICLE_MAX - PARTICLE_MIN) * ratio);
  const cx = x ?? (col * CELL + CELL / 2);
  const cy = y ?? (row * CELL + CELL / 2);
  const particleColor = bright ? boostVibrance(color, PARTICLE_BRIGHT_VIBRANCE_BOOST) : color;
  const lifeScale = bright ? PARTICLE_BRIGHT_LIFE_SCALE : 1;

  for (let i = 0; i < count; i++) {
    // Dynamic angular distribution with high-velocity bursts
    const angle = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.5;
    const speed = PARTICLE_SPEED * (0.55 + 0.85 * Math.random()) * (0.7 + 0.55 * ratio);
    const p = allocParticle();
    p.x = cx;
    p.y = cy;
    p.vx = Math.cos(angle) * speed;
    p.vy = Math.sin(angle) * speed - 45; // upward lift
    p.t = -delay;
    p.life = PARTICLE_LIFE_SEC * lifeScale * (0.65 + 0.6 * Math.random());
    p.color = particleColor;
    p.size = 2.0 + 2.8 * ratio * Math.random() + 1;
    p.rot = Math.random() * Math.PI * 2;
    p.vRot = (Math.random() - 0.5) * 10;

    // Variety classification:
    // kind 0: directional velocity-elongated juice droplet
    // kind 1: 4-pointed sparkle starburst (frequent on higher tiers)
    // kind 2: micro-droplet splash
    // kind 3: radiant prism shard
    if (ratio > 0.28 && i % 4 === 0) {
      p.kind = 1;
    } else if (ratio > 0.45 && i % 5 === 2) {
      p.kind = 3;
    } else if (i % 3 === 0) {
      p.kind = 2;
    } else {
      p.kind = 0;
    }

    fx.particles.push(p);
  }

  if (tier >= SHAKE_MIN_TIER) {
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
  // O(1) swap-and-pop deallocation: eliminates Array.splice churn
  for (let i = fx.squashes.length - 1; i >= 0; i--) {
    const s = fx.squashes[i];
    s.t += dt;
    if (s.t >= s.duration) {
      freeSquash(s);
      fx.squashes[i] = fx.squashes[fx.squashes.length - 1];
      fx.squashes.pop();
    }
  }

  for (let i = fx.particles.length - 1; i >= 0; i--) {
    const p = fx.particles[i];
    p.t += dt;
    if (p.t < 0) continue; // Waiting delayed burst
    if (p.t >= p.life) {
      freeParticle(p);
      fx.particles[i] = fx.particles[fx.particles.length - 1];
      fx.particles.pop();
      continue;
    }
    p.vy += PARTICLE_GRAVITY * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.vRot * dt;
  }

  for (let i = fx.ghosts.length - 1; i >= 0; i--) {
    const g = fx.ghosts[i];
    g.t += dt;
    if (g.t >= 0) {
      freeGhost(g);
      fx.ghosts[i] = fx.ghosts[fx.ghosts.length - 1];
      fx.ghosts.pop();
    }
  }

  if (fx.shake.t < fx.shake.duration) {
    fx.shake.t += dt;
    if (fx.shake.t >= fx.shake.duration) fx.shake.magnitude = 0;
  }

  for (let i = fx.bombRings.length - 1; i >= 0; i--) {
    const r = fx.bombRings[i];
    r.t += dt;
    if (r.t >= r.duration) {
      freeBombRing(r);
      fx.bombRings[i] = fx.bombRings[fx.bombRings.length - 1];
      fx.bombRings.pop();
    }
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
export function squashScaleAt(fx, row, col, tier) {
  for (let i = 0; i < fx.squashes.length; i++) {
    const s = fx.squashes[i];
    if (s.row !== row || s.col !== col) continue;
    if (tier !== undefined && s.tier !== tier) continue;
    if (s.t < 0) continue;
    const p = Math.min(1, s.t / s.duration);
    const wave = Math.sin(p * Math.PI * 1.5) * (1 - p);
    const k = s.amount * wave;
    SQUASH_RESULT.sx = 1 + k;
    SQUASH_RESULT.sy = 1 - k * 0.85;
    return SQUASH_RESULT;
  }
  return null;
}

export function shakeOffset(fx) {
  const s = fx.shake;
  if (s.t >= s.duration || s.magnitude <= 0) {
    SHAKE_RESULT.x = 0;
    SHAKE_RESULT.y = 0;
    return SHAKE_RESULT;
  }
  const decay = 1 - s.t / s.duration;
  const m = s.magnitude * decay * decay;
  SHAKE_RESULT.x = (Math.random() * 2 - 1) * m;
  SHAKE_RESULT.y = (Math.random() * 2 - 1) * m;
  return SHAKE_RESULT;
}

// Zero-allocation particle rendering loop
export function drawParticles(ctx, fx) {
  if (!fx.particles.length) return;
  ctx.save();
  ctx.translate(0, HUD_HEIGHT);

  for (let i = 0; i < fx.particles.length; i++) {
    const p = fx.particles[i];
    if (p.t < 0) continue;
    const life = Math.max(0, 1 - p.t / p.life);
    ctx.globalAlpha = life;
    ctx.fillStyle = p.color;

    if (p.kind === 1) {
      // Kind 1: Multi-stage sparkle starburst
      const starScale = life < 0.2 ? (life / 0.2) : (1 - (life - 0.2) / 0.8);
      const r = p.size * (0.8 + 1.2 * starScale);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.beginPath();
      ctx.moveTo(0, -r * 1.8);
      ctx.quadraticCurveTo(0, 0, r * 1.8, 0);
      ctx.quadraticCurveTo(0, 0, 0, r * 1.8);
      ctx.quadraticCurveTo(0, 0, -r * 1.8, 0);
      ctx.quadraticCurveTo(0, 0, 0, -r * 1.8);
      ctx.fill();

      // Brilliant white central glint core
      ctx.fillStyle = 'rgba(255,255,255,0.95)';
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.35, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    } else if (p.kind === 3) {
      // Kind 3: Radiant diamond gem shard
      const r = p.size * (0.5 + 0.6 * life);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.beginPath();
      ctx.moveTo(0, -r * 1.4);
      ctx.lineTo(r, 0);
      ctx.lineTo(0, r * 1.4);
      ctx.lineTo(-r, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.moveTo(0, -r * 0.7);
      ctx.lineTo(r * 0.5, 0);
      ctx.lineTo(0, r * 0.7);
      ctx.lineTo(-r * 0.5, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    } else if (p.kind === 2) {
      // Kind 2: Micro-droplet pop
      const r = p.size * 0.55 * (0.4 + 0.6 * life);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.beginPath();
      ctx.arc(p.x - r * 0.25, p.y - r * 0.25, r * 0.3, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Kind 0: High-velocity vector droplet with directional velocity elongation
      const speed = Math.hypot(p.vx, p.vy);
      const angle = Math.atan2(p.vy, p.vx);
      const stretch = Math.min(2.4, 1 + speed / 280);
      const radius = p.size * (0.35 + 0.65 * life);

      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.ellipse(0, 0, radius * stretch, radius / Math.sqrt(stretch), 0, 0, Math.PI * 2);
      ctx.fill();

      // Sharp specular highlight streak along the leading spine
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      ctx.beginPath();
      ctx.ellipse(radius * stretch * 0.2, -radius * 0.2, radius * stretch * 0.45, radius * 0.25, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  ctx.restore();
}

// Expanding shockwave rings from a bomb detonation or apex celebration
export function drawBombRings(ctx, fx) {
  if (!fx.bombRings.length) return;
  ctx.save();
  ctx.translate(0, HUD_HEIGHT);

  for (let i = 0; i < fx.bombRings.length; i++) {
    const r = fx.bombRings[i];
    const p = Math.min(1, r.t / r.duration);
    const ease = 1 - Math.pow(1 - p, 2.5); // Rapid explosive expansion easing
    const waveRadius = CELL * 0.35 + CELL * 2.3 * ease;

    // Dual-layer expanding shockwave
    // 1. Soft glowing outer atmospheric dispersion
    ctx.globalAlpha = Math.max(0, 1 - p) * 0.4;
    ctx.strokeStyle = 'rgba(255, 225, 160, 0.7)';
    ctx.lineWidth = 5 * (1 - p) + 1;
    ctx.beginPath();
    ctx.arc(r.x, r.y, waveRadius + 2, 0, Math.PI * 2);
    ctx.stroke();

    // 2. Razor-sharp pure white compression wave
    ctx.globalAlpha = Math.max(0, 1 - p) * 0.95;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.lineWidth = 2.5 * (1 - p) + 1;
    ctx.beginPath();
    ctx.arc(r.x, r.y, waveRadius, 0, Math.PI * 2);
    ctx.stroke();

    // 3. Four cardinal/diagonal radiant fracture ticks
    if (p < 0.7) {
      const tickAlpha = (1 - p / 0.7) * 0.8;
      ctx.globalAlpha = tickAlpha;
      ctx.lineWidth = 2;
      const tLen = 6 * (1 - p);
      for (let a = 0; a < 4; a++) {
        const rad = (a * Math.PI / 2) + Math.PI / 4;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        ctx.beginPath();
        ctx.moveTo(r.x + cos * (waveRadius - tLen), r.y + sin * (waveRadius - tLen));
        ctx.lineTo(r.x + cos * (waveRadius + tLen), r.y + sin * (waveRadius + tLen));
        ctx.stroke();
      }
    }
  }

  ctx.restore();
}

export function clearEffects(fx) {
  while (fx.squashes.length > 0) freeSquash(fx.squashes.pop());
  while (fx.particles.length > 0) freeParticle(fx.particles.pop());
  while (fx.ghosts.length > 0) freeGhost(fx.ghosts.pop());
  while (fx.bombRings.length > 0) freeBombRing(fx.bombRings.pop());
  fx.shake.t = 0;
  fx.shake.duration = 0;
  fx.shake.magnitude = 0;
  fx.levelCallout = null;
  fx.calloutQueue.length = 0;
}
