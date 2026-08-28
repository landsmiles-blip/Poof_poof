// Palette that shifts with score across the shared milestones.
//
// The palette is interpolated continuously between milestone stops rather than
// switched at each threshold, so crossing 1000 is a gradual warming rather than
// a visible cut. Between the last two stops the blend is eased so the final
// stretch (3000 -> 8000, by far the widest band) still feels like it is moving.

import { THEMES, MILESTONE_SCORES } from './constants.js';

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

export function themeForScore(score) {
  const { index, t } = themePosition(score);
  const a = THEMES[index];
  const b = THEMES[Math.min(THEMES.length - 1, index + 1)];
  if (a === b || t === 0) return { ...a };
  return {
    page: lerpHex(a.page, b.page, t),
    board: lerpHex(a.board, b.board, t),
    text: lerpHex(a.text, b.text, t),
    grid: lerpRgba(a.grid, b.grid, t),
    accent: lerpHex(a.accent, b.accent, t),
  };
}

// Pushes the page-level colors out to CSS so the area around the canvas and
// the overlay screens move with the board instead of staying fixed.
let lastApplied = null;

export function applyPageTheme(theme) {
  const key = `${theme.page}|${theme.board}|${theme.text}|${theme.accent}`;
  if (key === lastApplied) return; // avoid touching style every frame
  lastApplied = key;
  const root = document.documentElement;
  root.style.setProperty('--page-bg', theme.page);
  root.style.setProperty('--board-bg', theme.board);
  root.style.setProperty('--text-color', theme.text);
  root.style.setProperty('--accent', theme.accent);
}

export function resetPageTheme() {
  lastApplied = null;
}
