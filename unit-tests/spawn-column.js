// Where a fruit comes from, and when the run is actually over.
//
// This file has now been written against two different spawn rules and the
// history matters, because the second rule is a partial revert of the first
// and a future reader would otherwise assume one of them was a mistake.
//
// Before 12.2: every fruit spawned in the middle column and isGameOver read
// that one column. Measured in the real game, touching nothing: six runs,
// median 13.5s, every one ending on stacks 0,0,0,7,0,0 -- seventeen percent
// of the board used, five columns empty, run over.
//
// 12.2 changed TWO rules at once to fix that -- a random spawn column AND a
// whole-board game over -- and the random half was rejected on play: "the
// fruit dropping from every which way is not making sense."
//
// 14 keeps the whole-board game over and puts the spawn column back at the
// middle, where every successful game in this genre has always had it, and
// makes it VISIBLE (js/render.js's drawSpawnChute) -- which is the thing
// that was actually missing the first time round. So the invariants below
// come in two groups: the ones about the run ending, unchanged since 12.2,
// and the ones about the column, which now assert determinism where they
// used to assert spread.
//
// Written against the rule rather than against the numbers, so a future
// retune of COLS, ROWS or the gravity ramp cannot make them wrong.
import assert from 'node:assert/strict';
import { COLS, SPAWN_MIN_REACTION_SEC } from '../js/constants.js';
import { createInitialState, startRun, effectiveRows } from '../js/state.js';
import { spawnFruit, isGameOver, stepPhysics, spawnColumnFor } from '../js/physics.js';

const MIDDLE = Math.floor(COLS / 2);

function fresh() {
  const state = createInitialState(null);
  startRun(state);
  return state;
}

function fillColumn(state, col) {
  const rows = effectiveRows(state);
  for (let r = 0; r < rows; r++) state.grid[r][col] = (r + col) % 2;
  state.stackHeight[col] = rows;
}

// --- 1. The run is over only when there is nowhere left to put anything ---
// Unchanged since 12.2, and the single most important assertion in the file:
// it is what stops a fixed spawn column from meaning a fixed death column.
{
  const state = fresh();
  const rows = effectiveRows(state);

  assert.equal(isGameOver(state), false, 'an empty board is not game over');

  // Fill every column but one, starting with the spawn column itself -- the
  // whole point is that the middle filling is no longer the end of the run.
  const order = [MIDDLE, ...Array.from({ length: COLS }, (_, c) => c).filter((c) => c !== MIDDLE)];
  const last = order.pop();
  for (const col of order) {
    fillColumn(state, col);
    assert.equal(isGameOver(state), false,
      `with column ${col} full and others open, the run must continue`);
    state.active = null;
    const result = spawnFruit(state);
    assert.equal(result.blocked, false,
      `a spawn must not be blocked while any column has room (column ${col} full)`);
    assert.ok(state.stackHeight[state.active.col] < rows,
      'a fruit must never spawn over a column that has no room');
  }

  fillColumn(state, last);
  assert.equal(isGameOver(state), true, 'the run ends when no column has room');
  state.active = null;
  assert.equal(spawnFruit(state).blocked, true, 'and the next spawn is blocked');
}

// --- 2. The spawn column is the middle, and it is not random -------------
// 400 spawns on an empty board. Before 14 this test asserted the OPPOSITE --
// that fruit reached all six columns -- so it is now the change stated as an
// executable fact rather than only as a comment. The count is kept high
// deliberately: it is what would catch a stray Math.random() left behind.
{
  const seen = new Set();
  for (let i = 0; i < 400; i++) {
    const state = fresh();
    state.active = null;
    spawnFruit(state);
    seen.add(state.active.col);
  }
  assert.deepEqual([...seen], [MIDDLE],
    `every empty-board spawn must arrive in column ${MIDDLE}, saw ${[...seen].sort().join(',')}`);
}

