// All canvas drawing lives here. Nothing in this file mutates game state.

import {
  COLS, CELL, HUD_HEIGHT, BOARD_WIDTH, TIERS,
  RAINBOW_TIER, RAINBOW_DEF, BOMB_TIER, BOMB_DEF, BOMB_FUSE_DROPS,
  powerSlotRect, POWER_SLOT, pauseButtonRect,
  FONT_FAMILY, DISPLAY_FONT_FAMILY, LOCKED_FLASH_DURATION_SEC, CHIP_PULSE_DURATION_SEC,
  MERGE_METER_MAX, DANGER_ROWS_REMAINING, LEVEL_CALLOUT_SEC,
  REMOVER_CROSSHAIR_SIZE, RAINBOW_SPIN_RADIANS_PER_SEC,
  SPAWN_CHUTE_TINT_ALPHA, SPAWN_CHUTE_FADE_ROWS, SPAWN_CHUTE_MARK_ALPHA, SPAWN_CHUTE_MARK_INSET,
} from './constants.js';
import { tierColor, comboMultiplier, hudPowerUps, comboWindowSecFor, levelFor } from './state.js';
// The ONE function that decides where the next fruit arrives (js/physics.js).
// Imported rather than reimplemented here on purpose -- see its own comment.
// It is a pure read of stackHeight and mutates nothing, so this file's "no
// state mutation" rule is intact.
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
// Falls back to a square-cornered rect: the radius here is cosmetic, so a
// plain rect is a correct degradation, not a broken one.
export function roundRectPath(ctx, x, y, w, h, r) {
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, r);
  } else {
    ctx.rect(x, y, w, h);
  }
}

// 8.4 LANDMINE point 3: the bomb needs a tierDef entry too, same as the
// rainbow sentinel already did, so anything asking for a radius (spawn
// position, drag clamping, the HUD "Next" preview) works without special-
// casing the caller.
function tierDefFor(tierIndex) {
  if (tierIndex === RAINBOW_TIER) return RAINBOW_DEF;
  if (tierIndex === BOMB_TIER) return BOMB_DEF;
  return TIERS[tierIndex];
}

// 14.1: was the SECOND copy of this lookup. It was the correct one -- it
// handled both sentinels, where main.js's colorForTier handled only the
// rainbow -- which is precisely why nobody noticed the other was wrong. Both
// now call state.js's tierColor.
function colorFor(state, tierIndex) {
  return tierColor(state, tierIndex);
}

// How much fuse is left, 1 (fresh/still falling) down to 0 (about to
// detonate) -- drives drawBombShape's shrinking fuse. Only meaningful for a
// bomb; every other tier ignores the value entirely.
function bombFuseFractionFor(state, tierIndex) {
  if (tierIndex !== BOMB_TIER) return 1;
  if (state.bombFuseDrops === null || state.bombFuseDrops === undefined) return 1;
  return Math.max(0, Math.min(1, state.bombFuseDrops / BOMB_FUSE_DROPS));
}

