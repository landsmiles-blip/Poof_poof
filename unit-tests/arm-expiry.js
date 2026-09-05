// Regression tests for 18: an armed Remover/Swap must never hold the falling
// fruit hostage for the rest of a run.
//
// The bug, reproduced in a real browser before this fix: arm the Remover, tap
// an empty cell. The removal fails, so consumeRemover never runs, so the tool
// stays armed -- which is CORRECT and deliberate (unit-tests/input-callbacks.js
// asserts that tapping empty space must not cost a charge). But js/input.js
// reads every board gesture as aiming while armed and returns before it ever
// reaches the steering code, so the fruit kept falling and could not be moved
// at all. pauseRun did not clear it, and a phone has no Escape key, so the run
// was simply dead. These tests pin the bound that fixes it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CANVAS_WIDTH, HUD_HEIGHT, CELL, ARM_EXPIRY_DROPS, powerSlotRect } from '../js/constants.js';
import { canvasHeightFor } from '../js/render.js';
import { startRun, armRemover, armSwap, expireArmedPowerUp } from '../js/state.js';
import { spawnFruit, hardDrop } from '../js/physics.js';
import { attachInput } from '../js/input.js';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function freshState() {
  const state = {
    inventory: { slowDrop: 0, extraRow: 0, rainbow: 0, remover: 5, swap: 5, bomb: 0 },
    highScore: 5000, // everything unlocked, so arming is never refused
    coins: 0,
    unlockedSkins: ['classic'],
    events: [],
  };
  startRun(state, {});
  state.dirty = false;
  return state;
}

function makeFakeCanvas(state) {
  const listeners = {};
  return {
    style: {},
    addEventListener(type, fn) { listeners[type] = fn; },
    removeEventListener() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: CANVAS_WIDTH, height: canvasHeightFor(state) }; },
    fire(type, evt) { listeners[type](evt); },
  };
}

// Place a fruit so spawnIndex advances the way a real drop does.
function playOneDrop(state) {
  if (spawnFruit(state).blocked) return false;
  state.active.x = 0 * CELL + CELL / 2;
  hardDrop(state);
  return true;
}

// --- 1. expireArmedPowerUp: the bound itself --------------------------------
{
  const state = freshState();
  armRemover(state, true);
  assert.equal(state.removerArmed, true, 'arming should arm');
  assert.equal(state.armedAtSpawnIndex, state.spawnIndex, 'arming stamps the drop it happened on');

  // One drop short of the limit: still armed, so a player mid-gesture is safe.
  state.spawnIndex = state.armedAtSpawnIndex + ARM_EXPIRY_DROPS - 1;
  assert.equal(expireArmedPowerUp(state), false, 'must not expire before the limit');
  assert.equal(state.removerArmed, true, 'still armed one drop short of the limit');

  // At the limit: control comes back.
  state.spawnIndex = state.armedAtSpawnIndex + ARM_EXPIRY_DROPS;
  assert.equal(expireArmedPowerUp(state), true, 'should expire once the limit is reached');
  assert.equal(state.removerArmed, false, 'the arm is released');
  assert.equal(state.armedAtSpawnIndex, null, 'and the stamp is cleared');
}

// Nothing armed is a cheap no-op, and it never throws on a fresh state.
{
  const state = freshState();
  assert.equal(expireArmedPowerUp(state), false, 'nothing armed -> nothing to expire');
}

// Swap expires the same way, and takes any half-made selection with it.
{
  const state = freshState();
  armSwap(state, true);
  state.swapSelectedCell = { row: 0, col: 0 };
  state.spawnIndex = state.armedAtSpawnIndex + ARM_EXPIRY_DROPS;
  assert.equal(expireArmedPowerUp(state), true, 'swap expires too');
  assert.equal(state.swapArmed, false, 'swap disarmed');
  assert.equal(state.swapSelectedCell, null, 'a dangling half-selection is cleared with it');
}

