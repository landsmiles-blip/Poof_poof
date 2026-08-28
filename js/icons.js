// Vector power-up icons, drawn in code -- no image files, same approach as the
// fruit shapes in render.js.
//
// Every icon draws inside a unit box centred on (x, y) with a given `size`, so
// the same function serves the 26px HUD slots and the larger shop swatches.
// Shapes are kept to bold silhouettes with a single accent: at 26px, interior
// detail turns to mush, so contrast does the work instead.

const ICONS = {};

function withStyle(ctx, color, lineScale) {
  ctx.lineWidth = Math.max(1.4, lineScale);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
}

// Downward chevrons with a bar under them: "falling, slowly".
ICONS.slowDrop = (ctx, x, y, s, color) => {
  const u = s / 2;
  withStyle(ctx, color, s * 0.11);
  ctx.beginPath();
  ctx.moveTo(x - u * 0.55, y - u * 0.75);
  ctx.lineTo(x, y - u * 0.2);
  ctx.lineTo(x + u * 0.55, y - u * 0.75);
  ctx.moveTo(x - u * 0.55, y - u * 0.05);
  ctx.lineTo(x, y + u * 0.5);
  ctx.lineTo(x + u * 0.55, y - u * 0.05);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - u * 0.7, y + u * 0.8);
  ctx.lineTo(x + u * 0.7, y + u * 0.8);
  ctx.stroke();
};

// A circle with a diagonal slash: "remove this one".
ICONS.remover = (ctx, x, y, s, color) => {
  const u = s / 2;
  withStyle(ctx, color, s * 0.11);
  ctx.beginPath();
  ctx.arc(x, y, u * 0.68, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - u * 0.48, y + u * 0.48);
  ctx.lineTo(x + u * 0.48, y - u * 0.48);
  ctx.stroke();
};

// Stacked bars with an arrow: "one more row".
ICONS.extraRow = (ctx, x, y, s, color) => {
  const u = s / 2;
  withStyle(ctx, color, s * 0.1);
  ctx.globalAlpha = 0.45;
  ctx.fillRect(x - u * 0.75, y + u * 0.15, u * 1.5, u * 0.3);
  ctx.fillRect(x - u * 0.75, y + u * 0.6, u * 1.5, u * 0.3);
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.moveTo(x, y - u * 0.85);
  ctx.lineTo(x, y - u * 0.12);
  ctx.moveTo(x - u * 0.32, y - u * 0.5);
  ctx.lineTo(x, y - u * 0.85);
  ctx.lineTo(x + u * 0.32, y - u * 0.5);
  ctx.stroke();
};

// Classic horseshoe magnet: one thick U, drawn entirely in the passed colour.
//
// An earlier version marked the pole tips in hardcoded red/white. That reads
// on a neutral chip but vanishes the moment the slot is drawn on the theme
// accent (which is itself red-ish), so the whole icon must take its colour
// from the caller. The tips are distinguished by a gap instead of a hue.
ICONS.magnet = (ctx, x, y, s, color) => {
  const u = s / 2;
  const r = u * 0.52;
  const armW = u * 0.4;
  withStyle(ctx, color, armW);
  ctx.lineWidth = armW;
  ctx.lineCap = 'butt';

  // Arch across the top.
  ctx.beginPath();
  ctx.arc(x, y - u * 0.12, r, Math.PI, 0);
  ctx.stroke();

  // Legs, stopping short of the baseline to leave open poles.
  ctx.beginPath();
  ctx.moveTo(x - r, y - u * 0.12);
  ctx.lineTo(x - r, y + u * 0.46);
  ctx.moveTo(x + r, y - u * 0.12);
  ctx.lineTo(x + r, y + u * 0.46);
  ctx.stroke();

  // Pole faces: short thick caps set off by a gap, so the "open ends" of the
  // horseshoe read without relying on a second colour.
  ctx.lineWidth = armW * 0.9;
  ctx.beginPath();
  ctx.moveTo(x - r, y + u * 0.66);
  ctx.lineTo(x - r, y + u * 0.82);
  ctx.moveTo(x + r, y + u * 0.66);
  ctx.lineTo(x + r, y + u * 0.82);
  ctx.stroke();
};

// Round bomb with a lit fuse.
ICONS.bomb = (ctx, x, y, s, color) => {
  const u = s / 2;
  withStyle(ctx, color, s * 0.09);
  ctx.beginPath();
  ctx.arc(x - u * 0.05, y + u * 0.18, u * 0.62, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(x + u * 0.3, y - u * 0.34);
  ctx.quadraticCurveTo(x + u * 0.75, y - u * 0.72, x + u * 0.5, y - u * 0.95);
  ctx.stroke();

  // Spark, as a four-point star in the caller's colour rather than a fixed
  // orange -- the slot background changes with the theme and when armed.
  const sx = x + u * 0.52;
  const sy = y - u * 0.95;
  const a = u * 0.3;
  ctx.lineWidth = s * 0.07;
  ctx.beginPath();
  ctx.moveTo(sx - a, sy); ctx.lineTo(sx + a, sy);
  ctx.moveTo(sx, sy - a); ctx.lineTo(sx, sy + a);
  ctx.stroke();
};

// Rainbow wildcard: a disc split into coloured wedges.
ICONS.rainbow = (ctx, x, y, s, color) => {
  const u = s / 2;
  const r = u * 0.72;
  const wedges = ['#e0435a', '#f2960b', '#f2d43d', '#3fae5c', '#4c6ef5', '#8e44ad'];
  ctx.save();
  wedges.forEach((c, i) => {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.arc(x, y, r, (i / wedges.length) * Math.PI * 2, ((i + 1) / wedges.length) * Math.PI * 2);
    ctx.closePath();
    ctx.fillStyle = c;
    ctx.fill();
  });
  ctx.restore();
  withStyle(ctx, color, s * 0.08);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
};

export function drawIcon(ctx, name, x, y, size, color = '#3a2b20') {
  const fn = ICONS[name];
  if (!fn) return false;
  ctx.save();
  fn(ctx, x, y, size, color);
  ctx.restore();
  return true;
}

export function hasIcon(name) {
  return Boolean(ICONS[name]);
}

// Renders one icon into a standalone <canvas>, for the DOM shop screen.
export function iconCanvas(name, size, color = '#3a2b20') {
  const dpr = window.devicePixelRatio || 1;
  const canvas = document.createElement('canvas');
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  drawIcon(ctx, name, size / 2, size / 2, size * 0.86, color);
  return canvas;
}
