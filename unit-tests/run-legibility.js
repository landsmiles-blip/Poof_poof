// 19: the two marks that make a run readable, and the one thing they must
// never do -- lie.
//
// The reported complaint was not that the game was hard, it was that the
// ending was invisible: "it's like the game ends randomly, it gives the
// ending like a surprise because you do not even know how the game ended".
// The ceiling line and the next-rise meter answer "where do I lose" and
// "when does the floor push". Both are drawn from the SAME values the rules
// read, so this file's job is to prove they cannot drift out of step with
// those rules -- a mark that is merely decorative is worse than none, because
// the player will trust it.
import assert from 'node:assert/strict';
import { createInitialState, startRun, floorRiseCadenceDrops } from '../js/state.js';
import { raiseFloor } from '../js/physics.js';
import { drawCeilingLine, drawRiseMeter } from '../js/render.js';
import { _setReducedMotion } from '../js/effects.js';
import {
  COLS, CELL, LEVEL_DROPS, RISE_METER_HEIGHT,
  CEILING_LINE_ALPHA, CEILING_LINE_ALPHA_MAX,
  RISE_METER_FILL_ALPHA, RISE_METER_IMMINENT_ALPHA,
  FLOOR_RISE_START_LEVEL,
} from '../js/constants.js';

// Pulsing reads the wall clock, which would make every alpha assertion here
// flaky. Reduced motion is the game's own switch for "no clock-driven
// animation", so the marks are tested in exactly that mode.
_setReducedMotion(true);

function makeFakeCtx() {
  const calls = [];
  const ctx = {
    globalAlpha: 1, strokeStyle: null, fillStyle: null, lineWidth: 0,
    save: () => calls.push({ op: 'save' }),
    restore: () => calls.push({ op: 'restore' }),
    setLineDash: (d) => calls.push({ op: 'setLineDash', dash: d }),
    beginPath: () => calls.push({ op: 'beginPath' }),
    moveTo: (x, y) => calls.push({ op: 'moveTo', x, y, alpha: ctx.globalAlpha }),
    lineTo: (x, y) => calls.push({ op: 'lineTo', x, y, alpha: ctx.globalAlpha }),
    stroke: () => calls.push({ op: 'stroke', alpha: ctx.globalAlpha, color: ctx.strokeStyle }),
    fillRect: (x, y, w, h) => calls.push({ op: 'fillRect', x, y, w, h, alpha: ctx.globalAlpha, color: ctx.fillStyle }),
  };
  return { ctx, calls };
}
const THEME = { danger: '#ff0000', grid: '#888888' };
const rowsOf = (state) => state.grid.length;

function ceiling(state) {
  const { ctx, calls } = makeFakeCtx();
  drawCeilingLine(ctx, state, rowsOf(state), THEME);
  return calls;
}
function riseMeter(state) {
  const { ctx, calls } = makeFakeCtx();
  drawRiseMeter(ctx, state, rowsOf(state), THEME);
  return calls.filter((c) => c.op === 'fillRect');
}

// --- 1. the ceiling line sits ON the rule that actually ends the run --------
{
  const state = createInitialState();
  startRun(state, {});
  const rows = rowsOf(state);

  const calls = ceiling(state);
  const move = calls.find((c) => c.op === 'moveTo');
  const line = calls.find((c) => c.op === 'lineTo');
  assert.ok(move && line, 'the ceiling line is drawn');
  assert.equal(move.x, 0, 'it spans from the left board edge');
  assert.equal(line.x, COLS * CELL, '...to the right board edge');
  assert.equal(move.y, line.y, 'it is horizontal');
  // raiseFloor tops out on stackHeight[c] >= rows, i.e. a fruit occupying
  // ROW 0. The line must therefore sit at the top of row 0, not somewhere
  // decorative -- otherwise it marks a limit the game does not enforce.
  assert.ok(move.y >= 0 && move.y < CELL,
    `the line must sit at the top of row 0, where the topout check reads (got y=${move.y})`);
  assert.equal(calls.find((c) => c.op === 'stroke').color, THEME.danger,
    "drawn in the game's one danger colour, not the palette accent");
}

// --- 2. it brightens with real proximity, and only with real proximity ------
{
  const empty = createInitialState();
  startRun(empty, {});
  const restAlpha = ceiling(empty).find((c) => c.op === 'stroke').alpha;
  assert.ok(Math.abs(restAlpha - CEILING_LINE_ALPHA) < 1e-9,
    'an empty board leaves the line at its resting alpha');

  // A column filled to the very top: the next rise is fatal, and raiseFloor
  // is asked directly rather than trusted, so this stays true if that rule
  // ever moves.
  const doomed = createInitialState();
  startRun(doomed, {});
  const rows = rowsOf(doomed);
  for (let r = 0; r < rows; r++) doomed.grid[r][0] = 0;
  doomed.stackHeight[0] = rows;
  const maxAlpha = ceiling(doomed).find((c) => c.op === 'stroke').alpha;
  assert.ok(Math.abs(maxAlpha - CEILING_LINE_ALPHA_MAX) < 1e-9,
    'a column against the ceiling drives the line to full alpha');

  // 21: full alpha means "fruit is being crushed off the top of this column",
  // not "you are dead". A capped column is no longer a losing condition at
  // all -- the run ends only when there is no move left. The line is asked to
  // be bright exactly when the crush is happening, and the rule is asked
  // directly rather than trusted, so this still fails if the two drift apart.
  const probe = createInitialState();
  startRun(probe, {});
  for (let r = 0; r < rows; r++) probe.grid[r][0] = r % 2 ? 5 : 6;
  probe.stackHeight[0] = rows;
  probe.events.length = 0;
  assert.equal(raiseFloor(probe).toppedOut, false, 'a capped column is never itself the loss');
  assert.ok(probe.events.some((e) => e.type === 'crushed' && e.col === 0),
    'it is a column losing fruit off the top -- which is what full alpha is marking');

  // Monotonic in between: a taller pile is never a dimmer warning.
  let prev = -1;
  for (let h = 0; h <= rows; h++) {
    const s = createInitialState();
    startRun(s, {});
    for (let r = rows - h; r < rows; r++) s.grid[r][0] = 0;
    s.stackHeight[0] = h;
    const a = ceiling(s).find((c) => c.op === 'stroke').alpha;
    assert.ok(a >= prev - 1e-9, `the ceiling line must never dim as a column grows (height ${h})`);
    prev = a;
  }
}

