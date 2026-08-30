// Regression test for the landmine 10.2 shipped and 11.1 undoes: 10.2
// changed ROWS but left css/style.css's pre-JS-paint fallback values
// (--canvas-ratio, --canvas-aspect) computed against the OLD row count, so
// the shipped build rendered one wrong-shaped frame before js/main.js's
// syncCanvasAspect corrected it. Nothing ever checked that the stylesheet's
// hardcoded fallbacks still agreed with the constants they were computed
// from -- this reads the stylesheet as text (no CSS parser dependency) and
// recomputes the expected numbers independently from the live constants, the
// same approach unit-tests/difficulty-ramp.js uses for its own board-height
// arithmetic, so it fails the moment someone changes ROWS or CELL and
// forgets the stylesheet.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CANVAS_WIDTH, HUD_HEIGHT, ROWS, CELL } from '../js/constants.js';

const cssPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../css/style.css');
const css = fs.readFileSync(cssPath, 'utf8');

const ratioMatch = css.match(/var\(--canvas-ratio,\s*([\d.]+)\)/);
const aspectMatch = css.match(/aspect-ratio:\s*var\(--canvas-aspect,\s*([\d.]+)\s*\/\s*([\d.]+)\)/);
assert.ok(ratioMatch, "could not find --canvas-ratio's fallback in css/style.css's #game-canvas rule");
assert.ok(aspectMatch, "could not find --canvas-aspect's fallback in css/style.css's #game-canvas rule");

const cssRatio = parseFloat(ratioMatch[1]);
const cssAspectWidth = parseFloat(aspectMatch[1]);
const cssAspectHeight = parseFloat(aspectMatch[2]);

const expectedHeight = HUD_HEIGHT + ROWS * CELL;
const expectedRatio = CANVAS_WIDTH / expectedHeight;

assert.equal(cssAspectWidth, CANVAS_WIDTH,
  `css/style.css's aspect-ratio fallback's width (${cssAspectWidth}) does not match CANVAS_WIDTH (${CANVAS_WIDTH})`);
assert.equal(cssAspectHeight, expectedHeight,
  `css/style.css's aspect-ratio fallback's height (${cssAspectHeight}) does not match HUD_HEIGHT + ROWS * CELL (${expectedHeight}) -- ROWS or CELL changed without updating the stylesheet`);
// A tolerance, not a formatted-string comparison: css/style.css's own literal
// (itself rounded to 6 decimal places from the true ratio) can land on a
// double whose OWN toFixed(5) rounds the wrong way at the boundary --
// 0.678445 parses to 0.67844499999999996, which naively formats as
// "0.67844" even though it is the correct rounding of 384/566. Comparing the
// two raw numbers within half of the 5th decimal place is what "agrees to 5
// decimal places" actually means and does not have that failure mode.
assert.ok(Math.abs(cssRatio - expectedRatio) < 0.000005,
  `css/style.css's --canvas-ratio fallback (${cssRatio}) does not match CANVAS_WIDTH / (HUD_HEIGHT + ROWS * CELL) (${expectedRatio}) to 5 decimal places`);

console.log(`css-geometry: css/style.css's #game-canvas fallbacks (ratio ${cssRatio}, aspect ${cssAspectWidth}/${cssAspectHeight}) agree with CANVAS_WIDTH / (HUD_HEIGHT + ROWS * CELL) from js/constants.js`);
