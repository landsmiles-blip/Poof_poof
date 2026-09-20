// 23: the comeback, the bomb's silence, and the curve that actually climbs.
//
// WHY THIS FILE EXISTS. Phase 22 moved the floor off the clock and onto the
// play, and that part worked -- but it shipped a curve that did not bite until
// the run was nearly over. Measured on 2026.09.20-27, 250 runs of competent
// play: survival was 100% all the way to level 15, and the floor first moved
// at level 12. Three minutes of a four-minute run with nothing at stake, then
// a cliff.
//
// Phase 23 moves the whole curve forward and makes it climb the entire way.
// On its own that would turn the ending into a coin flip, so it also adds the
// thing that makes a steep curve fair: a merge is worth MORE the closer the
// floor is to moving. Fighting back pays most exactly when you most need it.
import assert from 'node:assert/strict';
import { createInitialState, startRun, pressureDrainFor, pressurePerDrop, levelFor } from '../js/state.js';
import { spawnFruit, hardDrop, setDragTarget, isGameOver, detonateBomb, resolveMerges } from '../js/physics.js';
import {
  COLS, CELL, LEVEL_DROPS, PRESSURE_RISE_AT, PRESSURE_CLUTCH_BONUS,
  PRESSURE_DRAIN_BASE, PRESSURE_DRAIN_BOMB_CASCADE, PRESSURE_BANK_FLOOR,
  FLOOR_RISE_START_LEVEL,
} from '../js/constants.js';

// --- 1. the comeback scales with danger, exactly ----------------------------
{
  const empty = pressureDrainFor(0, 0, 0);
  const half = pressureDrainFor(0, 0, PRESSURE_RISE_AT / 2);
  const full = pressureDrainFor(0, 0, PRESSURE_RISE_AT);

  assert.equal(empty, PRESSURE_DRAIN_BASE, 'an empty meter is the plain base rate');
  assert.ok(half > empty && full > half, 'and it rises with the danger, monotonically');
  assert.ok(Math.abs(full - PRESSURE_DRAIN_BASE * (1 + PRESSURE_CLUTCH_BONUS)) < 1e-9,
    'a full meter pays exactly the constant, not an approximation of it');
  assert.ok(Math.abs(half - PRESSURE_DRAIN_BASE * (1 + PRESSURE_CLUTCH_BONUS / 2)) < 1e-9,
    'and half a meter pays exactly half the bonus -- it is linear');

  // clamped at both ends: banked credit must not pay a negative bonus, and a
  // meter past the line must not pay an unbounded one.
  assert.equal(pressureDrainFor(0, 0, -9999), empty, 'banked pressure still pays the base rate, never less');
  assert.equal(pressureDrainFor(0, 0, PRESSURE_RISE_AT * 9), full, 'and overflow is capped at the full bonus');
}

// --- 2. the comeback stacks with skill, it does not replace it ---------------
// A chain pulled off under pressure has to be worth more than the same chain
// pulled off safely, AND more than a single merge under the same pressure --
// otherwise the answer to danger is "merge anything" rather than "chain".
{
  const loneSafe = pressureDrainFor(0, 0, 0);
  const loneDanger = pressureDrainFor(0, 0, PRESSURE_RISE_AT);
  const chainSafe = pressureDrainFor(0, 2, 0);
  const chainDanger = pressureDrainFor(0, 2, PRESSURE_RISE_AT);

  assert.ok(chainDanger > loneDanger, 'a chain under pressure beats a single merge under pressure');
  assert.ok(chainDanger > chainSafe, 'and the same chain is worth more when it is needed');
  assert.ok(chainDanger / loneSafe > 3,
    'the clutch chain is the biggest single swing in the game -- that is the play the whole curve is built around');
}

// --- 3. the bomb buys cells, not time ---------------------------------------
// Measured before this gate: one bomb refunded a median 47.8 pressure to a
// player dropping at random and exactly 0 to one merging as they went, because
// a competent board has no backlog for its full-board sweep to find. Same
// subsidy-for-bad-play shape phase 22 took out of the rise, hiding in an item.
{
  assert.equal(PRESSURE_DRAIN_BOMB_CASCADE, 0, 'the bomb cascade drains nothing');

  const state = createInitialState();
  startRun(state, {});
  state.spawnIndex = 200;
  const rows = state.grid.length;
  // a deliberately messy board: matching pairs everywhere for the sweep to find
  for (let c = 0; c < COLS; c++) {
    for (let r = rows - 4; r < rows; r++) state.grid[r][c] = (r + c) % 2;
    state.stackHeight[c] = 4;
  }
  state.pressure = PRESSURE_RISE_AT * 0.9; // exactly when a refund would be worth most
  const before = state.pressure;
  detonateBomb(state, rows - 2, 2);
  assert.equal(state.pressure, before,
    'a bomb on a full backlog, with the meter nearly up, refunds nothing at all');
}

