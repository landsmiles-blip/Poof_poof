// Falling motion, landing detection, merge resolution and column settling.
// Pure functions over the state object -- no canvas or DOM access here.

import {
  COLS, CELL, SLOW_DROP_MULTIPLIER, DRAG_LERP,
  MAX_TIER, WATERMELON_CLEAR_BONUS, TIERS, BOARD_WIDTH,
  RAINBOW_TIER, RAINBOW_DEF, BOMB_RADIUS, BOMB_TIER, BOMB_DEF, BOMB_FUSE_DROPS,
  MAGNET_ENERGY_MAX, MAGNET_DRAIN_PER_SEC, MAGNET_REGEN_PER_SEC,
  MAGNET_PULL_RANGE_PX, MAGNET_PULL_PX_PER_SEC,
} from './constants.js';
import {
  effectiveRows, nextTierFor, addScore, registerComboHit, currentGravityPxPerSec, fillMergeMeter,
} from './state.js';

// Tier lookup that also answers for the rainbow and bomb sentinels, so
// callers that only need geometry (radius) never have to special-case them.
export function tierDef(tier) {
  if (tier === RAINBOW_TIER) return RAINBOW_DEF;
  if (tier === BOMB_TIER) return BOMB_DEF;
  return TIERS[tier];
}

export function isRainbow(tier) {
  return tier === RAINBOW_TIER;
}

export function isBomb(tier) {
  return tier === BOMB_TIER;
}

// Scans for the currently-planted bomb (8.4) rather than trusting a cached
// position: settleColumns (from an unrelated merge or the remover elsewhere
// on the board) can shift it after it lands, and re-scanning is cheap
// against a board this small.
function findBombCell(state) {
  const rows = state.grid.length;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < COLS; c++) {
      if (state.grid[r][c] === BOMB_TIER) return { row: r, col: c };
    }
  }
  return null;
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

  // 8.4: the fuse burns down by DROPS, not wall-clock time -- a new spawn is
  // exactly what "a drop" means, so this only ticks while the game is
  // actually being played. Checked here, before this spawn does anything
  // else, so a fuse reaching zero detonates before the next fruit exists.
  // findBombCell can legitimately come back empty (the Fruit Remover deleted
  // the bomb tile before the fuse ran out) -- that just means the charge is
  // spent with nothing to show for it, not a bug to guard against further.
  if (state.bombFuseDrops !== null) {
    state.bombFuseDrops -= 1;
    if (state.bombFuseDrops <= 0) {
      const cell = findBombCell(state);
      if (cell) detonateBomb(state, cell.row, cell.col);
      state.bombFuseDrops = null;
      state.bombInPlay = false;
    }
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
    // 9.2: once the player has steered THIS fruit (a drag or a keyboard
    // nudge -- see setDragTarget, the single place both go through), the
    // magnet backs off it entirely for the rest of its fall. "Dragging
    // always overrides. The magnet assists aim; it never takes control" --
    // a permanent hand-off per drop, not a moment-to-moment tug of war that
    // could still yank the fruit sideways in the instant right after a
    // release. Resets to false for free on every new spawn.
    playerSteered: false,
  };
  return { blocked: false };
}