// --- 2. THE headline: an unused arm cannot kill a run -----------------------
// Reproduces the exact reported sequence -- arm, tap empty space, try to steer.
{
  const state = freshState();
  const canvas = makeFakeCanvas(state);
  attachInput(canvas, state);

  spawnFruit(state); // something is falling
  assert.ok(state.active, 'a fruit should be falling');

  // Arm the Remover via its real chip, exactly as a thumb would.
  const slot = powerSlotRect(0);
  canvas.fire('pointerdown', { clientX: slot.x + slot.w / 2, clientY: slot.y + slot.h / 2 });
  canvas.fire('pointerup', {});
  assert.equal(state.removerArmed, true, 'the chip arms the remover');

  // Tap an EMPTY cell: the removal fails, no charge is spent, and -- by
  // design -- the tool stays armed.
  canvas.fire('pointerdown', { clientX: 5 * CELL + CELL / 2, clientY: HUD_HEIGHT + 0 * CELL + CELL / 2 });
  canvas.fire('pointerup', {});
  assert.equal(state.removerArmed, true, 'tapping empty space must not consume the charge (existing, deliberate behaviour)');

  // This is the trap: while armed, dragging does NOT steer the falling fruit.
  const before = state.active.targetX;
  canvas.fire('pointerdown', { clientX: 3 * CELL + CELL / 2, clientY: HUD_HEIGHT + 7 * CELL });
  canvas.fire('pointermove', { clientX: 0 * CELL + CELL / 2, clientY: HUD_HEIGHT + 7 * CELL });
  canvas.fire('pointerup', {});
  assert.equal(state.active.targetX, before, 'documents the trap: while armed, a drag does not steer');

  // ...but it is now BOUNDED. Play on; within ARM_EXPIRY_DROPS the arm is
  // released and steering works again. Before this fix it never came back.
  for (let i = 0; i < ARM_EXPIRY_DROPS; i++) playOneDrop(state);
  assert.equal(state.removerArmed, false, 'the unused arm must expire so the player gets control back');

  spawnFruit(state);
  const before2 = state.active.targetX;
  canvas.fire('pointerdown', { clientX: 3 * CELL + CELL / 2, clientY: HUD_HEIGHT + 7 * CELL });
  canvas.fire('pointermove', { clientX: 0 * CELL + CELL / 2, clientY: HUD_HEIGHT + 7 * CELL });
  canvas.fire('pointerup', {});
  assert.notEqual(state.active.targetX, before2, 'steering must work again once the arm has expired');
}

// --- 3. A real two-tap Swap still completes inside the window ---------------
// The bound must not be so tight that it eats a legitimate gesture.
{
  const state = freshState();
  state.grid[0][0] = 3;
  state.grid[0][1] = 5;
  armSwap(state, true);
  const canvas = makeFakeCanvas(state);
  attachInput(canvas, state);

  const tap = (row, col) => {
    canvas.fire('pointerdown', { clientX: col * CELL + CELL / 2, clientY: HUD_HEIGHT + row * CELL + CELL / 2 });
    canvas.fire('pointerup', {});
  };
  tap(0, 0);
  playOneDrop(state); // a drop passes between the two taps, as it would in play
  tap(0, 1);
  assert.equal(state.grid[0][0], 5, 'a two-tap swap spanning a drop must still complete');
  assert.equal(state.grid[0][1], 3, 'a two-tap swap spanning a drop must still complete');
}

// --- 4. Pausing cancels an aim (the instinctive escape hatch) ---------------
// pauseRun lives in main.js and is not importable, so this is a source check --
// the same shape input-callbacks.js already uses for main.js wiring.
{
  const mainSrc = readFileSync(path.join(repoRoot, 'js/main.js'), 'utf8');
  const pauseBody = mainSrc.slice(mainSrc.indexOf('function pauseRun()'));
  const body = pauseBody.slice(0, pauseBody.indexOf('\n}'));
  assert.ok(/state\.removerArmed\s*=\s*false/.test(body), 'pauseRun should clear removerArmed');
  assert.ok(/state\.swapArmed\s*=\s*false/.test(body), 'pauseRun should clear swapArmed');
  assert.ok(/state\.armedAtSpawnIndex\s*=\s*null/.test(body), 'pauseRun should clear the arm stamp');
}

console.log('arm-expiry: an unused Remover/Swap arm expires, pausing cancels it, and a real two-tap swap still completes');
