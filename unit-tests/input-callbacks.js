// Regression test for the "three dead input callbacks" bug: js/input.js calls
// callbacks.onBombUsed / onRemoverUsed / onLockedPowerUp, but as of this
// writing js/main.js still calls attachInput(canvas, state) with no third
// argument, so none of the three ever fire in the shipped game.
//
// Two things are checked separately, because they can be true independently:
//   1. Does input.js correctly invoke a callback it IS given? (tests input.js)
//   2. Does the shipped main.js actually give it one -- directly, or through
//      an equivalent mechanism (physics.js's state.events queue)? (tests main.js)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CANVAS_WIDTH, HUD_HEIGHT, CELL, POWER_SLOT, powerSlotRect,
} from '../js/constants.js';
import { canvasHeightFor } from '../js/render.js';
import { startRun } from '../js/state.js';
import { attachInput } from '../js/input.js';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function freshState() {
  const state = {
    inventory: { slowDrop: 0, extraRow: 0, rainbow: 0, remover: 0, magnet: 0, bomb: 0 },
    highScore: 0,
    coins: 0,
    unlockedSkins: ['classic'],
    events: [],
  };
  startRun(state, {});
  return state;
}

function makeFakeCanvas(state) {
  const listeners = {};
  return {
    style: {},
    addEventListener(type, fn) { listeners[type] = fn; },
    removeEventListener() {},
    getBoundingClientRect() {
      return { left: 0, top: 0, width: CANVAS_WIDTH, height: canvasHeightFor(state) };
    },
    fire(type, evt) { listeners[type](evt); },
  };
}

// --- 1. input.js's own dispatch, given callbacks directly -----------------

// Bomb: place a fruit, arm the bomb, tap its cell.
{
  const state = freshState();
  state.grid[0][0] = 0;
  state.bombArmed = true;
  state.inventory.bomb = 1;
  const calls = { bomb: [] };
  const canvas = makeFakeCanvas(state);
  attachInput(canvas, state, { onBombUsed: (cleared) => calls.bomb.push(cleared) });
  canvas.fire('pointerdown', { clientX: 0 * CELL + CELL / 2, clientY: HUD_HEIGHT + 0 * CELL + CELL / 2 });
  assert.equal(calls.bomb.length, 1, 'onBombUsed should fire once when a bomb clears fruit');
  assert.ok(calls.bomb[0].length >= 1, 'onBombUsed should receive the cleared cells');
}

// Remover: place a fruit, arm the remover, tap its cell.
{
  const state = freshState();
  state.grid[0][1] = 0;
  state.removerArmed = true;
  state.inventory.remover = 1;
  const calls = { remover: 0 };
  const canvas = makeFakeCanvas(state);
  attachInput(canvas, state, { onRemoverUsed: () => { calls.remover += 1; } });
  canvas.fire('pointerdown', { clientX: 1 * CELL + CELL / 2, clientY: HUD_HEIGHT + 0 * CELL + CELL / 2 });
  assert.equal(calls.remover, 1, 'onRemoverUsed should fire once when the remover removes a fruit');
}

// Locked power-up: magnet unlocks at a score this fresh state has not reached.
{
  const state = freshState();
  const calls = { locked: [] };
  const canvas = makeFakeCanvas(state);
  attachInput(canvas, state, { onLockedPowerUp: (item) => calls.locked.push(item.id) });
  const magnetSlotRect = powerSlotRect(1); // [remover, magnet, bomb] -- see constants.POWERUPS order
  canvas.fire('pointerdown', {
    clientX: magnetSlotRect.x + POWER_SLOT.size / 2,
    clientY: magnetSlotRect.y + POWER_SLOT.size / 2,
  });
  assert.deepEqual(calls.locked, ['magnet'], 'onLockedPowerUp should fire for a locked/out-of-stock slot');
}

console.log('input.js dispatch: all three callbacks fire correctly when supplied');

// --- 2. Does the shipped main.js actually supply them? --------------------

const mainSrc = readFileSync(path.join(repoRoot, 'js/main.js'), 'utf8');
const physicsSrc = readFileSync(path.join(repoRoot, 'js/physics.js'), 'utf8');

const attachInputCall = mainSrc.match(/attachInput\(([^)]*)\)/);
assert.ok(attachInputCall, 'main.js should call attachInput');
const argCount = attachInputCall[1].split(',').length;

const bombHasEventPath = physicsSrc.includes("type: 'bombCleared'") && mainSrc.includes("'bombCleared'");
const removerHasEventPath = physicsSrc.includes("type: 'removerUsed'") || mainSrc.includes("'removerUsed'");
const lockedHasEventPath = physicsSrc.includes("type: 'lockedPowerUp'") || mainSrc.includes("'lockedPowerUp'");

console.log(`main.js calls attachInput with ${argCount} argument(s) (3 needed to wire callbacks directly)`);
console.log(`bomb feedback wired some other way (state.events)?    ${bombHasEventPath}`);
console.log(`remover feedback wired some other way (state.events)? ${removerHasEventPath}`);
console.log(`locked-power-up feedback wired some other way?        ${lockedHasEventPath}`);

assert.ok(
  argCount >= 3 || bombHasEventPath,
  'bomb feedback is dead: main.js passes no callbacks AND physics.js has no bombCleared event path',
);
assert.ok(
  argCount >= 3 || removerHasEventPath,
  'onRemoverUsed is dead: main.js never passes callbacks to attachInput, and no equivalent state.events path exists for the remover',
);
assert.ok(
  argCount >= 3 || lockedHasEventPath,
  'onLockedPowerUp is dead: main.js never passes callbacks to attachInput, and no equivalent state.events path exists for locked power-ups',
);
