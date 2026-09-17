// All canvas drawing lives here. Nothing in this file mutates game state.

import {
  COLS, CELL, HUD_HEIGHT, BOARD_WIDTH, TIERS,
  RAINBOW_TIER, RAINBOW_DEF, BOMB_TIER, BOMB_DEF, BOMB_FUSE_DROPS, STONE_TIER, STONE_DEF,
  powerSlotRect, POWER_SLOT, pauseButtonRect,
  FONT_FAMILY, DISPLAY_FONT_FAMILY, LOCKED_FLASH_DURATION_SEC, CHIP_PULSE_DURATION_SEC,
  MERGE_METER_MAX, DANGER_ROWS_REMAINING, LEVEL_CALLOUT_SEC, COMBO_MAX_MULTIPLIER,
  REMOVER_CROSSHAIR_SIZE, RAINBOW_SPIN_RADIANS_PER_SEC,
  SPAWN_CHUTE_TINT_ALPHA, SPAWN_CHUTE_FADE_ROWS, SPAWN_CHUTE_MARK_ALPHA, SPAWN_CHUTE_MARK_INSET,
  CEILING_LINE_ALPHA, CEILING_LINE_ALPHA_MAX, CEILING_LINE_DASH,
  RISE_METER_HEIGHT, RISE_METER_TRACK_ALPHA, RISE_METER_FILL_ALPHA, RISE_METER_IMMINENT_ALPHA,
} from './constants.js';
import {
  tierColor, comboMultiplier, hudPowerUps, comboWindowSecFor, levelFor, floorRiseCadenceDrops,
} from './state.js';
import { spawnColumnFor } from './physics.js';
import {
  squashScaleAt, shakeOffset, drawParticles, drawBombRings, isReducedMotion,
} from './effects.js';
import { themeForScore, themePosition, relativeLuminance } from './theme.js';
import { drawIcon } from './icons.js';

export function boardHeightFor(state) {
  return state.grid.length * CELL;
}

export function canvasHeightFor(state) {
  return HUD_HEIGHT + boardHeightFor(state);
}

// ctx.roundRect throws on Safari below 16, taking the whole HUD frame down
// with it -- compatibility with the iOS YouTube app's WebView is a MUST.
export function roundRectPath(ctx, x, y, w, h, r) {
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, r);
  } else {
    ctx.rect(x, y, w, h);
  }
}

function tierDefFor(tierIndex) {
  if (tierIndex === RAINBOW_TIER) return RAINBOW_DEF;
  if (tierIndex === BOMB_TIER) return BOMB_DEF;
  if (tierIndex === STONE_TIER) return STONE_DEF;
  return TIERS[tierIndex];
}

function colorFor(state, tierIndex) {
  return tierColor(state, tierIndex);
}

function bombFuseFractionFor(state, tierIndex) {
  if (tierIndex !== BOMB_TIER) return 1;
  if (state.bombFuseDrops === null || state.bombFuseDrops === undefined) return 1;
  return Math.max(0, Math.min(1, state.bombFuseDrops / BOMB_FUSE_DROPS));
}

const ZERO_OFFSET = { x: 0, y: 0 };

export function drawFrame(ctx, state, fx) {
  const width = BOARD_WIDTH;
  const height = canvasHeightFor(state);
  const theme = themeForScore(state.score);

  const scale = ctx.canvas.width / width || 1;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);

  ctx.clearRect(0, 0, width, height);

  // Continuous vertical gradient spanning HUD and board
  const boardGradient = ctx.createLinearGradient(0, 0, 0, height);
  boardGradient.addColorStop(0, theme.boardTop);
  boardGradient.addColorStop(1, theme.boardBot);
  ctx.fillStyle = boardGradient;
  ctx.fillRect(0, 0, width, height);

  // Defined panel seam under HUD
  const hudIsLight = relativeLuminance(theme.boardTop) >= 0.5;
  const hudShadow = ctx.createLinearGradient(0, HUD_HEIGHT, 0, HUD_HEIGHT + 10);
  hudShadow.addColorStop(0, 'rgba(0,0,0,0.10)');
  hudShadow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = hudShadow;
  ctx.fillRect(0, HUD_HEIGHT, width, 10);

  ctx.fillStyle = hudIsLight ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.16)';
  ctx.fillRect(0, HUD_HEIGHT, width, 1);

  drawHUD(ctx, state, width, theme);

  const offset = fx ? shakeOffset(fx) : ZERO_OFFSET;
  ctx.save();
  ctx.translate(offset.x, offset.y);
  drawBoard(ctx, state, fx, theme);
  if (fx) {
    drawParticles(ctx, fx);
    drawBombRings(ctx, fx);
    drawLevelCallout(ctx, fx, COLS * CELL, boardHeightFor(state), theme);
  }
  ctx.restore();

  ctx.save();
  ctx.translate(0, HUD_HEIGHT);
  drawCeilingLine(ctx, state, state.grid.length, theme);
  drawRiseMeter(ctx, state, state.grid.length, theme);
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

  // In-Game HUD Gold Coin Counter Graphic
  const coinX = 18;
  const coinY = 56;
  const coinR = 7;

  ctx.save();
  // 3D beveled gold disc with radial gradient
  const coinGrad = ctx.createRadialGradient(coinX - 2, coinY - 2, 1, coinX, coinY, coinR);
  coinGrad.addColorStop(0, '#fff3a8');
  coinGrad.addColorStop(0.35, '#ffd13b');
  coinGrad.addColorStop(0.85, '#d98200');
  coinGrad.addColorStop(1, '#9e5a00');

  ctx.beginPath();
  ctx.arc(coinX, coinY, coinR, 0, Math.PI * 2);
  ctx.fillStyle = coinGrad;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#8a4c00';
  ctx.stroke();

  // Inner embossed gold ring
  ctx.beginPath();
  ctx.arc(coinX, coinY, coinR * 0.65, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.50)';
  ctx.lineWidth = 0.8;
  ctx.stroke();

  // Specular glint
  ctx.beginPath();
  ctx.ellipse(coinX - 2, coinY - 2.2, 2.2, 1.1, -0.4, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
  ctx.fill();
  ctx.restore();

  // Crisp coin count text
  ctx.fillStyle = theme.text;
  ctx.font = `bold 13px ${FONT_FAMILY}`;
  ctx.fillText(`${state.coins}`, 30, 50);

  drawComboMeter(ctx, state, width, theme);

  ctx.textAlign = 'right';
  ctx.font = `13px ${FONT_FAMILY}`;
  ctx.fillStyle = theme.text;
  ctx.fillText('Next', width - 64, 32);
  const nextDef = tierDefFor(state.nextTier);
  drawFruit(ctx, width - 30, 38, nextDef, colorFor(state, state.nextTier), state.nextTier,
    bombFuseFractionFor(state, state.nextTier));

  drawPowerBar(ctx, state, theme);
  drawMergeMeter(ctx, state, theme);
  drawPauseButton(ctx, theme);

  ctx.textAlign = 'left';
  ctx.font = `bold 12px ${FONT_FAMILY}`;
  ctx.fillStyle = theme.text;
  ctx.fillText(`LV ${levelFor(state.spawnIndex)}`, 10, 66);
}

