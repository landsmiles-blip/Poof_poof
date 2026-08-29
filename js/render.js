// All canvas drawing lives here. Nothing in this file mutates game state.

import {
  COLS, CELL, HUD_HEIGHT, BOARD_WIDTH, TIERS, COMBO_WINDOW_SEC,
  RAINBOW_TIER, RAINBOW_DEF, powerSlotRect, MAGNET_DURATION_SEC, BUILD_VERSION,
  FONT_FAMILY, RENDER_SCALE, LOCKED_FLASH_DURATION_SEC,
} from './constants.js';
import { skinColor, comboMultiplier, hudPowerUps } from './state.js';
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

  // Re-established every frame rather than once at startup. Assigning
  // canvas.width/height resets the 2D context including its transform, and
  // resizeCanvasToState() reassigns height whenever Extra Row changes the row
  // count -- a one-time ctx.scale() would be silently wiped mid-run and drop
  // the game to half size in the corner.
  ctx.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0);

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
  ctx.font = `bold 20px ${FONT_FAMILY}`;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.fillText(`Score ${state.score}`, 10, 6);

  ctx.font = `13px ${FONT_FAMILY}`;
  ctx.fillText(`Best ${state.highScore}`, 10, 32);
  ctx.fillText(`Coins ${state.coins}`, 10, 50);

  drawComboMeter(ctx, state, width, theme);

  ctx.textAlign = 'right';
  ctx.font = `13px ${FONT_FAMILY}`;
  ctx.fillStyle = theme.text;
  ctx.fillText('Next', width - 10, 6);
  const nextDef = tierDefFor(state.nextTier);
  drawFruit(ctx, width - 30, 38, nextDef, colorFor(state, state.nextTier));

  drawPowerBar(ctx, state, theme);

  // Build stamp: low-contrast, but the fastest way to confirm which code a
  // browser is actually running when a deploy appears not to have landed.
  ctx.save();
  ctx.font = `9px ${FONT_FAMILY}`;
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.globalAlpha = 0.38;
  ctx.fillStyle = theme.text;
  ctx.fillText(`v${BUILD_VERSION}`, width - 8, HUD_HEIGHT - 3);
  ctx.restore();
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
  ctx.font = `bold 19px ${FONT_FAMILY}`;
  ctx.fillText(`${multiplier.toFixed(2)}x`, width / 2, 26);

  ctx.font = `bold 11px ${FONT_FAMILY}`;
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

// One slot per tappable power-up, always drawn -- locked and empty ones appear
// greyed so the player can see what exists and what unlocks it. Slot order comes
// straight from hudPowerUps() so render and input hit-testing cannot drift.
function drawPowerBar(ctx, state, theme) {
  const items = hudPowerUps();
  items.forEach((item, i) => {
    const rect = powerSlotRect(i);
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;

    const locked = state.highScore < (item.unlockScore || 0);
    const count = state.inventory[item.id] || 0;
    const usable = !locked && count > 0;
    const armed = (item.id === 'bomb' && state.bombArmed)
      || (item.id === 'remover' && state.removerArmed)
      || (item.id === 'magnet' && state.magnetActive);

    ctx.save();
    if (!usable && !armed) ctx.globalAlpha = 0.4;

    ctx.beginPath();
    ctx.roundRect(rect.x, rect.y, rect.w, rect.h, 6);
    ctx.fillStyle = armed ? theme.accent : theme.grid;
    ctx.fill();

    drawIcon(ctx, item.icon, cx, cy, rect.w * 0.72, armed ? theme.board : theme.text);

    // Below each slot: the unlock score while locked, otherwise the count.
    ctx.font = `bold 9px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = theme.text;
    ctx.fillText(locked ? `${item.unlockScore}` : `${count}`, cx, rect.y + rect.h + 2);
    ctx.restore();

    // A brief flash when this exact chip was just tapped while locked or out
    // of stock. The unlock score is already drawn beneath the chip, so this is
    // deliberately just a ring, not a second label.
    if (state.lockedFlash && state.lockedFlash.id === item.id) {
      const alpha = Math.max(0, 1 - state.lockedFlash.t / LOCKED_FLASH_DURATION_SEC);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.roundRect(rect.x - 2, rect.y - 2, rect.w + 4, rect.h + 4, 7);
      ctx.stroke();
      ctx.restore();
    }

    // Padlock corner marker, so "locked" is not conveyed by dimming alone.
    if (locked) {
      ctx.save();
      ctx.globalAlpha = 0.75;
      ctx.fillStyle = theme.text;
      ctx.beginPath();
      ctx.roundRect(rect.x + rect.w - 8, rect.y + 2, 6, 5, 1);
      ctx.fill();
      ctx.strokeStyle = theme.text;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.arc(rect.x + rect.w - 5, rect.y + 2.5, 2, Math.PI, 0);
      ctx.stroke();
      ctx.restore();
    }
  });

  // Remaining magnet duration, along the top edge of its slot. The chip now
  // stays on the bar while active even at zero stock, so this always has an
  // anchor to draw against.
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

      const squash = fx ? squashScaleAt(fx, r, c, tierIndex) : null;
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
