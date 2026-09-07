// 21: the Stone -- the piece that makes the rising floor actually pressure the
// board, and the reason the difficulty curve exists at all now.
//
// The finding behind it: with the run ending only when there is no move left
// (the rule the game should always have had), the old rising row made the
// curve completely INERT -- survival from an empty board measured ~180-230
// drops at every cadence from 16 down to 1. A row of tier 0 and 1 fruit is
// the cheapest material on the board to clear, so a faster floor was handing
// the player ammunition rather than applying pressure. See STONE_TIER in
// js/constants.js for the full measurement and the two failed attempts before
// this one.
import assert from 'node:assert/strict';
import { createInitialState, startRun, stonesPerRise, tierColor } from '../js/state.js';
import { raiseFloor, resolveMerges, swapFruits, removeFruitAt, tierDef, spawnFruit } from '../js/physics.js';
import {
  COLS, STONE_TIER, STONE_DEF, RAINBOW_TIER, BOMB_TIER, MAX_TIER,
  STONE_START_LEVEL, STONE_CRACK_POINTS, SKINS,
} from '../js/constants.js';

// --- 1. a stone never merges, with anything ---------------------------------
// Same landmine family as the bomb: a wildcard treats anything as mergeable,
// so the stone has to be rejected ABOVE the rainbow branch or a wild would
// dissolve the floor.
{
  const state = createInitialState();
  startRun(state, {});
  const rows = state.grid.length;

  const pairs = [
    ['two stones', STONE_TIER, STONE_TIER],
    ['a stone and a fruit', STONE_TIER, 3],
    ['a fruit and a stone', 3, STONE_TIER],
    ['a stone and a RAINBOW', STONE_TIER, RAINBOW_TIER],
    ['a rainbow and a stone', RAINBOW_TIER, STONE_TIER],
    ['a stone and a bomb', STONE_TIER, BOMB_TIER],
  ];
  for (const [label, a, b] of pairs) {
    const s = createInitialState();
    startRun(s, {});
    s.grid[rows - 1][2] = a;
    s.grid[rows - 2][2] = b;
    s.stackHeight[2] = 2;
    s.events.length = 0;
    resolveMerges(s);
    assert.equal(s.grid[rows - 1][2], a, `${label}: must not merge (lower cell unchanged)`);
    assert.equal(s.grid[rows - 2][2], b, `${label}: must not merge (upper cell unchanged)`);
  }
}

// --- 2. a merge beside a stone cracks it -----------------------------------
// This is what stops the stone being a wall you can only watch. Merging NEXT
// to the floor becomes the correct play, which is the "fight the floor" the
// design has claimed since 17 and never actually paid out.
{
  const state = createInitialState();
  startRun(state, {});
  const rows = state.grid.length;
  // Two matching fruit in column 2, a stone directly beside the lower one.
  state.grid[rows - 1][2] = 0;
  state.grid[rows - 2][2] = 0;
  state.stackHeight[2] = 2;
  state.grid[rows - 1][3] = STONE_TIER;
  state.stackHeight[3] = 1;
  const scoreBefore = state.score;
  state.events.length = 0;

  resolveMerges(state);

  assert.equal(state.grid[rows - 1][3], null, 'the stone beside the merge is cracked');
  assert.equal(state.stackHeight[3], 0, 'and the column it was in is shorter for it');
  assert.ok(state.events.some((e) => e.type === 'stoneCracked'), 'cracking is announced so it can be shown');
  assert.ok(state.score >= scoreBefore + STONE_CRACK_POINTS, 'and it scores -- clearing one is real work');
}
{
  // A stone NOT touching the merge survives. Cracking is a reward for
  // placement, not a blanket clear.
  const state = createInitialState();
  startRun(state, {});
  const rows = state.grid.length;
  state.grid[rows - 1][0] = 0;
  state.grid[rows - 2][0] = 0;
  state.stackHeight[0] = 2;
  state.grid[rows - 1][5] = STONE_TIER;   // far side of the board
  state.stackHeight[5] = 1;
  resolveMerges(state);
  assert.equal(state.grid[rows - 1][5], STONE_TIER, 'a stone across the board is untouched');
}

