// Vector power-up icons, drawn in code -- no image files, same approach as the
// fruit shapes in render.js.
//
// Every icon draws inside a unit box centred on (x, y) with a given `size`, so
// the same function serves the 26px HUD slots and the larger shop swatches.

const ICONS = {};

function withStyle(ctx, color, lineScale) {
  ctx.lineWidth = Math.max(1.4, lineScale);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
}

// Glowing aerodynamic wings / parachute canopy with motion streaks: "falling, slowly".
ICONS.slowDrop = (ctx, x, y, s, color) => {
  const u = s / 2;
  withStyle(ctx, color, s * 0.09);

  // Aerodynamic parachute canopy
  ctx.beginPath();
  ctx.moveTo(x - u * 0.72, y - u * 0.22);
  ctx.bezierCurveTo(x - u * 0.65, y - u * 0.85, x + u * 0.65, y - u * 0.85, x + u * 0.72, y - u * 0.22);
  ctx.quadraticCurveTo(x + u * 0.36, y - u * 0.08, x, y - u * 0.18);
  ctx.quadraticCurveTo(x - u * 0.36, y - u * 0.08, x - u * 0.72, y - u * 0.22);
  ctx.closePath();
  ctx.stroke();

  // Suspension cords
  ctx.lineWidth = Math.max(1, s * 0.05);
  ctx.beginPath();
  ctx.moveTo(x - u * 0.65, y - u * 0.22);
  ctx.lineTo(x, y + u * 0.32);
  ctx.moveTo(x + u * 0.65, y - u * 0.22);
  ctx.lineTo(x, y + u * 0.32);
  ctx.moveTo(x, y - u * 0.18);
  ctx.lineTo(x, y + u * 0.32);
  ctx.stroke();

  // Downward airflow motion streaks
  ctx.lineWidth = Math.max(1.2, s * 0.07);
  ctx.beginPath();
  ctx.moveTo(x - u * 0.40, y + u * 0.48);
  ctx.lineTo(x - u * 0.40, y + u * 0.82);
  ctx.moveTo(x, y + u * 0.52);
  ctx.lineTo(x, y + u * 0.90);
  ctx.moveTo(x + u * 0.40, y + u * 0.48);
  ctx.lineTo(x + u * 0.40, y + u * 0.82);
  ctx.stroke();
};

// High-tech laser target reticle with glowing crosshairs and circular targeting brackets.
ICONS.remover = (ctx, x, y, s, color) => {
  const u = s / 2;
  withStyle(ctx, color, s * 0.09);

  const r = u * 0.70;
  // Four corner targeting brackets
  const gap = 0.28;
  for (let i = 0; i < 4; i++) {
    const start = (i * Math.PI / 2) + gap;
    const end = ((i + 1) * Math.PI / 2) - gap;
    ctx.beginPath();
    ctx.arc(x, y, r, start, end);
    ctx.stroke();
  }

  // Inner precision reticle
  ctx.lineWidth = Math.max(1, s * 0.05);
  ctx.beginPath();
  ctx.arc(x, y, u * 0.34, 0, Math.PI * 2);
  ctx.stroke();

  // Crosshair laser tics pointing inward
  ctx.lineWidth = Math.max(1.2, s * 0.08);
  ctx.beginPath();
  ctx.moveTo(x, y - r * 1.15); ctx.lineTo(x, y - u * 0.45);
  ctx.moveTo(x, y + r * 1.15); ctx.lineTo(x, y + u * 0.45);
  ctx.moveTo(x - r * 1.15, y); ctx.lineTo(x - u * 0.45, y);
  ctx.moveTo(x + r * 1.15, y); ctx.lineTo(x + u * 0.45, y);
  ctx.stroke();

  // Center laser dot
  ctx.beginPath();
  ctx.arc(x, y, u * 0.12, 0, Math.PI * 2);
  ctx.fill();
};

// Stacked luminous ascending grid layers with dynamic upward chevron.
ICONS.extraRow = (ctx, x, y, s, color) => {
  const u = s / 2;
  withStyle(ctx, color, s * 0.09);

  // Stacked horizontal grid plates
  ctx.globalAlpha = 0.45;
  ctx.fillRect(x - u * 0.72, y + u * 0.25, u * 1.44, u * 0.22);
  ctx.fillRect(x - u * 0.72, y + u * 0.62, u * 1.44, u * 0.22);
  ctx.globalAlpha = 1;

  // Luminous upward energetic chevron
  ctx.lineWidth = Math.max(1.6, s * 0.12);
  ctx.beginPath();
  ctx.moveTo(x, y - u * 0.88);
  ctx.lineTo(x, y + u * 0.12);
  ctx.stroke();

  // Chevron arrowhead
  ctx.beginPath();
  ctx.moveTo(x - u * 0.48, y - u * 0.45);
  ctx.lineTo(x, y - u * 0.88);
  ctx.lineTo(x + u * 0.48, y - u * 0.45);
  ctx.stroke();
};

