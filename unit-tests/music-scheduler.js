// Regression test for 4.4 (closing the gap phase 3 left open): the
// music-scheduler trap. setInterval fires on the wall clock regardless of
// AudioContext suspension, so if pauseScheduler() didn't really clear it, or
// resumeScheduler() didn't reset the scheduling clock to "now", the first
// tick after a resume would see nextNoteTime far behind ctx.currentTime and
// dump every missed step at once as an audible burst. Playwright has no
// inspection surface for "was there an audible burst"; this is a stubbed
// AudioContext with a clock this test controls directly.
import assert from 'node:assert/strict';
import {
  attachContext, startMusic, stopMusic, isPlaying, isMusicOn,
  pauseScheduler, resumeScheduler, setHostAudioEnabled, setMusicOn,
} from '../js/music.js';

function makeFakeAudioContext() {
  let time = 0;
  let oscillatorCount = 0;
  const noopParam = () => ({
    value: 0,
    setValueAtTime() {},
    linearRampToValueAtTime() {},
    exponentialRampToValueAtTime() {},
    cancelScheduledValues() {},
  });
  return {
    get currentTime() { return time; },
    advance(sec) { time += sec; },
    get oscillatorCount() { return oscillatorCount; },
    resetCount() { oscillatorCount = 0; },
    createGain() { return { gain: noopParam(), connect() {} }; },
    createOscillator() {
      oscillatorCount += 1;
      return {
        type: 'sine',
        frequency: noopParam(),
        detune: noopParam(),
        connect() {},
        start() {},
        stop() {},
      };
    },
    destination: {},
  };
}

const fakeCtx = makeFakeAudioContext();
setHostAudioEnabled(true);
if (!isMusicOn()) setMusicOn(true);
attachContext(fakeCtx);
startMusic();
assert.equal(isPlaying(), true, 'music should be playing against the fake context');

// Let at least one real scheduler tick happen so something has been scheduled
// (LOOKAHEAD_MS is 25ms; give it real wall-clock time to fire).
await new Promise((r) => setTimeout(r, 60));
assert.ok(fakeCtx.oscillatorCount > 0, 'the running scheduler should have scheduled at least one note by now');

// Pause: must actually clear the interval. Advance the fake clock 30 seconds
// of AudioContext time while paused.
pauseScheduler();
fakeCtx.advance(30);
fakeCtx.resetCount();
await new Promise((r) => setTimeout(r, 60)); // if the interval were NOT cleared, a tick would land here
assert.equal(fakeCtx.oscillatorCount, 0, 'a paused scheduler must not schedule anything at all, even after the clock jumps');

// Resume: must reset the scheduling clock to "now" before restarting, not
// try to catch up on the 30 seconds it was not looking.
resumeScheduler();
await new Promise((r) => setTimeout(r, 60)); // one lookahead window's worth of real time
const notesOnFirstTick = fakeCtx.oscillatorCount;
// One pad note is 2 oscillators (a detuned pair); one arpeggio note is 1.
// A single lookahead window covers at most a couple of steps.
assert.ok(notesOnFirstTick > 0 && notesOnFirstTick <= 6,
  `resume scheduled ${notesOnFirstTick} oscillator(s) on its first tick -- ` +
  'the missed-steps burst the music-scheduler trap describes would produce far more than that');

stopMusic(true);
console.log(`music-scheduler: silent across a 30s clock jump while paused; resume scheduled only ${notesOnFirstTick} oscillator(s), not a burst`);