export function drawFrame(ctx, state, fx) {
  const width = BOARD_WIDTH;
  const height = canvasHeightFor(state);
  const theme = themeForScore(state.score);

  // Re-established every frame rather than once at startup. Assigning
  // canvas.width/height resets the 2D context including its transform, and
  // js/main.js reassigns it whenever the viewport, DPR, or Extra Row's row
  // count changes -- a one-time ctx.scale() would be silently wiped mid-run
  // and drop the game to a fraction of its size in the corner.
  //
  // Derived from the actual backing-store width rather than a fixed constant,
  // so js/main.js's responsive, DPR-aware sizing is reflected automatically:
  // this file does not need to know how big the canvas currently is on
  // screen, only how many backing pixels exist per logical pixel.
  const scale = ctx.canvas.width / width || 1;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);

  ctx.clearRect(0, 0, width, height);
  // 7.2: a vertical gradient replacing the old flat fill, spanning the whole
  // canvas (HUD and board share one continuous background, as they always
  // have) so the day-to-night palette actually reads as depth rather than a
  // single flat colour that merely changes hue at each milestone.
  const boardGradient = ctx.createLinearGradient(0, 0, 0, height);
  boardGradient.addColorStop(0, theme.boardTop);
  boardGradient.addColorStop(1, theme.boardBot);
  ctx.fillStyle = boardGradient;
  ctx.fillRect(0, 0, width, height);

  // 11.2: without an edge, that one gradient runs unbroken from the score
  // readout to the floor and the play area does not read as a panel. A soft
  // shadow cast onto the board just below the HUD, and a 1px highlight along
  // the seam itself -- see docs/phase11brief.md section 4.1.
  //
  // The brief also specified a tint across the HUD strip, dropped entirely
  // (see the "Board panel (11.2)" comment in constants.js and
  // unit-tests/theme-contrast.js): the crossing segment's text/board
  // contrast has only a 0.06 margin over the 4.5:1 floor with NO tint, and
  // any tint can only shrink that margin further, never grow it.
  const hudIsLight = relativeLuminance(theme.boardTop) >= 0.5;
  const hudShadow = ctx.createLinearGradient(0, HUD_HEIGHT, 0, HUD_HEIGHT + 10);
  hudShadow.addColorStop(0, 'rgba(0,0,0,0.10)');
  hudShadow.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = hudShadow;
  ctx.fillRect(0, HUD_HEIGHT, width, 10);

  ctx.fillStyle = hudIsLight ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.16)';
  ctx.fillRect(0, HUD_HEIGHT, width, 1);

  drawHUD(ctx, state, width, theme);

  // Shake displaces only the board, never the HUD -- shaking the score readout
  // makes it unreadable and reads as a glitch rather than as impact.
  const offset = fx ? shakeOffset(fx) : { x: 0, y: 0 };
  ctx.save();
  ctx.translate(offset.x, offset.y);
  drawBoard(ctx, state, fx, theme);
  if (fx) {
    drawParticles(ctx, fx);
    drawBombRings(ctx, fx);
    // 15: last of all -- see drawLevelCallout's own comment on why this is
    // not inside drawBoard.
    drawLevelCallout(ctx, fx, COLS * CELL, boardHeightFor(state), theme);
  }
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

  // 15: the persistent level readout. (10, 66) at 12px was checked against a
  // 390x844 screenshot and clears POWER_SLOT.y (80) with room to spare -- see
  // docs/phase15brief.md for the check. Left column, under Coins, same
  // left-aligned block the three stats above it already are.
  ctx.font = `bold 12px ${FONT_FAMILY}`;
  ctx.fillStyle = theme.text;
  ctx.fillText(`LV ${levelFor(state.spawnIndex)}`, 10, 66);

  drawComboMeter(ctx, state, width, theme);

  ctx.textAlign = 'right';
  ctx.font = `13px ${FONT_FAMILY}`;
  ctx.fillStyle = theme.text;
  ctx.fillText('Next', width - 10, 6);
  const nextDef = tierDefFor(state.nextTier);
  drawFruit(ctx, width - 30, 38, nextDef, colorFor(state, state.nextTier), state.nextTier,
    bombFuseFractionFor(state, state.nextTier));

  drawPowerBar(ctx, state, theme);
  drawMergeMeter(ctx, state, theme);
  drawPauseButton(ctx, theme);
}

