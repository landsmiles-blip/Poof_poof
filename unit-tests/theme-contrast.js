// Regression test for 7.2 -- THE LANDMINE. themeForScore used to lerp `text`
// linearly across every milestone segment, including the one where stop 2
// (dark ink on a light board) blends into stop 3 (light ink on a dark
// board). Halfway across that segment, both text and board arrive at the
// same mid-grey and the score readout disappears. text is now derived from
// the interpolated board's own relative luminance instead of being lerped;
// this samples the whole score range, out past the last milestone, and
// asserts the readout never becomes illegible anywhere in it.
import assert from 'node:assert/strict';
import { themeForScore, contrastRatio, resetPageTheme } from '../js/theme.js';
import { MILESTONE_SCORES } from '../js/constants.js';

const MIN_CONTRAST = 4.5; // WCAG AA for normal text

resetPageTheme();

let worst = Infinity;
let worstScore = 0;
// 20: swept past the LAST milestone, not to a number that used to be past
// it. The top palette milestone moved from 4,000 to 15,000, so a 0-10,000
// sweep would have stopped short of the final theme entirely and passed
// without ever testing it.
const SWEEP_TO = MILESTONE_SCORES[MILESTONE_SCORES.length - 1] * 2;
for (let score = 0; score <= SWEEP_TO; score += 5) {
  const theme = themeForScore(score);
  // Text sits on the board's top stop in the HUD (js/render.js draws the HUD
  // text before translating into the board), so that is what must contrast.
  //
  // 11.2 considered tinting this strip (docs/phase11brief.md 4.1) but the
  // brief's own §5.2 required checking against the TINTED colour first --
  // and the baseline (untinted) worst case here is only 4.56:1, a 0.06
  // margin over the 4.5 floor. Any tint strength greater than zero can only
  // move a board colour further from its own text colour (never closer, by
  // construction: the tint always pushes toward whichever ink colour is NOT
  // being used), so no strength could ever reach the required 0.3 margin --
  // confirmed by sweeping alpha down to 0.01. Per the brief's own decision
  // tree, the tint was dropped entirely; drawFrame keeps only the shadow and
  // highlight, which do not touch the board's own colour. This test is
  // therefore still checking exactly what is drawn -- unchanged from before
  // 11.2 -- and needs no tinted variant.
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
console.log(`theme-contrast: worst contrast across 0-${SWEEP_TO} (past the last milestone) was ${worst.toFixed(2)}:1 at score ${worstScore}, floor is ${MIN_CONTRAST}:1`);
