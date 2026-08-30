// The backdrop: a full-viewport canvas behind #app (css/style.css's
// #bg-canvas). Four layers -- a lit ground, a halo behind the board,
// drifting decorative fruit silhouettes, and a page-level vignette -- so the
// area around the board reads as designed rather than a flat --page-bg fill.
// See docs/phase11brief.md section 3.
//
// Deliberately its own module rather than folded into render.js: this canvas
// is sized and updated on a completely different schedule (DPR 1, ~15fps,
// independent of the board's own canvas and its 60fps loop), and nothing
// here reads or writes game state.

import {
  TIERS, BG_SHAPE_COUNT, BG_SHAPE_MIN_RADIUS, BG_SHAPE_MAX_RADIUS,
  BG_SHAPE_MIN_ALPHA, BG_SHAPE_MAX_ALPHA, BG_SHAPE_MAX_DRIFT_PX_PER_SEC,
  BG_HALO_PEAK_ALPHA, BG_HALO_MID_ALPHA, BG_HALO_RADIUS_SCALE,
  BG_GROUND_LIGHTEN, BG_GROUND_DARKEN,
  BG_VIGNETTE_INNER_SCALE, BG_VIGNETTE_OUTER_SCALE, BG_VIGNETTE_EDGE_ALPHA,
  BG_MIN_REDRAW_INTERVAL_SEC, BG_SHAPE_SEED,
} from './constants.js';
import { isReducedMotion } from './effects.js';

let canvas = null;
let ctx = null;
let boardRect = null; // last known #game-canvas getBoundingClientRect(), cached -- see setBoardRect
let shapes = null;
let lastDrawSec = -Infinity;
let staticDrawn = false; // under reduced motion, drawn exactly once per size