// Combo readout fades as the window runs out, so the player can see the streak
// is about to lapse.
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
    // 8.1: purchased stock and this run's earned charges both count toward
    // what the chip shows and whether it reads as usable -- see
    // canUsePowerUp/consumeCharge in state.js for the same combined figure.
    const earned = state.earnedCharges[item.id] || 0;
    const count = (state.inventory[item.id] || 0) + earned;
    const usable = !locked && count > 0;
    // "armed" here really means "currently doing something" -- the remover's
    // or Swap's actual aiming state, or (8.4) a planted bomb still live
    // somewhere on the board.
    const armed = (item.id === 'bomb' && state.bombInPlay)
      || (item.id === 'remover' && state.removerArmed)
      || (item.id === 'swap' && state.swapArmed);

    ctx.save();
    if (!usable && !armed) ctx.globalAlpha = 0.4;

    ctx.beginPath();
    roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, 6);
    ctx.fillStyle = armed ? theme.accent : theme.grid;
    ctx.fill();

    drawIcon(ctx, item.icon, cx, cy, rect.w * 0.72, armed ? theme.boardTop : theme.text);

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
      roundRectPath(ctx, rect.x - 2, rect.y - 2, rect.w + 4, rect.h + 4, 7);
      ctx.stroke();
      ctx.restore();
    }

    // A brief expanding, fading ring when this chip just earned a charge
    // (8.1) -- a reward, so it gets a growing pop rather than the flat flash
    // above, which means "denied".
    if (state.chipPulse && state.chipPulse.id === item.id) {
      const p = Math.min(1, state.chipPulse.t / CHIP_PULSE_DURATION_SEC);
      const wave = Math.sin(p * Math.PI); // one hump: 0 -> 1 -> 0
      ctx.save();
      ctx.globalAlpha = wave * 0.85;
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = 2 + wave * 2;
      const grow = wave * 5;
      ctx.beginPath();
      roundRectPath(ctx, rect.x - 3 - grow, rect.y - 3 - grow, rect.w + 6 + grow * 2, rect.h + 6 + grow * 2, 8);
      ctx.stroke();
      ctx.restore();
    }

    // Padlock corner marker, so "locked" is not conveyed by dimming alone.
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

    // Small marker (opposite corner from the padlock) distinguishing "earned
    // this run only" stock from owned stock -- 8.1 requires the two read as
    // different, since one evaporates at endRun and the other does not.
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

// 8.1: the meter that fills as you merge, spanning exactly the width of the
// three chips above it so the two visually read as one system.
function drawMergeMeter(ctx, state, theme) {
  const barX = POWER_SLOT.x0;
  const barY = POWER_SLOT.y + POWER_SLOT.size + 4;
  const barW = 3 * POWER_SLOT.size + 2 * POWER_SLOT.gap;
  const pct = Math.max(0, Math.min(1, state.mergeMeter / MERGE_METER_MAX));
  ctx.save();
  ctx.fillStyle = theme.grid;
  ctx.fillRect(barX, barY, barW, 3);
  ctx.fillStyle = theme.accent;
  ctx.fillRect(barX, barY, barW * pct, 3);
  ctx.restore();
}

// 9.3: the pause control -- same pill shape and theme.grid fill as a power-up
// chip, so it visually belongs to the same HUD row without being mistaken for
// one (no count label beneath it, no locked/armed states).
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

