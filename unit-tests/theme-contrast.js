// Regression test for 7.2 -- THE LANDMINE. themeForScore used to lerp `text`
// linearly across every milestone segment, including the one where stop 2
// (dark ink on a light board) blends into stop 3 (light ink on a dark
// board). Halfway across that segment, both text and board arrive at the
// same mid-grey and the score readout disappears. text is now derived from
// the interpolated board's own relative luminance instead of being lerped;
// this samples the whole 0-10,000 score range (the milestones sit at
// 0/1000/3000/8000) and asserts the readout never becomes illegible.
import assert from 'node:assert/strict';
import { themeForScore, contrastRatio, resetPageTheme } from '../js/theme.js';

const MIN_CONTRAST = 4.5; // WCAG AA for normal text

resetPageTheme();

let worst = Infinity;
let worstScore = 0;
for (let score = 0; score <= 10000; score += 5) {
  const theme = themeForScore(score);
  // Text sits on the board's top stop in the HUD (js/render.js draws the HUD
  // text before translating into the board), so that is what must contrast.
  const ratio = contrastRatio(theme.text, theme.boardTop);
  if (ratio < worst) {
    worst = ratio;
    worstScore = score;
  }
  assert.ok(ratio >= MIN_CONTRAST,
    `score ${score}: text ${theme.text} on board ${theme.boardTop} contrasts at ${ratio.toFixed(2)}:1, below the ${MIN_CONTRAST}:1 floor`);
}

// A genuine ascending sweep, matching how score actually moves during a real
// run -- the hysteresis this relies on is keyed on call order, not score
// alone, precisely so a run's monotonically increasing score can only cross
// the ink boundary once. See themeForScore's `inkIsDark` comment in theme.js.
console.log(`theme-contrast: worst contrast across 0-10000 was ${worst.toFixed(2)}:1 at score ${worstScore}, floor is ${MIN_CONTRAST}:1`);
