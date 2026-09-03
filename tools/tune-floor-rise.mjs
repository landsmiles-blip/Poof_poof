// Headless, pure-logic tuning harness for the 17 rising floor. It imports the
// game's own state/physics modules and plays greedy runs with no browser and
// no real-time -- hundreds of full runs in a blink -- to measure how many DROPS
// a run survives at whatever FLOOR_RISE_* constants are currently in
// constants.js. It measures ONE thing (drops survived, and the level that maps
// to) so the cadence can be fit to a target instead of guessed. It is NOT a
// substitute for a person actually playing the game.
import { createInitialState, startRun, levelFor } from '../js/state.js';
import { spawnFruit, hardDrop, isGameOver } from '../js/physics.js';
import { CELL, COLS } from '../js/constants.js';

function topTier(state, c) {
  const h = state.stackHeight[c];
  if (h <= 0) return null;
  return state.grid[state.grid.length - h][c];
}

// 'careful' drops the held fruit onto a matching top (a merge on landing) when
// one exists, else the shortest column -- a reasonable proxy for a thoughtful
// player, and a LOWER bound on a real expert who plans several moves ahead.
// 'careless' always takes the shortest column, matching nothing.
function chooseColumn(state, strategy) {
  const rows = state.grid.length;
  const held = state.active.tier;
  if (strategy === 'careful') {
    for (let c = 0; c < COLS; c++) {
      if (state.stackHeight[c] < rows && topTier(state, c) === held) return c;
    }
  }
  let best = -1, bestH = Infinity;
  for (let c = 0; c < COLS; c++) {
    if (state.stackHeight[c] < rows && state.stackHeight[c] < bestH) {
      bestH = state.stackHeight[c]; best = c;
    }
  }
  return best;
}

function playOne(strategy) {
  const state = createInitialState();
  startRun(state, {});
  const HARD_CAP = 100000; // catch a pathological non-terminating run
  while (state.spawnIndex < HARD_CAP) {
    const res = spawnFruit(state);
    if (res.blocked || isGameOver(state)) break;
    const target = chooseColumn(state, strategy);
    if (target < 0) break;
    state.active.x = target * CELL + CELL / 2;
    hardDrop(state);
  }
  return { drops: state.spawnIndex, level: levelFor(state.spawnIndex), capped: state.spawnIndex >= HARD_CAP };
}

function stats(arr) {
  const s = [...arr].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { min: s[0], p10: q(0.1), med: q(0.5), mean: Math.round(s.reduce((a, b) => a + b, 0) / s.length), p90: q(0.9), max: s[s.length - 1] };
}

const TRIALS = Number(process.env.TRIALS || 300);
// A rough real-time estimate only, clearly labelled: an engaged player spends
// very roughly ~2s per drop (steer + fall + a beat of thought). Reported as a
// band, never as a precise claim.
const SEC_PER_DROP = Number(process.env.SEC_PER_DROP || 2);
console.log(`rising-floor tuning  |  ${TRIALS} runs each  |  ~${SEC_PER_DROP}s/drop assumed for the minute estimate\n`);
for (const strat of ['careless', 'careful']) {
  const drops = [], levels = [];
  let capped = 0;
  for (let i = 0; i < TRIALS; i++) {
    const r = playOne(strat);
    if (r.capped) capped++;
    drops.push(r.drops); levels.push(r.level);
  }
  const d = stats(drops), l = stats(levels);
  const mins = (n) => `${(n * SEC_PER_DROP / 60).toFixed(1)}m`;
  console.log(`[${strat.padEnd(8)}] drops  min ${d.min}  p10 ${d.p10}  med ${d.med}  mean ${d.mean}  p90 ${d.p90}  max ${d.max}`);
  console.log(`           level  med ${l.med}  max ${l.max}   | ~time  med ${mins(d.med)}  max ${mins(d.max)}   | never-ended: ${capped}/${TRIALS}\n`);
}