// The run ends when the spawn column (always the centre one) reaches the
// top, with previously no warning of any kind. Pulses that column's outline
// once it is within DANGER_ROWS_REMAINING of full.
//
// 7.2: uses theme.danger, not theme.accent. The accent moves with the
// milestone palette and used to double as the only alarm colour the game
// had (milestone 0's accent was literally an alarm red) -- which meant
// nothing was left to visually distinguish "you are about to lose" from
// "this is just today's UI colour". theme.danger is fixed and appears
// nowhere else, so this is now the one thing in the game that means "danger".
// The board's warning. Until 12.2 this outlined the spawn column and nothing
// else, because the spawn column was the only one that could end the run.
// Any column can now, so any column within DANGER_ROWS_REMAINING of the top
// is marked -- and the run only actually ends when they ALL are, which the
// player can now see coming instead of being told about one column while
// five sit empty.
// 14: the chute -- the marker over the column the next fruit will arrive in.
//
// The whole reason a fixed spawn column was unbearable before is that it was
// INVISIBLE. Puyo Puyo has spawned at one fixed column since 1991 and draws
// that square on the board from second one; we had the same rule and drew
// nothing, so "the fruit dropping from every which way" was the complaint
// against the random fix rather than against the missing marker.
//
// The column is read from js/physics.js's spawnColumnFor -- the same function
// spawnFruit itself calls -- so when the middle column fills and the spawn is
// redirected outward, the chute MOVES WITH IT. A marker that keeps pointing
// at a dead column would be worse than no marker: it would be a lie exactly
// when the player most needs to trust it. That redirect is also the only
// visible sign the mercy rule has kicked in, which is otherwise a silent
// mechanic.
//
// Drawn in theme.grid rather than DANGER_COLOR -- see the chute constants in
// js/constants.js for why the game's one red is not spent here -- and drawn
// BEFORE drawDangerState so the red warning paints over the top of it when
// the same column is also running out of room.
function drawSpawnChute(ctx, state, rows, theme) {
  const col = spawnColumnFor(state);
  if (col < 0) return; // whole board full: the run is over, there is no next fruit

  const x0 = col * CELL;
  const cx = x0 + CELL / 2;

  // A wash down the mouth of the column, fading out over SPAWN_CHUTE_FADE_ROWS
  // so it reads as a chute the fruit falls out of rather than as a highlighted
  // column -- the bottom of that column is ordinary board and should look it.
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

  // Two lip ticks at the column's shoulders, and a chevron between them. Kept
  // inside the top ~16px: the falling fruit is revealed through this band in
  // the first fraction of its fall and is clear of it for the rest, so the
  // mark is legible almost all of the time without ever fighting the fruit.
  ctx.beginPath();
  ctx.moveTo(x0 + SPAWN_CHUTE_MARK_INSET, 0);
  ctx.lineTo(x0 + SPAWN_CHUTE_MARK_INSET, 11);
  ctx.moveTo(x0 + CELL - SPAWN_CHUTE_MARK_INSET, 0);
  ctx.lineTo(x0 + CELL - SPAWN_CHUTE_MARK_INSET, 11);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(cx - 8, 7);
  ctx.lineTo(cx, 15);
  ctx.lineTo(cx + 8, 7);
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

  // One pulse phase shared by every marked column, so several of them read as
  // one warning rather than as a row of independently blinking lights.
  const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 220);
  ctx.save();
  ctx.strokeStyle = theme.danger;
  ctx.lineWidth = 4;
  for (let c = 0; c < COLS; c++) {
    const height = state.stackHeight[c];
    if (height < threshold) continue;
    // A column with no room left is worse than one with a row to spare, and
    // is drawn steady rather than pulsing -- a full column is not a warning
    // any more, it is a fact.
    const full = height >= rows;
    ctx.globalAlpha = full ? 0.75 : 0.3 + 0.4 * pulse;
    ctx.strokeRect(c * CELL + 2, 2, CELL - 4, rows * CELL - 4);
  }
  ctx.restore();
}

// 15: the big centred callout on a level-up, alongside the persistent HUD
// readout drawHUD already draws. Two-part envelope over LEVEL_CALLOUT_SEC: a
// quick rise to peak alpha (0.85, the spec's ceiling) over the first 15% of
// the duration, then a fall to exactly 0 by the end -- "must not block the
// board" is satisfied by alpha reaching 0, not by staying out of the way.
// Scale grows across the whole duration under normal motion; under
// prefers-reduced-motion it holds at 1 and only the fade plays, per
// docs/phase15-spec.md section 6.3.
function levelCalloutEnvelope(p) {
  if (p < 0.15) return p / 0.15;
  return 1 - (p - 0.15) / 0.85;
}

// Called from drawFrame, not drawBoard -- "under nothing" (docs/phase15-spec.md
// section 6.3) means after drawParticles/drawBombRings too, which run outside
// drawBoard's own clip. Does its own HUD_HEIGHT translate for the same reason
// those two already do (see their own comments): board-local coordinates,
// computed independently of drawBoard's internal state.
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
  ctx.fillText(`LEVEL ${callout.level}`, 0, 0);
  ctx.restore();
}