export function setDragTarget(state, pixelX) {
  if (!state.active) return;
  const radius = tierDef(state.active.tier).radius;
  const clamped = Math.min(BOARD_WIDTH - radius, Math.max(radius, pixelX));
  state.active.targetX = clamped;
  state.active.playerSteered = true;
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
  // 8.4: the fuse starts counting only once the bomb is actually resting
  // somewhere -- not from the moment it was planted, which could be several
  // frames of falling earlier. resolveMerges below is a no-op for it either
  // way (pairTier rejects the bomb outright), so this is safe to set first.
  if (tier === BOMB_TIER) state.bombFuseDrops = BOMB_FUSE_DROPS;
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
  // 8.4 LANDMINE: checked BEFORE the rainbow branch below, on purpose. The
  // rainbow branch treats a wild as matching ANYTHING, so if this check came
  // after it, pairTier(BOMB_TIER, RAINBOW_TIER) would return BOMB_TIER --
  // merging the wildcard INTO the bomb, or worse, producing a real tier from
  // a sentinel value. A bomb never merges with anything, wildcard included.
  if (a === BOMB_TIER || b === BOMB_TIER) return null;
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
  // Same gate as the combo streak above, same reason (8.1): a bomb's cascade
  // must not also be a way to farm free charges.
  if (!state.suppressCombo) fillMergeMeter(state, tier >= MAX_TIER ? MAX_TIER : tier + 1);

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

// Magnet (9.2 redesign): it never touches settled fruit any more. The old
// design slid the exposed top-of-column fruit toward the companion's column,
// which read as "moving things I already placed" -- it fought the player's
// built stack instead of serving their aim, and it was the direct cause of a
// board-corruption bug: when one column was both a move's source and another
// move's destination in the SAME step, a fruit could be left floating over a
// hole the settle pass hadn't caught up to yet. Deleted entirely, not fixed
// in place: stepMagnet's grid mutation, its settleColumns call, and the
// slide-tween effect that existed only to hide that mutation's jump
// (js/effects.js's spawnMagnetSlides/magnetSlideOffsetAt, now gone too).
//
// New design: the companion never leaves its rail, but now it influences the
// CURRENTLY FALLING fruit instead of the board -- see magnetPullFor. It
// never resolves a merge itself (same invariant as before: a compliance
// review already caught one version of this power-up doing that), because it
// only ever nudges state.active.targetX, and a merge still only ever happens
// through the normal lockFruit -> resolveMerges path once the player's own
// drop lands.

// Moves the companion's target column (8.3) -- called continuously while the
// player drags it along the rail, the same shape as setDragTarget above.
export function setMagnetColumn(state, col) {
  state.magnetCol = Math.min(COLS - 1, Math.max(0, Math.round(col)));
}

// Read-only: how strongly, and in which direction, the magnet is currently
// pulling the given falling fruit toward its column -- null when there is
// nothing to pull (out of range, or the player has already steered this
// fruit). Shared by stepMagnet's own tick and by render.js, which calls this
// every frame to draw the pull arc, so the visual and the actual physics can
// never show different answers.
//
// distance is measured against active.targetX, not active.x -- the same
// "commanded position, not the smoothed visual follower" distinction
// setDragTarget and keyboard steering already respect (both write targetX
// only). Measuring against x instead would let a pull computed this tick
// disagree with whatever the PREVIOUS tick's nudge already committed to.
//
// 9.6: MAGNET_PULL_RANGE_PX is a hard cutoff, not just a gentler taper -- a
// magnet parked anywhere on the board must not influence every single drop
// regardless of where the player is aiming. Strength then falls off
// linearly inside that range, so a fruit far from the magnet (but still in
// range) gets a nudge, not a yank.
export function magnetPullFor(state, active) {
  if (!active || active.playerSteered) return null;
  const magnetCenterX = state.magnetCol * CELL + CELL / 2;
  const dx = magnetCenterX - active.targetX;
  const distance = Math.abs(dx);
  if (distance === 0 || distance > MAGNET_PULL_RANGE_PX) return null;
  return { dx, distance, strength: 1 - distance / MAGNET_PULL_RANGE_PX };
}

export function stepMagnet(state, dt) {
  if (!state.magnetActive) return;

  // The puck's DRAWN position eases toward wherever it was last dragged --
  // magnetCol (the logical, authoritative column) never itself moves except
  // by an explicit setMagnetColumn call.
  const targetX = state.magnetCol * CELL + CELL / 2;
  state.magnetX += (targetX - state.magnetX) * Math.min(1, DRAG_LERP * (dt * 60));

  // 8.3's energy-not-a-fixed-timer design carries over unchanged: "pulling"
  // now means there is a falling fruit within range and not yet steered by
  // the player, instead of a matching exposed grid fruit -- the condition
  // changed, the drain/regen mechanics did not.
  const pull = state.active ? magnetPullFor(state, state.active) : null;
  if (pull) {
    state.magnetEnergy = Math.max(0, state.magnetEnergy - MAGNET_DRAIN_PER_SEC * dt);
    // A curve, not a snap: this nudges targetX a bounded amount per tick
    // (scaled by dt and the range falloff) rather than relocating it, so the
    // falling fruit's existing x-toward-targetX lerp (stepPhysics) is what
    // actually draws the curve. Clamped to never overshoot past the magnet's
    // own centre in one tick, so it settles rather than oscillating past it.
    const step = pull.strength * MAGNET_PULL_PX_PER_SEC * dt;
    state.active.targetX += step >= pull.distance ? pull.dx : Math.sign(pull.dx) * step;
  } else {
    state.magnetEnergy = Math.min(MAGNET_ENERGY_MAX, state.magnetEnergy + MAGNET_REGEN_PER_SEC * dt);
  }

  if (state.magnetEnergy <= 0) {
    state.magnetActive = false;
  }
}

export function isGameOver(state) {
  const rows = effectiveRows(state);
  const startCol = Math.floor(COLS / 2);
  return state.stackHeight[startCol] >= rows;
}
