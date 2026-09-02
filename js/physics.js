// Falling motion, landing detection, merge resolution and column settling.
// Pure functions over the state object -- no canvas or DOM access here.

import {
  COLS, CELL, SLOW_DROP_MULTIPLIER, DRAG_LERP,
  MAX_TIER, WATERMELON_CLEAR_BONUS, TIERS, BOARD_WIDTH,
  RAINBOW_TIER, RAINBOW_DEF, BOMB_RADIUS, BOMB_TIER, BOMB_DEF, BOMB_FUSE_DROPS,
  SPAWN_MIN_REACTION_SEC,
} from './constants.js';
import {
  effectiveRows, nextTierFor, addScore, registerComboHit, currentGravityPxPerSec, fillMergeMeter, levelFor,
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

// The column the NEXT fruit will arrive in. Fixed at the middle of the board
// (14, reverting 12.2's uniform random pick -- see the "Where a fruit comes
// from" comment in js/constants.js for why both changes happened), then
// redirected outward to the nearest column with room if that one is full --
// the same alternating left/right search columnForX already performs, so a
// full column is never a valid answer here either.
//
// Returns -1 only when every column is full, which is the terminal state
// isGameOver reports.
//
// DETERMINISTIC AND EXPORTED, and both of those are load-bearing. It has no
// randomness and reads nothing but stackHeight, so js/render.js's
// drawSpawnChute can call it to draw the marker over exactly the column the
// next spawnFruit will use, including when the redirect moves it. A second
// implementation of "where does the next fruit go" would eventually
// disagree with this one, and the copy the player can SEE would be the one
// that was wrong. Do not inline it into spawnFruit.
export function spawnColumnFor(state) {
  const rows = effectiveRows(state);
  const wanted = Math.floor(COLS / 2);
  if (state.stackHeight[wanted] < rows) return wanted;
  for (let offset = 1; offset < COLS; offset++) {
    const left = wanted - offset;
    const right = wanted + offset;
    if (left >= 0 && state.stackHeight[left] < rows) return left;
    if (right < COLS && state.stackHeight[right] < rows) return right;
  }
  return -1;
}

// How long this fruit holds at the top before gravity takes it. See
// SPAWN_MIN_REACTION_SEC: a floor on time-to-land, not a flat delay, so it
// is zero on an empty board and only pays out over a tall column.
//
// Measured against the column the fruit ARRIVES over, once, at spawn. The
// player may immediately steer somewhere taller or shorter and the hold does
// not follow them -- recomputing it as they drag would make the fruit
// hesitate whenever they passed over a tall column, which reads as lag
// rather than as grace.
function spawnHangSecFor(state, col) {
  const rows = effectiveRows(state);
  const landingRow = rows - 1 - state.stackHeight[col];
  const distance = landingRow * CELL + CELL / 2 + tierDef(state.nextTier).radius;
  const fallSec = distance / currentGravityPxPerSec(state);
  return Math.max(0, SPAWN_MIN_REACTION_SEC - fallSec);
}

export function spawnFruit(state) {
  // Bail before consuming anything. A blocked spawn ends the run, and eating a
  // scheduled wild (or advancing the index) on the way out would silently
  // destroy a charge the player paid for.
  //
  // 12.2: "blocked" now means every column is full, not that one nominated
  // column is. Five empty columns no longer count for nothing. 14 restored
  // the fixed spawn column but kept this rule -- see js/constants.js.
  const startCol = spawnColumnFor(state);
  if (startCol < 0) {
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

  // Computed before nextTier is consumed below -- it needs the radius of the
  // fruit that is about to spawn, which is still state.nextTier at this point.
  const hangSec = spawnHangSecFor(state, startCol);

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
  // 15: the only place spawnIndex increments, so the only place a level
  // boundary can be crossed. Compared against the PRE-increment value rather
  // than caching levelFor(state.spawnIndex) from the top of this function --
  // spawnIndex is the single source of truth for both, and computing the
  // "before" from it here (one subtraction) needs no second variable to keep
  // in sync with the increment below.
  const levelBefore = levelFor(state.spawnIndex);
  state.spawnIndex += 1;
  if (levelFor(state.spawnIndex) > levelBefore) {
    // Physics pushes the event; js/main.js's drainEvents turns it into sound,
    // haptics and the on-board callout -- the same seam every other reaction
    // in this game goes through. No audio/effects/DOM call from here.
    state.events.push({ type: 'levelUp', level: levelFor(state.spawnIndex) });
  }
  state.nextTier = nextTierFor(state);

  state.active = {
    tier,
    col: startCol,
    x: startCol * CELL + CELL / 2,
    targetX: startCol * CELL + CELL / 2,
    y: -tierDef(tier).radius,
    hangSec,
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
  // 12.2: the reaction floor. Steering above is deliberately OUTSIDE this
  // branch -- the fruit tracks the pointer while it holds, which is the
  // whole purpose. Only the fall waits.
  if (active.hangSec > 0) {
    active.hangSec -= dt;
    return false;
  }

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

// Pre-existing bug surfaced by 9.5's board-integrity stress test: only the
// SPAWN column governs isGameOver, so a non-spawn column can already be
// completely full while play continues normally, and dragging a falling
// fruit over that column crashed lockFruit outright -- landingRow going
// negative, state.grid[-1] being undefined. Fixed at the root, here, rather
// than at each landing call site: a full column is simply never a valid
// answer, redirected to the nearest column (checked left/right alternately,
// outward) that still has room. Both stepPhysics and hardDrop call this.
function columnForX(state, x) {
  const col = Math.min(COLS - 1, Math.max(0, Math.floor(x / CELL)));
  const rows = effectiveRows(state);
  if (state.stackHeight[col] < rows) return col;
  for (let offset = 1; offset < COLS; offset++) {
    const left = col - offset;
    const right = col + offset;
    if (left >= 0 && state.stackHeight[left] < rows) return left;
    if (right < COLS && state.stackHeight[right] < rows) return right;
  }
  // Every column is full -- the board is already in a terminal state that
  // isGameOver will catch on the next spawn attempt; nothing better to do
  // with THIS fruit than leave it exactly where it naturally was.
  return col;
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

// Swap (10.1): trades two adjacent, already-settled fruit. Replaces the
// Magnet entirely -- the Magnet did what dragging already does (help a fruit
// reach a chosen column); this does the one thing dragging fundamentally
// cannot: act on the board once fruit has landed.
//
// Rejects everything that could break an invariant, bomb check FIRST per the
// brief: BOMB_TIER is a grid sentinel like the rainbow (see pairTier's own
// LANDMINE comment for the same danger family), and swapping it would move a
// live fuse somewhere the player did not plant it. Column heights are then
// preserved exactly no matter what -- two occupied cells trade tiers,
// nothing is ever cleared or created, so this cannot leave a hole beneath a
// fruit the way the old Magnet design once did. The invariant holds by
// construction, not by care, and there is no per-frame behaviour at all.
//
// Combo: a swap-caused merge feeds the combo streak normally, unlike a
// Bomb's collapse (see suppressCombo in detonateBomb/mergeCells). The player
// found and executed this merge themselves -- that is skill, the same
// reasoning phase 1.2 already established for the old Magnet's own (very
// different) merges. Deliberate asymmetry -- do not wrap this in
// suppressCombo.
export function swapFruits(state, r1, c1, r2, c2) {
  const tierA = state.grid[r1][c1];
  const tierB = state.grid[r2][c2];
  if (tierA === BOMB_TIER || tierB === BOMB_TIER) return false;
  if (tierA === null || tierB === null) return false;
  if (Math.abs(r1 - r2) + Math.abs(c1 - c2) !== 1) return false;

  state.grid[r1][c1] = tierB;
  state.grid[r2][c2] = tierA;
  resolveMerges(state);
  return true;
}

// 12.2: the board is over when there is nowhere left to put anything, not
// when one nominated column fills. This is the single line that stopped five
// empty columns from counting for nothing.
export function isGameOver(state) {
  const rows = effectiveRows(state);
  for (let c = 0; c < COLS; c++) {
    if (state.stackHeight[c] < rows) return false;
  }
  return true;
}