// theme.grid (js/constants.js's THEMES) is always an rgba() string -- swap
// just the alpha channel so a gradient's transparent end is the SAME hue as
// its solid end, just invisible, rather than a hardcoded black that would
// mismatch the grid's actual (theme-tinted) colour on later boards.
function withAlpha(rgbaString, alpha) {
  const parts = rgbaString.match(/rgba?\(([^)]+)\)/);
  if (!parts) return rgbaString;
  const [r, g, b] = parts[1].split(',').map((v) => parseFloat(v.trim()));
  return `rgba(${r},${g},${b},${alpha})`;
}

// Soft radial darkening toward the board's edges -- cheap depth, strengthening
// slightly at each milestone so the later, more saturated palettes read as
// more dramatic rather than flatter.
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

// One low-alpha ellipse under each resting fruit, so it reads as sitting on
// the board rather than floating on it.
function drawContactShadow(ctx, cx, cy, radius) {
  ctx.beginPath();
  ctx.ellipse(cx, cy + radius * 0.78, radius * 0.62, radius * 0.2, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.16)';
  ctx.fill();
}

// 7.3: "arming or activating a power-up must change the board, not a chip."
// Bomb, remover and (since 10.1) Swap each got a HUD chip in earlier phases
// and nothing else -- these three draw the actual effect where it happens.

// Swap (10.1): a pulsing ring around the currently selected fruit, the first
// of the pair -- nothing to draw until a selection exists, same gating shape
// as the remover's crosshair below. No per-frame mechanics behind it, unlike
// the Magnet overlay it replaces -- this is pure presentation of state that
// js/input.js already set.
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

// While armed, a translucent footprint at the currently aimed cell -- filled
// in js/input.js's armPreviewCell, which now updates continuously and tracks
// a drag before it commits on release, not just the moment of a tap.
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

  // 9.7: a fruit spawns above row 0 by design (state.active.y starts
  // negative), which used to draw straight through into the HUD since
  // nothing here ever clipped. Everything drawn below (grid, fruit, the
  // swap selection ring, the falling fruit itself, the vignette) is now
  // confined to exactly the board's own rectangle, so a fruit is revealed as
  // it enters the board rather than floating over the score readout.
  ctx.beginPath();
  ctx.rect(0, 0, COLS * CELL, rows * CELL);
  ctx.clip();

  // 11.2: a flat opacity read as ruled paper across the empty top half of the
  // board (the whole reason the board is tall enough to have one -- see
  // ROWS's own comment in constants.js). Fully transparent at the top,
  // reaching theme.grid by 45% down and holding, so alignment stays legible
  // exactly where fruit actually rests.
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

  // Order matters: the chute is a resting-state fact and the danger marking is
  // a warning, so the warning goes on top when both land on the same column.
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
        // Scale about the fruit's own centre so it pops in place.
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

// Dispatches on the tier's `shape`. Adding a shape means adding a branch here
// and a value in constants.js -- nothing else in the game needs to change.
//
// `tierIndex` is optional (callers that only have the tier DEFINITION, not
// its index, simply omit it) and is what 7.4's per-tier detail keys off --
// see drawTierDetail. It is never the rainbow or bomb sentinel here: those
// branches below draw their own thing and never call it.
//
// `fuseFraction` (8.4) only means anything for a bomb -- see
// bombFuseFractionFor, which every call site computes from state so this
// function itself never needs to know about state.bombFuseDrops directly.
export function drawFruit(ctx, x, y, tier, color, tierIndex, fuseFraction) {
  const fill = color || tier.color;
  if (tier.shape === 'flower') {
    drawFlower(ctx, x, y, tier.radius, fill, tierIndex);
  } else if (tier.shape === 'rainbow') {
    drawRainbow(ctx, x, y, tier.radius);
    return;
  } else if (tier.shape === 'bomb') {
    drawBombShape(ctx, x, y, tier.radius, fuseFraction ?? 1);
    return;
  } else {
    drawCircle(ctx, x, y, tier.radius, fill, tierIndex);
  }
  drawTierDetail(ctx, x, y, tier.radius, tierIndex);
}

