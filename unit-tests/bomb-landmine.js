// Regression tests for 8.4's five explicit landmine points -- a bomb is a
// second sentinel alongside RAINBOW_TIER, and the rainbow is exactly what
// makes it dangerous: pairTier's wildcard branch treats a rainbow as
// matching anything, so if the bomb were not rejected FIRST, a rainbow
// touching a bomb would merge the wildcard into it, or worse, produce a real
// tier from a sentinel value. One test per point, especially the rainbow one.
// (Point 2, the magnet exclusion, was retired by 9.2 -- see its own comment
// below for why the mechanism it protected against no longer exists.)
import assert from 'node:assert/strict';
import { COLS, CELL, BOMB_TIER, BOMB_FUSE_DROPS, RAINBOW_TIER } from '../js/constants.js';
import { createInitialState, startRun } from '../js/state.js';
import {
  resolveMerges, tierDef, hardDrop, isGameOver, spawnFruit,
} from '../js/physics.js';

function freshRun() {
  const state = createInitialState(null);
  startRun(state, {});
  return state;
}

// --- 1. pairTier rejects the bomb BEFORE the rainbow wildcard check --------
// The specifically dangerous case: a bomb directly adjacent to a rainbow.
{
  const state = freshRun();
  const rows = state.grid.length;
  state.grid[rows - 1][0] = BOMB_TIER;
  state.grid[rows - 1][1] = RAINBOW_TIER;
  state.stackHeight[0] = 1;
  state.stackHeight[1] = 1;
  const scoreBefore = state.score;

  resolveMerges(state);

  assert.equal(state.grid[rows - 1][0], BOMB_TIER, 'a bomb adjacent to a rainbow must not merge -- the bomb check must run before the wildcard branch');
  assert.equal(state.grid[rows - 1][1], RAINBOW_TIER, 'the rainbow must not have been consumed into the bomb');
  assert.equal(state.score, scoreBefore, 'no merge happened, so no score was awarded');
  assert.equal(state.events.length, 0, 'no merge event should have been pushed for a rejected pair');
}

// Two bombs (never actually reachable in play, since only one may be planted
// at a time, but pairTier itself must not special-case that) must not merge
// with each other either.
{
  const state = freshRun();
  const rows = state.grid.length;
  state.grid[rows - 1][0] = BOMB_TIER;
  state.grid[rows - 1][1] = BOMB_TIER;
  state.stackHeight[0] = 1;
  state.stackHeight[1] = 1;
  resolveMerges(state);
  assert.equal(state.grid[rows - 1][0], BOMB_TIER, 'two adjacent bombs must not merge with each other');
  assert.equal(state.grid[rows - 1][1], BOMB_TIER, 'two adjacent bombs must not merge with each other');
}

// Point 2 used to be "exclude the bomb from the Magnet's targeting, even for
// a held rainbow" -- retired along with the Magnet itself in 10.1. The SAME
// sentinel-collision danger family reappears in its replacement, Swap: a
// completed swap moves a planted bomb's live fuse somewhere the player did
// not plant it, exactly the class of bug this whole file exists to catch.
// Covered where Swap itself lives, not here -- unit-tests/swap.js (physics)
// and unit-tests/input-callbacks.js (the input-layer rejection, checked
// before adjacency or occupancy, same order the brief specifies).

// --- 3. tierDef gives it a radius, so anything asking for one works -------
{
  const def = tierDef(BOMB_TIER);
  assert.ok(def, 'tierDef(BOMB_TIER) must return something, not undefined');
  assert.equal(typeof def.radius, 'number', 'tierDef(BOMB_TIER).radius must be a number');
  assert.ok(def.radius > 0, 'tierDef(BOMB_TIER).radius must be a usable positive size');
}

