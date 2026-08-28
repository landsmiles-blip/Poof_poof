// All canvas drawing lives here. Nothing in this file mutates game state.

import { COLS, CELL, HUD_HEIGHT, BOARD_WIDTH, TIERS, MUTE_RECT, COMBO_WINDOW_SEC } from './constants.js';
import { skinColor, comboMultiplier } from './state.js';
import { isMuted } from './audio.js';

export function boardHeightFor(state) {
  return state.grid.length * CELL;
}

export function canvasHeightFor(state) {
  return HUD_HEIGHT + boardHeightFor(state);
}

export function drawFrame(ctx, state) {
  const width = BOARD_WIDTH;
  const height = canvasHeightFor(state);

  ctx.clearRect(0, 0, width, height);
  drawBackground(ctx, width, height);
  drawHUD(ctx, state, width);
  drawBoard(ctx, state, width);
}

function drawBackground(ctx, width, height) {
  ctx.fillStyle = '#fff6e8';
  ctx.fillRect(0, 0, width, height);
}

function drawHUD(ctx, state, width) {
  ctx.fillStyle = '#3a2b20';
  ctx.font = 'bold 20px system-ui, sans-serif';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText(`Score ${state.score}`, 10, 8);

  ctx.font = '13px system-ui, sans-serif';
  ctx.fillText(`Best ${state.highScore}`, 10, 34);
  ctx.fillText(`Coins ${state.coins}`, 10, 52);

  if (state.inventory.remover > 0) {
    ctx.fillStyle = state.removerArmed ? '#c0392b' : '#3a2b20';
    ctx.fillText(`Remover x${state.inventory.remover}${state.removerArmed ? ' (tap a fruit)' : ' (tap to arm)'}`, 10, 70);
  }

  drawComboMeter(ctx, state, width);

  // Next fruit preview
  ctx.textAlign = 'right';
  ctx.font = '13px system-ui, sans-serif';
  ctx.fillStyle = '#3a2b20';
  ctx.fillText('Next', width - 10, 8);
  drawFruit(ctx, width - 30, 40, TIERS[state.nextTier], skinColor(state, state.nextTier));

  drawMuteToggle(ctx);
}

// Combo readout sits centred in the HUD and fades as the window runs out,
// so the player can see the streak is about to lapse.
function drawComboMeter(ctx, state, width) {
  if (state.comboCount < 2) return;

  const multiplier = comboMultiplier(state.comboCount);
  const remaining = Math.max(0, Math.min(1, state.comboTimer / COMBO_WINDOW_SEC));

  ctx.save();
  ctx.textAlign = 'center';
  ctx.globalAlpha = 0.35 + 0.65 * remaining;

  ctx.fillStyle = '#c0392b';
  ctx.font = 'bold 19px system-ui, sans-serif';
  ctx.fillText(`${multiplier.toFixed(2)}x`, width / 2, 30);

  ctx.font = 'bold 11px system-ui, sans-serif';
  ctx.fillStyle = '#8a5a3b';
  ctx.fillText(`COMBO ${state.comboCount}`, width / 2, 52);

  // Draining bar for the remaining combo window.
  const barW = 68;
  const barX = width / 2 - barW / 2;
  const barY = 68;
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(58,43,32,0.12)';
  ctx.fillRect(barX, barY, barW, 4);
  ctx.fillStyle = '#c0392b';
  ctx.fillRect(barX, barY, barW * remaining, 4);
  ctx.restore();
}

function drawMuteToggle(ctx) {
  const { x, y, w, h } = MUTE_RECT;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const muted = isMuted();

  ctx.save();
  ctx.strokeStyle = 'rgba(58,43,32,0.55)';
  ctx.fillStyle = 'rgba(58,43,32,0.55)';
  ctx.lineWidth = 1.6;

  // Speaker body
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

function drawBoard(ctx, state, width) {
  ctx.save();
  ctx.translate(0, HUD_HEIGHT);

  const rows = state.grid.length;
  ctx.strokeStyle = 'rgba(58,43,32,0.08)';
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
      drawFruit(ctx, cx, cy, TIERS[tierIndex], skinColor(state, tierIndex));
    }
  }

  if (state.active) {
    drawFruit(ctx, state.active.x, state.active.y, TIERS[state.active.tier], skinColor(state, state.active.tier));
  }

  ctx.restore();
}

// Dispatches on the tier's `shape`. Adding a shape means adding a branch here
// and a value in constants.js -- nothing else in the game needs to change.
export function drawFruit(ctx, x, y, tier, color) {
  const fill = color || tier.color;
  if (tier.shape === 'flower') {
    drawFlower(ctx, x, y, tier.radius, fill);
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

  // small highlight so fruits read as spheres rather than flat discs
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

  // Outline pass: stroke the union of the petals without inner seams by
  // filling each petal first, then stroking only the outer silhouette.
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

  // Center disc, slightly darkened, gives the flower a distinct core.
  ctx.beginPath();
  ctx.arc(x, y, radius * 0.42, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.13)';
  ctx.fill();

  // Highlight, matching the circle treatment so both shapes read as one set.
  ctx.beginPath();
  ctx.arc(x - radius * 0.3, y - radius * 0.3, radius * 0.2, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fill();
  ctx.restore();
}
