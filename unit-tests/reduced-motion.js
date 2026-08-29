// Regression test for 6.3: prefers-reduced-motion must cut shake and
// particles entirely and shrink squash, without going all the way to a dead
// board (a merge should still visibly register).
import assert from 'node:assert/strict';
import { REDUCED_MOTION_SQUASH_SCALE } from '../js/constants.js';
import { createEffects, spawnMergeEffects, _setReducedMotion, isReducedMotion } from '../js/effects.js';

{
  _setReducedMotion(false);
  const fx = createEffects();
  spawnMergeEffects(fx, { row: 1, col: 1, tier: 3, color: '#fff', silent: true });
  assert.ok(fx.particles.length > 0, 'full motion should spawn particles');
  assert.ok(fx.squashes[0].amount > 0, 'full motion should record a nonzero squash');
  const fullAmount = fx.squashes[0].amount;

  _setReducedMotion(true);
  assert.equal(isReducedMotion(), true);
  const fxReduced = createEffects();
  spawnMergeEffects(fxReduced, { row: 1, col: 1, tier: 3, color: '#fff', silent: true });
  assert.equal(fxReduced.particles.length, 0, 'reduced motion must spawn zero particles');
  assert.equal(fxReduced.shake.magnitude, 0, 'reduced motion must never trigger shake');
  assert.ok(fxReduced.squashes[0].amount > 0, 'reduced motion must still squash -- not a dead board');
  assert.ok(fxReduced.squashes[0].amount < fullAmount, 'reduced motion squash must be smaller than full motion');
  assert.ok(
    Math.abs(fxReduced.squashes[0].amount - fullAmount * REDUCED_MOTION_SQUASH_SCALE) < 1e-9,
    'reduced motion squash must scale by REDUCED_MOTION_SQUASH_SCALE',
  );

  // High-tier merge would normally trigger shake -- confirm reduced motion
  // suppresses it even at the tier that would otherwise guarantee it.
  const fxShake = createEffects();
  spawnMergeEffects(fxShake, { row: 1, col: 1, tier: 8, color: '#fff', silent: true });
  assert.equal(fxShake.shake.magnitude, 0, 'reduced motion must suppress shake even at a high tier');

  _setReducedMotion(false);
}

console.log('reduced-motion: prefers-reduced-motion cuts particles and shake and shrinks squash, without going silent');
