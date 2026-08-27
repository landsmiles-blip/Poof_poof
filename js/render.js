// All canvas drawing lives here. Nothing in this file mutates game state.

import { COLS, CELL, HUD_HEIGHT, BOARD_WIDTH, TIERS } from './constants.js';

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

  // Next fruit preview
  ctx.textAlign = 'right';
  ctx.font = '13px system-ui, sans-serif';
  ctx.fillStyle = '#3a2b20';
  ctx.fillText('Next', width - 10, 8);
  const previewTier = TIERS[state.nextTier];
  drawFruit(ctx, width - 30, 46, previewTier);
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
      drawFruit(ctx, cx, cy, TIERS[tierIndex]);
    }
  }

  if (state.active) {
    drawFruit(ctx, state.active.x, state.active.y, TIERS[state.active.tier]);
  }

  ctx.restore();
}

function drawFruit(ctx, x, y, tier) {
  ctx.beginPath();
  ctx.arc(x, y, tier.radius, 0, Math.PI * 2);
  ctx.fillStyle = tier.color;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(0,0,0,0.15)';
  ctx.stroke();

  // small highlight so fruits read as spheres rather than flat discs
  ctx.beginPath();
  ctx.arc(x - tier.radius * 0.35, y - tier.radius * 0.35, tier.radius * 0.28, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fill();
}
