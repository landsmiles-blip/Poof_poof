// Falling motion, landing detection, merge resolution and column settling.
// Pure functions over the state object -- no canvas or DOM access here.

import {
  COLS, CELL, SLOW_DROP_MULTIPLIER, DRAG_LERP,
  MAX_TIER, WATERMELON_CLEAR_BONUS, TIERS, BOARD_WIDTH,
  RAINBOW_TIER, RAINBOW_DEF, BOMB_RADIUS, MAGNET_STEP_SEC,
} from './constants.js';
import { effectiveRows, nextTierFor, addScore, registerComboHit, currentGravityPxPerSec } from './state.js';

// Tier lookup that also answers for the rainbow sentinel, so callers that only
// need geometry (radius) never have to special-case it.
export function tierDef(tier) {
  return tier === RAINBOW_TIER ? RAINBOW_DEF : TIERS[tier];
}

export function isRainbow(tier) {
  return tier === RAINBOW_TIER;
}

export function spawnFruit(state) {
  const startCol = Math.floor(COLS / 2);
  const rows = effectiveRows(state);

  // Bail before consuming anything. A blocked spawn ends the run, and eating a
  // scheduled wild (or advancing the index) on the way out would silently
  // destroy a charge the player paid for.
  if (state.stackHeight[startCol] >= rows) {
    return { blocked: true };
  }

  // state.nextTier was decided one spawn ahead of time (in nextTierFor, called
  // from here and from startRun) specifically so the HUD's "Next" preview is
  // never a lie -- nothing here is allowed to override it.
  const tier = state.nextTier;
  if (tier === RAINBOW_TIER) {
    // Counted at actual spawn, not at the earlier scheduling decision: a run
    // that ends before this fruit ever drops must still read as undelivered,
    // so endRun's refund check is correct.
    state.rainbowDelivered = (state.rainbowDelivered || 0) + 1;
  }
  state.spawnIndex += 1;
  state.nextTier = nextTierFor(state);

  state.active = {
    tier,
    col: startCol,
    x: startCol * CELL + CELL / 2,
    targetX: startCol * CELL + CELL / 2,
    y: -tierDef(tier).radius,
  };
  return { blocked: false };
}