// --- 3. The marker and the spawn cannot disagree -------------------------
// js/render.js draws the chute over spawnColumnFor(state); js/physics.js
// spawns into spawnColumnFor(state). If those two ever answered differently
// the game would point at one column and drop into another, which is worse
// than not marking it at all. Asserted across a spread of board shapes, not
// just the empty one, because the interesting case is the redirect.
{
  const shapes = [
    [], // empty board
    [MIDDLE], // the spawn column itself is full -- the mercy redirect
    [MIDDLE, MIDDLE - 1], // ...and its nearer neighbour too
    [MIDDLE, MIDDLE - 1, MIDDLE + 1],
    Array.from({ length: COLS }, (_, c) => c).filter((c) => c !== 0), // only the far edge left
  ];
  for (const full of shapes) {
    const state = fresh();
    for (const c of full) fillColumn(state, c);
    const predicted = spawnColumnFor(state);
    state.active = null;
    const result = spawnFruit(state);
    assert.equal(result.blocked, false, `a board with columns [${full}] full should still accept a spawn`);
    assert.equal(state.active.col, predicted,
      `the column drawn (${predicted}) must be the column spawned into (${state.active.col}), full columns [${full}]`);
    assert.ok(!full.includes(state.active.col), 'and it must never be one of the full columns');
  }
}

// --- 4. The redirect goes to the NEAREST open column ----------------------
// Not merely "some open column": the fruit should appear as close as
// possible to where the player has learned to expect it, so the chute moving
// reads as a small shift rather than as the game losing track of itself.
{
  const one = fresh();
  fillColumn(one, MIDDLE);
  assert.equal(Math.abs(spawnColumnFor(one) - MIDDLE), 1,
    'with only the middle full, the spawn moves exactly one column');

  const three = fresh();
  fillColumn(three, MIDDLE);
  fillColumn(three, MIDDLE - 1);
  fillColumn(three, MIDDLE + 1);
  assert.equal(Math.abs(spawnColumnFor(three) - MIDDLE), 2,
    'with the middle and both neighbours full, the spawn moves exactly two columns');
}

// --- 5. Nothing is left to draw once the board is full -------------------
// drawSpawnChute early-returns on -1. If spawnColumnFor ever returned a real
// column on a full board, the chute would be painted over a dead column on
// the game-over frame.
{
  const state = fresh();
  for (let c = 0; c < COLS; c++) fillColumn(state, c);
  assert.equal(spawnColumnFor(state), -1, 'a full board has no next spawn column');
  assert.equal(isGameOver(state), true, 'and that is exactly the terminal state');
}

// --- 6. The reaction floor ------------------------------------------------
// Kept from 12.2. It fires far less often now that the spawn is fixed again
// (a fixed column puts 8-13% of drops over a nearly-full column, against a
// random column's 30-38%), but the case it covers is the same one and is
// nastier with a fixed spawn: a tall middle column, hit over and over.
{
  // On an empty board the natural fall is already long, so the hold is zero:
  // this must cost nothing where it is not needed.
  const empty = fresh();
  empty.active = null;
  spawnFruit(empty);
  assert.equal(empty.active.hangSec, 0,
    'a fruit falling to an empty board must not be held at all');

  // Over a nearly-full column the fall is short, so the hold makes up the
  // difference -- and never more than the floor itself.
  const tall = fresh();
  const rows = effectiveRows(tall);
  for (let r = 1; r < rows; r++) tall.grid[r][MIDDLE] = (r + MIDDLE) % 2;
  tall.stackHeight[MIDDLE] = rows - 1;
  tall.active = null;
  spawnFruit(tall);
  assert.equal(tall.active.col, MIDDLE, 'one row of headroom is still headroom -- no redirect');
  assert.ok(tall.active.hangSec > 0,
    'a fruit arriving over a nearly-full column must be held before it falls');
  assert.ok(tall.active.hangSec <= SPAWN_MIN_REACTION_SEC,
    'the hold can never exceed the floor it exists to reach');

  // While held, the fruit does not descend -- but the run has not stalled
  // either: the hold drains and gravity takes over.
  const yAtSpawn = tall.active.y;
  stepPhysics(tall, 0.05);
  assert.equal(tall.active.y, yAtSpawn, 'a held fruit must not move downward');
  let guard = 0;
  while (tall.active && tall.active.hangSec > 0 && guard++ < 1000) stepPhysics(tall, 0.05);
  assert.ok(guard < 1000, 'the hold must drain rather than trap the fruit at the top');
  stepPhysics(tall, 0.05);
  assert.ok(!tall.active || tall.active.y > yAtSpawn,
    'once the hold has drained the fruit must fall');
}

console.log(`spawn-column: every fruit arrives in column ${MIDDLE}; the drawn chute and the actual spawn are the same function; the redirect moves to the nearest open column; the run ends only when the whole board is full`);
