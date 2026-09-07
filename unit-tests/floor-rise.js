// Regression tests for 17: the rising floor -- the mechanic that makes a run
// actually END. Before it, speed capped at level 10 and the spawn pool went
// flat at level 13, so a careful merger held a low board forever and "how long
// can you last" had no answer (a real run reached level 171, still going).
// These prove three things: the cadence function is shaped the way
// constants.js claims, a single rise keeps the board's invariants intact, and
// -- the load-bearing one -- a played run ALWAYS terminates, so the game can
// never silently drift back to unloseable. See docs/phase17brief.md.
import assert from 'node:assert/strict';
import { createInitialState, startRun, floorRiseCadenceDrops } from '../js/state.js';
import { spawnFruit, hardDrop, isGameOver, raiseFloor, topColumnCount, setDragTarget } from '../js/physics.js';
import {
  COLS, CELL, LEVEL_DROPS,
  FLOOR_RISE_START_LEVEL, FLOOR_RISE_DROPS_START, FLOOR_RISE_DROPS_MIN, FLOOR_RISE_TIGHTEN_PER_LEVEL,
  FLOOR_RISE_DROPS_HARD_MIN,
} from '../js/constants.js';

// --- 1. floorRiseCadenceDrops: grace, monotonic tightening, both floors -----
{
  for (let lvl = 1; lvl < FLOOR_RISE_START_LEVEL; lvl++) {
    assert.equal(floorRiseCadenceDrops(lvl), Infinity, `level ${lvl} is inside the opening grace, no floor yet`);
  }
  assert.equal(floorRiseCadenceDrops(FLOOR_RISE_START_LEVEL), FLOOR_RISE_DROPS_START, 'the start level uses the start cadence exactly');

  let prev = Infinity;
  for (let lvl = FLOOR_RISE_START_LEVEL; lvl <= 300; lvl++) {
    const c = floorRiseCadenceDrops(lvl);
    assert.ok(c <= prev, `cadence must never loosen as level climbs (level ${lvl}: ${c} > ${prev})`);
    assert.ok(c >= FLOOR_RISE_DROPS_HARD_MIN, `cadence must never fall below the HARD floor (level ${lvl}: ${c})`);
    prev = c;
  }

  // Stage one still bottoms out exactly where it always did...
  const stageOneFloor = FLOOR_RISE_START_LEVEL
    + Math.ceil((FLOOR_RISE_DROPS_START - FLOOR_RISE_DROPS_MIN) / FLOOR_RISE_TIGHTEN_PER_LEVEL);
  assert.equal(floorRiseCadenceDrops(stageOneFloor), FLOOR_RISE_DROPS_MIN, 'stage one still reaches its own floor');
  // ...but 19 no longer STOPS there, which is the whole point of this phase.
  assert.ok(floorRiseCadenceDrops(stageOneFloor + 50) < FLOOR_RISE_DROPS_MIN,
    'stage two must keep tightening past the stage-one floor -- 17 flatlined here');
  assert.equal(floorRiseCadenceDrops(1000), FLOOR_RISE_DROPS_HARD_MIN, 'and it settles on the hard floor eventually');
}

// --- 1b. THE anti-flatline guard -------------------------------------------
// 17 shipped a wall: level 40 played EXACTLY like level 14. This is the test
// that fails if anyone flattens the late curve again.
{
  const harder = (a, b) => floorRiseCadenceDrops(b) < floorRiseCadenceDrops(a);
  assert.ok(harder(14, 20), 'level 20 must be harder than level 14');
  assert.ok(harder(20, 30), 'level 30 must be harder than level 20');
  assert.ok(harder(14, 40), 'level 40 must be harder than level 14 -- the 17 flatline must not come back');
}

