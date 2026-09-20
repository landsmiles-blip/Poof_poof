// 22: the floor rise moves off the clock and onto the play.
//
// WHY THIS FILE EXISTS. Measured on the shipped build (2026.09.07-26), 300
// runs per policy, steering through setDragTarget exactly as a player does:
//
//   policy    median drops   median score
//   suicide        180           7,585
//   random         165           7,436
//   decent         188          12,470
//
// A player deliberately stacking the worst column survived 180 drops; a
// player merging whenever they could survived 188. The game asked "how far
// can you last" and answered with the same number for everybody, because the
// rise fired on a pure function of spawnIndex. Score answered to skill.
// Survival did not.
//
// Two changes fixed that, and this file is the contract for both:
//   1. pressure -- drops add it, the player's own merges take it away, the
//      floor rises when it crosses PRESSURE_RISE_AT, and the per-drop fill
//      grows with level so a run still always ends.
//   2. the rise arrives inert. Its old auto-cascade ran at 0.48 merges/drop
//      for a player stacking the worst column and 0.13 for one playing well:
//      a subsidy that scaled with how badly you were playing.
import assert from 'node:assert/strict';
import { createInitialState, startRun, pressurePerDrop, pressureDrainFor, levelFor } from '../js/state.js';
import { spawnFruit, hardDrop, setDragTarget, raiseFloor, resolveMerges, isGameOver } from '../js/physics.js';
import {
  COLS, CELL, LEVEL_DROPS, STONE_TIER,
  PRESSURE_RISE_AT, PRESSURE_BANK_FLOOR, PRESSURE_DRAIN_BASE,
  PRESSURE_DRAIN_CASCADE_BONUS, PRESSURE_DRAIN_TIER_BONUS,
  FLOOR_RISE_START_LEVEL, RISE_RESOLVES_MERGES,
} from '../js/constants.js';

const atLevel = (state, level) => { state.spawnIndex = (level - 1) * LEVEL_DROPS; };

// --- 1. a fresh run starts with no pressure, and the grace holds it there ---
{
  const state = createInitialState();
  startRun(state, {});
  assert.equal(state.pressure, 0, 'a run starts with a clean meter');

  // Through the whole opening grace, no rise -- and the meter is held at zero
  // at every point the rule is actually read, which is immediately after each
  // spawn. Merges during the grace do drive it negative in between, and that
  // credit is deliberately discarded rather than carried: banking a minute of
  // immunity during the free period would make level 3 a formality.
  let rises = 0;
  for (let i = 0; i < LEVEL_DROPS * (FLOOR_RISE_START_LEVEL - 1) - 1; i++) {
    state.events.length = 0;
    if (spawnFruit(state).blocked) break;
    assert.equal(state.pressure, 0,
      'the meter reads zero at every point the rise rule is evaluated during the grace');
    for (const e of state.events) if (e.type === 'floorRose') rises++;
    setDragTarget(state, (i % COLS) * CELL + CELL / 2);
    hardDrop(state);
    assert.ok(state.pressure <= 0, 'and grace-period play never banks pressure UP');
  }
  assert.equal(rises, 0, 'no rise during the opening grace');
}

// --- 2. a drop adds exactly pressurePerDrop, and crossing fires one rise ----
{
  const state = createInitialState();
  startRun(state, {});
  atLevel(state, FLOOR_RISE_START_LEVEL);
  const per = pressurePerDrop(levelFor(state.spawnIndex));
  assert.ok(per > 0, 'a drop costs something past the grace');

  // Park pressure just under the line, on a board with nothing to merge, so
  // the only thing moving the meter is the drop itself.
  state.pressure = PRESSURE_RISE_AT - per - 0.001;
  state.events.length = 0;
  spawnFruit(state);
  assert.equal(state.events.filter((e) => e.type === 'floorRose').length, 0,
    'one drop short of the line does not rise');

  state.pressure = PRESSURE_RISE_AT - per + 0.001;
  state.events.length = 0;
  spawnFruit(state);
  const fired = state.events.filter((e) => e.type === 'floorRose').length;
  assert.equal(fired, 1, 'crossing the line rises exactly once, not twice');
  assert.ok(state.pressure < PRESSURE_RISE_AT,
    'and the overflow is carried, not reset -- a rise subtracts the threshold');
  assert.ok(state.pressure >= 0, 'carried overflow is never negative');
}