// 7.4: nine tiers used to differ only by hue, size, and a circle/flower
// alternation -- distinguishable, but memorised rather than recognised. This
// also doubles as accessibility: every extra channel separating the tiers is
// one less thing riding on colour alone.
function drawTierDetail(ctx, x, y, radius, tierIndex) {
  if (tierIndex === undefined || tierIndex === RAINBOW_TIER) return;
  const tier = TIERS[tierIndex];
  if (!tier) return;

  if (tierIndex >= 4) drawStemAndLeaf(ctx, x, y, radius);
  if (tier.name === 'pineapple') drawPineappleCrown(ctx, x, y, radius);
  if (tier.name === 'watermelon') drawWatermelonSeeds(ctx, x, y, radius);
}

// Short curved stem plus a single leaf, from apple (tier 4) upward -- the
// point where a fruit ladder conventionally starts reading as "tree fruit"
// rather than "berry".
function drawStemAndLeaf(ctx, x, y, radius) {
  ctx.save();
  ctx.strokeStyle = '#6b4a2b';
  ctx.lineWidth = Math.max(1.4, radius * 0.1);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y - radius * 0.92);
  ctx.quadraticCurveTo(x + radius * 0.12, y - radius * 1.15, x + radius * 0.05, y - radius * 1.32);
  ctx.stroke();

  ctx.translate(x + radius * 0.2, y - radius * 1.1);
  ctx.rotate(-0.5);
  ctx.beginPath();
  ctx.ellipse(0, 0, radius * 0.32, radius * 0.15, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#4c9a4c';
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(0,0,0,0.15)';
  ctx.stroke();
  ctx.restore();
}

// Small dark seeds scattered across the face -- watermelon only.
const SEED_POSITIONS = [
  [-0.35, -0.1], [0.12, -0.36], [0.4, 0.05], [0.02, 0.36],
  [-0.32, 0.3], [0.3, -0.34], [-0.46, 0.14],
];

