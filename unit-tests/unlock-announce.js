// 20: an unlock is announced the moment it is earned.
//
// Reported after real play, twice over: "as the power ups unlock, announce
// it -- give it a glow where the player knows he has access to this arsenal",
// and separately that two runs of 4,447 and 6,039 each unlocked SIX things at
// once. Both come from the same place: every unlock used to be computed in
// endRun and revealed only on the results screen, and skins and power-ups sat
// on the SAME three thresholds so each one fired two rewards.
import assert from 'node:assert/strict';
import { createInitialState, startRun, addScore } from '../js/state.js';
import { SKINS, POWERUPS, MILESTONE_SCORES, POWERUP_UNLOCK_SCORES } from '../js/constants.js';

const unlockEvents = (state) => state.events.filter((e) => e.type === 'unlocked');

// --- 1. the two ladders never land on the same score -------------------------
// This is the fix for "six things at once": if a palette and a power-up share
// a threshold, one milestone is always two rewards.
{
  const skins = SKINS.map((k) => k.unlockScore).filter((v) => v > 0);
  const powers = POWERUPS.map((p) => p.unlockScore).filter((v) => v > 0);
  for (const s of skins) {
    assert.ok(!powers.includes(s),
      `a palette and a power-up must never unlock at the same score (both at ${s})`);
  }
  const all = [...skins, ...powers].sort((a, b) => a - b);
  assert.equal(new Set(all).size, all.length, 'every unlock threshold is distinct');
  // And they should genuinely interleave rather than clumping into two runs.
  for (let i = 1; i < all.length; i++) {
    assert.ok(all[i] >= all[i - 1] * 1.4,
      `thresholds must be spread, not bunched (${all[i - 1]} -> ${all[i]})`);
  }
}

// --- 2. crossing a threshold announces it, once, mid-run ---------------------
{
  const state = createInitialState();
  startRun(state, {});
  state.events.length = 0;

  const first = MILESTONE_SCORES[1];
  addScore(state, first - 1);
  assert.equal(unlockEvents(state).length, 0, 'one point short is not an unlock');

  addScore(state, 1);
  const fired = unlockEvents(state);
  assert.equal(fired.length, 1, 'crossing the threshold announces exactly one reward');
  assert.equal(fired[0].score, first, 'and names the threshold it crossed');
  assert.ok(fired[0].name, 'and carries a name for the callout to show');

  state.events.length = 0;
  addScore(state, 50);
  assert.equal(unlockEvents(state).length, 0, 'it does not announce again on the next merge');
}

// --- 3. nothing is announced twice across runs -------------------------------
// The announcement is cosmetic; endRun still owns the real bookkeeping off
// highScore. A player who already owns a reward must not be told they earned
// it again every run.
{
  const state = createInitialState();
  state.highScore = POWERUP_UNLOCK_SCORES[1]; // already past the first few
  startRun(state, {});
  state.events.length = 0;
  addScore(state, POWERUP_UNLOCK_SCORES[1]);
  assert.equal(unlockEvents(state).length, 0,
    'a reward the player already owns is never re-announced');
}

// --- 4. a huge single jump announces everything it passed --------------------
// A big cascade can add thousands of points in one call. Each threshold it
// crosses is a real unlock and each has to be reported, in order.
{
  const state = createInitialState();
  startRun(state, {});
  state.events.length = 0;
  const top = Math.max(...SKINS.map((k) => k.unlockScore), ...POWERUPS.map((p) => p.unlockScore));
  addScore(state, top);
  const fired = unlockEvents(state);
  const expected = [...SKINS, ...POWERUPS].filter((i) => i.unlockScore > 0).length;
  assert.equal(fired.length, expected, 'every threshold the jump passed is announced');
  const scores = fired.map((e) => e.score);
  assert.deepEqual(scores, [...scores].sort((a, b) => a - b), 'and in ascending order');
}

console.log('unlock-announce: palettes and power-ups sit on separate, interleaved, spread-out ladders; crossing a threshold announces exactly one reward at the moment it happens, never twice, and never one the player already owned');