export function setDragTarget(state, pixelX) {
  if (!state.active) return;
  const radius = tierDef(state.active.tier).radius;
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

  // Slow Drop multiplies the RAMPED value, so it stays proportionally useful
  // late in a run rather than becoming irrelevant as the ramp climbs past it.
  const gravity = currentGravityPxPerSec(state) * (state.slowDropActive ? SLOW_DROP_MULTIPLIER : 1);
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

// Keyboard's "drop it" (6.4): skips straight to landing at the fruit's
// current column, using the exact same landing math stepPhysics ticks toward
// every frame -- so a hard drop resolves identically to letting gravity carry
// it there, just without the wait a keyboard-only player has no way to skip.
export function hardDrop(state) {
  const active = state.active;
  if (!active) return false;
  const col = columnForX(state, active.x);
  const rows = effectiveRows(state);
  const landingRow = rows - 1 - state.stackHeight[col];
  lockFruit(state, landingRow, col, active.tier);
  state.active = null;
  return true;
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

// Two cells merge when they hold the same tier, OR when either is a rainbow
// (which adopts whatever it touches). Returns the tier the pair resolves as,
// or null when they do not merge at all.
function pairTier(a, b) {
  if (a === null || b === null) return null;
  const aWild = a === RAINBOW_TIER;
  const bWild = b === RAINBOW_TIER;
  if (aWild && bWild) return 0; // two wilds settle to the lowest tier
  if (aWild) return b;
  if (bWild) return a;
  return a === b ? a : null;
}

function mergeOnePair(state) {
  const rows = state.grid.length;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < COLS; c++) {
      if (state.grid[r][c] === null) continue;

      // Check right neighbor and down neighbor only -- checking every cell
      // against both directions covers every adjacent pair exactly once.
      const right = c + 1 < COLS ? pairTier(state.grid[r][c], state.grid[r][c + 1]) : null;
      if (right !== null) {
        mergeCells(state, r, c, r, c + 1, right);
        return true;
      }
      const down = r + 1 < rows ? pairTier(state.grid[r][c], state.grid[r + 1][c]) : null;
      if (down !== null) {
        mergeCells(state, r, c, r + 1, c, down);
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
  //
  // Except during a bomb's collapse: the bomb is an escape hatch for a bad
  // board, and letting the cascade it triggers build a streak would make
  // detonating the cheapest way to run the multiplier up. Those merges still
  // score (they are real merges) but at 1x, and they do not extend the streak.
  const multiplier = state.suppressCombo ? 1 : registerComboHit(state);

  // Pixel position of the merge, frozen right now. A later merge elsewhere in
  // the same cascade can call settleColumns again and drop THIS cell's
  // contents further down the column to close a gap below it -- row/col
  // above stay correct for the squash effect, which re-checks them against
  // the live grid (plus a tier guard) at render time, but a particle burst
  // computed from row/col at drain time would then land wherever the fruit
  // ended UP, not where it actually merged. x/y sidestep that: they are a
  // point in space, not a cell reference, so no later shift can move them.
  const x = keepC * CELL + CELL / 2;
  const y = keepR * CELL + CELL / 2;

  if (tier >= MAX_TIER) {
    state.grid[keepR][keepC] = null;
    addScore(state, Math.round(WATERMELON_CLEAR_BONUS * multiplier));
    state.events.push({ type: 'topTier', tier, row: keepR, col: keepC, x, y, multiplier });
  } else {
    const newTier = tier + 1;
    state.grid[keepR][keepC] = newTier;
    addScore(state, Math.round(TIERS[newTier].points * multiplier));
    state.events.push({ type: 'merge', tier: newTier, row: keepR, col: keepC, x, y, multiplier });
    if (newTier >= MAX_TIER) {
      // Reaching the highest tier for the first time is its own moment,
      // distinct from clearing a pair of them.
      state.events.push({ type: 'reachedTop', tier: newTier, row: keepR, col: keepC, x, y });
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
  const tier = state.grid[row][col];
  if (tier === null) return false;
  state.grid[row][col] = null;
  settleColumns(state);
  // main.js turns this into a small burst at the removed cell -- see 1.4.
  state.events.push({ type: 'removerUsed', row, col, tier });
  return true;
}

// Bomb: clears every fruit within BOMB_RADIUS of the target cell, regardless of
// tier. The cleared fruit itself awards nothing.
//
// Merges are still resolved afterwards, because the collapse can legitimately
// bring matching fruit together -- but with the combo suppressed, so the bomb
// cannot be used to farm the multiplier. An earlier version of this comment
// claimed the bomb "does not touch the combo" while resolveMerges below routed
// straight into registerComboHit; the suppression flag is what makes the claim
// actually true.
export function detonateBomb(state, row, col) {
  const rows = state.grid.length;
  if (row < 0 || row >= rows || col < 0 || col >= COLS) return null;

  const cleared = [];
  for (let r = row - BOMB_RADIUS; r <= row + BOMB_RADIUS; r++) {
    for (let c = col - BOMB_RADIUS; c <= col + BOMB_RADIUS; c++) {
      if (r < 0 || r >= rows || c < 0 || c >= COLS) continue;
      if (state.grid[r][c] === null) continue;
      cleared.push({ row: r, col: c, tier: state.grid[r][c] });
      state.grid[r][c] = null;
    }
  }
  if (cleared.length === 0) return null;

  // Emitted before settling, so the coordinates still point at where each fruit
  // actually was when it was destroyed. main.js turns this into one burst per
  // cell (plus one expanding ring centred on row/col, 7.3); physics stays
  // free of audio/DOM imports, as everywhere else here.
  state.events.push({ type: 'bombCleared', row, col, cells: cleared.slice() });

  settleColumns(state);
  state.suppressCombo = true;
  try {
    resolveMerges(state);
  } finally {
    state.suppressCombo = false;
  }
  return cleared;
}

// Magnet: one gentle step of attraction. The exposed (top-of-column) fruit
// matching the held fruit's tier slides ONE column toward the column being
// dragged over, and only if the destination has room.
//
// Deliberately narrow: it never moves a fruit more than one column per step,
// and it never resolves the merge itself. It nudges the board, it does not
// solve it -- repositioning only. Any adjacency it creates sits there until the
// player's next drop lands and lockFruit() resolves it through the normal path,
// so the merge still costs the player a placement.
//
// (An earlier version called resolveMerges() here, which cashed in the merge --
// and any chain cascade behind it -- with no further player input, contradicting
// this very comment. A compliance review caught it.)
//
// Decision (1.2): a magnet-assisted merge still feeds the combo multiplier,
// unlike a Bomb's collapse (see suppressCombo in detonateBomb/mergeCells). The
// two are not the same kind of merge: the Magnet only repositions, so the
// merge still requires the player to drop a fruit to actually happen -- a real
// merge, worth the streak. The Bomb clears the board wholesale with no drop at
// all; letting its cascade build a multiplier would make detonating the
// cheapest way to run the streak up. Deliberate asymmetry -- do not "fix" it.
// Read-only: which exposed (top-of-column) fruits currently qualify to be
// pulled toward the held column, without moving anything. Shared by
// stepMagnet's own planning phase below and by render.js, which calls this
// every frame (not just on the ~magnetStepTimer cadence an actual move
// fires on) to draw the field arcs and target rings (7.3) -- those need to
// track what the magnet is CURRENTLY interested in, not just the instant a
// step happens to land.
export function magnetTargets(state) {
  if (!state.magnetActive || !state.active) return [];
  const heldTier = state.active.tier;
  const targetCol = state.active.col;
  const rows = state.grid.length;
  const targets = [];
  for (let c = 0; c < COLS; c++) {
    if (c === targetCol) continue;
    if (state.stackHeight[c] === 0) continue;
    const topRow = rows - state.stackHeight[c];
    const tier = state.grid[topRow][c];
    // A held rainbow attracts everything; a rainbow on the board answers to any hold.
    if (pairTier(tier, heldTier) === null) continue;
    targets.push({ col: c, row: topRow, tier });
  }
  return targets;
}

export function stepMagnet(state, dt) {
  if (!state.magnetActive || !state.active) return [];

  state.magnetTimer -= dt;
  if (state.magnetTimer <= 0) {
    state.magnetActive = false;
    state.magnetTimer = 0;
    return [];
  }

  state.magnetStepTimer -= dt;
  if (state.magnetStepTimer > 0) return [];
  state.magnetStepTimer = MAGNET_STEP_SEC;

  const targetCol = state.active.col;
  const rows = state.grid.length;

  // Two phases on purpose. Scanning and moving in one pass lets a fruit that
  // just landed in column c+1 be picked up again when the loop reaches c+1,
  // so a single fruit could cross several columns in one step and drop
  // straight into the merge -- exactly the "solves it for you" behaviour this
  // power-up must not have. Planning against an unmutated snapshot caps every
  // fruit at one column per step.
  const planned = [];
  for (const { col: c, row: topRow, tier } of magnetTargets(state)) {
    const dest = c + (targetCol > c ? 1 : -1);
    if (dest < 0 || dest >= COLS) continue;
    planned.push({ from: c, to: dest, tier, fromRow: topRow });
  }

  const moves = [];
  for (const move of planned) {
    // Re-check against live state: an earlier move this step may have filled
    // the destination or emptied the source.
    if (state.stackHeight[move.to] >= rows) continue;
    if (state.grid[move.fromRow][move.from] !== move.tier) continue;

    state.grid[move.fromRow][move.from] = null;
    state.stackHeight[move.from] -= 1;
    const destRow = rows - 1 - state.stackHeight[move.to];
    state.grid[destRow][move.to] = move.tier;
    state.stackHeight[move.to] += 1;
    moves.push({ from: move.from, to: move.to, tier: move.tier });
  }

  // settleColumns is required, not cosmetic. When one column is both a source
  // and a destination in the same step, the second move uses the snapshot's
  // fromRow and so nulls a cell that the first move has just buried, leaving a
  // hole with a fruit floating above it. Each fruit still travels only one
  // column; this repairs the transient gap and recomputes stackHeight.
  //
  // Note there is NO resolveMerges() here on purpose -- see the header comment.
  if (moves.length > 0) settleColumns(state);
  return moves;
}

export function isGameOver(state) {
  const rows = effectiveRows(state);
  const startCol = Math.floor(COLS / 2);
  return state.stackHeight[startCol] >= rows;
}