// --- 3. the rise meter is an exact readout, not an estimate -----------------
// The rise is drop-indexed (see FLOOR_RISE_* in constants.js), so the fill
// can be exact. If it ever becomes an approximation the player is being
// asked to trust a guess at the moment it matters most.
{
  const state = createInitialState();
  startRun(state, {});
  const rows = rowsOf(state);

  // Inside the opening grace there is no rise coming, and drawing an empty
  // bar there would promise one.
  state.spawnIndex = 0;
  assert.equal(floorRiseCadenceDrops(1), Infinity, 'level 1 is inside the grace');
  assert.equal(riseMeter(state).length, 0, 'no meter during the opening grace -- there is nothing to count down to');

  // Past the grace: every step of the countdown, checked against the cadence.
  state.spawnIndex = (FLOOR_RISE_START_LEVEL - 1) * LEVEL_DROPS;
  const cadence = floorRiseCadenceDrops(FLOOR_RISE_START_LEVEL);
  assert.ok(Number.isFinite(cadence) && cadence > 1, 'the start level has a real cadence');

  // dropsSinceFloorRise counts the fruit currently in hand, so the bar reads
  // (done + 1) / cadence -- full means "place this one and the floor pushes".
  for (let done = 0; done < cadence; done++) {
    state.dropsSinceFloorRise = done;
    const rects = riseMeter(state);
    assert.equal(rects.length, 2, 'a track and a fill');
    const [track, fill] = rects;
    assert.equal(track.w, COLS * CELL, 'the track spans the board');
    assert.equal(track.y, rows * CELL - RISE_METER_HEIGHT, 'and sits on the bottom edge -- the edge the floor pushes from');
    assert.equal(fill.w, COLS * CELL * ((done + 1) / cadence),
      `the fill is exactly ${done + 1}/${cadence} of the board, not an approximation`);
  }

  // The load-bearing half: a FULL bar has to mean the rise is one drop away,
  // and it has to be reachable. If these drift apart the mark becomes a lie
  // at the exact moment the player is relying on it.
  state.dropsSinceFloorRise = cadence - 1;
  assert.equal(riseMeter(state)[1].w, COLS * CELL, 'the bar is full on the last drop before a rise');
  state.dropsSinceFloorRise = cadence - 2;
  assert.ok(riseMeter(state)[1].w < COLS * CELL, 'and is not full before that');
}

// --- 4. the meter shouts on the last drop, and not before -------------------
// "One more drop and the floor moves" is the single moment this mark exists
// for; it has to be distinguishable from every other moment without counting
// pixels.
{
  const state = createInitialState();
  startRun(state, {});
  state.spawnIndex = (FLOOR_RISE_START_LEVEL - 1) * LEVEL_DROPS;
  const cadence = floorRiseCadenceDrops(FLOOR_RISE_START_LEVEL);

  state.dropsSinceFloorRise = cadence - 2;
  const calm = riseMeter(state)[1].alpha;
  state.dropsSinceFloorRise = cadence - 1;
  const loud = riseMeter(state)[1].alpha;

  assert.ok(Math.abs(calm - RISE_METER_FILL_ALPHA) < 1e-9, 'two drops out is the resting alpha');
  assert.ok(Math.abs(loud - RISE_METER_IMMINENT_ALPHA) < 1e-9, 'one drop out is the imminent alpha');
  assert.ok(loud > calm, 'and imminent must actually be louder');
}

// --- 5. it cannot overrun, whatever the counter says ------------------------
// dropsSinceFloorRise is reset by spawnFruit the instant it reaches the
// cadence, so it should never exceed it -- but a bar that renders past the
// board's edge on a state nobody expected is a rendering bug in the one
// frame the player is panicking.
{
  const state = createInitialState();
  startRun(state, {});
  state.spawnIndex = (FLOOR_RISE_START_LEVEL - 1) * LEVEL_DROPS;
  state.dropsSinceFloorRise = 999;
  const fill = riseMeter(state)[1];
  assert.equal(fill.w, COLS * CELL, 'the fill clamps to the full board width');
  state.dropsSinceFloorRise = -5;
  assert.equal(riseMeter(state)[1].w, COLS * CELL / floorRiseCadenceDrops(FLOOR_RISE_START_LEVEL),
    'a negative counter clamps to the first step, never to a negative width');
}

// Left as this file found it: run.js imports every test into ONE process, so
// a module-global left flipped here would silently change how a later test
// behaves. unit-tests/reduced-motion.js follows the same rule.
_setReducedMotion(false);

console.log('run-legibility: the ceiling line sits on the real topout rule and brightens monotonically with it; the rise meter is an exact drop-indexed readout, silent during the grace, loud on the last drop, and clamped at both ends');
