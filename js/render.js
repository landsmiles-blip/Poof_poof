// All canvas drawing lives here. Nothing in this file mutates game state.

import {
  COLS, CELL, HUD_HEIGHT, BOARD_WIDTH, TIERS, MUTE_RECT, COMBO_WINDOW_SEC,
  RAINBOW_TIER, RAINBOW_DEF, powerSlotRect, MAGNET_DURATION_SEC,
} from './constants.js';
import { skinColor, comboMultiplier, activePowerUps } from './state.js';
import { isMuted } from './audio.js';
import { squashScaleAt, shakeOffset, drawParticles } from './effects.js';
import { themeForScore } from './theme.js';
import { drawIcon } from './icons.js';

export function boardHeightFor(state) {
  return state.grid.length * CELL;
}

export function canvasHeightFor(state) {
  return HUD_HEIGHT + boardHeightFor(state);
}

function tierDefFor(tierIndex) {
  return tierIndex === RAINBOW_TIER ? RAINBOW_DEF : TIERS[tierIndex];
}

function colorFor(state, tierIndex) {
  return tierIndex === RAINBOW_TIER ? RAINBOW_DEF.color : skinColor(state, tierIndex);
}

export function drawFrame(ctx, state, fx) {
  const width = BOARD_WIDTH;
  const height = canvasHeightFor(state);
  const theme = themeForScore(state.score);

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = theme.board;
  ctx.fillRect(0, 0, width, height);

  drawHUD(ctx, state, width, theme);

  // Shake displaces only the board, never the HUD -- shaking the score readout
  // makes it unreadable and reads as a glitch rather than as impact.
  const offset = fx ? shakeOffset(fx) : { x: 0, y: 0 };
  ctx.save();
  ctx.translate(offset.x, offset.y);
  drawBoard(ctx, state, fx, theme);
  if (fx) drawParticles(ctx, fx);
  ctx.restore();
}

function drawHUD(ctx, state, width, theme) {
  ctx.fillStyle = theme.text;
  ctx.font = 'bold 20px system-ui, sans-serif';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText(`Score ${state.score}`, 10, 6);

  ctx.font = '13px system-ui, sans-serif';
  ctx.fillText(`Best ${state.highScore}`, 10, 32);
  ctx.fillText(`Coins ${state.coins}`, 10, 50);

  drawComboMeter(ctx, state, width, theme);

  ctx.textAlign = 'right';
  ctx.font = '13px system-ui, sans-serif';
  ctx.fillStyle = theme.text;
  ctx.fillText('Next', width - 10, 6);
  const nextDef = tierDefFor(state.nextTier);
  drawFruit(ctx, width - 30, 38, nextDef, colorFor(state, state.nextTier));

  drawMuteToggle(ctx, theme);
  drawPowerBar(ctx, state, theme);
}

// Combo readout fades as the window runs out, so the player can see the streak
// is about to lapse.
function drawComboMeter(ctx, state, width, theme) {
  if (state.comboCount < 2) return;

  const multiplier = comboMultiplier(state.comboCount);
  const remaining = Math.max(0, Math.min(1, state.comboTimer / COMBO_WINDOW_SEC));

  ctx.save();
  ctx.textAlign = 'center';
  ctx.globalAlpha = 0.35 + 0.65 * remaining;

  ctx.fillStyle = theme.accent;
  ctx.font = 'bold 19px system-ui, sans-serif';
  ctx.fillText(`${multiplier.toFixed(2)}x`, width / 2, 26);

  ctx.font = 'bold 11px system-ui, sans-serif';
  ctx.fillStyle = theme.text;
  ctx.globalAlpha = (0.35 + 0.65 * remaining) * 0.75;
  ctx.fillText(`COMBO ${state.comboCount}`, width / 2, 48);

  const barW = 68;
  const barX = width / 2 - barW / 2;
  const barY = 64;
  ctx.globalAlpha = 1;
  ctx.fillStyle = theme.grid;
  ctx.fillRect(barX, barY, barW, 4);
  ctx.fillStyle = theme.accent;
  ctx.fillRect(barX, barY, barW * remaining, 4);
  ctx.restore();
}

// One tappable slot per usable power-up, with its count and armed/active state.
// Slot order comes straight from activePowerUps() so render and input agree.
function drawPowerBar(ctx, state, theme) {
  const items = activePowerUps(state);
  items.forEach((item, i) => {
    const rect = powerSlotRect(i);
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;

    const armed = (item.id === 'bomb' && state.bombArmed)
      || (item.id === 'remover' && state.removerArmed)
      || (item.id === 'magnet' && state.magnetActive);

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(rect.x, rect.y, rect.w, rect.h, 6);
    ctx.fillStyle = armed ? theme.accent : theme.grid;
    ctx.fill();
    ctx.restore();

    drawIcon(ctx, item.icon, cx, cy, rect.w * 0.72, armed ? theme.board : theme.text);

    // Count, centred under its own slot. Right-aligning it past the slot edge
    // put it in the gap where it collided with the neighbouring chip.
    ctx.save();
    ctx.font = 'bold 10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = theme.text;
    ctx.fillText(`${state.inventory[item.id] || 0}`, cx, rect.y + rect.h + 2);
    ctx.restore();
  });

  // Remaining magnet duration, along the top edge of its slot -- the space
  // below now belongs to the count.
  if (state.magnetActive) {
    const idx = items.findIndex((p) => p.id === 'magnet');
    if (idx >= 0) {
      const rect = powerSlotRect(idx);
      const pct = Math.max(0, Math.min(1, state.magnetTimer / MAGNET_DURATION_SEC));
      ctx.fillStyle = theme.accent;
      ctx.fillRect(rect.x, rect.y - 4, rect.w * pct, 2.5);
    }
  }
}

