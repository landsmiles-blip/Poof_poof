// Palette that shifts with score across the shared milestones.
//
// The palette is interpolated continuously between milestone stops rather than
// switched at each threshold, so crossing 1000 is a gradual warming rather than
// a visible cut. Between the last two stops the blend is eased so the final
// stretch (3000 -> 8000, by far the widest band) still feels like it is moving.

import { THEMES, MILESTONE_SCORES, DANGER_COLOR } from './constants.js';

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgbToHex({ r, g, b }) {
  const to = (v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

function lerpHex(a, b, t) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return rgbToHex({
    r: A.r + (B.r - A.r) * t,
    g: A.g + (B.g - A.g) * t,
    b: A.b + (B.b - A.b) * t,
  });
}

// Grid lines are rgba() strings, so blend their alpha channel separately.
function parseRgba(str) {
  const m = str.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const parts = m[1].split(',').map((s) => parseFloat(s.trim()));
  return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
}

function lerpRgba(a, b, t) {
  const A = parseRgba(a);
  const B = parseRgba(b);
  if (!A || !B) return a;
  const n = (x, y) => x + (y - x) * t;
  return `rgba(${Math.round(n(A.r, B.r))},${Math.round(n(A.g, B.g))},${Math.round(n(A.b, B.b))},${n(A.a, B.a).toFixed(3)})`;
}

// WCAG relative luminance -- used to decide which ink (dark/light text) reads
// correctly on the CURRENT interpolated board colour. See themeForScore.
function relativeLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const lin = (channel) => {
    const s = channel / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrastRatio(hexA, hexB) {
  const a = relativeLuminance(hexA) + 0.05;
  const b = relativeLuminance(hexB) + 0.05;
  return a > b ? a / b : b / a;
}

// A stop's OWN board, classified once from its authored colour -- distinct
// from the hysteresis-gated live decision below. Used only to tell whether a
// segment between two stops needs the crossover treatment at all: two stops
// on the same side never risk the mid-grey trap, so their tuned text hues can
// still be blended normally.
function boardRegimeIsLight(theme) {
  return relativeLuminance(theme.boardTop) >= 0.5;
}

// Where the score sits on the milestone ladder, as a continuous position.
// Returns { index, t } meaning: blend THEMES[index] -> THEMES[index+1] by t.
export function themePosition(score) {
  const last = MILESTONE_SCORES.length - 1;
  if (score <= MILESTONE_SCORES[0]) return { index: 0, t: 0 };
  for (let i = 0; i < last; i++) {
    const lo = MILESTONE_SCORES[i];
    const hi = MILESTONE_SCORES[i + 1];
    if (score < hi) {
      const raw = (score - lo) / (hi - lo);
      // Ease the widest band so progress stays perceptible throughout it.
      const t = i === last - 1 ? Math.pow(raw, 0.7) : raw;
      return { index: i, t: Math.max(0, Math.min(1, t)) };
    }
  }
  return { index: last, t: 0 };
}

// Ink pair for a CROSSING segment only (today: stops 2->3) -- deliberately
// not either stop's own tuned text colour. The two safe luminance ranges a
// dark/light ink opens up (contrast >= 4.5 against the interpolated board)
// only overlap at all if the ink pair is close to the physical extremes: at
// exactly the 4.5 floor, pure black is safe from board luminance 0.175 up,
// pure white is safe down to 0.183 -- an overlap of about 0.008, which is
// already the widest any two colours can produce. Stop 2's purple ink and
// stop 3's pale blue are nowhere near extreme enough (verified by
// unit-tests/theme-contrast.js failing loudly when this used them directly),
// so the crossing borrows these instead and each stop's own tuned ink is
// used only outside the crossing, where it is not at risk.
const CROSSING_DARK_INK = '#000000';
const CROSSING_LIGHT_INK = '#FFFFFF';
const CROSSING_MIN_CONTRAST = 4.5;
const CROSSING_DARK_SAFE_AT = CROSSING_MIN_CONTRAST * (relativeLuminance(CROSSING_DARK_INK) + 0.05) - 0.05;
const CROSSING_LIGHT_SAFE_AT = (relativeLuminance(CROSSING_LIGHT_INK) + 0.05) / CROSSING_MIN_CONTRAST - 0.05;

// Hysteresis memory for the crossing-segment ink decision -- module state,
// not a themeForScore parameter, because the only place score ever moves
// backward is a screen transition back to the menu (score -> 0), which lands
// squarely inside stop 0's board, nowhere near a crossing. Reset alongside
// the page-theme cache in resetPageTheme().
let crossingInkIsDark = true;

export function themeForScore(score) {
  const { index, t } = themePosition(score);
  const a = THEMES[index];
  const b = THEMES[Math.min(THEMES.length - 1, index + 1)];

  if (a === b || t === 0) {
    return { ...a, danger: DANGER_COLOR };
  }

  const boardTop = lerpHex(a.boardTop, b.boardTop, t);
  const boardBot = lerpHex(a.boardBot, b.boardBot, t);

  let text;
  if (boardRegimeIsLight(a) === boardRegimeIsLight(b)) {
    // Both ends of this segment agree on which ink reads -- ordinary
    // interpolation is safe here and preserves each stop's own tuned hue.
    text = lerpHex(a.text, b.text, t);
  } else {
    // THE LANDMINE (see constants.js's THEMES comment): never blend a
    // crossing segment's text, and never use the stops' own ink for it
    // either -- see CROSSING_DARK_INK's comment for why. Pick whichever
    // extreme is legible on the CURRENT interpolated board, with hysteresis
    // so it does not flicker right at the boundary.
    const boardLum = relativeLuminance(boardTop);
    if (boardLum >= CROSSING_DARK_SAFE_AT) crossingInkIsDark = true;
    else if (boardLum <= CROSSING_LIGHT_SAFE_AT) crossingInkIsDark = false;
    // else: inside the (very narrow) band where both remain safe -- keep
    // whichever was already chosen.
    text = crossingInkIsDark ? CROSSING_DARK_INK : CROSSING_LIGHT_INK;
  }

  return {
    page: lerpHex(a.page, b.page, t),
    boardTop,
    boardBot,
    text,
    grid: lerpRgba(a.grid, b.grid, t),
    accent: lerpHex(a.accent, b.accent, t),
    danger: DANGER_COLOR,
  };
}

// Exported for unit-tests/theme-contrast.js, which needs to check contrast
// against the actual board colour text sits on (the top stop, where the HUD
// text is drawn) without duplicating the WCAG formula.
export { relativeLuminance, contrastRatio };

// Pushes the page-level colors out to CSS so the area around the canvas and
// the overlay screens move with the board instead of staying fixed.
let lastApplied = null;

export function applyPageTheme(theme) {
  const key = `${theme.page}|${theme.boardTop}|${theme.boardBot}|${theme.text}|${theme.accent}`;
  if (key === lastApplied) return; // avoid touching style every frame
  lastApplied = key;
  const root = document.documentElement;
  root.style.setProperty('--page-bg', theme.page);
  root.style.setProperty('--board-top', theme.boardTop);
  root.style.setProperty('--board-bottom', theme.boardBot);
  root.style.setProperty('--text-color', theme.text);
  root.style.setProperty('--accent', theme.accent);
  root.style.setProperty('--danger', theme.danger);
}

export function resetPageTheme() {
  lastApplied = null;
  crossingInkIsDark = true;
}