// --- 1c. the end of the curve is TERMINAL, by arithmetic --------------------
// The claim 19 rests on, and the reason "how far can you go" has an answer:
// at the hard floor the board gains COLS fruit per rise while the player
// answers with ONE drop, and a merge frees at most one cell. If anyone ever
// raises the hard floor above 1, or widens the board, this stops being true
// and a good player can camp at the end of the curve forever -- exactly the
// bug 19 exists to kill. Proven here as a played run, not asserted.
{
  assert.equal(FLOOR_RISE_DROPS_HARD_MIN, 1,
    'the terminal cadence must be one rise per drop -- anything looser is survivable');

  // An EMPTY board, difficulty clock pinned at the hard floor. If this is
  // survivable from nothing, it is survivable from anything.
  const deepLevel = 200; // far past the floor
  assert.equal(floorRiseCadenceDrops(deepLevel), FLOOR_RISE_DROPS_HARD_MIN, 'level 200 sits on the hard floor');
  const base = (deepLevel - 1) * LEVEL_DROPS;
  for (let trial = 0; trial < 20; trial++) {
    const state = createInitialState();
    startRun(state, {});
    state.spawnIndex = base;
    let drops = 0;
    let ended = false;
    while (drops < 500) {
      if (spawnFruit(state).blocked || isGameOver(state)) { ended = true; break; }
      let b = -1, bh = Infinity;
      const rows = state.grid.length;
      for (let c = 0; c < COLS; c++) if (state.stackHeight[c] < rows && state.stackHeight[c] < bh) { bh = state.stackHeight[c]; b = c; }
      if (b < 0) { ended = true; break; }
      setDragTarget(state, b * CELL + CELL / 2);
      hardDrop(state);
      drops += 1;
      // hold the clock at deepLevel without disturbing dropsSinceFloorRise
      state.spawnIndex = base + (state.spawnIndex - base) % LEVEL_DROPS;
    }
    assert.ok(ended, 'the terminal cadence must kill an empty board, not merely pressure it');
    assert.ok(drops < 200, `the terminal cadence must kill quickly (survived ${drops} drops)`);
  }
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
    setDragTarget(state, best * CELL + CELL / 2);
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

// --- 3. THE losing rule: one full column is a DEADLINE, not a loss ----------
// 19 and earlier ended the run the moment a rise met any full column, so a
// board with one capped column and five empty ones was a loss with fifty free
// cells on it. Reported from real play: "why should the game end and yet
// there are still spaces to play?" These tests keep the answer "it shouldn't"
// -- and section 4 keeps the run ending anyway.
{
  // One column capped, five wide open. The rise proceeds, skipping it.
  const state = createInitialState();
  startRun(state, {});
  const rows = state.grid.length;
  // Alternating tiers on purpose: a column of identical fruit merges with
  // itself and evaporates, which would silently un-fill the board this test
  // is about.
  for (let r = 0; r < rows; r++) state.grid[r][0] = r % 2 ? 5 : 6;
  state.stackHeight[0] = rows;

  assert.equal(raiseFloor(state).toppedOut, false,
    'one full column must NOT end the run while the rest of the board is empty');
  assert.equal(state.stackHeight[0], rows, 'the capped column sits the rise out rather than overflowing');
  assert.ok(state.grid[0][0] !== null, 'and nothing was pushed off the top of it');
  for (let c = 1; c < COLS; c++) {
    assert.equal(state.stackHeight[c], 1, `column ${c} had room, so it took the new row`);
  }
  assert.equal(topColumnCount(state), 1, 'exactly one column is reported at the ceiling');

  // Bottom-packing must survive a partial rise, or every later merge is wrong.
  for (let c = 0; c < COLS; c++) {
    let count = 0, seenFruit = false;
    for (let r = 0; r < rows; r++) {
      if (state.grid[r][c] !== null) { count += 1; seenFruit = true; }
      else assert.ok(!seenFruit, `column ${c} stays bottom-packed after a partial rise (hole at row ${r})`);
    }
    assert.equal(state.stackHeight[c], count, `column ${c}: stackHeight matches the grid after a partial rise`);
  }
}
{
  // Only a completely full board tops out -- and an ordinary drop agrees.
  // One rule, not two that disagreed by fifty cells.
  const state = createInitialState();
  startRun(state, {});
  const rows = state.grid.length;
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < rows; r++) state.grid[r][c] = c % 2 ? 5 : 6;
    state.stackHeight[c] = rows;
  }
  assert.equal(raiseFloor(state).toppedOut, true, 'a completely full board is the loss');

  const other = createInitialState();
  startRun(other, {});
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < rows; r++) other.grid[r][c] = c % 2 ? 5 : 6;
    other.stackHeight[c] = rows;
  }
  assert.equal(spawnFruit(other).blocked, true, 'and an ordinary drop reaches the same condition');
}