function drawWatermelonSeeds(ctx, x, y, radius) {
  ctx.save();
  ctx.fillStyle = 'rgba(25,20,10,0.55)';
  for (const [dx, dy] of SEED_POSITIONS) {
    ctx.save();
    ctx.translate(x + dx * radius, y + dy * radius);
    ctx.rotate(Math.atan2(dy, dx));
    ctx.beginPath();
    ctx.ellipse(0, 0, radius * 0.09, radius * 0.045, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

// A small spiky crown -- pineapple only.
function drawPineappleCrown(ctx, x, y, radius) {
  const spikes = 5;
  ctx.save();
  ctx.fillStyle = '#3f8f4a';
  ctx.strokeStyle = 'rgba(0,0,0,0.15)';
  ctx.lineWidth = 1;
  for (let i = 0; i < spikes; i++) {
    const t = (i - (spikes - 1) / 2) / spikes;
    const baseX = x + t * radius * 1.1;
    const baseY = y - radius * 0.85;
    const tipX = x + t * radius * 0.6;
    const tipY = y - radius * (1.5 + Math.abs(t) * 0.3);
    ctx.beginPath();
    ctx.moveTo(baseX - radius * 0.08, baseY);
    ctx.lineTo(tipX, tipY);
    ctx.lineTo(baseX + radius * 0.08, baseY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

// The highlight dot's angle shifts deterministically by tier, so each rung
// on the ladder reads with a slightly different "light source" rather than
// nine discs lit identically -- a cheap extra channel alongside colour/size/
// shape, and 7.4's dimple-or-highlight-shift ask.
function highlightAngleFor(tierIndex) {
  if (tierIndex === undefined) return -Math.PI * 0.75;
  return -Math.PI * 0.75 - (tierIndex % 5) * 0.22;
}

// Rim highlight (upper edge) + a slightly darker lower rim, on top of the
// existing outline + highlight dot -- three cheap lines that turn a flat
// disc into something reading as a lit, rounded object (7.2 depth pass).
// Shared between drawCircle and drawFlower's centre disc.
function drawRim(ctx, x, y, radius) {
  ctx.beginPath();
  ctx.arc(x, y, radius * 0.9, -Math.PI * 0.85, -Math.PI * 0.15);
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = Math.max(1, radius * 0.12);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(x, y, radius * 0.9, Math.PI * 0.15, Math.PI * 0.85);
  ctx.strokeStyle = 'rgba(0,0,0,0.16)';
  ctx.lineWidth = Math.max(1, radius * 0.1);
  ctx.stroke();
}

function drawCircle(ctx, x, y, radius, fill, tierIndex) {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(0,0,0,0.15)';
  ctx.stroke();

  drawRim(ctx, x, y, radius);

  const angle = highlightAngleFor(tierIndex);
  ctx.beginPath();
  ctx.arc(x + Math.cos(angle) * radius * 0.5, y + Math.sin(angle) * radius * 0.5, radius * 0.28, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fill();
}

const PETAL_COUNT = 6;

// Petals are drawn as overlapping discs on a ring, then a center disc on top.
// Ring offset + petal radius sum to the tier radius so a flower occupies
// exactly the same footprint as the circle it replaces -- the grid geometry
// and landing math stay untouched.
function drawFlower(ctx, x, y, radius, fill, tierIndex) {
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

  drawRim(ctx, x, y, radius * 0.42);

  const hAngle = highlightAngleFor(tierIndex);
  ctx.beginPath();
  ctx.arc(x + Math.cos(hAngle) * radius * 0.42, y + Math.sin(hAngle) * radius * 0.42, radius * 0.2, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.fill();
  ctx.restore();
}

// The wildcard reads as a fruit-sized disc of tier colours, so it is instantly
// distinguishable from every real tier without needing a legend.
const RAINBOW_WEDGES = ['#e0435a', '#f2960b', '#f2d43d', '#3fae5c', '#4c6ef5', '#8e44ad'];

function drawRainbow(ctx, x, y, radius) {
  // 7.3: the rarest object in the game used to sit perfectly still. Spins
  // from the wall clock, same as drawDangerState's pulse -- purely cosmetic,
  // so it needs no dt threaded through render.js's call chain.
  const spin = (Date.now() / 1000) * RAINBOW_SPIN_RADIANS_PER_SEC;
  ctx.save();
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

// 8.4: "the most visible object in the game while it is live" -- a round
// body plus a fuse whose LENGTH shrinks with fuseFraction (1 = just planted
// or still falling, 0 = about to go off), tipped with a spark that reddens
// as it nears detonation.
function drawBombShape(ctx, x, y, radius, fuseFraction) {
  ctx.save();

  ctx.beginPath();
  ctx.arc(x, y + radius * 0.12, radius * 0.82, 0, Math.PI * 2);
  ctx.fillStyle = BOMB_DEF.color;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(x - radius * 0.28, y - radius * 0.06, radius * 0.22, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fill();

  // Fuse: shrinks toward the bomb as the drops run out, not a fixed length
  // with a colour change -- the shrinking is what reads as "burning down".
  const clamped = Math.max(0.08, fuseFraction);
  const fuseBaseX = x + radius * 0.32;
  const fuseBaseY = y - radius * 0.62;
  const fuseLen = radius * 1.05 * clamped;
  const fuseEndX = fuseBaseX + fuseLen * 0.55;
  const fuseEndY = fuseBaseY - fuseLen * 0.85;
  ctx.lineWidth = Math.max(1.5, radius * 0.12);
  ctx.strokeStyle = '#8a5a2a';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(fuseBaseX, fuseBaseY);
  ctx.quadraticCurveTo(fuseBaseX + fuseLen * 0.3, fuseBaseY - fuseLen * 0.3, fuseEndX, fuseEndY);
  ctx.stroke();

  // Spark at the burning tip, pulsing, reddening as detonation nears.
  const pulse = 0.6 + 0.4 * Math.sin(Date.now() / 90);
  ctx.beginPath();
  ctx.arc(fuseEndX, fuseEndY, radius * 0.17 * pulse, 0, Math.PI * 2);
  ctx.fillStyle = fuseFraction < 0.3 ? '#ff5a3c' : '#ffb020';
  ctx.fill();

  ctx.restore();
}
