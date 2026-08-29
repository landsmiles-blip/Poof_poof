// Background music.
//
// The track is GENERATED, not sampled, and that is not just a build-time
// convenience -- a recorded-track path was removed in phase 5's compliance
// sweep. It loaded the file over the network, which is prohibited outright
// (no such requests are allowed; all game data ships in the bundle), and
// that was true regardless of whether the feature was ever actually
// exercised -- an unset URL constant does not make the network-loading call
// disappear from the shipped file. Generating the track is also just the
// better answer for this game: the payload stays at zero bytes, and because the
// music is original by construction there is no attribution to carry, no
// licence to honour, and nothing that can be claimed against the game later
// on a storefront.
//
// Musically this is a slow four-chord loop in A minor pentatonic: a soft pad
// holding the chord, plus a sparse arpeggio picking notes out of it. Notes are
// scheduled ahead of time against the AudioContext clock rather than from
// setInterval, because timer jitter at these tempos is audible.

let ctx = null;
let musicGain = null;
let unavailable = false;
let playing = false;
let musicOn = true;
// Assumed enabled until main.js says otherwise -- see js/audio.js's
// hostAudioEnabled for the full rationale (host permission, ANDed with the
// player's own musicOn toggle, never persisted).
let hostAudioEnabled = true;

// Sets the flag from the loaded save (main.js's boot, before the first
// frame). This module never reads storage itself -- see js/platform.js.
export function hydrate(save) {
  musicOn = save ? save.musicOn !== false : true;
}

export function setHostAudioEnabled(value) {
  hostAudioEnabled = Boolean(value);
  if (!ctx || !musicGain || unavailable) return;
  if (!hostAudioEnabled) {
    fadeTo(0, 0.2);
  } else if (playing && musicOn) {
    fadeTo(MUSIC_VOLUME, 0.5);
  }
}

let schedulerId = null;
let nextNoteTime = 0;
let step = 0;

// Kept well under the sound effects so merges always cut through.
const MUSIC_VOLUME = 0.16;
const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD_SEC = 0.2;
const BPM = 72;
const STEP_SEC = 60 / BPM / 2; // eighth notes

// A minor pentatonic. Four bars, one chord each.
const CHORDS = [
  [220.0, 261.63, 329.63], // Am
  [196.0, 246.94, 293.66], // G
  [174.61, 220.0, 261.63], // F
  [164.81, 196.0, 246.94], // Em
];
const ARP = [440.0, 523.25, 587.33, 659.25, 783.99];
const STEPS_PER_CHORD = 8;

export function isMusicOn() {
  return musicOn;
}

export function toggleMusic() {
  setMusicOn(!musicOn);
  return musicOn;
}

export function setMusicOn(value) {
  musicOn = Boolean(value);
  if (!musicOn) {
    stopMusic();
  } else if (playing) {
    startMusic(); // restart if we were meant to be playing
  }
  return musicOn;
}

// Shares the page's AudioContext when audio.js already made one, so both do not
// fight over the browser's per-page context limit.
export function attachContext(sharedCtx) {
  if (!sharedCtx || ctx) return;
  try {
    ctx = sharedCtx;
    musicGain = ctx.createGain();
    musicGain.gain.value = 0;
    musicGain.connect(ctx.destination);
  } catch {
    unavailable = true;
  }
}

function ready() {
  return ctx && musicGain && !unavailable && hostAudioEnabled;
}

function fadeTo(value, seconds) {
  if (!ready()) return;
  try {
    const now = ctx.currentTime;
    musicGain.gain.cancelScheduledValues(now);
    musicGain.gain.setValueAtTime(musicGain.gain.value, now);
    musicGain.gain.linearRampToValueAtTime(value, now + seconds);
  } catch {
    // A failed fade must never interrupt gameplay.
  }
}

// One soft pad note: a detuned pair with a long, gentle envelope.
function padNote(freq, startAt, duration) {
  try {
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, startAt);
    env.gain.linearRampToValueAtTime(0.28, startAt + duration * 0.35);
    env.gain.linearRampToValueAtTime(0.0001, startAt + duration);
    env.connect(musicGain);

    for (const detune of [-4, 4]) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, startAt);
      osc.detune.setValueAtTime(detune, startAt);
      osc.connect(env);
      osc.start(startAt);
      osc.stop(startAt + duration + 0.05);
    }
  } catch {
    // ignore
  }
}

function arpNote(freq, startAt) {
  try {
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, startAt);
    env.gain.exponentialRampToValueAtTime(0.16, startAt + 0.02);
    env.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.5);
    env.connect(musicGain);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, startAt);
    osc.connect(env);
    osc.start(startAt);
    osc.stop(startAt + 0.55);
  } catch {
    // ignore
  }
}

function scheduleStep(index, time) {
  const chordIndex = Math.floor(index / STEPS_PER_CHORD) % CHORDS.length;
  const withinChord = index % STEPS_PER_CHORD;

  // Pad restates on the first beat of each chord.
  if (withinChord === 0) {
    for (const f of CHORDS[chordIndex]) {
      padNote(f, time, STEP_SEC * STEPS_PER_CHORD * 0.95);
    }
  }

  // Sparse arpeggio: a few offbeats per bar, so it breathes rather than chugs.
  if (withinChord === 2 || withinChord === 5 || withinChord === 7) {
    const note = ARP[(index * 3 + chordIndex) % ARP.length];
    arpNote(note, time);
  }
}

function scheduler() {
  if (!ready() || !playing) return;
  try {
    while (nextNoteTime < ctx.currentTime + SCHEDULE_AHEAD_SEC) {
      scheduleStep(step, nextNoteTime);
      nextNoteTime += STEP_SEC;
      step += 1;
    }
  } catch {
    // ignore
  }
}

export function startMusic() {
  if (!ready() || !musicOn) return;
  stopMusic(true);
  playing = true;
  step = 0;
  nextNoteTime = ctx.currentTime + 0.08;
  schedulerId = setInterval(scheduler, LOOKAHEAD_MS);
  fadeTo(MUSIC_VOLUME, 2.0);
}

export function stopMusic(immediate = false) {
  playing = false;
  if (schedulerId !== null) {
    clearInterval(schedulerId);
    schedulerId = null;
  }
  if (ready()) fadeTo(0, immediate ? 0.01 : 1.2);
}

export function isPlaying() {
  return playing;
}

// Clears just the JS timer, leaving `playing` and the AudioContext untouched
// -- used by platform.onPause. Distinct from stopMusic(), which also fades
// out and stops any recorded-track source: suspendAudio() (js/audio.js)
// freezes the whole context, so nothing needs fading here, but the interval
// itself keeps firing on the wall clock regardless of context state and must
// be stopped explicitly.
export function pauseScheduler() {
  if (schedulerId !== null) {
    clearInterval(schedulerId);
    schedulerId = null;
  }
}

// Resets the scheduling clock to "now", exactly like startMusic() does,
// before restarting -- otherwise nextNoteTime is still wherever it was when
// paused, ctx.currentTime has jumped forward by the whole pause duration, and
// the while loop in scheduler() dumps every missed step at once as an
// audible burst.
export function resumeScheduler() {
  if (!playing || !ready()) return;
  step = 0;
  nextNoteTime = ctx.currentTime + 0.08;
  if (schedulerId === null) schedulerId = setInterval(scheduler, LOOKAHEAD_MS);
}