// Two dynamic, glowing aerodynamic curved arrows in a circular flow with sharp dimensional heads.
ICONS.swap = (ctx, x, y, s, color) => {
  const u = s / 2;
  withStyle(ctx, color, s * 0.11);
  ctx.lineCap = 'round';

  const r = u * 0.58;

  // Upper clockwise arc
  ctx.beginPath();
  ctx.arc(x, y, r, -Math.PI * 0.88, -Math.PI * 0.10);
  ctx.stroke();

  // Upper arrowhead at right end pointing downwards
  const topEndX = x + Math.cos(-Math.PI * 0.10) * r;
  const topEndY = y + Math.sin(-Math.PI * 0.10) * r;
  ctx.beginPath();
  ctx.moveTo(topEndX - u * 0.10, topEndY - u * 0.28);
  ctx.lineTo(topEndX, topEndY);
  ctx.lineTo(topEndX - u * 0.32, topEndY - u * 0.05);
  ctx.stroke();

  // Lower counter-clockwise arc
  ctx.beginPath();
  ctx.arc(x, y, r, Math.PI * 0.12, Math.PI * 0.90);
  ctx.stroke();

  // Lower arrowhead at left end pointing upwards
  const botEndX = x + Math.cos(Math.PI * 0.90) * r;
  const botEndY = y + Math.sin(Math.PI * 0.90) * r;
  ctx.beginPath();
  ctx.moveTo(botEndX + u * 0.10, botEndY + u * 0.28);
  ctx.lineTo(botEndX, botEndY);
  ctx.lineTo(botEndX + u * 0.32, botEndY + u * 0.05);
  ctx.stroke();
};