// --- 4. ...but the player's own merges still pay, and pay more under pressure -
{
  const rows = 10;
  function planted(pressure) {
    const s = createInitialState(); startRun(s, {});
    s.spawnIndex = (FLOOR_RISE_START_LEVEL - 1) * LEVEL_DROPS;
    s.pressure = pressure;
    s.grid[rows - 1][0] = 2; s.grid[rows - 1][1] = 2;
    s.stackHeight[0] = 1; s.stackHeight[1] = 1;
    const before = s.pressure;
    resolveMerges(s);
    return before - s.pressure;
  }
  const calm = planted(0);
  const desperate = planted(PRESSURE_RISE_AT * 0.95);
  assert.ok(calm > 0, 'a merge still pays');
  assert.ok(desperate > calm, 'and it pays more when the floor is about to move');
}

// --- 5. the curve climbs the whole way ---------------------------------------
// The defect this phase exists to fix: fill that barely moved, so nothing was
// at stake until the run was nearly over.
{
  let prev = 0;
  for (let lvl = FLOOR_RISE_START_LEVEL; lvl <= 25; lvl++) {
    const f = pressurePerDrop(lvl);
    assert.ok(f > prev, `fill per drop rises at every level (level ${lvl})`);
    prev = f;
  }
  // and it has to rise enough to matter: by level 15 a dropped fruit must cost
  // meaningfully more than it did when the floor first switched on.
  assert.ok(pressurePerDrop(15) >= pressurePerDrop(FLOOR_RISE_START_LEVEL) * 1.8,
    'by level 15 a drop costs at least 80% more than it did at the start level');
}

// --- 6. risk arrives before the run is over, and runs still end --------------
// The end-to-end property. Competent play must meet real jeopardy well before
// the run ends, and must still always terminate.
{
  function decent(s) {
    let t = -1;
    for (let c = 0; c < COLS; c++) {
      const h = s.stackHeight[c];
      if (h >= s.grid.length) continue;
      if (h > 0 && s.grid[s.grid.length - h][c] === s.active.tier) { t = c; break; }
    }
    if (t >= 0) return t;
    let bh = Infinity;
    for (let c = 0; c < COLS; c++) if (s.stackHeight[c] < s.grid.length && s.stackHeight[c] < bh) { bh = s.stackHeight[c]; t = c; }
    return t;
  }

  const CAP = 5000;
  let longest = 0, hitCap = 0, totalRises = 0, risesBeforeL12 = 0;
  const N = 40;
  for (let i = 0; i < N; i++) {
    const s = createInitialState(); startRun(s, {});
    let n = 0;
    while (n < CAP) {
      s.events.length = 0;                  // BEFORE spawnFruit -- the rise fires inside it
      if (spawnFruit(s).blocked || isGameOver(s)) break;
      const c = decent(s); if (c < 0) break;
      const lvl = levelFor(s.spawnIndex);
      setDragTarget(s, c * CELL + CELL / 2); hardDrop(s);
      const r = s.events.filter((e) => e.type === 'floorRose').length;
      totalRises += r;
      if (lvl < 12) risesBeforeL12 += r;
      n++;
    }
    if (n >= CAP) hitCap++;
    if (n > longest) longest = n;
  }
  assert.equal(hitCap, 0, `every merge-greedy run terminates (longest ${longest})`);
  assert.ok(longest > 60, `and not instantly either (longest ${longest})`);
  assert.ok(totalRises > 0, 'the floor actually moves during competent play -- phase 22 shipped a build where it never did');
  assert.ok(risesBeforeL12 > 0,
    'and it starts moving before level 12, which is the whole point of this phase');
}

// --- 7. banked credit is still bounded --------------------------------------
{
  const s = createInitialState(); startRun(s, {});
  s.spawnIndex = (FLOOR_RISE_START_LEVEL - 1) * LEVEL_DROPS;
  const rows = s.grid.length;
  for (let i = 0; i < 25; i++) {
    s.grid[rows - 1][0] = 1; s.grid[rows - 1][1] = 1;
    s.stackHeight[0] = 1; s.stackHeight[1] = 1;
    resolveMerges(s);
  }
  assert.ok(s.pressure >= PRESSURE_BANK_FLOOR, 'the bank floor still holds, however well the run is going');
}

console.log('clutch: a merge is worth more the closer the floor is to moving -- exactly linear, clamped at both ends, biggest when chained under pressure; the bomb buys cells and not time; the fill climbs at every level and climbs enough to matter; the floor actually moves during competent play and moves before level 12; and runs still always end');
