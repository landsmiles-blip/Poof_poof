// Phase 24. The Playgama Bridge implementation, held to the same contract
// the other two are: "a platform that misbehaves must never take the game
// down" (2.1, unit-tests/platform.js).
//
// Two halves, mirroring that file:
//   1. a Bridge whose every call throws or rejects -- boot must still
//      complete, with fresh-save/audio-on/no-ads defaults.
//   2. a Bridge that works -- the exact calls and arguments the SDK is
//      supposed to receive, recorded and asserted, so a wrong key, a wrong
//      message string or a missing isMain leaderboard id is caught here and
//      not in a submission rejection.
//
// No DOM: js/platform.js exports _createBridgeImpl for exactly this, and the
// impl only ever reaches the SDK through window.bridge, which this file
// supplies.
import assert from 'node:assert/strict';
import * as platform from '../js/platform.js';
import { SAVE_KEY } from '../js/constants.js';

function throwing() { throw new Error('bridge failure'); }
function rejecting() { return Promise.reject(new Error('bridge failure')); }

const originalWindow = globalThis.window;

// --- 1. every call fails ---------------------------------------------------

globalThis.window = {
  bridge: {
    initialize: rejecting,
    EVENT_NAME: { PAUSE_STATE_CHANGED: 'pause_state_changed', AUDIO_STATE_CHANGED: 'audio_state_changed' },
    get platform() { return { get isAudioEnabled() { return throwing(); }, on: throwing, sendMessage: throwing }; },
    get storage() { return { get: rejecting, set: rejecting }; },
    get advertisement() { return { get isInterstitialSupported() { return throwing(); }, showInterstitial: throwing }; },
    get leaderboards() { return { setScore: rejecting }; },
  },
};

{
  const impl = platform._createBridgeImpl();
  await impl.init(); // a rejected initialize() must not propagate
  const save = await impl.load();
  assert.equal(save, null, 'a failed load() must fall back to a fresh save');
  impl.save({ v: 1, highScore: 0 });
  await impl.flush();
  impl.firstFrameReady();
  impl.gameReady();
  impl.onPause(() => {});
  impl.onResume(() => {});
  assert.equal(impl.audioEnabled(), true, 'audio must fail open -- a silent game is worse than an unmuted one');
  impl.onAudioEnabledChange(() => {});
  await impl.submitScore(10);
  assert.equal(await impl.language(), 'en', 'language must fall back to en');
  assert.equal(impl.isInterstitialSupported(), false, 'an unreadable ad module means no ads, not a crash');
  impl.showInterstitial('game_over');
  assert.equal(impl.isReadOnly(), false);
}

// --- 2. a working Bridge, asserting what the SDK receives ------------------

const calls = { messages: [], sets: [], gets: [], scores: [], interstitials: [], on: [] };
let pauseCb = null;
let audioCb = null;

const platformModule = {
  language: 'th',
  isAudioEnabled: false,
  sendMessage(m) { calls.messages.push(m); return Promise.resolve(); },
  on(evt, cb) {
    calls.on.push(evt);
    if (evt === 'pause_state_changed') pauseCb = cb;
    if (evt === 'audio_state_changed') audioCb = cb;
  },
};
const storageModule = {
  data: null,
  get(key) { calls.gets.push(key); return Promise.resolve(storageModule.data); },
  set(key, value) { calls.sets.push([key, value]); storageModule.data = value; return Promise.resolve(); },
};

globalThis.window = {
  bridge: {
    initialize: () => Promise.resolve(),
    EVENT_NAME: { PAUSE_STATE_CHANGED: 'pause_state_changed', AUDIO_STATE_CHANGED: 'audio_state_changed' },
    platform: platformModule,
    storage: storageModule,
    advertisement: {
      isInterstitialSupported: true,
      showInterstitial(p) { calls.interstitials.push(p); },
    },
    leaderboards: { setScore(id, score) { calls.scores.push([id, score]); return Promise.resolve(); } },
  },
};

{
  const impl = platform._createBridgeImpl();
  await impl.init();

  // Step 4 of Playgama's required list: the pause and audio state must be
  // subscribed to, and the audio state read at start -- "On game start,
  // check the current value and mute the game audio if it is false."
  assert.ok(calls.on.includes('pause_state_changed'), 'init must subscribe to the pause event');
  assert.equal(impl.audioEnabled(), false, 'a host that starts muted must be respected at boot, not after the first change');

  let audioSeen = null;
  impl.onAudioEnabledChange((v) => { audioSeen = v; });
  assert.ok(calls.on.includes('audio_state_changed'), 'the audio event must be subscribed to');
  audioCb(true);
  assert.equal(audioSeen, true, 'an audio change must reach the game');
  assert.equal(impl.audioEnabled(), true, 'and must update what audioEnabled() reports');

  // One SDK event feeds both halves, and each half must fire only on its own
  // edge -- a resume delivered as a pause would un-freeze a paused game.
  let paused = 0; let resumed = 0;
  impl.onPause(() => { paused += 1; });
  impl.onResume(() => { resumed += 1; });
  pauseCb(true);
  pauseCb(false);
  assert.deepEqual([paused, resumed], [1, 1], 'pause_state_changed must split into exactly one pause and one resume');

  // Step 2: the host language, not a guess.
  assert.equal(await impl.language(), 'th');

  // Step 3: storage, by the key the rest of the game uses. The blob goes
  // through as an object -- set() serialises it itself, and get() parses
  // it back, so a JSON.stringify here would come back as a string.
  const blob = { v: 1, highScore: 4321, coins: 7 };
  impl.save(blob);
  await impl.flush();
  assert.deepEqual(calls.sets, [[SAVE_KEY, blob]], 'the save must be written to the shared save key, as an object');
  assert.deepEqual(await impl.load(), blob, 'and must read back as the same blob');
  assert.deepEqual(calls.gets, [SAVE_KEY], 'the load must read the shared save key');

  // Step 5: the one message Playgama requires, by its exact name.
  impl.gameReady();
  assert.deepEqual(calls.messages, ['game_ready'], "gameReady() must send exactly 'game_ready'");
  impl.firstFrameReady();
  assert.deepEqual(calls.messages, ['game_ready'], 'firstFrameReady() must send nothing -- the Bridge does it itself on YouTube');

  // Step 6: the interstitial, with the placement main.js passes.
  assert.equal(impl.isInterstitialSupported(), true);
  impl.showInterstitial('game_over');
  assert.deepEqual(calls.interstitials, ['game_over']);

  // The score has to go to the id the config marks isMain, or the YouTube
  // path rejects it outright and the Playables high score never updates.
  await impl.submitScore(4321);
  assert.deepEqual(calls.scores, [['highscore', 4321]], 'the score must go to the isMain leaderboard id from playgama-bridge-config.json');
}

globalThis.window = originalWindow;
console.log('bridge: survives a failing Bridge, and sends the right calls to a working one');