// Public domain mulberry32 -- deterministic so the decorative layout (and any
// screenshot diff against it) is identical on every load, independent of
// frame timing.
function mulberry32(seed) {
  let a = seed;
  return function rng() {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Positions are analytic functions of absolute time (x0 + vx*t, wrapped),
// not accumulated per frame -- the throttle below means drawBackground is
// called at irregular intervals, and accumulating drift per call would make
// the layout depend on exactly how many calls happened to land, not just on
// elapsed time.
function buildShapes(width, height) {
  const rng = mulberry32(BG_SHAPE_SEED);
  const list = [];
  for (let i = 0; i < BG_SHAPE_COUNT; i++) {
    const tier = Math.floor(rng() * TIERS.length);
    list.push({
      x0: rng() * width,
      y0: rng() * height,
      radius: BG_SHAPE_MIN_RADIUS + rng() * (BG_SHAPE_MAX_RADIUS - BG_SHAPE_MIN_RADIUS),
      tier,
      // Tied to the tier's own real shape rather than an independent coin
      // flip, so the decorative silhouettes echo the actual fruit roster.
      isFlower: TIERS[tier].shape === 'flower',
      alpha: BG_SHAPE_MIN_ALPHA + rng() * (BG_SHAPE_MAX_ALPHA - BG_SHAPE_MIN_ALPHA),
      vx: (rng() - 0.5) * BG_SHAPE_MAX_DRIFT_PX_PER_SEC,
      vy: -(rng() * BG_SHAPE_MAX_DRIFT_PX_PER_SEC), // up and sideways, never down
      rotation0: rng() * Math.PI * 2,
      spin: (rng() - 0.5) * 0.3, // rad/sec -- only visible on rosettes
    });
  }
  return list;
}

function wrap(v, max) {
  const m = v % max;
  return m < 0 ? m + max : m;
}

function resize() {
  const w = Math.max(1, Math.round(window.innerWidth));
  const h = Math.max(1, Math.round(window.innerHeight));
  // DPR 1, not devicePixelRatio -- deliberate, not an oversight. Every layer
  // here is a soft gradient or a shape at <=10% alpha; there is not one hard
  // edge on this canvas that a higher backing-store resolution would
  // sharpen, so MIN/MAX_BACKING_SCALE (tuned for the board's crisp fruit and
  // grid lines) would only multiply fill-rate and memory for zero visible
  // gain here.
  if (canvas.width === w && canvas.height === h) return;
  canvas.width = w;
  canvas.height = h;
  shapes = buildShapes(w, h);
  lastDrawSec = -Infinity; // force a redraw at the new size
  staticDrawn = false; // ...even under reduced motion
}

export function initBackground() {
  canvas = document.getElementById('bg-canvas');
  ctx = canvas.getContext('2d');
  resize();
  window.addEventListener('resize', resize);
}

// Cached, not read per frame: js/main.js calls this from
// handleCanvasMeasurement, which already early-returns on a zero rect, so
// the last good rect survives the board canvas being hidden behind the menu
// -- the halo stays where the board was rather than disappearing.
export function setBoardRect(rect) {
  boardRect = rect;
}

function shade(hex, percent) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const adjust = (c) => (percent < 0 ? c * (1 + percent) : c + (255 - c) * percent);
  const toHex = (c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0');
  return `#${toHex(adjust(r))}${toHex(adjust(g))}${toHex(adjust(b))}`;
}

function hexToRgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

// Layer 1: the largest single improvement in the phase -- replaces a flat
// --page-bg fill with a gradient lit from above.
function drawGround(theme, w, h) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, shade(theme.page, BG_GROUND_LIGHTEN));
  g.addColorStop(1, shade(theme.page, -BG_GROUND_DARKEN));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

// Layer 2: the board reads as lit from behind rather than pasted onto the
// ground. Skipped before the board has ever been measured (menu on a very
// first boot) -- ground and shapes still show, just without a halo yet.
function drawHalo(theme, w, h) {
  if (!boardRect) return;
  const cx = boardRect.left + boardRect.width / 2;
  const cy = boardRect.top + boardRect.height / 2;
  const radius = Math.hypot(boardRect.width, boardRect.height) * BG_HALO_RADIUS_SCALE;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
  g.addColorStop(0, hexToRgba(theme.accent, BG_HALO_PEAK_ALPHA));
  g.addColorStop(0.55, hexToRgba(theme.accent, BG_HALO_MID_ALPHA));
  g.addColorStop(1, hexToRgba(theme.accent, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

// A plain filled disc -- deliberately not render.js's drawCircle, whose rim
// stroke and specular highlight are tuned to read at full opacity on the
// board and turn into visible noise at these shapes' alpha.
function drawFlatDisc(ctx2, x, y, r) {
  ctx2.beginPath();
  ctx2.arc(x, y, r, 0, Math.PI * 2);
  ctx2.fill();
}

const BG_PETAL_COUNT = 6;

// Six petal discs on a ring plus a centre disc -- the same construction as
// render.js's drawFlower, minus its stroke and highlight for the same reason
// drawFlatDisc skips drawCircle's.
function drawFlatRosette(ctx2, x, y, r, rotation) {
  const petalR = r * 0.42;
  const ringR = r - petalR;
  ctx2.beginPath();
  for (let i = 0; i < BG_PETAL_COUNT; i++) {
    const angle = (i / BG_PETAL_COUNT) * Math.PI * 2 + rotation;
    const px = x + Math.cos(angle) * ringR;
    const py = y + Math.sin(angle) * ringR;
    ctx2.moveTo(px + petalR, py);
    ctx2.arc(px, py, petalR, 0, Math.PI * 2);
  }
  ctx2.fill();
  ctx2.beginPath();
  ctx2.arc(x, y, petalR, 0, Math.PI * 2);
  ctx2.fill();
}

// Layer 3: sixteen drifting silhouettes, coloured from the live skin (see
// drawBackground's theme.skinColors) so a player's chosen skin is reflected
// even in the surround.
function drawShapes(theme, timeSec, w, h) {
  if (!shapes) return;
  for (const s of shapes) {
    const x = wrap(s.x0 + s.vx * timeSec, w);
    const y = wrap(s.y0 + s.vy * timeSec, h);
    const rotation = s.rotation0 + s.spin * timeSec;
    ctx.save();
    ctx.globalAlpha = s.alpha;
    ctx.fillStyle = theme.skinColors[s.tier];
    if (s.isFlower) drawFlatRosette(ctx, x, y, s.radius, rotation);
    else drawFlatDisc(ctx, x, y, s.radius);
    ctx.restore();
  }
}

// Layer 4: keeps layer 3 from reading as clutter -- the shapes fade out
// exactly where they would start competing with the board. A different
// surface from render.js's own drawVignette (which darkens the board's own
// corners): this one darkens the PAGE around it, and the two are not merged
// -- see docs/phase11brief.md landmine L4.
function drawPageVignette(w, h) {
  const cx = w / 2;
  const cy = h / 2;
  const outerR = Math.max(w, h) * BG_VIGNETTE_OUTER_SCALE;
  const g = ctx.createRadialGradient(cx, cy, outerR * BG_VIGNETTE_INNER_SCALE, cx, cy, outerR);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${BG_VIGNETTE_EDGE_ALPHA})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

// theme: themeForScore(...)'s own return shape, plus a skinColors array (one
// hex per TIERS index) -- not part of themeForScore's shape because skin and
// score-theme are independent systems in this codebase, but layer 3 needs
// both, and this module's signature (theme, timeSec) has no `state` to call
// js/state.js's skinColor from directly. js/main.js builds this object at
// the call site instead of changing this signature.
export function drawBackground(theme, timeSec) {
  if (!canvas || !ctx) return;

  const reduced = isReducedMotion();
  if (reduced) {
    if (staticDrawn) return;
  } else if (timeSec - lastDrawSec < BG_MIN_REDRAW_INTERVAL_SEC) {
    return;
  }
  lastDrawSec = timeSec;
  staticDrawn = true;

  const w = canvas.width;
  const h = canvas.height;
  drawGround(theme, w, h);
  drawHalo(theme, w, h);
  drawShapes(theme, timeSec, w, h);
  drawPageVignette(w, h);
}
