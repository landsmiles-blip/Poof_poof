// Regression test for 3.2/3.3: setHostAudioEnabled (audio.js, music.js) must
// never throw, whether or not an AudioContext exists yet -- boot() calls it
// before any user gesture, so on a browser that blocks context creation
// entirely (audio.js's `unavailable` path), ctx/masterGain stay null and this
// must still be a safe no-op rather than taking the game down.
import assert from 'node:assert/strict';
import { setHostAudioEnabled as setAudioHostEnabled, isMuted, setMuted } from '../js/audio.js';
import { setHostAudioEnabled as setMusicHostEnabled } from '../js/music.js';

assert.doesNotThrow(() => setAudioHostEnabled(true), 'audio.js setHostAudioEnabled(true) with no context must not throw');
assert.doesNotThrow(() => setAudioHostEnabled(false), 'audio.js setHostAudioEnabled(false) with no context must not throw');
assert.doesNotThrow(() => setMusicHostEnabled(true), 'music.js setHostAudioEnabled(true) with no context must not throw');
assert.doesNotThrow(() => setMusicHostEnabled(false), 'music.js setHostAudioEnabled(false) with no context must not throw');

// The player's own mute toggle is independent of the host flag and must keep
// working regardless of the order these are called in.
setMuted(true);
assert.equal(isMuted(), true);
setMuted(false);
assert.equal(isMuted(), false);

console.log('host-audio-enabled: setHostAudioEnabled is a safe no-op with no AudioContext yet');
