// 21.1: the stone's first-encounter teaching, and the callout queue that had
// to exist before it could be added safely.
//
// WHY THIS FILE EXISTS. Phase 21 put a grey slab on the board that never
// merges and breaks only when a merge lands beside it, and shipped it with no
// explanation of any kind. Half that rule teaches itself -- drop a fruit on a
// stone, nothing happens. The other half does not: "merge BESIDE it" is not
// something a player reliably stumbles into inside a five-minute Playables
// session, and without it the stone is pure difficulty with no counterplay.
//
// The queue is not a nicety. fx.levelCallout was a single slot that every
// trigger simply assigned to, so two callouts arriving in one event batch
// meant one was never seen -- and level 3 is exactly where the floor starts,
// the first stone arrives and a level-up fires. Section 5 is the regression
// test for the pre-existing version of that bug, which was reproduced before
// it was fixed.
import assert from 'node:assert/strict';
import {
  createInitialState, startRun, toSaveBlob, maybeTeach, hasTaught,
} from '../js/state.js';
import { raiseFloor, resolveMerges } from '../js/physics.js';
import {
  createEffects, triggerLevelUp, triggerUnlock, triggerTeach, updateEffects, _setReducedMotion,
} from '../js/effects.js';
import {
  COLS, STONE_TIER, TEACH_STONE, TEACH_STONE_CRACK, LEVEL_CALLOUT_SEC,
  STONE_TEACH_TITLE, STONE_TEACH_LINE, CRACK_TEACH_TITLE, CRACK_TEACH_LINE,
  BOARD_WIDTH,
} from '../js/constants.js';

const teachEvents = (s) => s.events.filter((e) => e.type === 'teach');

// --- 1. the first rise carrying a stone teaches it, once and only once ------
{
  const state = createInitialState();
  startRun(state, {});
  state.spawnIndex = 200; // deep enough that a rise is guaranteed to carry stone
  state.events.length = 0;

  raiseFloor(state);
  const first = teachEvents(state);
  assert.equal(first.length, 1, 'the first rise with a stone in it teaches the stone');
  assert.equal(first[0].key, TEACH_STONE, 'and it is the stone lesson, by key');
  assert.equal(first[0].title, STONE_TEACH_TITLE, 'carrying the title for the callout');
  assert.equal(first[0].line, STONE_TEACH_LINE, 'and the rule itself');

  // Ten more rises. A player who has been told does not get told again.
  for (let i = 0; i < 10; i++) {
    state.events.length = 0;
    raiseFloor(state);
    assert.equal(teachEvents(state).filter((e) => e.key === TEACH_STONE).length, 0,
      `rise ${i + 2} must not teach the stone again`);
  }
  assert.equal(hasTaught(state, TEACH_STONE), true, 'and the save records that it was shown');
}

// --- 2. a rise with no stone in it teaches nothing --------------------------
// Below STONE_START_LEVEL a rise is all fruit. Teaching the stone there would
// name something that is not on the board.
{
  const state = createInitialState();
  startRun(state, {});
  state.spawnIndex = 0; // level 1 -- stonesPerRise is 0
  state.events.length = 0;
  raiseFloor(state);
  assert.equal(teachEvents(state).length, 0, 'a stoneless rise teaches nothing');
  assert.equal(hasTaught(state, TEACH_STONE), false, 'and records nothing');
}

