// Regression test for 4.3: ctx.roundRect throws on Safari below 16, which
// would take the whole HUD frame down with it. js/render.js's roundRectPath
// must fall back to a plain rect (dropping the cosmetic radius) rather than
// calling the missing method.
import assert from 'node:assert/strict';
import { roundRectPath } from '../js/render.js';

function makeFakeCtx({ withRoundRect }) {
  const calls = [];
  const ctx = { rect: (...args) => calls.push(['rect', ...args]) };
  if (withRoundRect) ctx.roundRect = (...args) => calls.push(['roundRect', ...args]);
  return { ctx, calls };
}

{
  const { ctx, calls } = makeFakeCtx({ withRoundRect: true });
  roundRectPath(ctx, 1, 2, 3, 4, 5);
  assert.deepEqual(calls, [['roundRect', 1, 2, 3, 4, 5]], 'should use ctx.roundRect when present');
}

{
  // Simulates Safari < 16, where ctx.roundRect does not exist at all.
  const { ctx, calls } = makeFakeCtx({ withRoundRect: false });
  assert.doesNotThrow(() => roundRectPath(ctx, 1, 2, 3, 4, 5),
    'must not throw when ctx.roundRect is absent');
  assert.deepEqual(calls, [['rect', 1, 2, 3, 4]], 'should fall back to a plain rect, dropping the radius');
}

console.log('roundRectPath: uses ctx.roundRect when present, falls back to ctx.rect without throwing when absent');