// --- 3b. the deadline: a capped column kills, but only after a full cadence -
// This is what replaced "one full column = instant loss". It has to do BOTH
// jobs: give the player a visible stretch to react, and still end the run if
// they do not use it.
{
  const state = createInitialState();
  startRun(state, {});
  const rows = state.grid.length;
  for (let r = 0; r < rows; r++) state.grid[r][0] = r % 2 ? 5 : 6;
  state.stackHeight[0] = rows;

  // First rise with the column capped: a warning, not a loss.
  assert.equal(raiseFloor(state).toppedOut, false, 'the first rise past a capped column is a warning');
  assert.equal(state.ceilingWarned[0], true, 'and it arms the deadline on THAT column');
  assert.equal(topColumnCount(state), 1, 'the column is still at the ceiling');

  // Second rise, still capped: out of time.
  assert.equal(raiseFloor(state).toppedOut, true, 'the second rise with it still capped ends the run');
}
{
  // Clear the column inside the grace and the deadline is gone. Without this
  // the "chance" is not a chance at all.
  const state = createInitialState();
  startRun(state, {});
  const rows = state.grid.length;
  for (let r = 0; r < rows; r++) state.grid[r][0] = r % 2 ? 5 : 6;
  state.stackHeight[0] = rows;

  raiseFloor(state);
  assert.equal(state.ceilingWarned[0], true, 'deadline armed on column 0');

  // The player frees cells in that column before the next rise. Two, not one:
  // the rise itself puts a cell back, so freeing exactly one leaves the column
  // capped again the instant the floor pushes -- which is fair (they get a
  // fresh cadence for it), but it is not the case under test here.
  state.grid[0][0] = null;
  state.grid[1][0] = null;
  state.stackHeight[0] = rows - 2;

  assert.equal(raiseFloor(state).toppedOut, false, 'clearing the ceiling in time saves the run');
  assert.equal(state.ceilingWarned[0], false, 'and disarms that column\'s deadline');
}
{
  // Freeing only ONE cell still saves the run -- the rise re-caps the column,
  // but the player earns a fresh cadence for the work they did.
  const state = createInitialState();
  startRun(state, {});
  const rows = state.grid.length;
  for (let r = 0; r < rows; r++) state.grid[r][0] = r % 2 ? 5 : 6;
  state.stackHeight[0] = rows;
  raiseFloor(state);

  state.grid[0][0] = null;
  state.stackHeight[0] = rows - 1;
  assert.equal(raiseFloor(state).toppedOut, false, 'one freed cell is still enough to survive this rise');
}
{
  // A rise whose own cascade clears the column it just capped must NOT leave
  // a warning behind -- the flag is read after resolveMerges for exactly this.
  const state = createInitialState();
  startRun(state, {});
  const rows = state.grid.length;
  // one cell of headroom, filled with fruit that will cascade away when the
  // rise lands a matching tier underneath
  for (let r = 1; r < rows; r++) state.grid[r][0] = 0;
  state.stackHeight[0] = rows - 1;
  raiseFloor(state);
  if (topColumnCount(state) === 0) {
    assert.ok(state.ceilingWarned.every((w) => w === false),
      'a cascade that clears the ceiling must not leave any deadline armed');
  }
}

// --- 3c. the deadline belongs to a COLUMN, not to the board -----------------
// This shipped first as one board-wide boolean and review caught it before it
// went out. Rescue the capped column, have a DIFFERENT column top off inside
// the same cadence, and the second column inherited the first one's armed
// warning and died with no grace at all -- the exact instant, unwarned loss
// this whole phase exists to remove, on a rarer trigger. Reproduced then, and
// pinned here so it cannot come back.
{
  const state = createInitialState();
  startRun(state, {});
  const rows = state.grid.length;
  const cap = (c) => {
    for (let r = 0; r < rows; r++) state.grid[r][c] = r % 2 ? 5 : 6;
    state.stackHeight[c] = rows;
  };

  cap(0);
  assert.equal(raiseFloor(state).toppedOut, false, 'column 0 caps: a warning, not a loss');
  assert.equal(state.ceilingWarned[0], true, 'and the warning is on column 0');

  // The player digs column 0 out -- two cells, so the rise itself does not
  // simply refill it and re-arm it. In the same cadence, a column that has
  // never been warned tops off.
  state.grid[0][0] = null;
  state.grid[1][0] = null;
  state.stackHeight[0] = rows - 2;
  cap(1);

  assert.equal(raiseFloor(state).toppedOut, false,
    'a newly capped column must get its OWN cadence of grace, never inherit another column\'s');
  assert.equal(state.ceilingWarned[0], false, 'the rescued column is disarmed');
  assert.equal(state.ceilingWarned[1], true, 'and the new one is armed on its own account');

  // And it still kills on the following rise, so the fix did not just remove
  // the ending.
  assert.equal(raiseFloor(state).toppedOut, true,
    'column 1 still dies on the next rise if it is not cleared');
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
        setDragTarget(state, t * CELL + CELL / 2);
        hardDrop(state);
      }
      assert.ok(ended, `a played run must end -- it hit the ${CAP}-drop cap, so the floor is not doing its job`);
      assert.ok(state.spawnIndex < RUNAWAY, `a played run must end well before ${RUNAWAY} drops (got ${state.spawnIndex}) -- the floor has been weakened`);
    }
  }
}

console.log('floor-rise: all assertions passed');