// --- 3. cracking one teaches the second half, once --------------------------
{
  const state = createInitialState();
  startRun(state, {});
  const rows = state.grid.length;
  // Two matching fruit in column 2 with a stone beside the lower one.
  state.grid[rows - 1][2] = 0;
  state.grid[rows - 2][2] = 0;
  state.stackHeight[2] = 2;
  state.grid[rows - 1][3] = STONE_TIER;
  state.stackHeight[3] = 1;
  state.events.length = 0;

  resolveMerges(state);
  const cracked = state.events.filter((e) => e.type === 'stoneCracked');
  assert.equal(cracked.length, 1, 'the merge cracked the stone (guard for the rest of this case)');
  const taught = teachEvents(state);
  assert.equal(taught.length, 1, 'the first crack teaches');
  assert.equal(taught[0].key, TEACH_STONE_CRACK, 'and it is the crack lesson');
  assert.equal(taught[0].title, CRACK_TEACH_TITLE);
  assert.equal(taught[0].line, CRACK_TEACH_LINE);

  // Crack another. No second lesson.
  state.grid[rows - 1][2] = 0;
  state.grid[rows - 2][2] = 0;
  state.stackHeight[2] = 2;
  state.grid[rows - 1][3] = STONE_TIER;
  state.stackHeight[3] = 1;
  state.events.length = 0;
  resolveMerges(state);
  assert.equal(state.events.filter((e) => e.type === 'stoneCracked').length, 1,
    'the second stone did crack');
  assert.equal(teachEvents(state).length, 0, 'but it is not taught twice');
}

// --- 3b. STONE is always taught before BROKEN -------------------------------
// A rise can deliver a stone AND set off a cascade that cracks one in the very
// same frame. If BROKEN arrived first it would explain a thing the player had
// not been told about yet.
{
  const state = createInitialState();
  startRun(state, {});
  state.spawnIndex = 200;
  const rows = state.grid.length;
  // Fill the bottom of every column with a pair that will merge on the rise,
  // maximising the chance the new row's stone is cracked in the same frame.
  for (let c = 0; c < COLS; c++) {
    state.grid[rows - 1][c] = 0;
    state.grid[rows - 2][c] = 0;
    state.stackHeight[c] = 2;
  }
  state.events.length = 0;
  raiseFloor(state);
  const keys = teachEvents(state).map((e) => e.key);
  // Asserted hard, not guarded by an `if`: this board produces both lessons in
  // one frame on every trial (measured 2000/2000), so a conditional check here
  // could go vacuous without anyone noticing.
  assert.ok(keys.includes(TEACH_STONE), 'the rise delivered a stone and taught it');
  assert.ok(keys.includes(TEACH_STONE_CRACK), 'and the cascade cracked one in the same frame');
  assert.ok(keys.indexOf(TEACH_STONE) < keys.indexOf(TEACH_STONE_CRACK),
    'STONE must be queued before BROKEN when both happen in one frame');
  assert.equal(keys.filter((k) => k === TEACH_STONE).length, 1, 'once each, even here');
  assert.equal(keys.filter((k) => k === TEACH_STONE_CRACK).length, 1);
}

// --- 4. the record survives a save round-trip, and a legacy save is owed it -
// This is the lesson from 20's silent unlocks, applied before it can bite
// again: the game has to record what it has SHOWN, not only what is true.
{
  const state = createInitialState();
  startRun(state, {});
  maybeTeach(state, TEACH_STONE, STONE_TEACH_TITLE, STONE_TEACH_LINE);
  assert.equal(state.dirty, true, 'teaching marks the save dirty so it is written out');

  const blob = toSaveBlob(state, { musicOn: true, sfxOn: true, hapticsOn: true });
  assert.ok(Array.isArray(blob.taught) && blob.taught.includes(TEACH_STONE),
    'the blob carries what has been taught');

  const reloaded = createInitialState(blob);
  assert.equal(hasTaught(reloaded, TEACH_STONE), true, 'and a reload remembers it');
  reloaded.events = [];
  assert.equal(maybeTeach(reloaded, TEACH_STONE, 'X', 'Y'), false,
    'so a returning player is not re-taught');
  assert.equal(reloaded.events.length, 0, 'and no event is pushed');

  // A save written before 21.1 has no `taught` key at all. That player has
  // been shown nothing, so they are owed everything -- the same reasoning
  // pendingUnlocks uses for a pre-21 save.
  const legacy = { ...blob };
  delete legacy.taught;
  const old = createInitialState(legacy);
  assert.equal(hasTaught(old, TEACH_STONE), false, 'a legacy save has been taught nothing');
  old.events = [];
  assert.equal(maybeTeach(old, TEACH_STONE, STONE_TEACH_TITLE, STONE_TEACH_LINE), true,
    'so it still gets the lesson');
}