// --- 3. the floor delivers stone, and more of it as levels climb -----------
{
  for (let lvl = 1; lvl < STONE_START_LEVEL; lvl++) {
    assert.equal(stonesPerRise(lvl), 0, `level ${lvl} is inside the opening grace -- no floor, no stone`);
  }
  let prev = -1;
  for (let lvl = 1; lvl <= 200; lvl++) {
    const n = stonesPerRise(lvl);
    assert.ok(n >= prev, `stone count must never go back down (level ${lvl})`);
    assert.ok(n <= COLS - 1,
      `a rise must always bring at least one real fruit, or the player is starved of the very material that cracks stone (level ${lvl}: ${n})`);
    prev = n;
  }
  assert.ok(stonesPerRise(200) > stonesPerRise(STONE_START_LEVEL),
    'and it genuinely climbs -- this is the second difficulty lever, not decoration');
}
{
  // A real rise puts the right number of stones on the board.
  const state = createInitialState();
  startRun(state, {});
  const rows = state.grid.length;
  state.spawnIndex = 200; // deep enough that several stones are due
  const expected = stonesPerRise(Math.floor(200 / 10) + 1);
  raiseFloor(state);
  let stones = 0;
  for (let c = 0; c < COLS; c++) if (state.grid[rows - 1][c] === STONE_TIER) stones += 1;
  assert.equal(stones, expected, `the new bottom row carries exactly stonesPerRise stones (${expected})`);
}

// --- 4. a stone is scenery, not a piece the player can move ----------------
{
  const state = createInitialState();
  startRun(state, {});
  const rows = state.grid.length;
  state.grid[rows - 1][1] = STONE_TIER;
  state.grid[rows - 1][2] = 4;
  state.stackHeight[1] = 1;
  state.stackHeight[2] = 1;
  assert.equal(swapFruits(state, rows - 1, 1, rows - 1, 2), false,
    'Swap must refuse a stone -- sliding the floor around would be free tidying');
  assert.equal(state.grid[rows - 1][1], STONE_TIER, 'and nothing moved');
}
{
  // The Remover DOES take one. This is a large part of why the shop is worth
  // anything now: before the stone, a 20-coin Remover competed with simply
  // merging, and lost.
  const state = createInitialState();
  startRun(state, {});
  const rows = state.grid.length;
  state.grid[rows - 1][4] = STONE_TIER;
  state.stackHeight[4] = 1;
  assert.equal(removeFruitAt(state, rows - 1, 4), true, 'the Remover clears a stone');
  assert.equal(state.stackHeight[4], 0, 'and the column is shorter for it');
}

// --- 5. it is drawable, on every palette -----------------------------------
// A stone must never be mistaken for a fruit the player failed to match, so
// its colour is fixed rather than skinned, and it must resolve to a real
// shape and radius like anything else the renderer is handed.
{
  const def = tierDef(STONE_TIER);
  assert.equal(def, STONE_DEF, 'the stone resolves to its own definition');
  assert.ok(def.radius > 0 && def.shape === 'stone', 'with a real radius and its own shape');
  const state = createInitialState();
  for (const skin of SKINS) {
    state.selectedSkin = skin.id;
    assert.equal(tierColor(state, STONE_TIER), STONE_DEF.color,
      `the stone keeps its own colour on the ${skin.name} palette -- it is not fruit and must not look like it`);
  }
  assert.ok(STONE_TIER > MAX_TIER, 'the sentinel sits past every real tier, so it can never collide with one');
}

console.log('stone: never merges (rainbow and bomb included), cracks when a merge lands beside it and scores for it, arrives in growing numbers by level but never fills a whole row, cannot be swapped but can be removed, and draws as itself on every palette');
