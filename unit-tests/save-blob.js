// Regression test for 2.2's size budget: "cap is 3 MiB, target 64 KiB for
// exit saves. This blob is under a kilobyte. Assert it anyway, so a future
// addition that blows the budget fails a test rather than a certification
// review."
import assert from 'node:assert/strict';
import { SAVE_VERSION } from '../js/constants.js';
import { createInitialState, toSaveBlob, startRun, buyPowerUp } from '../js/state.js';

const CAP_BYTES = 3 * 1024 * 1024;
const TARGET_BYTES = 64 * 1024;

const state = createInitialState(null);
startRun(state, {});
state.coins = 999999;
for (let i = 0; i < 6; i++) buyPowerUp(state, 'bomb', 0); // pad inventory a bit
state.unlockedSkins = ['classic', 'blossom', 'neon', 'midnight'];

const blob = toSaveBlob(state, { musicOn: true, sfxOn: false, hapticsOn: true });
assert.equal(blob.v, SAVE_VERSION);
assert.equal(blob.hapticsOn, true, 'toSaveBlob should carry hapticsOn through, added in phase 3.4');

const bytes = Buffer.byteLength(JSON.stringify(blob), 'utf8');
assert.ok(bytes < CAP_BYTES, `save blob is ${bytes} bytes, over the ${CAP_BYTES}-byte cap`);
assert.ok(bytes < TARGET_BYTES, `save blob is ${bytes} bytes, over the ${TARGET_BYTES}-byte target`);

console.log(`save-blob: ${bytes} bytes, well under the ${TARGET_BYTES}-byte target`);