// --- 3. merging is how the player buys the time back ------------------------
{
  // A deeper link in a chain, and a higher tier, must both be worth more --
  // that is the whole reason a chain is worth building.
  assert.ok(pressureDrainFor(0, 1) > pressureDrainFor(0, 0),
    'the second link of a chain drains more than the first');
  assert.ok(pressureDrainFor(3, 0) > pressureDrainFor(0, 0),
    'a bigger fruit drains more than a small one');
  assert.equal(pressureDrainFor(0, 0), PRESSURE_DRAIN_BASE,
    'a plain tier-0 first merge is exactly the base');
  const twoLinks = pressureDrainFor(0, 1) / pressureDrainFor(0, 0);
  assert.ok(Math.abs(twoLinks - (1 + PRESSURE_DRAIN_CASCADE_BONUS)) < 1e-9,
    'and the chain bonus is the one in constants.js, not an approximation of it');
  const oneTier = pressureDrainFor(1, 0) / pressureDrainFor(0, 0);
  assert.ok(Math.abs(oneTier - (1 + PRESSURE_DRAIN_TIER_BONUS)) < 1e-9,
    'same for the tier bonus');

  // And it actually moves the live meter.
  const state = createInitialState();
  startRun(state, {});
  atLevel(state, FLOOR_RISE_START_LEVEL);
  const rows = state.grid.length;
  state.pressure = PRESSURE_RISE_AT * 0.9;
  const before = state.pressure;
  state.grid[rows - 1][0] = 2;
  state.grid[rows - 1][1] = 2;
  state.stackHeight[0] = 1; state.stackHeight[1] = 1;
  resolveMerges(state);
  assert.ok(state.pressure < before, 'a merge takes pressure off the meter');
}

// --- 4. banked credit is bounded --------------------------------------------
// A huge chain may buy real breathing room, but not immunity: without a floor,
// one lucky cascade would pay for a minute of free drops.
{
  const state = createInitialState();
  startRun(state, {});
  atLevel(state, FLOOR_RISE_START_LEVEL);
  state.pressure = 0;
  const rows = state.grid.length;
  // twenty merges in a row, far more than any real chain
  for (let i = 0; i < 20; i++) {
    state.grid[rows - 1][0] = 1;
    state.grid[rows - 1][1] = 1;
    state.stackHeight[0] = 1; state.stackHeight[1] = 1;
    resolveMerges(state);
  }
  assert.ok(state.pressure >= PRESSURE_BANK_FLOOR,
    'pressure never banks below PRESSURE_BANK_FLOOR, however good the run is going');
}

// --- 5. the rise arrives inert ----------------------------------------------
// The load-bearing half of the fix. A board laid out so that EVERY column
// would cascade on contact must produce zero merges when the floor pushes.
{
  assert.equal(RISE_RESOLVES_MERGES, false, 'the rise does not resolve merges');

  const state = createInitialState();
  startRun(state, {});
  state.spawnIndex = 200;
  const rows = state.grid.length;
  for (let c = 0; c < COLS; c++) {
    state.grid[rows - 1][c] = 0;
    state.grid[rows - 2][c] = 0;
    state.stackHeight[c] = 2;
  }
  state.events.length = 0;
  raiseFloor(state);
  assert.equal(state.events.filter((e) => e.type === 'merge').length, 0,
    'a rise onto a board of matching pairs merges nothing -- the player must trigger it');
  assert.ok(state.events.some((e) => e.type === 'floorRose'), 'but the rise itself still happened');
}

// --- 6. and a well-built bottom row still pays, on the next drop -------------
// Removing the auto-cascade must not remove the counterplay, only move it to
// where the player causes it.
{
  const state = createInitialState();
  startRun(state, {});
  atLevel(state, FLOOR_RISE_START_LEVEL);
  const rows = state.grid.length;
  state.grid[rows - 1][0] = 1;
  state.stackHeight[0] = 1;
  spawnFruit(state);
  state.active.tier = 1;
  state.events.length = 0;
  setDragTarget(state, 0 * CELL + CELL / 2);
  hardDrop(state);
  assert.ok(state.events.some((e) => e.type === 'merge'),
    'dropping onto a match still merges -- the counterplay moved, it did not go away');
}

// --- 7. every run still ends ------------------------------------------------
// pressurePerDrop grows with level without bound, so even a player who merges
// on nearly every drop is eventually outrun. A difficulty system that can be
// held off forever is not a difficulty system.
{
  const cap = 5000;
  let worst = 0;
  for (let t = 0; t < 12; t++) {
    const state = createInitialState();
    startRun(state, {});
    let n = 0;
    while (n < cap) {
      if (spawnFruit(state).blocked || isGameOver(state)) break;
      // merge whenever possible: the strongest simple policy measured
      let target = -1;
      for (let c = 0; c < COLS; c++) {
        const h = state.stackHeight[c];
        if (h >= state.grid.length) continue;
        if (h > 0 && state.grid[state.grid.length - h][c] === state.active.tier) { target = c; break; }
      }
      if (target < 0) {
        let bh = Infinity;
        for (let c = 0; c < COLS; c++) if (state.stackHeight[c] < state.grid.length && state.stackHeight[c] < bh) { bh = state.stackHeight[c]; target = c; }
      }
      if (target < 0) break;
      setDragTarget(state, target * CELL + CELL / 2);
      hardDrop(state);
      n++;
    }
    if (n > worst) worst = n;
    assert.ok(n < cap, `a merge-greedy run terminates (ran ${n} drops)`);
  }
  assert.ok(worst > 60, `and it is not terminating instantly either (longest was ${worst} drops)`);
}

console.log('pressure: the floor rises on play, not on a clock -- drops fill the meter, the player\'s own merges drain it (more for chains and bigger fruit), banked credit is bounded, the rise arrives inert so it can no longer tidy up the boards that earned it, the counterplay still pays on the next drop, and every run still ends');
