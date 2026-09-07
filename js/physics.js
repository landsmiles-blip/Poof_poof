// Falling motion, landing detection, merge resolution and column settling.
// Pure functions over the state object -- no canvas or DOM access here.

import {
  COLS, CELL, SLOW_DROP_MULTIPLIER, DRAG_LERP,
  MAX_TIER, WATERMELON_CLEAR_BONUS, TIERS, BOARD_WIDTH,
  RAINBOW_TIER, RAINBOW_DEF, BOMB_RADIUS, BOMB_TIER, BOMB_DEF, BOMB_FUSE_DROPS,
  SPAWN_MIN_REACTION_SEC, STONE_TIER, STONE_DEF, STONE_CRACK_POINTS,
} from './constants.js';
import {
  effectiveRows, nextTierFor, addScore, registerComboHit, currentGravityPxPerSec, fillMergeMeter, levelFor,
  floorRiseCadenceDrops, expireArmedPowerUp, stonesPerRise,
} from './state.js';

// Tier lookup that also answers for the rainbow and bomb sentinels, so
// callers that only need geometry (radius) never have to special-case them.
export function tierDef(tier) {
  if (tier === RAINBOW_TIER) return RAINBOW_DEF;
  if (tier === BOMB_TIER) return BOMB_DEF;
  if (tier === STONE_TIER) return STONE_DEF;
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
  // Terminal bail before consuming anything. A blocked spawn ends the run, and
  // eating a scheduled wild (or advancing the index) on the way out would
  // silently destroy a charge the player paid for.
  //
  // 12.2: "blocked" now means every column is full, not that one nominated
  // column is. Five empty columns no longer count for nothing. 14 restored
  // the fixed spawn column but kept this rule -- see js/constants.js.
  // 8.4: the fuse burns down by DROPS, not wall-clock time -- a new spawn is
  // exactly what "a drop" means, so this only ticks while the game is
  // actually being played.
  // findBombCell can legitimately come back empty (the Fruit Remover deleted
  // the bomb tile before the fuse ran out) -- that just means the charge is
  // spent with nothing to show for it, not a bug to guard against further.
  //
  // 20 LANDMINE, found by audit: this used to sit AFTER the terminal bail
  // below, and its own comment claimed the opposite ("checked here, before
  // this spawn does anything else"). So if the drop that filled the last cell
  // was also the drop the fuse was going to end on, the bail fired first and
  // the bomb never went off -- the player paid 60 coins for a rescue the game
  // then skipped, on the exact board it existed to rescue. Ticking the fuse
  // FIRST is what the comment always said, and it costs nothing: a detonation
  // frees cells, so the bail below simply sees the rescued board.
  if (state.bombFuseDrops !== null) {
    state.bombFuseDrops -= 1;
    if (state.bombFuseDrops <= 0) {
      const cell = findBombCell(state);
      if (cell) detonateBomb(state, cell.row, cell.col);
      state.bombFuseDrops = null;
      state.bombInPlay = false;
    }
  }

  // Terminal bail before consuming anything else. A blocked spawn ends the
  // run, and eating a scheduled wild (or advancing the index) on the way out
  // would silently destroy a charge the player paid for.
  //
  // 12.2: "blocked" means every column is full, not that one nominated column
  // is. Five empty columns no longer count for nothing. 14 restored the fixed
  // spawn column but kept this rule -- see js/constants.js.
  if (spawnColumnFor(state) < 0) {
    return { blocked: true };
  }

  // state.nextTier was decided one spawn ahead of time (in nextTierFor, called
  // from here and from startRun) specifically so the HUD's "Next" preview is
  // never a lie -- nothing here is allowed to override it.
  const tier = state.nextTier;
  // 15: the only place spawnIndex increments, so the only place a level
  // boundary -- and, since 17, a rising-floor push -- can be crossed. Compared
  // against the PRE-increment value rather than caching levelFor from the top
  // of this function: spawnIndex is the single source of truth for both.
  const levelBefore = levelFor(state.spawnIndex);
  state.spawnIndex += 1;
  if (levelFor(state.spawnIndex) > levelBefore) {
    // Physics pushes the event; js/main.js's drainEvents turns it into sound,
    // haptics and the on-board callout -- the same seam every other reaction
    // in this game goes through. No audio/effects/DOM call from here.
    state.events.push({ type: 'levelUp', level: levelFor(state.spawnIndex) });
  }

  // 18: hand control back if an armed Remover/Swap was never used. Drop-indexed
  // here for the same reason the floor is -- one counter, no clock, immune to
  // pausing. See ARM_EXPIRY_DROPS in js/constants.js for the dead-run bug this
  // closes.
  expireArmedPowerUp(state);

  // 17: the rising floor, drop-indexed off the count just incremented.
  // Deliberately AFTER the level bump so a rise uses the level it belongs to.
  //
  // 20 LANDMINE, found by audit: the counter used to run during the opening
  // grace too, where the cadence is Infinity and no rise can happen. By the
  // time level 3 arrived the counter was already at 20 against a cadence of
  // 16, so the very first rise of every run fired INSTANTLY at the level
  // boundary -- with the meter, which draws nothing while the cadence is
  // infinite, never having appeared. Twenty silent drops, then the floor
  // jumps with no warning at all: exactly the "it ends like a surprise"
  // complaint 19 was built to remove, on the one rise a new player meets
  // first. Holding the counter at zero until the mechanic is actually live
  // also makes the first gap the 16 drops constants.js claims, instead of 0.
  const cadence = floorRiseCadenceDrops(levelFor(state.spawnIndex));
  if (!Number.isFinite(cadence)) {
    state.dropsSinceFloorRise = 0;
  } else {
    state.dropsSinceFloorRise += 1;
    if (state.dropsSinceFloorRise >= cadence) {
      state.dropsSinceFloorRise = 0;
      if (raiseFloor(state).toppedOut) {
        return { blocked: true };
      }
    }
  }

  // startCol and hangSec are computed HERE, after the rise -- the rise shifted
  // every column up by one, so a value read before it would be stale. hangSec
  // still reads state.nextTier (=== tier), so it must run before the reassign
  // just below. spawnColumnFor can now come back -1 if the rise itself filled
  // the last open column, which is simply the run ending on this drop.
  const startCol = spawnColumnFor(state);
  if (startCol < 0) {
    return { blocked: true };
  }
  const hangSec = spawnHangSecFor(state, startCol);

  // 18 (was 17.1): counted HERE, past every `return { blocked: true }` above,
  // not up where `tier` is read. The original code had exactly one bail point
  // and it sat before this line -- "bail before consuming anything", as its own
  // comment said -- so a run that ended on this drop could never mark a wild as
  // delivered without delivering it. Phase 17 added two bail points AFTER it
  // (the floor top-out and the post-rise full board), quietly breaking that
  // guarantee: endRun refunds the charge only when rainbowDelivered is still 0,
  // and it reads that BEFORE resetting, so a coincidence would have silently
  // eaten a charge the player paid for. Unreachable with today's constants
  // (RAINBOW_SCHEDULE resolves by drop 8, the earliest rise is drop 20) -- but
  // that is two independently-tunable numbers apart, and we just spent a phase
  // tuning one of them. Restored by structure instead of by luck.
  if (tier === RAINBOW_TIER) {
    state.rainbowDelivered = (state.rainbowDelivered || 0) + 1;
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
  // 20: keyed to targetX -- where the player AIMED -- not to active.x, where
  // the fruit has physically eased to.
  //
  // The keyboard sets targetX one cell per press (js/input.js), and
  // stepPhysics eases x toward it at DRAG_LERP, which takes about 167ms to
  // close a single column. Dropping from active.x meant a player who pressed
  // right and then dropped inside that window landed in the column they were
  // leaving. Measured before the fix: 3 of 8 hard drops landed in the wrong
  // column; waiting out the ease first, 136 of 136 landed correctly. The
  // command said "put it there", so it goes there.
  const col = columnForX(state, active.targetX);
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
// 20: how far into the current cascade we are. Every merge event carries its
// step so the presentation layer can play the chain out in order -- see
// CASCADE_STEP_SEC in constants.js for the reported problem this solves.
// Module-local rather than on `state`: it is meaningless between calls, it is
// never persisted, and resolveMerges is never re-entrant.
let cascadeStep = 0;

export function resolveMerges(state) {
  cascadeStep = 0;
  let mergedSomething = true;
  while (mergedSomething) {
    mergedSomething = mergeOnePair(state);
    if (mergedSomething) {
      settleColumns(state);
      cascadeStep += 1;
    }
  }
  // 20: the biggest chain a single action set off, which is the number a
  // player would actually call a "chain". The results screen used to report
  // state.bestComboThisRun instead -- the timer-based streak, which does not
  // lapse between drops, so it just counted every merge in the run and
  // reported things like "530x chain". A number that only ever goes up is not
  // a result. This one moves: it is typically 1 or 2 and rarely above 5.
  if (cascadeStep > state.bestCascade) state.bestCascade = cascadeStep;
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
  // 21: the same landmine, one sentinel later. A stone never merges with
  // anything, wildcard included -- checked here, above the rainbow branch,
  // for exactly the reason the bomb is.
  if (a === STONE_TIER || b === STONE_TIER) return null;
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

// 21: a merge cracks any stone orthogonally touching either of the two cells
// it consumed. This is what stops the stone being a wall you can only watch:
// merging BESIDE the floor is now the correct play, which is the "fight the
// floor" the design has always claimed and never quite paid out. Scores a
// little, because clearing one is real work.
//
// Called from mergeCells while the cascade is still resolving, so a chain
// eats its way along a row of stone -- deliberately, and it is the best
// feeling in the game.
function crackStonesAround(state, row, col) {
  const rows = state.grid.length;
  const near = [[row - 1, col], [row + 1, col], [row, col - 1], [row, col + 1]];
  for (const [r, c] of near) {
    if (r < 0 || r >= rows || c < 0 || c >= COLS) continue;
    if (state.grid[r][c] !== STONE_TIER) continue;
    state.grid[r][c] = null;
    addScore(state, STONE_CRACK_POINTS);
    state.events.push({
      type: 'stoneCracked', row: r, col: c,
      x: c * CELL + CELL / 2, y: r * CELL + CELL / 2,
    });
  }
}

function mergeCells(state, r1, c1, r2, c2, tier) {
  // Keep the result at the lower (larger row) cell so it stays grounded.
  const [keepR, keepC] = r2 >= r1 ? [r2, c2] : [r1, c1];
  const [clearR, clearC] = keepR === r1 && keepC === c1 ? [r2, c2] : [r1, c1];

  // 21: both consumed fruit, captured with their tiers and frozen pixel
  // positions BEFORE the grid changes. js/render.js draws them as ghosts
  // until this link of the chain actually pops -- without that, staging the
  // pops only staggers the confetti while the fruit themselves all vanish in
  // the same frame, which is what "fruits popping randomly" actually was.
  const consumed = [
    { tier: state.grid[r1][c1], x: c1 * CELL + CELL / 2, y: r1 * CELL + CELL / 2 },
    { tier: state.grid[r2][c2], x: c2 * CELL + CELL / 2, y: r2 * CELL + CELL / 2 },
  ];

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

  // Both consumed cells crack their neighbours -- the pair covers a wider
  // footprint than the surviving fruit alone, which is what makes a chain
  // running alongside a stone row actually clear it.
  crackStonesAround(state, keepR, keepC);
  crackStonesAround(state, clearR, clearC);

  if (tier >= MAX_TIER) {
    state.grid[keepR][keepC] = null;
    addScore(state, Math.round(WATERMELON_CLEAR_BONUS * multiplier));
    state.events.push({ type: 'topTier', tier, row: keepR, col: keepC, x, y, multiplier, step: cascadeStep, consumed });
  } else {
    const newTier = tier + 1;
    state.grid[keepR][keepC] = newTier;
    addScore(state, Math.round(TIERS[newTier].points * multiplier));
    state.events.push({ type: 'merge', tier: newTier, row: keepR, col: keepC, x, y, multiplier, step: cascadeStep, consumed });
    if (newTier >= MAX_TIER) {
      // Reaching the highest tier for the first time is its own moment,
      // distinct from clearing a pair of them.
      state.events.push({ type: 'reachedTop', tier: newTier, row: keepR, col: keepC, x, y });
    }
  }
}

export function settleColumns(state) {
  const rows = state.grid.length;
  const sel = state.swapSelectedCell;
  for (let c = 0; c < COLS; c++) {
    const values = [];
    // 20: where the pending Swap selection ends up. See rebaseSwapSelection
    // for the bug this closes -- a coordinate stored between two taps used to
    // go stale the moment anything moved, and Swap then acted on a fruit the
    // player never picked. Captured as an INDEX INTO values (how many fruit
    // sit above it), which is the one description of "that fruit" this
    // repack cannot invalidate.
    let selIndex = -1;
    for (let r = 0; r < rows; r++) {
      if (state.grid[r][c] === null) continue;
      if (sel && sel.col === c && sel.row === r) selIndex = values.length;
      values.push(state.grid[r][c]);
    }
    for (let r = 0; r < rows; r++) state.grid[r][c] = null;
    const startRow = rows - values.length;
    for (let i = 0; i < values.length; i++) {
      state.grid[startRow + i][c] = values[i];
    }
    state.stackHeight[c] = values.length;

    if (sel && sel.col === c) {
      // selIndex < 0 means the selected cell held nothing after the merge
      // that triggered this settle -- the fruit is gone, so the selection is.
      if (selIndex < 0) state.swapSelectedCell = null;
      else state.swapSelectedCell = { row: startRow + selIndex, col: c, tier: values[selIndex] };
    }
  }
}

// 20: keeps a pending Swap selection pointing at the fruit the player actually
// tapped, across a board that moves underneath them.
//
// The bug, found by audit and reproduced end to end: swapSelectedCell held a
// raw {row, col} between the two taps a Swap needs, and NOTHING rebased it. A
// floor rise shifts every row up one; a merge repacks a column downward. Both
// happen constantly, and both happen in the gap between the taps -- the run
// does not pause while a power-up is armed. So the second tap swapped whatever
// had slid into that coordinate, and consumeSwap billed the charge for it.
// Measured: tap a tier 6, one rise later that cell holds a tier 5, and the
// game swaps the 5.
//
// A rise is a uniform shift, so it rebases exactly. settleColumns rebases
// itself (above). The tier recorded at selection is the belt to that braces:
// if what is at the rebased cell is not what the player pointed at, the
// selection is dropped rather than guessed at. Dropping it costs one extra
// tap; acting on it costs a charge and a fruit they wanted to keep.
function rebaseSwapSelectionForRise(state, col) {
  const sel = state.swapSelectedCell;
  if (!sel || sel.col !== col) return;
  const row = sel.row - 1;
  if (row < 0) { state.swapSelectedCell = null; return; }
  state.swapSelectedCell = { row, col, tier: sel.tier };
}

// Called wherever the board changed in a way the rebasing above cannot
// describe. Cheap, and always safe: the worst case is one extra tap.
export function validateSwapSelection(state) {
  const sel = state.swapSelectedCell;
  if (!sel) return;
  const inBounds = sel.row >= 0 && sel.row < state.grid.length && sel.col >= 0 && sel.col < COLS;
  if (!inBounds || state.grid[sel.row][sel.col] !== sel.tier) state.swapSelectedCell = null;
}

// Removes a single fruit from the board (Fruit Remover power-up), then settles.
export function removeFruitAt(state, row, col) {
  const tier = state.grid[row][col];
  if (tier === null) return false;
  state.grid[row][col] = null;
  settleColumns(state);
  validateSwapSelection(state);
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
  // 21: nor a stone. It is scenery the floor put there; letting the player
  // slide it around would turn a pressure mechanic into free tidying.
  if (tierA === STONE_TIER || tierB === STONE_TIER) return false;
  if (tierA === null || tierB === null) return false;
  if (Math.abs(r1 - r2) + Math.abs(c1 - c2) !== 1) return false;

  state.grid[r1][c1] = tierB;
  state.grid[r2][c2] = tierA;
  resolveMerges(state);
  return true;
}

// 17: the rising floor -- push a new bottom row up across the whole board,
// lifting every column by one. This is the pressure that makes a run END:
// speed and the spawn pool both stop escalating (see constants.js), so without
// it a careful merger holds a low board forever and "how long can you last"
// has no answer.
//
// Returns { toppedOut } rather than setting a flag, and 20 changed what that
// means: it is now true only for a COMPLETELY full board, or for a board that
// was left with a column at the ceiling through a whole cadence. It used to be
// true the moment any single column was full. Checked before any mutation, so
// a topping-out rise leaves the board untouched for endRun to read.
//
// No active fruit exists when this runs: it is called only from spawnFruit,
// after the previous fruit has locked and before the next is placed, so there
// is never a mid-air fruit whose coordinates a shift would invalidate.

// How many columns are currently at the ceiling. Since 21 a capped column is
// not a losing condition -- its top fruit is crushed off on the next rise --
// so this feeds the board's danger reading only. Kept as one function so
// nothing can disagree about what "at the ceiling" means.
export function topColumnCount(state) {
  const rows = state.grid.length;
  let n = 0;
  for (let c = 0; c < COLS; c++) if (state.stackHeight[c] >= rows) n += 1;
  return n;
}

export function raiseFloor(state) {
  const rows = state.grid.length;

  // 21: THE ending, rebuilt on one rule -- the run is over when there is no
  // move left to play, and that means every cell taken. Nothing else ends it.
  //
  // This is the third design for this, and the first that is simply the rule
  // the game always should have had. The history is worth keeping, because
  // two of the three looked obviously right:
  //
  //   17-19  A rise that met ANY full column ended the run on the spot. One
  //          capped column beside five empty ones was a loss with fifty of
  //          sixty cells free. Reported from real play, correctly, as the game
  //          ending while there were still spaces to play.
  //   20     A capped column got one floor cadence of grace, then ended the
  //          run. Fairer, and still not the rule: it ended runs that had moves
  //          left, and needed a line of text on the results screen explaining
  //          why -- a good sign that the rule itself was not self-evident.
  //   21     The rise pushes EVERY column. A column with no room has its top
  //          fruit crushed off the board. The run ends when spawnColumnFor
  //          finds nowhere to put a fruit. No deadline, no grace, no
  //          explanation needed.
  //
  // The objection to 21 was that it would make the game unloseable, and 20's
  // own measurements seemed to prove it -- letting full columns SIT OUT a rise
  // took the median run from 21 drops to 17,325, with 13 of 40 never ending.
  // That conclusion was drawn from too few designs. Sitting out breaks the
  // game because a capped column stops receiving fruit, so pressure FALLS as
  // the board fills. Crushing does not: the column still takes its fruit at
  // the bottom every rise, it just cannot grow. Pressure stays constant, the
  // board keeps filling, and the run always ends -- measured over 240 runs,
  // 0 failed to terminate.
  //
  // Nor is a full column a free-deletion machine, which was the other worry.
  // A bot that deliberately keeps one column capped to farm the crush does
  // WORSE: 401 drops and 48,666 points against 529 and 87,141 for normal
  // play. You are paying a sixth of the board for one small fruit per rise.
  const newRow = riseRowFor(levelFor(state.spawnIndex));
  for (let c = 0; c < COLS; c++) {
    const full = state.stackHeight[c] >= rows;
    if (full) {
      // The fruit at the top has nowhere to go. Announced before it is
      // overwritten so js/main.js can show it being crushed out -- an
      // unexplained disappearance is exactly the confusion this phase is
      // fixing elsewhere.
      state.events.push({ type: 'crushed', col: c, tier: state.grid[0][c] });
    }
    // Shift the column up one (row r takes what was below it). For a full
    // column this discards row 0, which is the crush; for any other column
    // row 0 is null and nothing is lost.
    for (let r = 0; r < rows - 1; r++) state.grid[r][c] = state.grid[r + 1][c];
    state.grid[rows - 1][c] = newRow[c];
    if (!full) state.stackHeight[c] += 1;
    rebaseSwapSelectionForRise(state, c);
  }

  // Pushed before resolveMerges so a floorRose cue fires even when the new row
  // sets off a cascade. main.js turns it into sound/haptics -- physics stays
  // free of audio/DOM, as everywhere else here.
  state.events.push({ type: 'floorRose' });

  // The new fruit can sit under a matching fruit, or a settling cascade can
  // bring matches together -- resolve them. This is the seam that lets a good
  // player FIGHT the floor: a well-built bottom row eats part of the rise.
  resolveMerges(state);

  // Deliberately always false. A rise can no longer end a run; only having
  // nowhere to put the next fruit can, which spawnFruit checks itself. Kept
  // as a return value rather than removed so every call site keeps reading
  // the same shape, and so this comment sits where the old rule used to.
  return { toppedOut: false };
}

// 21: which cells of a rising row arrive as stone. The count comes from the
// level (stonesPerRise); WHICH cells is randomised per rise so the player
// cannot learn a fixed safe column, and so a stone is never guaranteed to
// land under the spawn chute every single time.
function riseRowFor(level) {
  const stones = stonesPerRise(level);
  const cols = [];
  for (let c = 0; c < COLS; c++) cols.push(c);
  for (let i = cols.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [cols[i], cols[j]] = [cols[j], cols[i]];
  }
  const isStone = new Array(COLS).fill(false);
  for (let i = 0; i < stones; i++) isStone[cols[i]] = true;
  const phase = Math.random() < 0.5 ? 0 : 1;
  const out = [];
  for (let c = 0; c < COLS; c++) out.push(isStone[c] ? STONE_TIER : riseTierAt(c, 0, phase));
  return out;
}

// The tier of one freshly-inserted cell, at column `c`, `i` cells up from the
// bottom of this rise's insertion, with a per-rise random `phase`.
//
// Always the two LOWEST tiers, and 19 measured why that has to stay true:
// raising it makes the game EASIER, because big fruit sit close to the
// MAX_TIER vanish and evaporate against the pile. See constants.js.
//
// The (c + i) parity is what keeps a rise from simply deleting itself. No two
// horizontal neighbours in the new bottom row match (c differs by one), and
// no two vertical neighbours within one column's inserted block match (i
// differs by one) -- so an arriving rise can never self-merge away, which
// would defeat the very pressure it exists to create.
function riseTierAt(c, i, phase) {
  return (c + i + phase) % 2;
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
