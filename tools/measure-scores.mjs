// What does a run actually SCORE? The milestone ladder (skins + power-up
// unlocks) has to be spaced against real scores, and until 20 it was not:
// every milestone fell inside a single ordinary run. Same greedy bots as
// tools/tune-floor-rise.mjs, measuring points instead of drops. No power-ups,
// so every figure here is a LOWER bound on a real player.
import { createInitialState, startRun, levelFor } from '../js/state.js';
import { spawnFruit, hardDrop, isGameOver, setDragTarget } from '../js/physics.js';
import { CELL, COLS } from '../js/constants.js';

function topTier(s, c) { const h = s.stackHeight[c]; return h <= 0 ? null : s.grid[s.grid.length - h][c]; }
function play(careful) {
  const s = createInitialState(); startRun(s, {});
  while (s.spawnIndex < 100000) {
    if (spawnFruit(s).blocked || isGameOver(s)) break;
    const rows = s.grid.length, held = s.active.tier;
    let t = -1;
    if (careful) for (let c = 0; c < COLS; c++) if (s.stackHeight[c] < rows && topTier(s, c) === held) { t = c; break; }
    if (t < 0) { let bh = Infinity; for (let c = 0; c < COLS; c++) if (s.stackHeight[c] < rows && s.stackHeight[c] < bh) { bh = s.stackHeight[c]; t = c; } }
    if (t < 0) break;
    setDragTarget(s, t * CELL + CELL / 2); hardDrop(s);
  }
  return { score: s.score, level: levelFor(s.spawnIndex) };
}
const N = Number(process.env.TRIALS || 400);
const q = (a, p) => a[Math.min(a.length - 1, Math.floor(p * a.length))];
for (const careful of [false, true]) {
  const scores = [];
  for (let i = 0; i < N; i++) scores.push(play(careful).score);
  scores.sort((a, b) => a - b);
  console.log(`[${careful ? 'careful ' : 'careless'}] score  p10 ${q(scores,.1)}  med ${q(scores,.5)}  p75 ${q(scores,.75)}  p90 ${q(scores,.9)}  p99 ${q(scores,.99)}  max ${scores[scores.length-1]}`);
  // cumulative: how many runs to reach a given total best-score
  const cum = [];
  let best = 0, runs = 0;
  const marks = [1500, 3000, 6000, 10000, 15000, 25000];
  const need = {};
  const shuffled = [...scores].sort(() => Math.random() - 0.5);
  for (const sc of shuffled) { runs++; if (sc > best) best = sc; for (const m of marks) if (!need[m] && best >= m) need[m] = runs; }
  console.log('            runs needed for a best score of: ' + marks.map(m => `${m}:${need[m] || '>'+runs}`).join('  '));
}
