// Sound effects, synthesized at runtime with WebAudio.
//
// Deliberately no audio files: the whole sound design is a few oscillators
// and gain envelopes, which keeps the payload at zero bytes, sidesteps
// sample licensing entirely, and means there is nothing to swap out later.
//
// Browsers block audio until a user gesture, so the context is created lazily
// on the first tap/click via unlockAudio(). Every entry point is a no-op when
// audio is unavailable -- a game must never fail because sound failed.

import { MAX_TIER } from './constants.js';

let ctx = null;
let masterGain = null;
let muted = false;
let unavailable = false;
// Assumed enabled until main.js says otherwise (platform.audioEnabled(),
// read at boot and again on every platform.onAudioEnabledChange). This is
// the HOST's permission, separate from the player's own mute toggle above --
// both must be true for anything to be audible (phase 3.3's requirement) --
// and it is never written into the save; it belongs to the host, not to the
// player's persisted preferences.
let hostAudioEnabled = true;

// Sets the flag from the loaded save (main.js's boot, before the first
// frame). This module never reads storage itself -- see js/platform.js.
export function hydrate(save) {
  muted = save ? !save.sfxOn : false;
}

function targetGain() {
  return (muted || !hostAudioEnabled) ? 0 : 0.9;
}

export function setHostAudioEnabled(value) {
  hostAudioEnabled = Boolean(value);
  if (masterGain && ctx) {
    masterGain.gain.setTargetAtTime(targetGain(), ctx.currentTime, 0.01);
  }
}

// Called from the first user gesture. Safe to call repeatedly.
export function unlockAudio() {
  if (ctx || unavailable) {
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    return;
  }
  try {
    // NOTE: the resume() below is deliberately unconditional at the end of this
    // function. Resuming only on the early-return path above worked purely
    // because a window pointerdown listener always constructed the context
    // before the Play button's click handler ran; if that order ever changed,
    // iOS Safari would be left with a permanently suspended context and a
    // silent game.
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) {
      unavailable = true;
      return;
    }
    ctx = new AudioCtx();
    masterGain = ctx.createGain();
    masterGain.gain.value = targetGain();
    masterGain.connect(ctx.destination);
    // A context constructed outside a user gesture starts suspended; resume
    // unconditionally rather than relying on listener ordering.
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  } catch {
    unavailable = true;
  }
}

// Exposed so music.js can share this context rather than opening a second one
// (browsers cap contexts per page, and two would double the unlock problem).
export function getAudioContext() {
  return ctx;
}

export function isMuted() {
  return muted;
}

export function setMuted(value) {
  muted = Boolean(value);
  if (masterGain && ctx) {
    // Ramp rather than jump, so toggling mid-tone doesn't click.
    masterGain.gain.setTargetAtTime(targetGain(), ctx.currentTime, 0.01);
  }
}

export function toggleMuted() {
  setMuted(!muted);
  return muted;
}

// Suspend/resume the whole context -- used when the tab is hidden, and the
// hook a host platform's pause/resume command would drive.
export function suspendAudio() {
  if (ctx && ctx.state === 'running') ctx.suspend().catch(() => {});
}

export function resumeAudio() {
  if (ctx && ctx.state === 'suspended' && !muted) ctx.resume().catch(() => {});
}

function ready() {
  return ctx && masterGain && !muted && hostAudioEnabled && ctx.state === 'running';
}

// One short percussive blip: a sine with a fast pitch drop and quick decay.
function blip(freq, { duration = 0.16, type = 'sine', gain = 0.35, bendTo = null, delay = 0 } = {}) {
  if (!ready()) return;
  try {
    const start = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (bendTo !== null) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, bendTo), start + duration);
    }

    // Percussive envelope: near-instant attack, exponential tail.
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(gain, start + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, start + duration);

    osc.connect(env);
    env.connect(masterGain);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  } catch {
    // A failed sound must never interrupt gameplay.
  }
}

// Merge pop. Pitch climbs with tier so bigger merges read as more significant:
// one semitone per tier over the 9-tier range.
export function playMerge(tier) {
  const t = Math.max(0, Math.min(MAX_TIER, tier));
  const base = 320;
  const freq = base * Math.pow(2, t / 12);
  blip(freq, { duration: 0.14, type: 'sine', gain: 0.3, bendTo: freq * 0.6 });
}

// Reaching the top tier: a short rising arpeggio instead of a single pop.
export function playCelebration() {
  const root = 523.25; // C5
  const intervals = [0, 4, 7, 12, 16]; // major triad climbing into the octave
  intervals.forEach((semitones, i) => {
    blip(root * Math.pow(2, semitones / 12), {
      duration: 0.3,
      type: 'triangle',
      gain: 0.26,
      delay: i * 0.075,
    });
  });
}

// Small confirmation tick for shop purchases / skin selection.
export function playUiTick() {
  blip(660, { duration: 0.08, type: 'square', gain: 0.12, bendTo: 880 });
}

// A charge earned mid-run (8.1): a short, bright two-note rise. Distinct from
// playCelebration's five-note arpeggio -- that one means "you reached the top
// tier"; this one means "a free charge just became available".
export function playChargeEarned() {
  const root = 660;
  blip(root, { duration: 0.1, type: 'triangle', gain: 0.22 });
  blip(root * Math.pow(2, 7 / 12), { duration: 0.16, type: 'triangle', gain: 0.24, delay: 0.07 });
}

// A level-up (15): a short rising two-note cue, pitched above playChargeEarned
// so the two reward sounds never get mistaken for each other -- a charge is a
// tool becoming available, a level is the game itself moving up a notch.
export function playLevelUp() {
  const root = 880;
  blip(root, { duration: 0.11, type: 'triangle', gain: 0.24 });
  blip(root * Math.pow(2, 7 / 12), { duration: 0.18, type: 'triangle', gain: 0.26, delay: 0.08 });
}

// Descending tone when a run ends.
export function playGameOver() {
  blip(330, { duration: 0.5, type: 'triangle', gain: 0.28, bendTo: 110 });
}
