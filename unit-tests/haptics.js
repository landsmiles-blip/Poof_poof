// Regression test for 3.4: hapticsOn hydrates from the save, toggles, and
// defaults to on when absent (a fresh save, or one saved before this field
// existed).
import assert from 'node:assert/strict';
import { hydrate, isHapticsOn, toggleHaptics, vibrate, hasHaptics } from '../js/effects.js';

hydrate(null);
assert.equal(isHapticsOn(), true, 'a fresh save should default hapticsOn to true');

hydrate({ hapticsOn: false });
assert.equal(isHapticsOn(), false, 'hydrate should read hapticsOn: false from the save');

hydrate({}); // a save from before this field existed
assert.equal(isHapticsOn(), true, 'a save missing hapticsOn entirely should default to true, not off');

hydrate({ hapticsOn: true });
assert.equal(toggleHaptics(), false, 'toggling from on should turn it off');
assert.equal(isHapticsOn(), false);
assert.equal(toggleHaptics(), true, 'toggling from off should turn it back on');

// hasHaptics() is always false in plain Node (no navigator.vibrate), so
// vibrate() must return false regardless of hapticsOn -- this is the
// device-capability gate the shop's toggle is hidden behind, exercised here
// as "never throws, never claims a vibration happened."
assert.equal(hasHaptics(), false, 'plain Node has no navigator.vibrate');
hydrate({ hapticsOn: true });
assert.equal(vibrate(10), false, 'vibrate() must fail closed when the device cannot vibrate at all');
hydrate({ hapticsOn: false });
assert.equal(vibrate(10), false, 'vibrate() must also fail closed when the player has turned haptics off');

console.log('haptics: hydrate/toggle/default and the device-capability gate all behave correctly');
