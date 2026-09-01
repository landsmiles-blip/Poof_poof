// 14.1: the regression guard for a bug that had shipped for weeks and was
// invisible because the try/catch phase 12.1 added to keep the game alive was
// also keeping it quiet.
//
// What happened. detonateBomb clears its whole 3x3 INCLUDING the bomb's own
// cell, so the bombCleared event carries a cell whose tier is BOMB_TIER (98).
// main.js turned each cleared cell into a burst via its own colorForTier,
// which handled the rainbow sentinel and not the bomb -- so skinColor indexed
// a nine-entry palette with 98, got `undefined`, and effects.js's
// boostVibrance did `undefined.replace(...)` on every light board. js/
// render.js had a SECOND copy of the same lookup which did handle the bomb,
// which is exactly why nobody caught it: the copy you would naturally read
// was the correct one.
//
// The blast radius was not one burst. js/main.js cleared state.events AFTER
// the loop, so the throw skipped the clear, the same event sat at the head of
// the queue, and it threw again every frame for the rest of the run --
// killing every merge sound, particle, squash, haptic and chip pulse, and the
// pause button with them (openPauseMenu's only caller is inside that loop).
//
// So this file asserts the two things that make that impossible rather than
// unlikely: every tier a cleared cell can carry resolves to a usable colour,
// on every skin; and the sentinels resolve to their own definitions rather
// than to a palette entry that does not exist.
import assert from 'node:assert/strict';
import { TIERS, SKINS, RAINBOW_TIER, RAINBOW_DEF, BOMB_TIER, BOMB_DEF } from '../js/constants.js';
import { createInitialState, startRun, selectSkin, tierColor } from '../js/state.js';
import { detonateBomb } from '../js/physics.js';

const HEX = /^#[0-9a-fA-F]{6}$/;

function fresh() {
  const state = createInitialState(null);
  state.unlockedSkins = SKINS.map((s) => s.id); // so every palette is reachable
  startRun(state, {});
  return state;
}

// --- 1. Every tier, every sentinel, every skin, resolves to a real colour ---
// Written across all skins because the failure mode was an index into ONE
// palette; a test that only checked Classic would pass while a skin with a
// short colours array failed.
{
  for (const skin of SKINS) {
    const state = fresh();
    assert.equal(selectSkin(state, skin.id), true, `skin ${skin.id} should be selectable here`);
    for (let t = 0; t < TIERS.length; t++) {
      assert.match(tierColor(state, t), HEX,
        `skin ${skin.id} must give tier ${t} (${TIERS[t].name}) a usable colour`);
    }
    assert.equal(tierColor(state, RAINBOW_TIER), RAINBOW_DEF.color,
      `the rainbow sentinel must resolve to its own definition on skin ${skin.id}`);
    assert.equal(tierColor(state, BOMB_TIER), BOMB_DEF.color,
      `the bomb sentinel must resolve to its own definition on skin ${skin.id}`);
  }
}

// --- 2. Every cell a real detonation reports can be coloured ---------------
// Not a restatement of section 1: this goes through detonateBomb itself, so
// it stays true if the set of tiers a bombCleared event can carry ever
// changes. The bomb's own cell being in that set is the whole bug.
{
  const state = fresh();
  const rows = state.grid.length;
  state.grid[rows - 1][2] = 0;
  state.grid[rows - 1][3] = BOMB_TIER;
  state.grid[rows - 1][4] = 1;
  state.stackHeight[2] = 1;
  state.stackHeight[3] = 1;
  state.stackHeight[4] = 1;

  detonateBomb(state, rows - 1, 3);
  const event = state.events.find((e) => e.type === 'bombCleared');
  assert.ok(event, 'a detonation must emit a bombCleared event');
  assert.ok(event.cells.some((c) => c.tier === BOMB_TIER),
    'fixture check: the bomb clears its own cell, so the event carries BOMB_TIER -- '
    + 'if this ever stops being true the bug this file guards has moved, not gone');

  for (const cell of event.cells) {
    const color = tierColor(state, cell.tier);
    assert.match(color, HEX,
      `every cell in a bombCleared event must resolve to a colour (tier ${cell.tier} did not)`);
    // effects.js's boostVibrance does exactly this first, on every light
    // board. It is the line that actually threw.
    assert.doesNotThrow(() => color.replace('#', ''),
      'the colour must survive what effects.js does with it on a bright board');
  }
}

// --- 3. An unknown tier fails loudly here, not three modules downstream ----
// tierColor is now the single lookup, so it is also the single place where a
// future sentinel added without a branch can be caught. It is allowed to
// return undefined -- what must NOT happen is that it silently returns
// something that looks like a colour and is not.
{
  const state = fresh();
  const bogus = tierColor(state, 12345);
  assert.equal(bogus, undefined,
    'an unknown tier must come back undefined rather than as a plausible-looking string');
}

console.log(`tier-color: all ${TIERS.length} tiers plus both sentinels resolve to a real colour on all ${SKINS.length} skins, and every cell a real detonation reports can be coloured`);
