// 20: two defects found by audit that have no other natural home. Both are
// "the code did something different from what its own comment claimed", and
// both cost the player something real.
import assert from 'node:assert/strict';
import { createInitialState, startRun, toSaveBlob } from '../js/state.js';
import { spawnFruit } from '../js/physics.js';
import { COLS, BOMB_TIER } from '../js/constants.js';

// --- 1. the bomb fuse must tick before the terminal bail --------------------
// The Bomb is the escape hatch for a board that is nearly gone. Its fuse used
// to be ticked AFTER the "no room anywhere" bail in spawnFruit, even though
// the comment right above it said "checked here, before this spawn does
// anything else". So on the one board it exists to rescue -- the drop that
// fills the last cell being the drop the fuse would end on -- the run ended
// and the bomb, bought for 60 coins, never went off.
{
  const state = createInitialState();
  startRun(state, {});
  const rows = state.grid.length;
  for (let c = 0; c < COLS; c++) {
    for (let r = 0; r < rows; r++) state.grid[r][c] = c % 2 ? 5 : 6;
    state.stackHeight[c] = rows;
  }
  // A live bomb sitting in the pile with one drop left on its fuse.
  state.grid[5][3] = BOMB_TIER;
  state.bombInPlay = true;
  state.bombFuseDrops = 1;

  spawnFruit(state);

  assert.equal(state.bombFuseDrops, null, 'the fuse must reach zero even on a full board');
  assert.equal(state.bombInPlay, false, 'and the bomb must be spent, not left sitting there');
  const stillThere = state.grid.some((row) => row.some((cell) => cell === BOMB_TIER));
  assert.equal(stillThere, false, 'the bomb detonated rather than dying with the run');
  const freed = state.stackHeight.reduce((a, b) => a + b, 0);
  assert.ok(freed < COLS * rows, 'the detonation actually cleared board space -- the rescue happened');
}

// --- 2. the starter Remover is granted exactly once per save ----------------
// It used to infer "brand-new save" from an empty inventory plus a zero high
// score. Both are true again after a player spends the free Remover on their
// first fruit and quits without scoring, so it re-granted on every boot.
{
  let blob = {};
  const grants = [];
  for (let boot = 0; boot < 4; boot++) {
    const state = createInitialState(blob);
    grants.push(state.inventory.remover);
    state.inventory.remover = 0; // spent it, scored nothing, quit
    blob = toSaveBlob(state, { musicOn: true, sfxOn: true, hapticsOn: true });
  }
  assert.deepEqual(grants, [1, 0, 0, 0],
    'exactly one starter Remover across four boot/spend/quit cycles');
  assert.equal(blob.starterGranted, true, 'and the save records that it happened');
}
{
  // A save written before 20 has no flag. An established player must not be
  // re-granted, and a genuinely new one must not be robbed.
  assert.equal(createInitialState({ highScore: 900, inventory: { remover: 2 } }).inventory.remover, 2,
    'a legacy save with progress is left alone');
  assert.equal(createInitialState({ highScore: 0, inventory: {} }).inventory.remover, 1,
    'a legacy save that is genuinely untouched still gets its one starter');
}

console.log('audit-fixes: the bomb fuse detonates even on the board that ends the run; the starter Remover is granted exactly once per save, with legacy saves handled both ways');
