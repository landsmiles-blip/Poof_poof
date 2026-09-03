// Regression tests for 17: the rising floor -- the mechanic that makes a run
// actually END. Before it, speed capped at level 10 and the spawn pool went
// flat at level 13, so a careful merger held a low board forever and "how long
// can you last" had no answer (a real run reached level 171, still going).
// These prove three things: the cadence function is shaped the way
// constants.js claims, a single rise keeps the board's invariants intact, and
// -- the load-bearing one -- a played run ALWAYS terminates, so the game can
// never silently drift back to unloseable. See docs/phase17brief.md.
import assert from 'node:assert/strict';
import {
  createInitialState, startRun, floorRiseCadenceDrops,
} from '../js/state.js';
import { spawnFruit, hardDrop, isGameOver, raiseFloor } from '../js/physics.js';
import {
  COLS, CELL,
  FLOOR_RISE_START_LEVEL, FLOOR_RISE_DROPS_START, FLOOR_RISE_DROPS_MIN, FLOOR_RISE_TIGHTEN_PER_LEVEL,
} from '../js/constants.js';

// --- 1. floorRiseCadenceDrops: grace, monotonic tightening, and the floor ---
{
  for (let lvl = 1; lvl < FLOOR_RISE_START_LEVEL; lvl++) {
    assert.equal(floorRiseCadenceDrops(lvl), Infinity, `level ${lvl} is inside the opening grace, no floor yet`);
  }
  assert.equal(floorRiseCadenceDrops(FLOOR_RISE_START_LEVEL), FLOOR_RISE_DROPS_START, 'the start level uses the start cadence exactly');

  let prev = Infinity;
  for (let lvl = FLOOR_RISE_START_LEVEL; lvl <= 300; lvl++) {
    const c = floorRiseCadenceDrops(lvl);
    assert.ok(c <= prev, `cadence must never loosen as level climbs (level ${lvl}: ${c} > ${prev})`);
    assert.ok(c >= FLOOR_RISE_DROPS_MIN, `cadence must never fall below the floor (level ${lvl}: ${c})`);
    prev = c;
  }

  const capLevel = FLOOR_RISE_START_LEVEL
    + Math.ceil((FLOOR_RISE_DROPS_START - FLOOR_RISE_DROPS_MIN) / FLOOR_RISE_TIGHTEN_PER_LEVEL);
  assert.equal(floorRiseCadenceDrops(capLevel), FLOOR_RISE_DROPS_MIN, 'the min cadence is actually reached');
  assert.equal(floorRiseCadenceDrops(capLevel + 50), FLOOR_RISE_DROPS_MIN, 'and held for every level after');
}

// --- 2. one rise keeps every board invariant intact -------------------------
{
  const state = createInitialState();
  startRun(state, {});
  // Lay a dozen fruit down so the shift has real content to move.
  for (let i = 0; i < 12; i++) {
    if (spawnFruit(state).blocked) break;
    let best = 0;
    for (let c = 1; c < COLS; c++) if (state.stackHeight[c] < state.stackHeight[best]) best = c;
    state.active.x = best * CELL + CELL / 2;
    hardDrop(state);
  }

  const res = raiseFloor(state);
  assert.equal(res.toppedOut, false, 'a low board does not top out on a rise');

  const rows = state.grid.length;
  for (let c = 0; c < COLS; c++) {
    // The invariant every physics function relies on: stackHeight equals the
    // real grid contents, and a column is bottom-packed. Row 0 is the TOP, so
    // a correct column is nulls-then-fruit reading downward; a hole is a null
    // that appears BELOW a fruit (after we have already seen one).
    let count = 0;
    let seenFruit = false;
    for (let r = 0; r < rows; r++) {
      if (state.grid[r][c] !== null) {
        count += 1;
        seenFruit = true;
      } else {
        assert.ok(!seenFruit, `column ${c} must stay bottom-packed after a rise (a hole opened at row ${r})`);
      }
    }
    assert.equal(state.stackHeight[c], count, `column ${c}: stackHeight matches the grid after a rise`);
  }
  assert.ok(state.events.some((e) => e.type === 'floorRose'), 'a rise announces a floorRose event for audio/haptics');
}

// --- 3. a rise tops out when a column already reaches the ceiling ------------
{
  const state = createInitialState();
  startRun(state, {});
  const rows = state.grid.length;
  for (let r = 0; r < rows; r++) state.grid[r][0] = 8; // fill column 0 to the top
  state.stackHeight[0] = rows;
  assert.equal(raiseFloor(state).toppedOut, true, 'a rise with a full column tops the board out (the loss)');
}

// --- 4. THE load-bearing guard: a played run ALWAYS ends --------------------
// If a future change neutralises the floor, these runs go unbounded and blow
// through the cap -- exactly the regression this test exists to catch. A real
// run tops out near ~450 drops; anything past a few thousand is a runaway.
{
  const CAP = 20000;
  const RUNAWAY = 5000;
  const shortest = (s) => {
    let b = -1, bh = Infinity;
    const rows = s.grid.length;
    for (let c = 0; c < COLS; c++) if (s.stackHeight[c] < rows && s.stackHeight[c] < bh) { bh = s.stackHeight[c]; b = c; }
    return b;
  };
  const match = (s) => {
    const rows = s.grid.length, held = s.active.tier;
    for (let c = 0; c < COLS; c++) {
      const h = s.stackHeight[c];
      if (h > 0 && h < rows && s.grid[rows - h][c] === held) return c;
    }
    return shortest(s);
  };

  for (const choose of [shortest, match]) {
    for (let trial = 0; trial < 40; trial++) {
      const state = createInitialState();
      startRun(state, {});
      let ended = false;
      while (state.spawnIndex < CAP) {
        if (spawnFruit(state).blocked || isGameOver(state)) { ended = true; break; }
        const t = choose(state);
        if (t < 0) { ended = true; break; }
        state.active.x = t * CELL + CELL / 2;
        hardDrop(state);
      }
      assert.ok(ended, `a played run must end -- it hit the ${CAP}-drop cap, so the floor is not doing its job`);
      assert.ok(state.spawnIndex < RUNAWAY, `a played run must end well before ${RUNAWAY} drops (got ${state.spawnIndex}) -- the floor has been weakened`);
    }
  }
}

console.log('floor-rise: all assertions passed');