function drawMuteToggle(ctx, theme) {
  const { x, y, w, h } = MUTE_RECT;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const muted = isMuted();

  ctx.save();
  ctx.globalAlpha = 0.6;
  ctx.strokeStyle = theme.text;
  ctx.fillStyle = theme.text;
  ctx.lineWidth = 1.6;

  ctx.beginPath();
  ctx.moveTo(cx - 6, cy - 3);
  ctx.lineTo(cx - 3, cy - 3);
  ctx.lineTo(cx + 1, cy - 7);
  ctx.lineTo(cx + 1, cy + 7);
  ctx.lineTo(cx - 3, cy + 3);
  ctx.lineTo(cx - 6, cy + 3);
  ctx.closePath();
  ctx.fill();

  if (muted) {
    ctx.beginPath();
    ctx.moveTo(cx + 4, cy - 4);
    ctx.lineTo(cx + 10, cy + 4);
    ctx.moveTo(cx + 10, cy - 4);
    ctx.lineTo(cx + 4, cy + 4);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(cx + 2, cy, 5, -Math.PI / 3, Math.PI / 3);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx + 2, cy, 8.5, -Math.PI / 3, Math.PI / 3);
    ctx.stroke();
  }
  ctx.restore();
}

function drawBoard(ctx, state, fx, theme) {
  ctx.save();
  ctx.translate(0, HUD_HEIGHT);

  const rows = state.grid.length;
  ctx.strokeStyle = theme.grid;
  ctx.lineWidth = 1;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * CELL, 0);
    ctx.lineTo(c * CELL, rows * CELL);
    ctx.stroke();
  }

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < COLS; c++) {
      const tierIndex = state.grid[r][c];
      if (tierIndex === null) continue;
      const cx = c * CELL + CELL / 2;
      const cy = r * CELL + CELL / 2;
      const def = tierDefFor(tierIndex);
      const color = colorFor(state, tierIndex);

      const squash = fx ? squashScaleAt(fx, r, c) : null;
      if (squash) {
        // Scale about the fruit's own centre so it pops in place.
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(squash.sx, squash.sy);
        drawFruit(ctx, 0, 0, def, color);
        ctx.restore();
      } else {
        drawFruit(ctx, cx, cy, def, color);
      }
    }
  }

  if (state.active) {
    const def = tierDefFor(state.active.tier);
    drawFruit(ctx, state.active.x, state.active.y, def, colorFor(state, state.active.tier));
  }

  ctx.restore();
}

// Dispatches on the tier's `shape`. Adding a shape means adding a branch here
// and a value in constants.js -- nothing else in the game needs to change.
export function drawFruit(ctx, x, y, tier, color) {
  const fill = color || tier.color;
  if (tier.shape === 'flower') {
    drawFlower(ctx, x, y, tier.radius, fill);
  } else if (tier.shape === 'rainbow') {
    drawRainbow(ctx, x, y, tier.radius);
  } else {
    drawCircle(ctx, x, y, tier.radius, fill);
  }
}

function drawCircle(ctx, x, y, radius, fill) {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(0,0,0,0.15)';
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(x - radius * 0.35, y - radius * 0.35, radius * 0.28, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fill();
}

const PETAL_COUNT = 6;

// Petals are drawn as overlapping discs on a ring, then a center disc on top.
// Ring offset + petal radius sum to the tier radius so a flower occupies
// exactly the same footprint as the circle it replaces -- the grid geometry
// and landing math stay untouched.
function drawFlower(ctx, x, y, radius, fill) {
  const petalR = radius * 0.42;
  const ringR = radius - petalR;

  ctx.save();
  ctx.fillStyle = fill;
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(0,0,0,0.15)';

  ctx.beginPath();
  for (let i = 0; i < PETAL_COUNT; i++) {
    const angle = (i / PETAL_COUNT) * Math.PI * 2 - Math.PI / 2;
    const px = x + Math.cos(angle) * ringR;
    const py = y + Math.sin(angle) * ringR;
    ctx.moveTo(px + petalR, py);
    ctx.arc(px, py, petalR, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(x, y, radius * 0.42, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.13)';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(x - radius * 0.3, y - radius * 0.3, radius * 0.2, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fill();
  ctx.restore();
}

// The wildcard reads as a fruit-sized disc of tier colours, so it is instantly
// distinguishable from every real tier without needing a legend.
const RAINBOW_WEDGES = ['#e0435a', '#f2960b', '#f2d43d', '#3fae5c', '#4c6ef5', '#8e44ad'];

function drawRainbow(ctx, x, y, radius) {
  ctx.save();
  RAINBOW_WEDGES.forEach((c, i) => {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.arc(
      x, y, radius,
      (i / RAINBOW_WEDGES.length) * Math.PI * 2 - Math.PI / 2,
      ((i + 1) / RAINBOW_WEDGES.length) * Math.PI * 2 - Math.PI / 2
    );
    ctx.closePath();
    ctx.fillStyle = c;
    ctx.fill();
  });
  ctx.restore();

  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(x, y, radius * 0.34, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fill();
}
