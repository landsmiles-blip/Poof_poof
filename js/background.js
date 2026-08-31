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
  TIERS, BG_BANDS,
  BG_HALO_PEAK_ALPHA, BG_HALO_MID_ALPHA,
  BG_HALO_MIN_SPILL_PX, BG_HALO_MAX_SPILL_PX, BG_HALO_SPILL_SCALE, BG_HALO_INNER_SPILL_SCALE,
  BG_GROUND_LIGHTEN, BG_GROUND_DARKEN,
  BG_DARK_PAGE_LUMINANCE, BG_DARK_GROUND_DARKEN,
  BG_DARK_HALO_PEAK_ALPHA, BG_DARK_HALO_MID_ALPHA,
  BG_VIGNETTE_INNER_SCALE, BG_VIGNETTE_OUTER_SCALE, BG_VIGNETTE_EDGE_ALPHA,
  BG_MIN_REDRAW_INTERVAL_SEC, BG_SHAPE_SEED,
  BG_POP_MIN_PERIOD_SEC, BG_POP_MAX_PERIOD_SEC, BG_POP_DURATION_SEC, BG_POP_RING_SCALE,
} from './constants.js';
import { isReducedMotion } from './effects.js';
import { relativeLuminance } from './theme.js';

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
  for (const band of BG_BANDS) {
    for (let i = 0; i < band.count; i++) {
      const tier = Math.floor(rng() * TIERS.length);
      const radius = band.minRadius + rng() * (band.maxRadius - band.minRadius);
      list.push({
        x0: rng() * width,
        // Start spread over a band's worth of extra height above the
        // viewport as well as inside it, so nothing arrives in a visible
        // row at t=0 and the first frame already looks settled.
        y0: rng() * (height + band.maxRadius * 2) - band.maxRadius,
        radius,
        tier,
        // Tied to the tier's own real shape rather than an independent coin
        // flip, so the decorative silhouettes echo the actual fruit roster.
        isFlower: TIERS[tier].shape === 'flower',
        alpha: band.alpha,
        // A little sideways wander, but the dominant motion is DOWN -- the
        // backdrop echoes the falling fruit rather than contradicting it.
        vx: (rng() - 0.5) * band.minSpeed,
        vy: band.minSpeed + rng() * (band.maxSpeed - band.minSpeed),
        rotation0: rng() * Math.PI * 2,
        spin: (rng() - 0.5) * 2 * band.spin, // rad/sec -- reads on rosettes and on the near band
        // 13.4: only the two closer bands puff; a 12px far-band shape
        // popping is invisible and would just cost fill-rate.
        popPeriod: band.pops
          ? BG_POP_MIN_PERIOD_SEC + rng() * (BG_POP_MAX_PERIOD_SEC - BG_POP_MIN_PERIOD_SEC)
          : 0,
        popOffset: rng() * BG_POP_MAX_PERIOD_SEC,
      });
    }
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
function drawGround(theme, w, h, darkness) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, shade(theme.page, BG_GROUND_LIGHTEN));
  g.addColorStop(1, shade(theme.page, -lerp(BG_GROUND_DARKEN, BG_DARK_GROUND_DARKEN, darkness)));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// 0 for an ordinary page colour, 1 for one already at or below
// BG_DARK_PAGE_LUMINANCE. Drives both the ground's darkening and the halo's
// strength, so the Midnight stop keeps a visible backdrop -- see the
// BG_DARK_* comment in js/constants.js.
function darknessOf(theme) {
  const lum = relativeLuminance(theme.page);
  if (lum <= BG_DARK_PAGE_LUMINANCE) return 1;
  const ceiling = BG_DARK_PAGE_LUMINANCE * 4;
  if (lum >= ceiling) return 0;
  return 1 - (lum - BG_DARK_PAGE_LUMINANCE) / (ceiling - BG_DARK_PAGE_LUMINANCE);
}

