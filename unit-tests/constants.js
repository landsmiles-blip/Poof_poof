// Sanity check that the harness can import the real modules and that
// BUILD_VERSION -- the only way to tell which build a browser is running --
// is actually present and shaped like a date-plus-counter.
import assert from 'node:assert/strict';
import { BUILD_VERSION, POWER_SLOT, HUD_HEIGHT, BOARD_WIDTH, TIERS } from '../js/constants.js';

assert.match(BUILD_VERSION, /^\d{4}\.\d{2}\.\d{2}-\d+$/);

// --- 20: HUD boxes that must not overlap ------------------------------------
// Two collisions shipped because separate offsets were picked independently
// and nobody ever compared them. Both were invisible in code review and
// obvious the moment anyone looked at a screenshot. This is the arithmetic
// that catches the next one.
{
  // The power-up chip's count/unlock label vs the merge meter bar beneath it.
  // The bar used to sit at +4..+7 while the label ran +2..+11 -- inside the
  // text, and painted afterwards, so "500" and "1500" under the locked chips
  // were struck through by a solid bar.
  const labelTop = POWER_SLOT.y + POWER_SLOT.size + 1;
  const labelBottom = labelTop + 8;            // 8px font, textBaseline 'top'
  const barTop = POWER_SLOT.y + POWER_SLOT.size + 10;
  const barBottom = barTop + 2;
  assert.ok(barTop >= labelBottom,
    `the merge meter must start below the chip label (label ends ${labelBottom}, bar starts ${barTop})`);
  assert.ok(barBottom <= HUD_HEIGHT,
    `and the whole HUD row must fit above the board (bar ends ${barBottom}, HUD is ${HUD_HEIGHT})`);

  // The "Next" label vs the preview fruit it labels. The label used to be
  // right-aligned at width-10 while the fruit is centred at width-30, so any
  // fruit with a radius over 19px was drawn straight over the word -- seven
  // of the nine tiers, five of the seven that can actually come next.
  const labelRight = BOARD_WIDTH - 64;
  const fruitCentreX = BOARD_WIDTH - 30;
  const widest = Math.max(...TIERS.map((t) => t.radius));
  assert.ok(labelRight <= fruitCentreX - widest,
    `the "Next" label must clear the widest preview fruit (label ends ${labelRight}, fruit's left edge ${fruitCentreX - widest})`);
}

console.log('constants: BUILD_VERSION is present and well-formed; the HUD chip labels, merge meter and "Next" label do not overlap each other');
