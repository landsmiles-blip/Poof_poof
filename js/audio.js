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

// Merge pop: tactile percussive attack snap + warm resonant harmonic body.
// Pitch climbs musically across tiers with sparkling overtones at higher tiers for dopamine escalation.
export function playMerge(tier) {
  if (!ready()) return;
  try {
    const t = Math.max(0, Math.min(MAX_TIER, tier));
    const now = ctx.currentTime;

    // Musical scale across tiers 0..8: C4 (261.6Hz) to G5 (784Hz)
    const scale = [261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33, 659.25, 783.99];
    const baseFreq = scale[t] || (261.63 * Math.pow(2, t / 8));

    // 1. Tactile percussive "snap" transient (punchy physical contact)
    const snap = ctx.createOscillator();
    const snapEnv = ctx.createGain();
    snap.type = 'sine';
    snap.frequency.setValueAtTime(baseFreq * 2.8, now);
    snap.frequency.exponentialRampToValueAtTime(baseFreq * 0.9, now + 0.022);

    snapEnv.gain.setValueAtTime(0.0001, now);
    snapEnv.gain.linearRampToValueAtTime(0.24, now + 0.003);
    snapEnv.gain.exponentialRampToValueAtTime(0.0001, now + 0.035);

    snap.connect(snapEnv);
    snapEnv.connect(masterGain);
    snap.start(now);
    snap.stop(now + 0.04);

    // 2. Warm resonant harmonic body (juicy acoustic pop)
    const body = ctx.createOscillator();
    const bodyEnv = ctx.createGain();
    body.type = 'sine';
    body.frequency.setValueAtTime(baseFreq * 1.15, now);
    body.frequency.exponentialRampToValueAtTime(baseFreq, now + 0.038);
    body.frequency.exponentialRampToValueAtTime(baseFreq * 0.75, now + 0.13);

    bodyEnv.gain.setValueAtTime(0.0001, now);
    bodyEnv.gain.linearRampToValueAtTime(0.32, now + 0.005);
    bodyEnv.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);

    body.connect(bodyEnv);
    bodyEnv.connect(masterGain);
    body.start(now);
    body.stop(now + 0.16);

    // 3. For mid-to-high tiers (t >= 3), add a sparkling harmonic shimmer overtone
    if (t >= 3) {
      const chime = ctx.createOscillator();
      const chimeEnv = ctx.createGain();
      chime.type = 'triangle';
      chime.frequency.setValueAtTime(baseFreq * 2, now + 0.01);
      chimeEnv.gain.setValueAtTime(0.0001, now + 0.01);
      chimeEnv.gain.linearRampToValueAtTime(0.14 + (t / MAX_TIER) * 0.10, now + 0.018);
      chimeEnv.gain.exponentialRampToValueAtTime(0.0001, now + 0.16 + (t / MAX_TIER) * 0.08);

      chime.connect(chimeEnv);
      chimeEnv.connect(masterGain);
      chime.start(now + 0.01);
      chime.stop(now + 0.26);
    }
  } catch {
    // A failed sound must never interrupt gameplay.
  }
}

// Reaching the top tier (Watermelon): climbing major arpeggio with shimmering chime harmonics.
export function playCelebration() {
  if (!ready()) return;
  try {
    const root = 523.25; // C5
    const intervals = [0, 4, 7, 12, 16]; // C5, E5, G5, C6, E6
    const now = ctx.currentTime;
    intervals.forEach((semitones, i) => {
      const freq = root * Math.pow(2, semitones / 12);
      const t = now + i * 0.075;
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);
      env.gain.setValueAtTime(0.0001, t);
      env.gain.linearRampToValueAtTime(0.24, t + 0.01);
      env.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      osc.connect(env);
      env.connect(masterGain);
      osc.start(t);
      osc.stop(t + 0.38);

      const chime = ctx.createOscillator();
      const chimeEnv = ctx.createGain();
      chime.type = 'triangle';
      chime.frequency.setValueAtTime(freq * 2, t);
      chimeEnv.gain.setValueAtTime(0.0001, t);
      chimeEnv.gain.linearRampToValueAtTime(0.12, t + 0.012);
      chimeEnv.gain.exponentialRampToValueAtTime(0.0001, t + 0.30);
      chime.connect(chimeEnv);
      chimeEnv.connect(masterGain);
      chime.start(t);
      chime.stop(t + 0.35);
    });
  } catch {
    // Safe no-op
  }
}

