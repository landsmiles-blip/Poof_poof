# Phase 7 brief — the facelift

Work on `playables`. `CLAUDE.md`'s hard rules apply throughout.

Nothing here is required for certification. All of it is required for the game
to look like something a person wants to open.

**Four sections, independent of each other. Commit after each one.** If you get
through two, that is two shipped improvements, not half a phase.

**Everything stays drawn in code.** No image files, no webfonts, no new network
requests. The bundle is 167 KB against a 30 MiB allowance and that discipline is
also why there is no third-party IP to clear. Do not spend it here.

---

## 7.1 — The menu

### The problem

`renderShopScreen` puts everything on one page: title, stats, a Power-ups
heading and hint, six shop cards, a Fruit skins heading, five skin cards, three
"Next run" toggles, the Play button, three audio buttons, and a build stamp. On
a phone that is a long scroll past eleven cards to reach the button that starts
the game.

The menu is a shop with Play buried in it. It should be an invitation with a
shop behind it.

### The structure

The first screen carries four things and nothing else:

1. Title
2. Best score
3. **PLAY** — large, primary, unmissable
4. A row of three icon buttons

The three buttons open sub-screens within the same overlay (keep the existing
architecture — the overlay still replaces the canvas; these are panels inside
it, each with a back control):

- **Cart** — the six power-ups *and* the "Next run" equip toggles together, so
  buying a thing and equipping it happen in the same place. Show the coin
  balance on the cart button itself; a shop you cannot afford should say so
  before you open it.
- **Palette** — the five skins.
- **Gear** — sound, music, haptics, and the build stamp.

The game-over screen keeps its result block (score, best, combo, coins earned,
unlock banner) and then uses the same four-thing structure below it.

### New icons in `js/icons.js`

`cart`, `palette`, `gear`, `back`. Same unit-box convention as the existing six,
same "bold silhouette, single accent, readable at 26px" rule the file's header
comment already sets out.

### `Esc` finally has a job

Phase 6 correctly noted that `Esc` had nothing to dismiss and bound it to
cancelling an armed power-up. Now it should also close an open panel back to the
main menu. Keep both behaviours: panel first, then armed state.

---

## 7.2 — The palette

Four new milestone palettes: a day turning to night. Warm and forgiving at the
start, sweet and saturated once the player has the rhythm, cooling and
heightening as it tightens, and finally a dark board where the fruit glow.

Starting values — tune on a real phone in daylight, the relationships matter
more than the numbers:

| Stop | board top | board bottom | page | text | accent |
|---|---|---|---|---|---|
| 0 | `#FFF6EA` | `#FFE4CB` | `#2A1A12` | `#4A3122` | `#F2960B` |
| 1 | `#FFF1F4` | `#FFD6E2` | `#3A1526` | `#5A2438` | `#E8368F` |
| 2 | `#F3EEFF` | `#D9CCFF` | `#1E1338` | `#3A2A6B` | `#7C4DFF` |
| 3 | `#1E2947` | `#0C1122` | `#05080F` | `#D2E6FF` | `#00D9C0` |

### THE LANDMINE — read before writing any code

`themeForScore` interpolates `text` linearly along with everything else. Stage 2
has **dark text on a light board**; stage 3 has **light text on a dark board**.
Interpolate between those two and, halfway across, the text and the board both
arrive at mid-grey **at the same time**. The score readout disappears.

This is the same shape of trap as the combo window in phase 6: a value that was
safe as a constant stops being safe once something it depends on starts moving.

**Do not interpolate `text` across that boundary.** Derive it instead: compute
the interpolated board colour's relative luminance and pick the light or dark
ink accordingly, with a hysteresis band so it does not flicker back and forth at
the crossover. Write a test that samples the whole 0–10,000 score range and
asserts text-on-board contrast never drops below 4.5:1.

### Reserve red

Add `danger` to the theme object as a **fixed, non-interpolated** red — around
`#FF3B30`. It appears nowhere except the danger state from item 6.2. One colour,
one meaning. The current milestone-0 accent of `#c0392b` spends the alarm colour
on the resting state; that is why the game has nothing left to shout with.

### Depth, cheaply

- Vertical gradient on the board, `boardTop` to `boardBot`, replacing the flat
  fill. `theme.board` becomes two stops — update `applyPageTheme` and the CSS
  variables the overlay screens use.
- A soft radial vignette over the board, strengthening slightly with each
  milestone.
- A contact shadow under each resting fruit: one low-alpha ellipse.
- A rim highlight arc on each fruit's upper edge, plus a slightly darker lower
  rim. Three lines, and flat discs become objects.
- Particles need a touch more saturation and a slightly shorter life against the
  brighter boards, or bursts turn to mush.

---

## 7.3 — Power-ups that live on the board

The rule: **arming or activating a power-up must change the board, not a chip.**

- **Magnet.** Draw a magnet glyph inside the play area while active, riding
  above the column being dragged, with field arcs pulsing toward the fruit it is
  pulling. Ring the fruit it has targeted so the player can see it choosing.
  **And tween the movement** — a magnet-moved fruit still crosses a full 64px
  cell between two frames, which reads as a rendering glitch rather than
  attraction. The grid stays authoritative; only the draw position lags, the
  same way `effects.js` already handles squash. This has been open since the
  first review.
- **Bomb.** While armed, show a translucent 3x3 blast footprint that follows the
  finger before committing. On detonation: an expanding ring, debris, and the
  shake. The bomb clears up to nine fruit and is currently the quietest thing in
  the game.
- **Remover.** While armed, a crosshair on the fruit under the finger.
- **Rainbow.** Rotate its wedges slowly. It is the rarest object in the game and
  it currently sits perfectly still.

---

## 7.4 — Give the fruit faces

Nine tiers currently differ by hue, size, and a circle/flower alternation. Add
per-tier detail so the ladder is recognised rather than memorised:

- A small stem and leaf from tier 4 upward.
- Seeds on the watermelon.
- A crown on the pineapple.
- A dimple or highlight shift that varies by tier.

All drawn in `render.js` alongside the existing shapes, all in code. This also
doubles as accessibility: the more channels separating the tiers, the less the
game leans on colour alone.

---

## What must not change

- `js/physics.js` and `js/state.js` stay pure. This is all presentation.
- `js/platform.js` stays the only file touching `ytgame`, `localStorage` or
  `visibilitychange`.
- Gameplay, scoring, combo and unlock economics are untouched.
- No image files, no webfonts, no network requests.

---

## Finish

- All suites green. **Re-run the CSP check and the prohibited-API sweep** — this
  phase touches `index.html` structure and the build, so both need confirming.
- Report the new bundle size and file count against the old ones.
- Commit per section, then `git push origin playables`.
- Do not push `main`. Do not bump `BUILD_VERSION`. This gets played before it
  gets deployed.