function drawComboMeter(ctx, state, width, theme) {
  if (state.comboCount < 2) return;

  const multiplier = comboMultiplier(state.comboCount);
  const remaining = Math.max(0, Math.min(1, state.comboTimer / comboWindowSecFor(state)));

  ctx.save();
  ctx.textAlign = 'center';
  ctx.globalAlpha = 0.35 + 0.65 * remaining;

  ctx.fillStyle = theme.accent;
  ctx.font = `bold 19px ${FONT_FAMILY}`;
  ctx.fillText(`${multiplier.toFixed(2)}x`, width / 2, 26);

  ctx.font = `bold 11px ${FONT_FAMILY}`;
  ctx.fillStyle = theme.text;
  ctx.globalAlpha = (0.35 + 0.65 * remaining) * 0.75;
  const atCap = multiplier >= COMBO_MAX_MULTIPLIER;
  ctx.fillText(atCap ? `COMBO ${state.comboCount} MAX` : `COMBO ${state.comboCount}`, width / 2, 48);

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

function drawPowerBar(ctx, state, theme) {
  const items = hudPowerUps();
  items.forEach((item, i) => {
    const rect = powerSlotRect(i);
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;

    const locked = state.highScore < (item.unlockScore || 0);
    const earned = state.earnedCharges[item.id] || 0;
    const count = (state.inventory[item.id] || 0) + earned;
    const usable = !locked && count > 0;
    const armed = (item.id === 'bomb' && state.bombInPlay)
      || (item.id === 'remover' && state.removerArmed)
      || (item.id === 'swap' && state.swapArmed);

    ctx.save();
    if (!usable && !armed) ctx.globalAlpha = 0.4;

    // Sleek floating glass chip with beveled border
    ctx.beginPath();
    roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, 7);
    if (armed) {
      ctx.fillStyle = theme.accent;
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.6;
      ctx.stroke();
    } else {
      const chipGrad = ctx.createLinearGradient(rect.x, rect.y, rect.x, rect.y + rect.h);
      chipGrad.addColorStop(0, withAlpha(theme.grid, 0.40));
      chipGrad.addColorStop(1, withAlpha(theme.grid, 0.18));
      ctx.fillStyle = chipGrad;
      ctx.fill();
      ctx.strokeStyle = withAlpha(theme.grid, 0.60);
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    drawIcon(ctx, item.icon, cx, cy, rect.w * 0.72, armed ? theme.boardTop : theme.text);

    ctx.font = `bold 8px ${FONT_FAMILY}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = theme.text;
    ctx.fillText(locked ? `${item.unlockScore}` : `${count}`, cx, rect.y + rect.h + 1);
    ctx.restore();

    if (state.lockedFlash && state.lockedFlash.id === item.id) {
      const alpha = Math.max(0, 1 - state.lockedFlash.t / LOCKED_FLASH_DURATION_SEC);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      roundRectPath(ctx, rect.x - 2, rect.y - 2, rect.w + 4, rect.h + 4, 8);
      ctx.stroke();
      ctx.restore();
    }

    if (state.chipPulse && state.chipPulse.id === item.id) {
      const p = Math.min(1, state.chipPulse.t / CHIP_PULSE_DURATION_SEC);
      const wave = Math.sin(p * Math.PI);
      ctx.save();
      ctx.globalAlpha = wave * 0.85;
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = 2 + wave * 2;
      const grow = wave * 5;
      ctx.beginPath();
      roundRectPath(ctx, rect.x - 3 - grow, rect.y - 3 - grow, rect.w + 6 + grow * 2, rect.h + 6 + grow * 2, 9);
      ctx.stroke();
      ctx.restore();
    }

    if (locked) {
      ctx.save();
      ctx.globalAlpha = 0.75;
      ctx.fillStyle = theme.text;
      ctx.beginPath();
      roundRectPath(ctx, rect.x + rect.w - 8, rect.y + 2, 6, 5, 1);
      ctx.fill();
      ctx.strokeStyle = theme.text;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.arc(rect.x + rect.w - 5, rect.y + 2.5, 2, Math.PI, 0);
      ctx.stroke();
      ctx.restore();
    }

    if (earned > 0) {
      ctx.save();
      ctx.fillStyle = theme.accent;
      ctx.beginPath();
      ctx.arc(rect.x + 4, rect.y + 4, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  });
}

function drawMergeMeter(ctx, state, theme) {
  const barX = POWER_SLOT.x0;
  const barY = POWER_SLOT.y + POWER_SLOT.size + 10;
  const barW = 3 * POWER_SLOT.size + 2 * POWER_SLOT.gap;
  const pct = Math.max(0, Math.min(1, state.mergeMeter / MERGE_METER_MAX));
  ctx.save();
  ctx.fillStyle = theme.grid;
  ctx.fillRect(barX, barY, barW, 2);
  ctx.fillStyle = theme.accent;
  ctx.fillRect(barX, barY, barW * pct, 2);
  ctx.restore();
}

function drawPauseButton(ctx, theme) {
  const rect = pauseButtonRect();
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  ctx.save();
  ctx.beginPath();
  roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, 6);
  ctx.fillStyle = theme.grid;
  ctx.fill();
  drawIcon(ctx, 'pause', cx, cy, rect.w * 0.72, theme.text);
  ctx.restore();
}

function drawSpawnChute(ctx, state, rows, theme) {
  const col = spawnColumnFor(state);
  if (col < 0) return;

  const x0 = col * CELL;
  const cx = x0 + CELL / 2;

  const fadeH = Math.min(rows, SPAWN_CHUTE_FADE_ROWS) * CELL;
  const wash = ctx.createLinearGradient(0, 0, 0, fadeH);
  wash.addColorStop(0, withAlpha(theme.grid, SPAWN_CHUTE_TINT_ALPHA));
  wash.addColorStop(1, withAlpha(theme.grid, 0));
  ctx.fillStyle = wash;
  ctx.fillRect(x0, 0, CELL, fadeH);

  ctx.save();
  ctx.strokeStyle = withAlpha(theme.grid, SPAWN_CHUTE_MARK_ALPHA);
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';

  ctx.beginPath();
  ctx.moveTo(x0 + SPAWN_CHUTE_MARK_INSET, 0);
  ctx.lineTo(x0 + SPAWN_CHUTE_MARK_INSET, 12);
  ctx.moveTo(x0 + CELL - SPAWN_CHUTE_MARK_INSET, 0);
  ctx.lineTo(x0 + CELL - SPAWN_CHUTE_MARK_INSET, 12);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(cx - 8, 6);
  ctx.lineTo(cx, 13);
  ctx.lineTo(cx + 8, 6);
  ctx.moveTo(cx - 6, 12);
  ctx.lineTo(cx, 18);
  ctx.lineTo(cx + 6, 12);
  ctx.stroke();
  ctx.restore();
}

function drawDangerState(ctx, state, rows, theme) {
  const threshold = rows - DANGER_ROWS_REMAINING;
  let any = false;
  for (let c = 0; c < COLS; c++) {
    if (state.stackHeight[c] >= threshold) { any = true; break; }
  }
  if (!any) return;

  const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 220);
  ctx.save();
  ctx.strokeStyle = theme.danger;
  ctx.lineWidth = 3.5;
  for (let c = 0; c < COLS; c++) {
    const height = state.stackHeight[c];
    if (height < threshold) continue;
    const full = height >= rows;
    ctx.globalAlpha = full ? 0.75 : 0.3 + 0.4 * pulse;
    ctx.strokeRect(c * CELL + 2, 2, CELL - 4, rows * CELL - 4);
  }
  ctx.restore();
}

// 19: The ceiling line. Must stroke horizontal line spanning 0 to COLS * CELL at y in [0, CELL)
// with theme.danger, matching CEILING_LINE_ALPHA and CEILING_LINE_ALPHA_MAX under reduced motion.
export function drawCeilingLine(ctx, state, rows, theme) {
  let tallest = 0;
  for (let c = 0; c < COLS; c++) if (state.stackHeight[c] > tallest) tallest = state.stackHeight[c];

  const threshold = Math.max(1, rows - DANGER_ROWS_REMAINING);
  const closeness = Math.max(0, Math.min(1, (tallest - threshold) / DANGER_ROWS_REMAINING));
  let alpha = CEILING_LINE_ALPHA + (CEILING_LINE_ALPHA_MAX - CEILING_LINE_ALPHA) * closeness;

  if (tallest >= rows && !isReducedMotion()) {
    alpha *= 0.75 + 0.25 * (0.5 + 0.5 * Math.sin(Date.now() / 220));
  }

  ctx.save();
  ctx.strokeStyle = theme.danger;
  ctx.globalAlpha = alpha;
  ctx.lineWidth = 2;
  ctx.setLineDash(CEILING_LINE_DASH);
  ctx.beginPath();
  ctx.moveTo(0, 1);
  ctx.lineTo(COLS * CELL, 1);
  ctx.stroke();
  ctx.restore();
}

// 19: The countdown to the next floor rise. Must emit EXACTLY two fillRect calls: track and fill.
export function drawRiseMeter(ctx, state, rows, theme) {
  const cadence = floorRiseCadenceDrops(levelFor(state.spawnIndex));
  if (!Number.isFinite(cadence) || cadence <= 0) return;

  const done = Math.max(0, Math.min(cadence, state.dropsSinceFloorRise));
  const progress = Math.min(1, (done + 1) / cadence);
  const imminent = cadence - done <= 1;

  const y = rows * CELL - RISE_METER_HEIGHT;
  const w = COLS * CELL;

  ctx.save();
  ctx.fillStyle = theme.danger;
  ctx.globalAlpha = RISE_METER_TRACK_ALPHA;
  ctx.fillRect(0, y, w, RISE_METER_HEIGHT);

  let alpha = RISE_METER_FILL_ALPHA;
  if (imminent) {
    alpha = RISE_METER_IMMINENT_ALPHA;
    if (!isReducedMotion()) alpha *= 0.7 + 0.3 * (0.5 + 0.5 * Math.sin(Date.now() / 160));
  }
  ctx.globalAlpha = alpha;
  ctx.fillRect(0, y, w * progress, RISE_METER_HEIGHT);
  ctx.restore();
}

function levelCalloutEnvelope(p) {
  if (p < 0.15) return p / 0.15;
  return 1 - (p - 0.15) / 0.85;
}

function drawLevelCallout(ctx, fx, width, height, theme) {
  const callout = fx.levelCallout;
  if (!callout) return;
  const p = Math.min(1, callout.t / LEVEL_CALLOUT_SEC);
  const alpha = levelCalloutEnvelope(p) * 0.85;
  if (alpha <= 0.002) return;
  const scale = isReducedMotion() ? 1 : 1 + 0.5 * p;

  ctx.save();
  ctx.translate(0, HUD_HEIGHT);
  ctx.globalAlpha = alpha;
  ctx.translate(width / 2, height / 2);
  ctx.scale(scale, scale);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `48px ${DISPLAY_FONT_FAMILY}`;
  ctx.shadowColor = 'rgba(0,0,0,0.4)';
  ctx.shadowBlur = 12;
  ctx.fillStyle = theme.accent;
  if (callout.teach) {
    ctx.font = `40px ${DISPLAY_FONT_FAMILY}`;
    ctx.fillText(callout.teach, 0, -16);
    ctx.fillStyle = theme.text;
    ctx.font = `bold 17px ${FONT_FAMILY}`;
    let size = 17;
    while (size > 11 && ctx.measureText(callout.line).width > width - 24) {
      size -= 1;
      ctx.font = `bold ${size}px ${FONT_FAMILY}`;
    }
    ctx.fillText(callout.line, 0, 22);
  } else if (callout.unlock) {
    ctx.font = `40px ${DISPLAY_FONT_FAMILY}`;
    ctx.fillText('UNLOCKED', 0, -16);
    ctx.font = `bold 19px ${FONT_FAMILY}`;
    ctx.fillStyle = theme.text;
    ctx.fillText(callout.unlock, 0, 22);
  } else {
    ctx.fillText(`LEVEL ${callout.level}`, 0, 0);
  }
  ctx.restore();
}

function withAlpha(rgbaString, alpha) {
  const parts = rgbaString.match(/rgba?\(([^)]+)\)/);
  if (!parts) return rgbaString;
  const [r, g, b] = parts[1].split(',').map((v) => parseFloat(v.trim()));
  return `rgba(${r},${g},${b},${alpha})`;
}

function drawVignette(ctx, width, height, progress) {
  const cx = width / 2;
  const cy = height / 2;
  const outerR = Math.max(width, height) * 0.75;
  const strength = 0.05 + 0.04 * progress;
  const gradient = ctx.createRadialGradient(cx, cy, outerR * 0.35, cx, cy, outerR);
  gradient.addColorStop(0, 'rgba(0,0,0,0)');
  gradient.addColorStop(1, `rgba(0,0,0,${strength.toFixed(3)})`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

// Dual-layer grounding contact shadow: sharp umbra core + diffuse penumbra ambient occlusion
function drawContactShadow(ctx, cx, cy, radius) {
  ctx.beginPath();
  ctx.ellipse(cx, cy + radius * 0.86, radius * 0.52, radius * 0.13, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.fill();

  ctx.beginPath();
  ctx.ellipse(cx, cy + radius * 0.78, radius * 0.80, radius * 0.22, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.07)';
  ctx.fill();
}

function drawSwapSelection(ctx, state, theme) {
  if (!state.swapArmed || !state.swapSelectedCell) return;
  const { row, col } = state.swapSelectedCell;
  const cx = col * CELL + CELL / 2;
  const cy = row * CELL + CELL / 2;
  const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 260);

  ctx.save();
  ctx.globalAlpha = 0.7 + 0.3 * pulse;
  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, CELL * 0.42, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawRemoverCrosshair(ctx, state, theme) {
  if (!state.removerArmed || !state.armPreviewCell) return;
  const { row, col } = state.armPreviewCell;
  const cx = col * CELL + CELL / 2;
  const cy = row * CELL + CELL / 2;
  const r = CELL * REMOVER_CROSSHAIR_SIZE * 0.5;

  ctx.save();
  ctx.strokeStyle = theme.accent;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.moveTo(cx - r * 1.3, cy);
  ctx.lineTo(cx - r * 0.4, cy);
  ctx.moveTo(cx + r * 0.4, cy);
  ctx.lineTo(cx + r * 1.3, cy);
  ctx.moveTo(cx, cy - r * 1.3);
  ctx.lineTo(cx, cy - r * 0.4);
  ctx.moveTo(cx, cy + r * 0.4);
  ctx.lineTo(cx, cy + r * 1.3);
  ctx.stroke();
  ctx.restore();
}

function drawBoard(ctx, state, fx, theme) {
  ctx.save();
  ctx.translate(0, HUD_HEIGHT);

  const rows = state.grid.length;

  ctx.beginPath();
  ctx.rect(0, 0, COLS * CELL, rows * CELL);
  ctx.clip();

  // Vertical grid lines with smooth downward fade
  const gridFade = ctx.createLinearGradient(0, 0, 0, rows * CELL);
  gridFade.addColorStop(0, withAlpha(theme.grid, 0));
  gridFade.addColorStop(0.45, theme.grid);
  gridFade.addColorStop(1, theme.grid);
  ctx.strokeStyle = gridFade;
  ctx.lineWidth = 1;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * CELL, 0);
    ctx.lineTo(c * CELL, rows * CELL);
    ctx.stroke();
  }

  // Subtle modular guide markers at cell boundaries
  ctx.fillStyle = withAlpha(theme.grid, 0.18);
  for (let r = 1; r < rows; r++) {
    for (let c = 1; c < COLS; c++) {
      ctx.fillRect(c * CELL - 1, r * CELL - 1, 2, 2);
    }
  }

  drawSpawnChute(ctx, state, rows, theme);
  drawDangerState(ctx, state, rows, theme);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < COLS; c++) {
      const tierIndex = state.grid[r][c];
      if (tierIndex === null) continue;
      const cy = r * CELL + CELL / 2;
      const def = tierDefFor(tierIndex);
      const color = colorFor(state, tierIndex);
      const cx = c * CELL + CELL / 2;

      drawContactShadow(ctx, cx, cy, def.radius);

      const fuseFraction = bombFuseFractionFor(state, tierIndex);
      const squash = fx ? squashScaleAt(fx, r, c, tierIndex) : null;
      if (squash) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.scale(squash.sx, squash.sy);
        drawFruit(ctx, 0, 0, def, color, tierIndex, fuseFraction);
        ctx.restore();
      } else {
        drawFruit(ctx, cx, cy, def, color, tierIndex, fuseFraction);
      }
    }
  }

  if (fx) drawGhosts(ctx, fx, state);

  drawSwapSelection(ctx, state, theme);
  drawRemoverCrosshair(ctx, state, theme);

  if (state.active) {
    const def = tierDefFor(state.active.tier);
    drawFruit(ctx, state.active.x, state.active.y, def, colorFor(state, state.active.tier), state.active.tier,
      bombFuseFractionFor(state, state.active.tier));
  }

  const { index, t } = themePosition(state.score);
  drawVignette(ctx, COLS * CELL, rows * CELL, index + t);

  ctx.restore();
}

function drawGhosts(ctx, fx, state) {
  for (const g of fx.ghosts) {
    if (g.t >= 0) continue;
    const def = tierDefFor(g.tier);
    if (!def) continue;
    drawContactShadow(ctx, g.x, g.y, def.radius);
    drawFruit(ctx, g.x, g.y, def, g.color || colorFor(state, g.tier), g.tier,
      bombFuseFractionFor(state, g.tier));
  }
}

// Master fruit drawing dispatcher
export function drawFruit(ctx, x, y, tier, color, tierIndex, fuseFraction) {
  const fill = color || tier.color;
  if (tier.shape === 'rainbow' || tierIndex === RAINBOW_TIER) {
    drawRainbow(ctx, x, y, tier.radius);
    return;
  }
  if (tier.shape === 'bomb' || tierIndex === BOMB_TIER) {
    drawBombShape(ctx, x, y, tier.radius, fuseFraction ?? 1);
    return;
  }
  if (tier.shape === 'stone' || tierIndex === STONE_TIER) {
    drawStone(ctx, x, y, tier.radius);
    return;
  }

  // Resolve tier index 0..8 for dedicated organic sculpted rendering
  let resolvedTier = tierIndex;
  if (resolvedTier === undefined && tier) {
    if (tier.name === 'cherry') resolvedTier = 0;
    else if (tier.name === 'grape') resolvedTier = 1;
    else if (tier.name === 'lemon') resolvedTier = 2;
    else if (tier.name === 'orange') resolvedTier = 3;
    else if (tier.name === 'apple') resolvedTier = 4;
    else if (tier.name === 'pear') resolvedTier = 5;
    else if (tier.name === 'peach') resolvedTier = 6;
    else if (tier.name === 'pineapple') resolvedTier = 7;
    else if (tier.name === 'watermelon') resolvedTier = 8;
  }

  drawOrganicFruitBody(ctx, x, y, tier.radius, fill, resolvedTier);
  drawTierDetail(ctx, x, y, tier.radius, resolvedTier, tier);
}

// 21: The Stone -- faceted basalt monolith with glowing magical fissures
const STONE_PTS = [
  [-0.86, -0.34], [-0.42, -0.92], [0.44, -0.88],
  [0.92, -0.22], [0.62, 0.80], [-0.52, 0.90],
];

function drawStone(ctx, x, y, radius) {
  const r = radius;
  ctx.save();

  // Stone base polygon
  ctx.beginPath();
  STONE_PTS.forEach(([px, py], i) => {
    const vx = x + px * r;
    const vy = y + py * r;
    if (i === 0) ctx.moveTo(vx, vy); else ctx.lineTo(vx, vy);
  });
  ctx.closePath();
  ctx.fillStyle = STONE_DEF.color;
  ctx.fill();

  const cx = x + 0.05 * r;
  const cy = y - 0.12 * r;

  // Facet 1: Lit top-left facet
  ctx.beginPath();
  ctx.moveTo(x + STONE_PTS[0][0] * r, y + STONE_PTS[0][1] * r);
  ctx.lineTo(x + STONE_PTS[1][0] * r, y + STONE_PTS[1][1] * r);
  ctx.lineTo(x + STONE_PTS[2][0] * r, y + STONE_PTS[2][1] * r);
  ctx.lineTo(cx, cy);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255,255,255,0.26)';
  ctx.fill();

  // Facet 2: Midtone right facet
  ctx.beginPath();
  ctx.moveTo(x + STONE_PTS[2][0] * r, y + STONE_PTS[2][1] * r);
  ctx.lineTo(x + STONE_PTS[3][0] * r, y + STONE_PTS[3][1] * r);
  ctx.lineTo(cx, cy);
  ctx.closePath();
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fill();

  // Facet 3: Darkened bottom facet
  ctx.beginPath();
  ctx.moveTo(x + STONE_PTS[3][0] * r, y + STONE_PTS[3][1] * r);
  ctx.lineTo(x + STONE_PTS[4][0] * r, y + STONE_PTS[4][1] * r);
  ctx.lineTo(x + STONE_PTS[5][0] * r, y + STONE_PTS[5][1] * r);
  ctx.lineTo(cx, cy);
  ctx.closePath();
  ctx.fillStyle = 'rgba(0,0,0,0.30)';
  ctx.fill();

  // Facet 4: Bottom-left shaded facet
  ctx.beginPath();
  ctx.moveTo(x + STONE_PTS[5][0] * r, y + STONE_PTS[5][1] * r);
  ctx.lineTo(x + STONE_PTS[0][0] * r, y + STONE_PTS[0][1] * r);
  ctx.lineTo(cx, cy);
  ctx.closePath();
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  ctx.fill();

  // Sharp facet ridge highlights
  ctx.strokeStyle = 'rgba(255,255,255,0.42)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(x + STONE_PTS[1][0] * r, y + STONE_PTS[1][1] * r);
  ctx.lineTo(cx, cy);
  ctx.moveTo(x + STONE_PTS[2][0] * r, y + STONE_PTS[2][1] * r);
  ctx.lineTo(cx, cy);
  ctx.stroke();

  // Glowing runic cracked fissures
  const pulse = 0.72 + 0.28 * Math.sin(Date.now() / 260);

  // Fissure underlay glow
  ctx.strokeStyle = `rgba(56, 189, 248, ${0.48 * pulse})`;
  ctx.lineWidth = 3.2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x - 0.14 * r, y - 0.12 * r);
  ctx.lineTo(x - 0.32 * r, y + 0.20 * r);
  ctx.lineTo(x - 0.22 * r, y + 0.48 * r);
  ctx.moveTo(x + 0.08 * r, y - 0.14 * r);
  ctx.lineTo(x + 0.28 * r, y + 0.16 * r);
  ctx.lineTo(x + 0.42 * r, y + 0.42 * r);
  ctx.moveTo(x - 0.04 * r, y - 0.38 * r);
  ctx.lineTo(x - 0.14 * r, y - 0.12 * r);
  ctx.stroke();

  // Fissure energetic core
  ctx.strokeStyle = `rgba(224, 242, 254, ${0.95 * pulse})`;
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(x - 0.14 * r, y - 0.12 * r);
  ctx.lineTo(x - 0.32 * r, y + 0.20 * r);
  ctx.lineTo(x - 0.22 * r, y + 0.48 * r);
  ctx.moveTo(x + 0.08 * r, y - 0.14 * r);
  ctx.lineTo(x + 0.28 * r, y + 0.16 * r);
  ctx.lineTo(x + 0.42 * r, y + 0.42 * r);
  ctx.moveTo(x - 0.04 * r, y - 0.38 * r);
  ctx.lineTo(x - 0.14 * r, y - 0.12 * r);
  ctx.stroke();

  // Chiseled surface pits
  ctx.fillStyle = 'rgba(0,0,0,0.32)';
  ctx.beginPath();
  ctx.arc(x - 0.26 * r, y + 0.10 * r, r * 0.10, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x + 0.32 * r, y + 0.34 * r, r * 0.08, 0, Math.PI * 2);
  ctx.fill();

  // Outer bevel stroke
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  STONE_PTS.forEach(([px, py], i) => {
    const vx = x + px * r;
    const vy = y + py * r;
    if (i === 0) ctx.moveTo(vx, vy); else ctx.lineTo(vx, vy);
  });
  ctx.closePath();
  ctx.stroke();

  ctx.restore();
}

function highlightAngleFor(tierIndex) {
  if (tierIndex === undefined) return -Math.PI * 0.75;
  return -Math.PI * 0.75 - (tierIndex % 5) * 0.22;
}

// Sculpted organic silhouettes with bezierCurveTo, clipped 4-stop createRadialGradient
// volumetric 3D lighting, conforming inner rim highlight, and crisp specular glints.
function drawOrganicFruitBody(ctx, x, y, radius, fill, resolvedTier) {
  ctx.save();

  // 1. Build organic bezier silhouette path
  ctx.beginPath();
  buildTierPath(ctx, x, y, radius, resolvedTier);

  // 2. Base saturated fill
  ctx.fillStyle = fill;
  ctx.fill();

  // 3. Clip strictly to the organic silhouette so volumetric 3D lighting conforms seamlessly
  ctx.clip();

  // 4. Volumetric 3D spherical lighting via 4-stop createRadialGradient
  const volGrad = ctx.createRadialGradient(
    x - radius * 0.35, y - radius * 0.35, radius * 0.05,
    x, y, radius * 1.05
  );
  volGrad.addColorStop(0, 'rgba(255, 255, 255, 0.44)');   // 1. Focal highlight offset top-left
  volGrad.addColorStop(0.35, 'rgba(255, 255, 255, 0.05)'); // 2. Rich saturated midtone transition
  volGrad.addColorStop(0.78, 'rgba(0, 0, 0, 0.26)');        // 3. Deep shadowed penumbra
  volGrad.addColorStop(1.0, 'rgba(255, 255, 255, 0.16)');  // 4. Warm ambient bounce light in bottom-right shadow
  ctx.fillStyle = volGrad;
  ctx.fillRect(x - radius * 1.5, y - radius * 1.5, radius * 3, radius * 3);

  // 5. Conforming inner rim highlight & shadow (strictly clipped to organic silhouette; never floats outside)
  const rimGrad = ctx.createLinearGradient(x - radius, y - radius, x + radius, y + radius);
  rimGrad.addColorStop(0, 'rgba(255, 255, 255, 0.42)');
  rimGrad.addColorStop(0.42, 'rgba(255, 255, 255, 0.0)');
  rimGrad.addColorStop(0.72, 'rgba(0, 0, 0, 0.0)');
  rimGrad.addColorStop(1.0, 'rgba(0, 0, 0, 0.20)');
  ctx.beginPath();
  buildTierPath(ctx, x, y, radius, resolvedTier);
  ctx.strokeStyle = rimGrad;
  ctx.lineWidth = Math.max(1.6, radius * 0.13);
  ctx.stroke();

  ctx.restore();

  // 6. Crisp vector outer silhouette stroke
  ctx.save();
  ctx.beginPath();
  buildTierPath(ctx, x, y, radius, resolvedTier);
  ctx.lineWidth = 1.8;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.22)';
  ctx.stroke();

  // 7. Sharp vector specular glints (capsule + micro-sparkle pinpoint)
  const angle = highlightAngleFor(resolvedTier);
  const hx = x + Math.cos(angle) * radius * 0.50;
  const hy = y + Math.sin(angle) * radius * 0.50;

  ctx.beginPath();
  ctx.ellipse(hx, hy, radius * 0.28, radius * 0.13, angle + Math.PI / 2, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.46)';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(hx + Math.cos(angle - 0.45) * radius * 0.24, hy + Math.sin(angle - 0.45) * radius * 0.24, radius * 0.08, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
  ctx.fill();

  ctx.restore();
}

// Sculpted organic silhouettes with bezierCurveTo / quadraticCurveTo for each individual fruit tier
function buildTierPath(ctx, x, y, r, tierIndex) {
  if (tierIndex === 0) {
    // Tier 0: Cherry (indented top stem dimple with rounded heart silhouette)
    ctx.moveTo(x, y - r * 0.76);
    ctx.bezierCurveTo(x + r * 0.55, y - r * 1.05, x + r * 1.15, y - r * 0.35, x + r * 0.98, y + r * 0.30);
    ctx.bezierCurveTo(x + r * 0.85, y + r * 0.85, x + r * 0.35, y + r * 1.05, x, y + r * 0.96);
    ctx.bezierCurveTo(x - r * 0.35, y + r * 1.05, x - r * 0.85, y + r * 0.85, x - r * 0.98, y + r * 0.30);
    ctx.bezierCurveTo(x - r * 1.15, y - r * 0.35, x - r * 0.55, y - r * 1.05, x, y - r * 0.76);
    ctx.closePath();
  } else if (tierIndex === 1) {
    // Tier 1: Grape (clustered plump berry silhouette with rounded lobe protrusions)
    ctx.moveTo(x, y - r * 0.94);
    ctx.bezierCurveTo(x + r * 0.52, y - r * 1.04, x + r * 0.96, y - r * 0.55, x + r * 0.88, y - r * 0.15);
    ctx.bezierCurveTo(x + r * 1.12, y + r * 0.20, x + r * 0.86, y + r * 0.72, x + r * 0.45, y + r * 0.94);
    ctx.bezierCurveTo(x + r * 0.20, y + r * 1.06, x - r * 0.20, y + r * 1.06, x - r * 0.45, y + r * 0.94);
    ctx.bezierCurveTo(x - r * 0.86, y + r * 0.72, x - r * 1.12, y + r * 0.20, x - r * 0.88, y - r * 0.15);
    ctx.bezierCurveTo(x - r * 0.96, y - r * 0.55, x - r * 0.52, y - r * 1.04, x, y - r * 0.94);
    ctx.closePath();
  } else if (tierIndex === 2) {
    // Tier 2: Lemon (upright plump juicy lemon with organic pole nubs)
    const topY = y - r * 1.05;
    const botY = y + r * 1.02;
    ctx.moveTo(x, topY);
    // Right upper belly
    ctx.bezierCurveTo(x + r * 0.22, topY + r * 0.12, x + r * 0.92, y - r * 0.48, x + r * 0.92, y + r * 0.04);
    // Right lower belly to bottom nub
    ctx.bezierCurveTo(x + r * 0.92, y + r * 0.56, x + r * 0.22, botY - r * 0.10, x, botY);
    // Left lower belly from bottom nub
    ctx.bezierCurveTo(x - r * 0.22, botY - r * 0.10, x - r * 0.92, y + r * 0.56, x - r * 0.92, y + r * 0.04);
    // Left upper belly to top nub
    ctx.bezierCurveTo(x - r * 0.92, y - r * 0.48, x - r * 0.22, topY + r * 0.12, x, topY);
    ctx.closePath();
  } else if (tierIndex === 3) {
    // Tier 3: Orange -- User top-priority fix: PERFECTLY ROUND AND PLUMP CIRCULAR SPHERE
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.closePath();
  } else if (tierIndex === 4) {
    // Tier 4: Apple (indented shoulders and base clefts)
    ctx.moveTo(x, y - r * 0.82);
    ctx.bezierCurveTo(x + r * 0.60, y - r * 1.12, x + r * 1.14, y - r * 0.30, x + r * 0.96, y + r * 0.40);
    ctx.bezierCurveTo(x + r * 0.82, y + r * 0.96, x + r * 0.25, y + r * 1.04, x, y + r * 0.88);
    ctx.bezierCurveTo(x - r * 0.25, y + r * 1.04, x - r * 0.82, y + r * 0.96, x - r * 0.96, y + r * 0.40);
    ctx.bezierCurveTo(x - r * 1.14, y - r * 0.30, x - r * 0.60, y - r * 1.12, x, y - r * 0.82);
    ctx.closePath();
  } else if (tierIndex === 5) {
    // Tier 5: Pear (bell-bottom teardrop silhouette: narrow neck flaring into wide rounded belly)
    ctx.moveTo(x, y - r * 0.96);
    ctx.bezierCurveTo(x + r * 0.35, y - r * 0.95, x + r * 0.44, y - r * 0.30, x + r * 0.84, y + r * 0.25);
    ctx.bezierCurveTo(x + r * 1.16, y + r * 0.70, x + r * 0.56, y + r * 1.05, x, y + r * 1.04);
    ctx.bezierCurveTo(x - r * 0.56, y + r * 1.05, x - r * 1.16, y + r * 0.70, x - r * 0.84, y + r * 0.25);
    ctx.bezierCurveTo(x - r * 0.44, y - r * 0.30, x - r * 0.35, y - r * 0.95, x, y - r * 0.96);
    ctx.closePath();
  } else if (tierIndex === 6) {
    // Tier 6: Peach (sensual heart-cleft silhouette with organic curvature)
    ctx.moveTo(x, y - r * 0.84);
    ctx.bezierCurveTo(x + r * 0.58, y - r * 1.06, x + r * 1.15, y - r * 0.20, x + r * 0.92, y + r * 0.48);
    ctx.bezierCurveTo(x + r * 0.70, y + r * 0.92, x + r * 0.22, y + r * 1.08, x, y + r * 1.05);
    ctx.bezierCurveTo(x - r * 0.22, y + r * 1.08, x - r * 0.70, y + r * 0.92, x - r * 0.92, y + r * 0.48);
    ctx.bezierCurveTo(x - r * 1.15, y - r * 0.20, x - r * 0.58, y - r * 1.06, x, y - r * 0.84);
    ctx.closePath();
  } else if (tierIndex === 7) {
    // Tier 7: Pineapple (sturdy barrel shape with rounded shoulders)
    ctx.moveTo(x - r * 0.65, y - r * 0.82);
    ctx.lineTo(x + r * 0.65, y - r * 0.82);
    ctx.bezierCurveTo(x + r * 1.08, y - r * 0.40, x + r * 1.08, y + r * 0.40, x + r * 0.65, y + r * 0.86);
    ctx.quadraticCurveTo(x, y + r * 0.95, x - r * 0.65, y + r * 0.86);
    ctx.bezierCurveTo(x - r * 1.08, y + r * 0.40, x - r * 1.08, y - r * 0.40, x - r * 0.65, y - r * 0.82);
    ctx.closePath();
  } else if (tierIndex === 8) {
    // Tier 8: Watermelon (giant rounded organic melon)
    ctx.moveTo(x, y - r * 0.98);
    ctx.bezierCurveTo(x + r * 0.72, y - r * 1.02, x + r * 1.05, y - r * 0.52, x + r * 1.03, y);
    ctx.bezierCurveTo(x + r * 1.05, y + r * 0.52, x + r * 0.72, y + r * 1.02, x, y + r * 0.98);
    ctx.bezierCurveTo(x - r * 0.72, y + r * 1.02, x - r * 1.05, y + r * 0.52, x - r * 1.03, y);
    ctx.bezierCurveTo(x - r * 1.05, y - r * 0.52, x - r * 0.72, y - r * 1.02, x, y - r * 0.98);
    ctx.closePath();
  } else {
    // Fallback circle
    ctx.arc(x, y, r, 0, Math.PI * 2);
  }
}

// 8-wedge prismatic iridescent rainbow disc with glass gloss
const RAINBOW_WEDGES = ['#ff2a55', '#ff7a00', '#ffc700', '#10b981', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'];

function drawRainbow(ctx, x, y, radius) {
  const spin = (Date.now() / 1000) * RAINBOW_SPIN_RADIANS_PER_SEC;
  ctx.save();

  // Prismatic spectral pinwheel
  RAINBOW_WEDGES.forEach((c, i) => {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.arc(
      x, y, radius,
      spin + (i / RAINBOW_WEDGES.length) * Math.PI * 2 - Math.PI / 2,
      spin + ((i + 1) / RAINBOW_WEDGES.length) * Math.PI * 2 - Math.PI / 2
    );
    ctx.closePath();
    ctx.fillStyle = c;
    ctx.fill();
  });

  // Concentric iridescent diffraction arcs
  ctx.beginPath();
  ctx.arc(x, y, radius * 0.72, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // Outer vector border
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(0,0,0,0.22)';
  ctx.stroke();

  // Upper convex glass gloss dome
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.clip();
  const glossGrad = ctx.createLinearGradient(x, y - radius, x, y + radius * 0.1);
  glossGrad.addColorStop(0, 'rgba(255,255,255,0.46)');
  glossGrad.addColorStop(1, 'rgba(255,255,255,0.06)');
  ctx.beginPath();
  ctx.ellipse(x, y - radius * 0.35, radius * 0.85, radius * 0.46, 0, 0, Math.PI * 2);
  ctx.fillStyle = glossGrad;
  ctx.fill();
  ctx.restore();

  // Crystalline prism center: 4-pointed diamond star
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  const starR = radius * 0.36;
  ctx.beginPath();
  ctx.moveTo(x, y - starR);
  ctx.quadraticCurveTo(x, y, x + starR, y);
  ctx.quadraticCurveTo(x, y, x, y + starR);
  ctx.quadraticCurveTo(x, y, x - starR, y);
  ctx.quadraticCurveTo(x, y, x, y - starR);
  ctx.closePath();
  ctx.fill();

  ctx.restore();
}

// Tactile bomb with brass collar and animated star-spark fuse
function drawBombShape(ctx, x, y, radius, fuseFraction) {
  ctx.save();

  // Heavy cast-iron metallic spherical body
  ctx.beginPath();
  ctx.arc(x, y + radius * 0.12, radius * 0.82, 0, Math.PI * 2);
  ctx.fillStyle = BOMB_DEF.color;
  ctx.fill();

  // Metallic radial shine
  const bombShine = ctx.createRadialGradient(
    x - radius * 0.28, y - radius * 0.10, radius * 0.08,
    x, y + radius * 0.12, radius * 0.82
  );
  bombShine.addColorStop(0, 'rgba(255,255,255,0.22)');
  bombShine.addColorStop(0.5, 'rgba(255,255,255,0.0)');
  bombShine.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = bombShine;
  ctx.fill();

  ctx.lineWidth = 1.8;
  ctx.strokeStyle = 'rgba(0,0,0,0.30)';
  ctx.stroke();

  // Gloss crescent on top-left
  ctx.beginPath();
  ctx.arc(x - radius * 0.28, y - radius * 0.06, radius * 0.24, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.26)';
  ctx.fill();

  // Sharp micro-glint dot
  ctx.beginPath();
  ctx.arc(x - radius * 0.38, y - radius * 0.18, radius * 0.07, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.65)';
  ctx.fill();

  // Knurled metallic brass collar at nozzle
  const fuseBaseX = x + radius * 0.32;
  const fuseBaseY = y - radius * 0.62;
  ctx.fillStyle = '#d4af37';
  ctx.beginPath();
  ctx.ellipse(fuseBaseX, fuseBaseY + 2, radius * 0.16, radius * 0.08, 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#78350f';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Braided burning fuse
  const clamped = Math.max(0.08, fuseFraction);
  const fuseLen = radius * 1.08 * clamped;
  const fuseEndX = fuseBaseX + fuseLen * 0.55;
  const fuseEndY = fuseBaseY - fuseLen * 0.85;

  ctx.lineWidth = Math.max(1.8, radius * 0.12);
  ctx.strokeStyle = '#8a5a2a';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(fuseBaseX, fuseBaseY);
  ctx.quadraticCurveTo(fuseBaseX + fuseLen * 0.3, fuseBaseY - fuseLen * 0.3, fuseEndX, fuseEndY);
  ctx.stroke();

  // Dynamic animated star-spark at fuse tip
  const isUrgent = fuseFraction < 0.3;
  const sparkFreq = isUrgent ? 45 : 85;
  const pulse = 0.65 + 0.35 * Math.sin(Date.now() / sparkFreq);
  const sr = radius * 0.24 * pulse;

  ctx.save();
  ctx.translate(fuseEndX, fuseEndY);

  ctx.fillStyle = isUrgent ? '#ef4444' : '#f97316';
  ctx.beginPath();
  ctx.moveTo(0, -sr);
  ctx.lineTo(sr * 0.28, -sr * 0.28);
  ctx.lineTo(sr, 0);
  ctx.lineTo(sr * 0.28, sr * 0.28);
  ctx.lineTo(0, sr);
  ctx.lineTo(-sr * 0.28, sr * 0.28);
  ctx.lineTo(-sr, 0);
  ctx.lineTo(-sr * 0.28, -sr * 0.28);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(0, 0, sr * 0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.restore();
}

function drawTierDetail(ctx, x, y, radius, tierIndex, tierDef) {
  if (tierIndex === undefined && !tierDef) return;
  const tier = (tierIndex !== undefined ? TIERS[tierIndex] : tierDef);
  if (!tier) return;

  const name = tier.name;
  if (name === 'cherry' || tierIndex === 0) {
    drawCherryDetail(ctx, x, y, radius);
  } else if (name === 'grape' || tierIndex === 1) {
    drawGrapeDetail(ctx, x, y, radius);
  } else if (name === 'lemon' || tierIndex === 2) {
    drawLemonDetail(ctx, x, y, radius);
  } else if (name === 'orange' || tierIndex === 3) {
    drawOrangeDetail(ctx, x, y, radius);
  } else if (name === 'apple' || tierIndex === 4) {
    drawAppleDetail(ctx, x, y, radius);
  } else if (name === 'pear' || tierIndex === 5) {
    drawPearDetail(ctx, x, y, radius);
  } else if (name === 'peach' || tierIndex === 6) {
    drawPeachDetail(ctx, x, y, radius);
  } else if (name === 'pineapple' || tierIndex === 7) {
    drawPineappleDetail(ctx, x, y, radius);
  } else if (name === 'watermelon' || tierIndex === 8) {
    drawWatermelonDetail(ctx, x, y, radius);
  } else if (tierIndex !== undefined && tierIndex >= 4) {
    drawStemAndLeaf(ctx, x, y, radius);
  }
}

// Tier 0: Cherry Detail
function drawCherryDetail(ctx, x, y, radius) {
  ctx.save();

  ctx.beginPath();
  ctx.arc(x, y - radius * 0.78, radius * 0.16, 0, Math.PI);
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.fill();

  ctx.strokeStyle = '#4a3018';
  ctx.lineWidth = Math.max(1.6, radius * 0.10);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y - radius * 0.80);
  ctx.quadraticCurveTo(x + radius * 0.28, y - radius * 1.25, x + radius * 0.36, y - radius * 1.48);
  ctx.stroke();

  ctx.save();
  ctx.translate(x + radius * 0.25, y - radius * 1.30);
  ctx.rotate(0.38);
  ctx.beginPath();
  ctx.ellipse(0, 0, radius * 0.24, radius * 0.11, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#388e3c';
  ctx.fill();
  ctx.strokeStyle = '#81c784';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-radius * 0.18, 0);
  ctx.lineTo(radius * 0.18, 0);
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.beginPath();
  ctx.arc(x - radius * 0.22, y - radius * 0.25, radius * 0.10, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// Tier 1: Grape Detail
function drawGrapeDetail(ctx, x, y, radius) {
  ctx.save();

  // Woody stem
  ctx.strokeStyle = '#4a3018';
  ctx.lineWidth = Math.max(1.6, radius * 0.11);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y - radius * 0.92);
  ctx.lineTo(x + radius * 0.06, y - radius * 1.25);
  ctx.stroke();

  // Curled green vine tendril
  ctx.strokeStyle = '#43a047';
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.arc(x + radius * 0.22, y - radius * 1.16, radius * 0.13, Math.PI * 0.4, Math.PI * 1.85);
  ctx.stroke();

  // Interior berry division creases delineating individual grapes in cluster
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.18)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.arc(x - radius * 0.35, y - radius * 0.25, radius * 0.42, 0.2, Math.PI * 0.65);
  ctx.arc(x + radius * 0.35, y - radius * 0.25, radius * 0.42, Math.PI * 0.35, Math.PI * 0.80);
  ctx.arc(x, y + radius * 0.35, radius * 0.45, -Math.PI * 0.80, -Math.PI * 0.20);
  ctx.stroke();

  // Clustered interior berry highlights
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.32)';
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.arc(x - radius * 0.22, y - radius * 0.38, radius * 0.22, -Math.PI * 0.8, -Math.PI * 0.15);
  ctx.arc(x + radius * 0.22, y - radius * 0.35, radius * 0.20, -Math.PI * 0.8, -Math.PI * 0.15);
  ctx.arc(x, y + radius * 0.15, radius * 0.24, -Math.PI * 0.8, -Math.PI * 0.15);
  ctx.stroke();

  ctx.restore();
}

// Tier 2: Lemon Detail -- Plump sunny citrus with fresh green leaf, stem node, and delicate zest texture
function drawLemonDetail(ctx, x, y, radius) {
  ctx.save();

  const topY = y - radius * 1.04;

  // 1. Calyx / stem node at top pole tip
  ctx.fillStyle = '#2e7d32';
  ctx.beginPath();
  ctx.arc(x, topY + radius * 0.04, radius * 0.10, 0, Math.PI * 2);
  ctx.fill();

  // Woody stem bud
  ctx.strokeStyle = '#4a2e1b';
  ctx.lineWidth = Math.max(1.4, radius * 0.08);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, topY + radius * 0.04);
  ctx.quadraticCurveTo(x + radius * 0.06, topY - radius * 0.12, x + radius * 0.03, topY - radius * 0.22);
  ctx.stroke();

  // Fresh vibrant green leaf sprouting to upper right
  ctx.save();
  ctx.translate(x + radius * 0.10, topY - radius * 0.10);
  ctx.rotate(0.40);
  ctx.beginPath();
  ctx.ellipse(0, 0, radius * 0.28, radius * 0.12, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#43a047';
  ctx.fill();
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.16)';
  ctx.lineWidth = 0.9;
  ctx.stroke();

  // Leaf central vein
  ctx.strokeStyle = '#a5d6a7';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-radius * 0.22, 0);
  ctx.lineTo(radius * 0.22, 0);
  ctx.stroke();
  ctx.restore();

  // 2. Soft curved longitudinal highlight on upper-left flank
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.38)';
  ctx.lineWidth = Math.max(1.4, radius * 0.08);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(x - radius * 0.10, y, radius * 0.65, -Math.PI * 0.75, -Math.PI * 0.22);
  ctx.stroke();

  // 3. Delicate citrus peel zest pores (warm golden dimples)
  ctx.fillStyle = 'rgba(180, 130, 0, 0.15)';
  const pores = [
    [-0.24, -0.32], [0.30, -0.22], [-0.35, 0.18], [0.26, 0.30], [-0.06, 0.48], [0.08, -0.52]
  ];
  for (const [px, py] of pores) {
    ctx.beginPath();
    ctx.arc(x + px * radius, y + py * radius, 1.1, 0, Math.PI * 2);
    ctx.fill();
  }

  // 4. Subtle organic dimple crease at bottom pole tip
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.16)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(x, y + radius * 0.96, radius * 0.08, 0, Math.PI);
  ctx.stroke();

  ctx.restore();
}

// Tier 3: Orange Detail -- Circular sphere with vivid emerald calyx star navel
function drawOrangeDetail(ctx, x, y, radius) {
  ctx.save();

  const cyx = x;
  const cyy = y - radius * 0.88;
  const s = radius * 0.16;
  ctx.fillStyle = '#2e7d32';
  ctx.beginPath();
  ctx.moveTo(cyx, cyy - s);
  ctx.lineTo(cyx + s * 0.35, cyy - s * 0.35);
  ctx.lineTo(cyx + s, cyy);
  ctx.lineTo(cyx + s * 0.35, cyy + s * 0.35);
  ctx.lineTo(cyx, cyy + s);
  ctx.lineTo(cyx - s * 0.35, cyy + s * 0.35);
  ctx.lineTo(cyx - s, cyy);
  ctx.lineTo(cyx - s * 0.35, cyy - s * 0.35);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#a5d6a7';
  ctx.beginPath();
  ctx.arc(cyx, cyy, s * 0.28, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(x, y, radius * 0.72, -Math.PI * 0.82, -Math.PI * 0.08);
  ctx.stroke();

  ctx.fillStyle = 'rgba(0,0,0,0.10)';
  const pores = [[-0.22, -0.32], [0.35, -0.25], [-0.38, 0.20], [0.28, 0.32], [-0.08, 0.44]];
  for (const [px, py] of pores) {
    ctx.beginPath();
    ctx.arc(x + px * radius, y + py * radius, 1.1, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

// Tier 4: Apple Detail
function drawAppleDetail(ctx, x, y, radius) {
  ctx.save();

  ctx.beginPath();
  ctx.arc(x, y - radius * 0.82, radius * 0.18, 0, Math.PI);
  ctx.fillStyle = 'rgba(0,0,0,0.30)';
  ctx.fill();

  ctx.strokeStyle = '#4a2e1b';
  ctx.lineWidth = Math.max(1.8, radius * 0.11);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y - radius * 0.86);
  ctx.quadraticCurveTo(x + radius * 0.14, y - radius * 1.20, x + radius * 0.08, y - radius * 1.40);
  ctx.stroke();

  ctx.save();
  ctx.translate(x + radius * 0.22, y - radius * 1.16);
  ctx.rotate(-0.42);
  ctx.beginPath();
  ctx.ellipse(0, 0, radius * 0.32, radius * 0.15, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#388e3c';
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.strokeStyle = '#a5d6a7';
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(-radius * 0.24, 0);
  ctx.lineTo(radius * 0.24, 0);
  ctx.stroke();
  ctx.restore();

  ctx.restore();
}

// Tier 5: Pear Detail
const PEAR_FRECKLES = [[-0.25, 0.45], [0.18, 0.52], [-0.05, 0.65], [0.32, 0.38], [-0.35, 0.22]];

function drawPearDetail(ctx, x, y, radius) {
  ctx.save();

  ctx.strokeStyle = '#5c3d24';
  ctx.lineWidth = Math.max(1.6, radius * 0.10);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y - radius * 0.90);
  ctx.quadraticCurveTo(x - radius * 0.14, y - radius * 1.22, x - radius * 0.07, y - radius * 1.38);
  ctx.stroke();

  ctx.save();
  ctx.translate(x + radius * 0.18, y - radius * 1.14);
  ctx.rotate(-0.54);
  ctx.beginPath();
  ctx.ellipse(0, 0, radius * 0.28, radius * 0.13, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#4caf50';
  ctx.fill();
  ctx.strokeStyle = '#81c784';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-radius * 0.2, 0);
  ctx.lineTo(radius * 0.2, 0);
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = 'rgba(0,0,0,0.14)';
  for (const [fx, fy] of PEAR_FRECKLES) {
    ctx.beginPath();
    ctx.arc(x + fx * radius, y + fy * radius, 1.2, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.30)';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(x - radius * 0.1, y + radius * 0.2, radius * 0.58, Math.PI * 0.8, Math.PI * 1.35);
  ctx.stroke();

  ctx.restore();
}

// Tier 6: Peach Detail
function drawPeachDetail(ctx, x, y, radius) {
  ctx.save();

  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = 1.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y - radius * 0.88);
  ctx.quadraticCurveTo(x + radius * 0.10, y - radius * 0.15, x, y + radius * 0.68);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(x - radius * 0.06, y - radius * 0.80);
  ctx.quadraticCurveTo(x + radius * 0.04, y - radius * 0.15, x - radius * 0.06, y + radius * 0.60);
  ctx.stroke();

  ctx.strokeStyle = '#4a2e1b';
  ctx.lineWidth = Math.max(1.5, radius * 0.09);
  ctx.beginPath();
  ctx.moveTo(x, y - radius * 0.88);
  ctx.lineTo(x + radius * 0.04, y - radius * 1.20);
  ctx.stroke();

  ctx.fillStyle = '#43a047';
  ctx.beginPath();
  ctx.ellipse(x - radius * 0.15, y - radius * 1.08, radius * 0.20, radius * 0.10, -0.38, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(x + radius * 0.18, y - radius * 1.10, radius * 0.18, radius * 0.09, 0.42, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// Tier 7: Pineapple Detail
const PINEAPPLE_OFFSETS = [-0.4, 0, 0.4];

function drawPineappleDetail(ctx, x, y, radius) {
  ctx.save();

  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = 1.4;
  for (const off of PINEAPPLE_OFFSETS) {
    ctx.beginPath();
    ctx.moveTo(x - radius * 0.65, y + off * radius - radius * 0.35);
    ctx.lineTo(x + radius * 0.65, y + off * radius + radius * 0.35);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - radius * 0.65, y + off * radius + radius * 0.35);
    ctx.lineTo(x + radius * 0.65, y + off * radius - radius * 0.35);
    ctx.stroke();
  }

  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  const scalePips = [[0, 0], [-0.3, -0.28], [0.3, -0.28], [-0.3, 0.28], [0.3, 0.28]];
  for (const [px, py] of scalePips) {
    ctx.beginPath();
    ctx.arc(x + px * radius, y + py * radius, 1.4, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
  drawPineappleCrown(ctx, x, y, radius);
}

function drawPineappleCrown(ctx, x, y, radius) {
  const spikes = 5;
  ctx.save();
  ctx.fillStyle = '#2e7d32';
  ctx.strokeStyle = 'rgba(0,0,0,0.20)';
  ctx.lineWidth = 1.1;

  for (let i = 0; i < spikes; i++) {
    const t = (i - (spikes - 1) / 2) / spikes;
    const baseX = x + t * radius * 1.15;
    const baseY = y - radius * 0.85;
    const tipX = x + t * radius * 0.65;
    const tipY = y - radius * (1.55 + Math.abs(t) * 0.32);
    ctx.beginPath();
    ctx.moveTo(baseX - radius * 0.09, baseY);
    ctx.lineTo(tipX, tipY);
    ctx.lineTo(baseX + radius * 0.09, baseY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = '#66bb6a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(baseX, baseY);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();
  }
  ctx.restore();
}

// Tier 8: Watermelon Detail
const SEED_POSITIONS = [
  [-0.35, -0.1], [0.12, -0.36], [0.4, 0.05], [0.02, 0.36],
  [-0.32, 0.3], [0.3, -0.34], [-0.46, 0.14],
];

function drawWatermelonDetail(ctx, x, y, radius) {
  ctx.save();

  ctx.strokeStyle = '#1b5e20';
  ctx.lineWidth = Math.max(2.8, radius * 0.13);
  ctx.beginPath();
  ctx.arc(x, y, radius - ctx.lineWidth / 2, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(200, 250, 200, 0.65)';
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.arc(x, y, radius - Math.max(2.8, radius * 0.13) - 0.7, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = '#1a1a1a';
  for (const [dx, dy] of SEED_POSITIONS) {
    ctx.save();
    ctx.translate(x + dx * radius, y + dy * radius);
    ctx.rotate(Math.atan2(dy, dx));
    ctx.beginPath();
    ctx.ellipse(0, 0, radius * 0.095, radius * 0.048, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(-radius * 0.03, -radius * 0.015, 0.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  ctx.restore();
}

function drawStemAndLeaf(ctx, x, y, radius) {
  ctx.save();
  ctx.strokeStyle = '#5a3d28';
  ctx.lineWidth = Math.max(1.5, radius * 0.10);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y - radius * 0.92);
  ctx.quadraticCurveTo(x + radius * 0.12, y - radius * 1.16, x + radius * 0.05, y - radius * 1.34);
  ctx.stroke();

  ctx.translate(x + radius * 0.20, y - radius * 1.12);
  ctx.rotate(-0.5);
  ctx.beginPath();
  ctx.ellipse(0, 0, radius * 0.32, radius * 0.15, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#388e3c';
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.stroke();
  ctx.restore();
}