// --- 5. the callout queue: two in one batch, both seen ---------------------
// The pre-existing bug. Reproduced against the old single-slot behaviour
// before the fix: a drop that both levels up and crosses a milestone puts
// levelUp and unlocked in the same batch, and the second overwrote the first.
{
  _setReducedMotion(false);
  const fx = createEffects();
  triggerLevelUp(fx, 7);
  triggerUnlock(fx, 'Bomb');
  assert.equal(fx.levelCallout.level, 7, 'the level-up is the one showing');
  assert.equal(fx.calloutQueue.length, 1, 'and the unlock is waiting, not lost');

  // Run the showing one out. The queued one takes over rather than vanishing.
  updateEffects(fx, LEVEL_CALLOUT_SEC + 0.01);
  assert.equal(fx.levelCallout?.unlock, 'Bomb', 'the unlock is shown after the level-up');
  assert.equal(fx.calloutQueue.length, 0);

  updateEffects(fx, LEVEL_CALLOUT_SEC + 0.01);
  assert.equal(fx.levelCallout, null, 'and then the board is clear');
}

// --- 5b. when the queue overflows, a level-up is what gets dropped ---------
// A level-up happens again next level. A teach or an unlock happens once in
// the life of a save, so neither may ever be the casualty.
{
  const fx = createEffects();
  triggerTeach(fx, STONE_TEACH_TITLE, STONE_TEACH_LINE); // shows immediately
  triggerLevelUp(fx, 3);
  triggerLevelUp(fx, 4);
  triggerUnlock(fx, 'Swap');
  triggerTeach(fx, CRACK_TEACH_TITLE, CRACK_TEACH_LINE);

  const kinds = fx.calloutQueue.map((e) => e.callout.kind);
  assert.ok(kinds.length <= 2, 'the queue is capped so callouts cannot become a parade');
  assert.ok(!kinds.includes('level'),
    `a level-up must be dropped before a once-ever callout (queue held ${kinds.join()})`);
  assert.ok(kinds.includes('teach'), 'the second teach survived');
  assert.ok(kinds.includes('unlock'), 'and so did the unlock');
}

// --- 5c. a teach carries no shake and no extra noise -----------------------
// It rides an event that already fired a cue. A third one on top reads as a
// glitch, not as emphasis.
{
  const fx = createEffects();
  triggerTeach(fx, STONE_TEACH_TITLE, STONE_TEACH_LINE);
  assert.equal(fx.shake.magnitude, 0, 'a teach must not shake the board');
  assert.equal(fx.levelCallout.kind, 'teach');
  assert.equal(fx.levelCallout.teach, STONE_TEACH_TITLE);
  assert.equal(fx.levelCallout.line, STONE_TEACH_LINE);
}

// --- 6. the copy is short enough to be readable on the narrowest board ------
// render.js shrinks the body line to fit, down to 11px. That is a safety net,
// not a licence: if the copy needs 11px to fit it is too long to read in the
// 1.2s the callout is on screen. Bold 17px averages ~0.55em per character in
// the shipped stack, so this is the budget at full size with the same 24px of
// margin drawLevelCallout leaves.
{
  const budget = Math.floor((BOARD_WIDTH - 24) / (17 * 0.55));
  for (const [what, line] of [['stone', STONE_TEACH_LINE], ['crack', CRACK_TEACH_LINE]]) {
    assert.ok(line.length > 0, `${what}: there is a rule to show`);
    assert.ok(line.length <= budget,
      `${what}: "${line}" is ${line.length} chars, budget is ${budget} at full size`);
  }
  for (const t of [STONE_TEACH_TITLE, CRACK_TEACH_TITLE]) {
    assert.ok(t.length > 0 && t.length <= 12, `"${t}" must be a short word at 40px`);
  }
}

console.log('teach: the stone is explained once -- the rule on the first rise that brings one, the confirmation on the first one broken -- recorded in the save so a returning player is not re-taught and a pre-21.1 save still is; plus the callout queue that stops two callouts in one batch from eating each other, dropping a repeatable level-up rather than a once-ever lesson');