// Glossy round bomb with metallic specular crescent, brass nozzle collar, and burning spark.
ICONS.bomb = (ctx, x, y, s, color) => {
  const u = s / 2;
  withStyle(ctx, color, s * 0.09);

  const bx = x - u * 0.04;
  const by = y + u * 0.18;
  const br = u * 0.60;

  // Spherical bomb body
  ctx.beginPath();
  ctx.arc(bx, by, br, 0, Math.PI * 2);
  ctx.fill();

  // Metallic specular crescent
  ctx.save();
  ctx.beginPath();
  ctx.arc(bx - br * 0.28, by - br * 0.12, br * 0.28, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
  ctx.fill();
  ctx.restore();

  // Brass nozzle collar
  const collarX = bx + br * 0.38;
  const collarY = by - br * 0.78;
  ctx.save();
  ctx.fillStyle = '#d4af37';
  ctx.beginPath();
  ctx.ellipse(collarX, collarY, u * 0.16, u * 0.08, 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Burning S-curved fuse
  const fuseEndX = x + u * 0.55;
  const fuseEndY = y - u * 0.92;
  ctx.lineWidth = Math.max(1.4, s * 0.08);
  ctx.strokeStyle = '#8a5a2a';
  ctx.beginPath();
  ctx.moveTo(collarX, collarY);
  ctx.quadraticCurveTo(x + u * 0.72, y - u * 0.65, fuseEndX, fuseEndY);
  ctx.stroke();

  // 4-pointed radiant star-spark at fuse tip
  const starR = u * 0.26;
  ctx.save();
  ctx.translate(fuseEndX, fuseEndY);
  ctx.fillStyle = '#f97316';
  ctx.beginPath();
  ctx.moveTo(0, -starR);
  ctx.lineTo(starR * 0.28, -starR * 0.28);
  ctx.lineTo(starR, 0);
  ctx.lineTo(starR * 0.28, starR * 0.28);
  ctx.lineTo(0, starR);
  ctx.lineTo(-starR * 0.28, starR * 0.28);
  ctx.lineTo(-starR, 0);
  ctx.lineTo(-starR * 0.28, -starR * 0.28);
  ctx.closePath();
  ctx.fill();

  // Blazing white center ember
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(0, 0, starR * 0.36, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
};

// Rainbow wildcard: 8-wedge iridescent pinwheel with glass gloss dome and radiant star core.
ICONS.rainbow = (ctx, x, y, s, color) => {
  const u = s / 2;
  const r = u * 0.72;
  const wedges = ['#ff2a55', '#ff7a00', '#ffc700', '#10b981', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'];
  ctx.save();
  wedges.forEach((c, i) => {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.arc(x, y, r, (i / wedges.length) * Math.PI * 2, ((i + 1) / wedges.length) * Math.PI * 2);
    ctx.closePath();
    ctx.fillStyle = c;
    ctx.fill();
  });

  // Upper glass dome gloss
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.beginPath();
  ctx.ellipse(x, y - r * 0.35, r * 0.85, r * 0.45, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.42)';
  ctx.fill();

  // Center diamond star core
  ctx.fillStyle = '#ffffff';
  const starR = r * 0.36;
  ctx.beginPath();
  ctx.moveTo(x, y - starR);
  ctx.quadraticCurveTo(x, y, x + starR, y);
  ctx.quadraticCurveTo(x, y, x, y + starR);
  ctx.quadraticCurveTo(x, y, x - starR, y);
  ctx.quadraticCurveTo(x, y, x, y - starR);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  withStyle(ctx, color, s * 0.08);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
};

// Shopping cart: open basket, handle, two wheels. Menu hub button (7.1).
ICONS.cart = (ctx, x, y, s, color) => {
  const u = s / 2;
  withStyle(ctx, color, s * 0.1);
  ctx.beginPath();
  ctx.moveTo(x - u * 0.55, y - u * 0.25);
  ctx.lineTo(x + u * 0.65, y - u * 0.25);
  ctx.lineTo(x + u * 0.45, y + u * 0.35);
  ctx.lineTo(x - u * 0.35, y + u * 0.35);
  ctx.closePath();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - u * 0.55, y - u * 0.25);
  ctx.lineTo(x - u * 0.75, y - u * 0.65);
  ctx.lineTo(x - u * 0.9, y - u * 0.65);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x - u * 0.15, y + u * 0.6, u * 0.13, 0, Math.PI * 2);
  ctx.arc(x + u * 0.3, y + u * 0.6, u * 0.13, 0, Math.PI * 2);
  ctx.fill();
};

// Artist's palette: a rounded blob, a thumb-hole, three paint dots. Menu hub
// button (7.1) for the skin picker.
ICONS.palette = (ctx, x, y, s, color) => {
  const u = s / 2;
  withStyle(ctx, color, s * 0.1);
  ctx.beginPath();
  ctx.ellipse(x, y, u * 0.85, u * 0.68, -0.3, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(x + u * 0.28, y + u * 0.42, u * 0.2, u * 0.14, -0.3, 0, Math.PI * 2);
  ctx.stroke();
  [[-0.4, -0.2], [-0.05, -0.5], [0.35, -0.35]].forEach(([dx, dy]) => {
    ctx.beginPath();
    ctx.arc(x + dx * u, y + dy * u, u * 0.13, 0, Math.PI * 2);
    ctx.fill();
  });
};

// Cog: radiating bevelled teeth and an annular ring with clean vector center hole.
// Menu hub button (7.1) for audio/haptics settings.
ICONS.gear = (ctx, x, y, s, color) => {
  const u = s / 2;
  ctx.save();
  ctx.fillStyle = color;
  // Eight radiating teeth
  const teeth = 8;
  const toothLen = u * 0.28;
  const toothW = u * 0.26;
  for (let i = 0; i < teeth; i++) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((i / teeth) * Math.PI * 2);
    ctx.fillRect(u * 0.48, -toothW / 2, toothLen, toothW);
    ctx.restore();
  }
  // Annular gear disc with clean non-destructive center hole
  ctx.beginPath();
  ctx.arc(x, y, u * 0.62, 0, Math.PI * 2);
  ctx.arc(x, y, u * 0.28, 0, Math.PI * 2, true);
  ctx.fill();
  ctx.restore();
};

// Left chevron: back out of a panel to the home screen (7.1).
ICONS.back = (ctx, x, y, s, color) => {
  const u = s / 2;
  withStyle(ctx, color, s * 0.14);
  ctx.beginPath();
  ctx.moveTo(x + u * 0.35, y - u * 0.6);
  ctx.lineTo(x - u * 0.35, y);
  ctx.lineTo(x + u * 0.35, y + u * 0.6);
  ctx.stroke();
};

// Two rounded vertical bars: the universal pause glyph. 9.3's in-HUD pause control.
ICONS.pause = (ctx, x, y, s, color) => {
  const u = s / 2;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, u * 0.38);
  ctx.lineCap = 'round';
  const halfH = u * 0.46;
  ctx.beginPath();
  ctx.moveTo(x - u * 0.34, y - halfH);
  ctx.lineTo(x - u * 0.34, y + halfH);
  ctx.moveTo(x + u * 0.34, y - halfH);
  ctx.lineTo(x + u * 0.34, y + halfH);
  ctx.stroke();
  ctx.restore();
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
