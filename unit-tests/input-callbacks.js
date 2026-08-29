// Regression test for 1.4, updated for the phase-1 brief's revised contract:
// the callbacks parameter is gone. attachInput now takes exactly (canvas,
// state), and bomb/remover/locked-power-up feedback all ride state.events --
// the same queue main.js already drains everything else from.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CANVAS_WIDTH, HUD_HEIGHT, CELL, POWER_SLOT, powerSlotRect } from '../js/constants.js';
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

assert.equal(attachInput.length, 2, 'attachInput should no longer declare a callbacks parameter');

// Bomb: place a fruit, arm the bomb, tap its cell -- event rides state.events.
{
  const state = freshState();
  state.grid[0][0] = 0;
  state.bombArmed = true;
  state.inventory.bomb = 1;
  const canvas = makeFakeCanvas(state);
  attachInput(canvas, state);
  canvas.fire('pointerdown', { clientX: 0 * CELL + CELL / 2, clientY: HUD_HEIGHT + 0 * CELL + CELL / 2 });
  const events = state.events.filter((e) => e.type === 'bombCleared');
  assert.equal(events.length, 1, 'a bombCleared event should be pushed when a bomb clears fruit');
  assert.ok(events[0].cells.length >= 1, 'the event should carry the cleared cells');
}

// Remover: place a fruit, arm the remover, tap its cell.
{
  const state = freshState();
  state.grid[0][1] = 3;
  state.removerArmed = true;
  state.inventory.remover = 1;
  const canvas = makeFakeCanvas(state);
  attachInput(canvas, state);
  canvas.fire('pointerdown', { clientX: 1 * CELL + CELL / 2, clientY: HUD_HEIGHT + 0 * CELL + CELL / 2 });
  const events = state.events.filter((e) => e.type === 'removerUsed');
  assert.equal(events.length, 1, 'a removerUsed event should be pushed when the remover removes a fruit');
  assert.deepEqual(
    { row: events[0].row, col: events[0].col, tier: events[0].tier },
    { row: 0, col: 1, tier: 3 },
    'the event should carry where and what was removed',
  );
}

// Locked power-up: magnet unlocks at a score this fresh state has not reached.
{
  const state = freshState();
  const canvas = makeFakeCanvas(state);
  attachInput(canvas, state);
  const magnetSlotRect = powerSlotRect(1); // [remover, magnet, bomb] -- see constants.POWERUPS order
  canvas.fire('pointerdown', {
    clientX: magnetSlotRect.x + POWER_SLOT.size / 2,
    clientY: magnetSlotRect.y + POWER_SLOT.size / 2,
  });
  const events = state.events.filter((e) => e.type === 'lockedPowerUp');
  assert.equal(events.length, 1, 'a lockedPowerUp event should be pushed for a locked/out-of-stock slot');
  assert.equal(events[0].id, 'magnet');
  assert.equal(events[0].unlockScore, 1000);
}

console.log('input.js: bomb, remover, and locked-power-up all push their event onto state.events');

// --- Is the shipped main.js actually wired to all three? -------------------

const mainSrc = readFileSync(path.join(repoRoot, 'js/main.js'), 'utf8');

const attachInputCall = mainSrc.match(/attachInput\(([^)]*)\)/);
assert.ok(attachInputCall, 'main.js should call attachInput');
const argCount = attachInputCall[1].split(',').filter((s) => s.trim()).length;
assert.equal(argCount, 2, 'main.js should call attachInput with exactly (canvas, state) -- no callbacks object');

for (const eventType of ['bombCleared', 'removerUsed', 'lockedPowerUp']) {
  assert.ok(mainSrc.includes(`'${eventType}'`), `main.js's drainEvents should handle a '${eventType}' event`);
}

console.log('main.js: attachInput called with (canvas, state); drainEvents handles all three event types');
