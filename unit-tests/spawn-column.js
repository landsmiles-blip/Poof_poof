// 12.2 -- where a fruit comes from, and when the run is actually over.
//
// Until this phase every fruit spawned in column 3 and isGameOver read that
// one column. Measured in the real game, touching nothing: six runs, median
// 13.5s, every one ending on stacks 0,0,0,7,0,0 -- seventeen percent of the
// board used, five columns empty, run over.
//
// These are the invariants that stop that from coming back. They are written
// against the rule rather than against the numbers, so a future retune of
// COLS, ROWS or the gravity ramp cannot make them wrong.
import assert from 'node:assert/strict';
import { COLS, CELL, SPAWN_MIN_REACTION_SEC } from '../js/constants.js';
import { createInitialState, startRun, effectiveRows } from '../js/state.js';
import { spawnFruit, isGameOver, stepPhysics } from '../js/physics.js';

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
{
  const state = fresh();
  const rows = effectiveRows(state);

  assert.equal(isGameOver(state), false, 'an empty board is not game over');

  // Fill every column but one, in an order that includes the old spawn
  // column early -- the whole point is that column 3 filling is no longer
  // special.
  for (const col of [3, 0, 5, 1, 4]) {
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

  fillColumn(state, 2); // the last one
  assert.equal(isGameOver(state), true, 'the run ends when no column has room');
  state.active = null;
  assert.equal(spawnFruit(state).blocked, true, 'and the next spawn is blocked');
}

// --- 2. A fruit never arrives over a full column ---
{
  // Repeated because the column is chosen at random: one pass proves nothing
  // about a uniform pick. Every column but one is full, so the redirect is
  // exercised on essentially every iteration.
  for (let trial = 0; trial < 200; trial++) {
    const state = fresh();
    const rows = effectiveRows(state);
    const open = trial % COLS;
    for (let c = 0; c < COLS; c++) if (c !== open) fillColumn(state, c);
    state.active = null;
    const result = spawnFruit(state);
    assert.equal(result.blocked, false, 'one open column is enough to keep playing');
    assert.equal(state.active.col, open,
      'with exactly one column open, every spawn must be redirected into it');
    assert.ok(state.stackHeight[state.active.col] < rows, 'and it must have room');
  }
}

// --- 3. Over many spawns, fruit actually reaches every column ------------
// The failure this guards against is a redirect (or a stray constant) that
// quietly funnels everything back into the middle -- which would look like
// the change had been made while behaving exactly as before.
{
  const seen = new Set();
  for (let i = 0; i < 400; i++) {
    const state = fresh();
    state.active = null;
    spawnFruit(state);
    seen.add(state.active.col);
  }
  assert.equal(seen.size, COLS,
    `fruit should reach all ${COLS} columns over 400 empty-board spawns, saw ${[...seen].sort().join(',')}`);
}

// --- 4. The reaction floor ------------------------------------------------
{
  // On an empty board the natural fall is already long, so the hold is zero:
  // this change must cost nothing where it is not needed.
  const empty = fresh();
  empty.active = null;
  spawnFruit(empty);
  assert.equal(empty.active.hangSec, 0,
    'a fruit falling to an empty board must not be held at all');

  // Over a nearly-full column the fall is short, so the hold makes up the
  // difference -- and never more than the floor itself.
  const tall = fresh();
  const rows = effectiveRows(tall);
  for (let c = 0; c < COLS; c++) if (c !== 2) fillColumn(tall, c);
  for (let r = 1; r < rows; r++) tall.grid[r][2] = (r + 2) % 2;
  tall.stackHeight[2] = rows - 1;
  tall.active = null;
  spawnFruit(tall);
  assert.equal(tall.active.col, 2, 'the only open column');
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

console.log('spawn-column: the run ends only when the whole board is full; fruit reaches every column, never a full one; the reaction floor holds only where the fall is short');