// Layer 2: the board reads as lit from behind rather than pasted onto the
// ground. Skipped before the board has ever been measured (menu on a very
// first boot) -- ground and shapes still show, just without a halo yet.
//
// 14: was one radial gradient centred on the board and sized from the
// board's own diagonal. That is the wrong primitive the moment the board
// gets big relative to the screen: the visible part of such a gradient is
// only the thin margin around the board, and across a 53px margin it
// resolves to three levels of colour -- a flat tint, measured, not guessed.
// See the BG_HALO_MIN_SPILL_PX comment in js/constants.js for the numbers.
//
// Now: two soft glows cast OUTWARD from the board's own rectangle. The
// falloff length is a pixel spill, not a fraction of the board, so it stays
// legible whether the board fills 65% of the screen or 87% of it.
//
// The rectangle we fill is clipped OUT of the canvas before filling ('evenodd'
// against a full-canvas rect), so only the shadow lands. That is not a
// flourish -- the board canvas is hidden on the menu, and without the cutout
// the fill itself would paint a solid accent-coloured rectangle across the
// menu where the board is going to be.
function drawHalo(theme, w, h, darkness) {
  if (!boardRect) return;
  const { left, top, width, height } = boardRect;
  if (width <= 0 || height <= 0) return;

  const marginX = Math.max(0, (w - width) / 2);
  const marginY = Math.max(0, (h - height) / 2);
  const spill = Math.min(
    BG_HALO_MAX_SPILL_PX,
    Math.max(BG_HALO_MIN_SPILL_PX, Math.max(marginX, marginY) * BG_HALO_SPILL_SCALE),
  );
  const peak = lerp(BG_HALO_PEAK_ALPHA, BG_DARK_HALO_PEAK_ALPHA, darkness);
  const mid = lerp(BG_HALO_MID_ALPHA, BG_DARK_HALO_MID_ALPHA, darkness);

  ctx.save();
  // Everything except the board's own footprint. Plain rects, no rounded
  // corners: the board's CSS radius is 12px and the smallest spill here is
  // 40px of blur, which erases that distinction completely -- so rounding
  // would cost a ctx.roundRect Safari fallback for a difference nobody can
  // see.
  ctx.beginPath();
  ctx.rect(0, 0, w, h);
  ctx.rect(left, top, width, height);
  ctx.clip('evenodd');

  // Two passes: a tight bright one that reads as the board's own edge light,
  // and a wide faint one that carries it out into the surround. One pass
  // alone is either a hard rim or a vague fog.
  for (const [blur, alpha] of [
    [spill * BG_HALO_INNER_SPILL_SCALE, peak],
    [spill, mid],
  ]) {
    ctx.shadowColor = hexToRgba(theme.accent, alpha);
    ctx.shadowBlur = blur;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.fillStyle = hexToRgba(theme.accent, 1);
    ctx.beginPath();
    ctx.rect(left, top, width, height);
    ctx.fill();
  }
  ctx.restore();
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
function drawShapes(theme, timeSec, w, h, reduced) {
  if (!shapes) return;
  for (const s of shapes) {
    // Wrapped over the viewport plus a shape's own diameter at each end, so
    // a large near-band shape slides fully off the bottom before reappearing
    // at the top instead of snapping out of existence mid-screen.
    const span = h + s.radius * 2;
    const x = wrap(s.x0 + s.vx * timeSec, w);
    const y = wrap(s.y0 + s.vy * timeSec, span) - s.radius;
    const rotation = s.rotation0 + s.spin * timeSec;

    // 13.4: the puff. `phase` is 0..1 through this shape's own pop cycle;
    // only the tail BG_POP_DURATION_SEC of it does anything, so a shape
    // spends the overwhelming majority of its life simply falling. Analytic
    // from absolute time like the position above, for the same reason: the
    // ~15fps throttle means frames arrive at irregular intervals and
    // anything accumulated per call would drift.
    let alpha = s.alpha;
    let ringT = -1;
    if (!reduced && s.popPeriod > 0) {
      const cycle = (timeSec + s.popOffset) % s.popPeriod;
      const since = cycle - (s.popPeriod - BG_POP_DURATION_SEC);
      if (since >= 0) {
        ringT = since / BG_POP_DURATION_SEC; // 0 -> 1 across the puff
        alpha = s.alpha * (1 - ringT);
      }
    }

    if (ringT >= 0) {
      // The ring the shape leaves behind: expands outward and fades, drawn
      // under the shrinking shape so the two read as one event.
      const rr = s.radius * (1 + (BG_POP_RING_SCALE - 1) * ringT);
      ctx.save();
      ctx.globalAlpha = s.alpha * (1 - ringT) * 0.9;
      ctx.strokeStyle = theme.skinColors[s.tier];
      ctx.lineWidth = Math.max(1.5, s.radius * 0.12 * (1 - ringT));
      ctx.beginPath();
      ctx.arc(x, y, rr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    if (alpha <= 0.002) continue;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = theme.skinColors[s.tier];
    // Shrinks slightly as it goes, so the puff reads as a pop rather than a
    // plain fade.
    const r = ringT >= 0 ? s.radius * (1 - 0.35 * ringT) : s.radius;
    if (s.isFlower) drawFlatRosette(ctx, x, y, r, rotation);
    else drawFlatDisc(ctx, x, y, r);
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
  const darkness = darknessOf(theme);
  drawGround(theme, w, h, darkness);
  drawHalo(theme, w, h, darkness);
  drawShapes(theme, timeSec, w, h, reduced);
  drawPageVignette(w, h);
}