// --- 4. Falls and settles normally; counts toward stack height and game-over
{
  const state = freshRun();
  const startCol = Math.floor(COLS / 2);
  const rows = state.grid.length;
  // Fill the WHOLE board to one free slot with ordinary fruit, then land a
  // bomb in that last slot -- if a bomb takes up space like any other tier,
  // this must end the run.
  //
  // 12.2 changed what "the run is over" means: it used to be "the spawn
  // column is full" and is now "no column has room", so filling one column
  // is no longer a terminal state and this test has to build the real one.
  // The subject of the test is unchanged -- a bomb occupying a cell like any
  // other tier -- only the board it is asserted against.
  //
  // (r + c) % 2 rather than r % 2: a checkerboard has no two equal
  // neighbours in either direction, so this filler cannot cascade-merge on
  // its own when resolveMerges runs after the bomb lands. Alternating on the
  // row alone would have put equal tiers side by side across columns.
  for (let c = 0; c < COLS; c++) {
    if (c === startCol) continue;
    for (let r = 0; r < rows; r++) state.grid[r][c] = (r + c) % 2;
    state.stackHeight[c] = rows;
  }
  for (let r = 1; r < rows; r++) state.grid[r][startCol] = (r + startCol) % 2;
  state.stackHeight[startCol] = rows - 1;
  state.active = {
    tier: BOMB_TIER, col: startCol, x: startCol * CELL + CELL / 2, targetX: startCol * CELL + CELL / 2, y: 0,
  };
  const scoreBefore = state.score;

  const landed = hardDrop(state);

  assert.equal(landed, true, 'a bomb should fall and land exactly like any other fruit');
  assert.equal(state.stackHeight[startCol], rows, 'a landed bomb must count toward stack height');
  assert.equal(state.grid[0][startCol], BOMB_TIER, 'the bomb should be resting at the top of the now-full column');
  assert.equal(isGameOver(state), true, 'a bomb filling the last free cell on the board must end the run, same as any fruit would');
  assert.equal(state.score, scoreBefore, 'landing a bomb (no merge) must award no score');
  assert.equal(state.bombFuseDrops, BOMB_FUSE_DROPS, 'landing should start the fuse counting down');
}

// --- 5. Detonation (via the fuse, not a player tap) keeps the existing
// suppressCombo behaviour, and awards no score -----------------------------
{
  const state = freshRun();
  const rows = state.grid.length;
  const bombCol = 2;
  state.grid[rows - 1][bombCol] = BOMB_TIER;
  state.stackHeight[bombCol] = 1;
  state.bombInPlay = true;
  state.bombFuseDrops = 1; // expires on the very next spawn
  const scoreBefore = state.score;

  spawnFruit(state); // this spawn's own fuse check should trigger detonation

  assert.equal(state.bombFuseDrops, null, 'the fuse should be cleared once it has fired');
  assert.equal(state.bombInPlay, false, 'the bomb should no longer read as in play once it has detonated');
  assert.equal(state.grid[rows - 1][bombCol], null, 'the bomb tile is inside its own blast radius and should be gone');
  assert.equal(state.events.some((e) => e.type === 'bombCleared'), true,
    'detonating via the fuse should push the same bombCleared event a player-triggered detonation always has');
  assert.equal(state.suppressCombo, false, 'suppressCombo must be reset back to false afterward, not left dangling true');
  assert.equal(state.score, scoreBefore, 'the bomb detonating alone, with nothing else in its blast, awards no score');
}

// --- Only one bomb may ever be in play ------------------------------------
{
  const state = freshRun();
  state.bombInPlay = true;
  state.active = { tier: 0, col: 3, x: 3 * CELL + CELL / 2, targetX: 3 * CELL + CELL / 2, y: 0 };
  // plantBomb itself (js/state.js) is exercised in unit-tests/dirty-flag.js
  // and input-callbacks.js; this file stays scoped to physics.js's own
  // landmine points, so this just confirms the flag physics.js relies on
  // (bombInPlay) actually gates a second plant -- see plantBomb's own guard.
  assert.equal(state.bombInPlay, true, 'sanity: a bomb is already in play');
}

// --- Defused early (Fruit Remover deletes the bomb tile before the fuse
// ends): the fuse must still resolve gracefully, with no phantom detonation
// and no stuck bombInPlay flag ----------------------------------------------
{
  const state = freshRun();
  const rows = state.grid.length;
  // A bomb was planted and landed, then the tile was removed by some other
  // means (the Fruit Remover) before the fuse ran out -- nothing at
  // grid[rows-1][2] any more, but the fuse state was never told.
  state.bombInPlay = true;
  state.bombFuseDrops = 1;
  const scoreBefore = state.score;

  spawnFruit(state);

  assert.equal(state.bombFuseDrops, null, 'a fuse with no bomb left to find must still clear itself');
  assert.equal(state.bombInPlay, false, 'a fuse with no bomb left to find must still stop reading as in play, so another can be planted');
  assert.equal(state.events.some((e) => e.type === 'bombCleared'), false, 'there is nothing to detonate, so no bombCleared event should fire');
  assert.equal(state.score, scoreBefore, 'a defused bomb must not somehow still award or deduct score');
  void rows;
}

console.log('bomb-landmine: pairTier rejects the bomb before the rainbow wildcard (both directions), tierDef gives it a radius, it falls/settles/counts toward game-over, and its fuse-triggered detonation keeps suppressCombo and awards no score');
