// Falling motion, landing detection, merge resolution and column settling.
// Pure functions over the state object -- no canvas or DOM access here.

import {
  COLS, CELL, GRAVITY_PX_PER_SEC, SLOW_DROP_MULTIPLIER, DRAG_LERP,
  MAX_TIER, WATERMELON_CLEAR_BONUS, TIERS, BOARD_WIDTH,
} from './constants.js';
import { effectiveRows, randomSpawnTier, addScore, registerComboHit } from './state.js';

export function spawnFruit(state) {
  const tier = state.nextTier;
  state.nextTier = randomSpawnTier();
  const startCol = Math.floor(COLS / 2);
  const rows = effectiveRows(state);

  if (state.stackHeight[startCol] >= rows) {
    return { blocked: true };
  }

  state.active = {
    tier,
    col: startCol,
    x: startCol * CELL + CELL / 2,
    targetX: startCol * CELL + CELL / 2,
    y: -TIERS[tier].radius,
  };
  return { blocked: false };
}

export function setDragTarget(state, pixelX) {
  if (!state.active) return;
  const radius = TIERS[state.active.tier].radius;
  const clamped = Math.min(BOARD_WIDTH - radius, Math.max(radius, pixelX));
  state.active.targetX = clamped;
}

// Advances the falling fruit by dt seconds. Returns true if the fruit landed this tick.
export function stepPhysics(state, dt) {
  const active = state.active;
  if (!active) return false;

  active.x += (active.targetX - active.x) * Math.min(1, DRAG_LERP * (dt * 60));

  const col = columnForX(state, active.x);
  active.col = col;

  const gravity = GRAVITY_PX_PER_SEC * (state.slowDropActive ? SLOW_DROP_MULTIPLIER : 1);
  active.y += gravity * dt;

  const rows = effectiveRows(state);
  const landingRow = rows - 1 - state.stackHeight[col];
  const landingY = landingRow * CELL + CELL / 2;

  if (active.y >= landingY) {
    lockFruit(state, landingRow, col, active.tier);
    state.active = null;
    return true;
  }
  return false;
}

function columnForX(state, x) {
  const col = Math.floor(x / CELL);
  return Math.min(COLS - 1, Math.max(0, col));
}

function lockFruit(state, row, col, tier) {
  state.grid[row][col] = tier;
  state.stackHeight[col] += 1;
  resolveMerges(state);
}

// Repeatedly finds one adjacent equal-tier pair, merges it, settles the
// affected column, and repeats until no merges remain (handles chain reactions).
export function resolveMerges(state) {
  let mergedSomething = true;
  while (mergedSomething) {
    mergedSomething = mergeOnePair(state);
    if (mergedSomething) settleColumns(state);
  }
}

function mergeOnePair(state) {
  const rows = state.grid.length;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < COLS; c++) {
      const tier = state.grid[r][c];
      if (tier === null) continue;

      // Check right neighbor and down neighbor only -- checking every cell
      // against both directions covers every adjacent pair exactly once.
      if (c + 1 < COLS && state.grid[r][c + 1] === tier) {
        mergeCells(state, r, c, r, c + 1, tier);
        return true;
      }
      if (r + 1 < rows && state.grid[r + 1][c] === tier) {
        mergeCells(state, r, c, r + 1, c, tier);
        return true;
      }
    }
  }
  return false;
}

function mergeCells(state, r1, c1, r2, c2, tier) {
  // Keep the result at the lower (larger row) cell so it stays grounded.
  const [keepR, keepC] = r2 >= r1 ? [r2, c2] : [r1, c1];
  const [clearR, clearC] = keepR === r1 && keepC === c1 ? [r2, c2] : [r1, c1];

  state.grid[clearR][clearC] = null;

  // Every merge extends the combo streak; the multiplier applies to the
  // points this merge awards.
  const multiplier = registerComboHit(state);

  if (tier >= MAX_TIER) {
    state.grid[keepR][keepC] = null;
    addScore(state, Math.round(WATERMELON_CLEAR_BONUS * multiplier));
    state.events.push({ type: 'topTier', tier, row: keepR, col: keepC, multiplier });
  } else {
    const newTier = tier + 1;
    state.grid[keepR][keepC] = newTier;
    addScore(state, Math.round(TIERS[newTier].points * multiplier));
    state.events.push({ type: 'merge', tier: newTier, row: keepR, col: keepC, multiplier });
    if (newTier >= MAX_TIER) {
      // Reaching the highest tier for the first time is its own moment,
      // distinct from clearing a pair of them.
      state.events.push({ type: 'reachedTop', tier: newTier, row: keepR, col: keepC });
    }
  }
}

export function settleColumns(state) {
  const rows = state.grid.length;
  for (let c = 0; c < COLS; c++) {
    const values = [];
    for (let r = 0; r < rows; r++) {
      if (state.grid[r][c] !== null) values.push(state.grid[r][c]);
    }
    for (let r = 0; r < rows; r++) state.grid[r][c] = null;
    const startRow = rows - values.length;
    for (let i = 0; i < values.length; i++) {
      state.grid[startRow + i][c] = values[i];
    }
    state.stackHeight[c] = values.length;
  }
}

// Removes a single fruit from the board (Fruit Remover power-up), then settles.
export function removeFruitAt(state, row, col) {
  if (state.grid[row][col] === null) return false;
  state.grid[row][col] = null;
  settleColumns(state);
  return true;
}

export function isGameOver(state) {
  const rows = effectiveRows(state);
  const startCol = Math.floor(COLS / 2);
  return state.stackHeight[startCol] >= rows;
}
