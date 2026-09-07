// 20: an unlock is announced the moment it is earned.
//
// Reported after real play, twice over: "as the power ups unlock, announce
// it -- give it a glow where the player knows he has access to this arsenal",
// and separately that two runs of 4,447 and 6,039 each unlocked SIX things at
// once. Both come from the same place: every unlock used to be computed in
// endRun and revealed only on the results screen, and skins and power-ups sat
// on the SAME three thresholds so each one fired two rewards.
import assert from 'node:assert/strict';
import {
  createInitialState, startRun, addScore, toSaveBlob, pendingUnlocks, clearPendingUnlocks,
} from '../js/state.js';
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
  // Either a clear step up in ratio, OR a big absolute gap -- at the top of
  // the ladder 13,000 -> 18,000 is only 1.38x but it is five thousand points,
  // which is most of a good run. Bunching is what this guards against, not
  // arithmetic.
  for (let i = 1; i < all.length; i++) {
    const ratio = all[i] / all[i - 1];
    const gap = all[i] - all[i - 1];
    assert.ok(ratio >= 1.4 || gap >= 3000,
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

// --- 5. the game remembers what it has SHOWN, not just what you own -------
// The gap this closes, found from real play: when 20 re-spaced the milestone
// ladder, every existing save woke up already past thresholds it had never
// celebrated. One player loaded the new build owning five of six unlocks,
// having seen none of them arrive, and asked -- reasonably -- why the
// power-ups never announced themselves. Ownership was derived from highScore
// and nothing recorded whether the moment had been shown, so the game could
// not know it owed anything.
{
  // A save from before 21 records nothing, so everything earned is owed.
  const legacy = createInitialState({ highScore: 17550 });
  const owed = pendingUnlocks(legacy);
  assert.ok(owed.length > 0, 'a legacy save with a high score is owed the moments it never got');
  for (const item of owed) {
    assert.ok(legacy.highScore >= item.unlockScore, 'and only for things actually earned');
  }
  const names = owed.map((o) => o.name);
  assert.equal(names.length, new Set(names).size, 'each owed exactly once');
}
{
  // Paying the debt clears it, and it stays cleared across a save/load.
  const state = createInitialState({ highScore: 17550 });
  assert.ok(pendingUnlocks(state).length > 0, 'owed before');
  clearPendingUnlocks(state);
  assert.equal(pendingUnlocks(state).length, 0, 'and nothing is owed once shown');

  const blob = toSaveBlob(state, { musicOn: true, sfxOn: true, hapticsOn: true });
  assert.ok(Array.isArray(blob.announcedUnlocks) && blob.announcedUnlocks.length > 0,
    'the save records what was shown');
  assert.equal(pendingUnlocks(createInitialState(blob)).length, 0,
    'so it is never shown twice, across reloads');
}
{
  // Earning one in-run marks it shown, so the menu does not then repeat it.
  const state = createInitialState();
  startRun(state, {});
  state.events.length = 0;
  addScore(state, MILESTONE_SCORES[1]);
  const fired = state.events.filter((e) => e.type === 'unlocked');
  assert.equal(fired.length, 1, 'announced live');
  state.highScore = state.score;                  // what endRun would do
  const owed = pendingUnlocks(state).map((o) => o.id);
  assert.ok(!owed.includes(fired[0].id), 'and not owed again by the menu afterwards');
}
{
  // A power-up unlock pulses its own chip -- the entrance is the tool
  // arriving in the bar the player taps, not a line of text.
  const state = createInitialState();
  startRun(state, {});
  state.chipPulse = null;
  addScore(state, POWERUP_UNLOCK_SCORES[0]);
  assert.ok(state.chipPulse, 'a power-up unlock pulses a chip');
  assert.equal(state.chipPulse.id, POWERUPS.find((p) => p.unlockScore === POWERUP_UNLOCK_SCORES[0]).id,
    'and it is that power-up\'s own chip');
}

console.log('unlock-announce: the two ladders interleave and never share a score; crossing one announces exactly one reward, live, once, and pulses that power-up\'s own chip; and the game records what it has SHOWN, so a save that gained unlocks silently when the ladder moved is owed them on the next menu -- once');