// Deeply satisfying organic wooden-marimba / juicy bubble-pop acoustic tap for UI clicks/taps.
export function playUiTick() {
  if (!ready()) return;
  try {
    const now = ctx.currentTime;

    // 1. Organic wooden/marimba tap body: sine pitch drop from 940Hz to 430Hz
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(940, now);
    osc.frequency.exponentialRampToValueAtTime(430, now + 0.038);

    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(0.28, now + 0.003);
    env.gain.exponentialRampToValueAtTime(0.0001, now + 0.052);

    osc.connect(env);
    env.connect(masterGain);
    osc.start(now);
    osc.stop(now + 0.06);

    // 2. Subtle high-frequency acoustic snap transient (adds tactile "pop" click)
    const click = ctx.createOscillator();
    const clickEnv = ctx.createGain();
    click.type = 'triangle';
    click.frequency.setValueAtTime(1800, now);
    click.frequency.exponentialRampToValueAtTime(700, now + 0.015);

    clickEnv.gain.setValueAtTime(0.0001, now);
    clickEnv.gain.linearRampToValueAtTime(0.12, now + 0.001);
    clickEnv.gain.exponentialRampToValueAtTime(0.0001, now + 0.018);

    click.connect(clickEnv);
    clickEnv.connect(masterGain);
    click.start(now);
    click.stop(now + 0.025);
  } catch {
    // Audio errors must never throw
  }
}

// A charge earned mid-run: bright, sparkling two-note rising chime (E5 -> A5)
// with sweet harmonic resonance.
export function playChargeEarned() {
  if (!ready()) return;
  try {
    const now = ctx.currentTime;
    const cues = [
      { freq: 659.25, delay: 0, dur: 0.16, gain: 0.22 },      // E5
      { freq: 880.00, delay: 0.08, dur: 0.26, gain: 0.26 },   // A5
    ];
    for (const c of cues) {
      const t = now + c.delay;
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(c.freq, t);
      env.gain.setValueAtTime(0.0001, t);
      env.gain.linearRampToValueAtTime(c.gain, t + 0.01);
      env.gain.exponentialRampToValueAtTime(0.0001, t + c.dur);
      osc.connect(env);
      env.connect(masterGain);
      osc.start(t);
      osc.stop(t + c.dur + 0.03);

      // Sparkling octave harmonic
      const spark = ctx.createOscillator();
      const sparkEnv = ctx.createGain();
      spark.type = 'triangle';
      spark.frequency.setValueAtTime(c.freq * 2, t);
      sparkEnv.gain.setValueAtTime(0.0001, t);
      sparkEnv.gain.linearRampToValueAtTime(c.gain * 0.45, t + 0.012);
      sparkEnv.gain.exponentialRampToValueAtTime(0.0001, t + c.dur * 0.85);
      spark.connect(sparkEnv);
      sparkEnv.connect(masterGain);
      spark.start(t);
      spark.stop(t + c.dur + 0.03);
    }
  } catch {
    // Safe no-op
  }
}

// A level-up: triumphant, sparkling ascending chime (G5 -> C6 -> E6)
// with brilliant overtone resonance.
export function playLevelUp() {
  if (!ready()) return;
  try {
    const now = ctx.currentTime;
    const cues = [
      { freq: 783.99, delay: 0, dur: 0.16, gain: 0.22 },     // G5
      { freq: 1046.50, delay: 0.08, dur: 0.20, gain: 0.24 }, // C6
      { freq: 1318.51, delay: 0.16, dur: 0.32, gain: 0.28 }, // E6
    ];
    for (const c of cues) {
      const t = now + c.delay;
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(c.freq, t);
      env.gain.setValueAtTime(0.0001, t);
      env.gain.linearRampToValueAtTime(c.gain, t + 0.008);
      env.gain.exponentialRampToValueAtTime(0.0001, t + c.dur);
      osc.connect(env);
      env.connect(masterGain);
      osc.start(t);
      osc.stop(t + c.dur + 0.03);

      // Shimmer overtone
      const chime = ctx.createOscillator();
      const chimeEnv = ctx.createGain();
      chime.type = 'triangle';
      chime.frequency.setValueAtTime(c.freq * 1.5, t);
      chimeEnv.gain.setValueAtTime(0.0001, t);
      chimeEnv.gain.linearRampToValueAtTime(c.gain * 0.40, t + 0.012);
      chimeEnv.gain.exponentialRampToValueAtTime(0.0001, t + c.dur * 0.85);
      chime.connect(chimeEnv);
      chimeEnv.connect(masterGain);
      chime.start(t);
      chime.stop(t + c.dur + 0.03);
    }
  } catch {
    // Safe no-op
  }
}

// Gentle, comforting descending triad when a run ends: soft warm bell tones (G3 -> E3 -> C3)
// that invite the player to jump right back in with "Play Again".
export function playGameOver() {
  if (!ready()) return;
  try {
    const now = ctx.currentTime;
    const notes = [
      { freq: 196.00, delay: 0, dur: 0.38, gain: 0.22 },      // G3
      { freq: 164.81, delay: 0.16, dur: 0.42, gain: 0.22 },   // E3
      { freq: 130.81, delay: 0.34, dur: 0.65, gain: 0.26 },   // C3
    ];
    for (const n of notes) {
      const t = now + n.delay;
      const osc = ctx.createOscillator();
      const env = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(n.freq, t);

      env.gain.setValueAtTime(0.0001, t);
      env.gain.linearRampToValueAtTime(n.gain, t + 0.025);
      env.gain.exponentialRampToValueAtTime(0.0001, t + n.dur);

      osc.connect(env);
      env.connect(masterGain);
      osc.start(t);
      osc.stop(t + n.dur + 0.05);
    }
  } catch {
    // Audio errors must never throw
  }
}
