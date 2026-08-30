# Phase 9 addendum — findings from 25 device screenshots on v2026.08.28-10

Evidence-based. Each item cites the screenshot it was observed in. Append these
to `docs/phase-9-brief.md`.

## Confirmed fixed

The letterbox coordinate bug (9.1) is resolved on `-10`. The board renders at
the correct aspect with no empty canvas below the grid, and power-up chips
register taps — the magnet chip appears active/highlighted in several shots.

---

## 9.5 — BOARD STATE CORRUPTION: fruit left floating with holes beneath

**Observed:** `120000.jpg` — column 4 holds a blue circle suspended in mid-air
with a completely empty cell beneath it before the stack resumes. Also visible
in `119986.jpg`.

This is not cosmetic. The grid has holes in it, which means merge detection,
stack height and game-over are all computing against a board that does not match
what the player sees.

**Cause:** the magnet mutates grid cells without settling the column afterward,
or the movement tween draws fruit at positions the grid no longer agrees with.

**This is fixed by construction** if 9.2 is implemented as specified — a magnet
that only influences the *falling* fruit never touches a settled cell, so no
hole can be created. Do not patch the settling; remove the cause.

**Regression test regardless:** after any magnet activity, assert the grid has
no null cell below a non-null cell in the same column. That invariant should
hold at all times and nothing currently checks it.

---

## 9.6 — The magnet has no range limit

**Observed:** `120000.jpg` — the magnet is parked at the far-left column and has
drawn a pull line diagonally across the board to a fruit several columns away
near the bottom.

Under the 9.2 redesign this becomes moot for settled fruit, but the falling-fruit
pull still needs the specified distance falloff, or a magnet parked anywhere will
dominate every drop regardless of where the player aims.

---

## 9.7 — The board does not clip its contents

**Observed:** `119987.jpg` — the falling fruit is drawn above the board's top
edge, overlapping the version stamp and the HUD chip row.

Fruit spawn at negative y by design, so this has always technically happened,
but the HUD is far busier since phase 7 and it now reads as a rendering fault.

**Fix:** clip drawing to the board rect. The falling fruit should be revealed as
it enters the board, not float over the score readout.

**Same defect, second instance:** `120000.jpg` shows the magnet puck drawn half
outside the board's left edge, overlapping the card boundary and the chip
labels. Constrain the puck to the board and clip it the same way.

---

## 9.8 — Stale shop copy for the magnet

**Observed:** `119990.jpg` / `119991.jpg` — the Magnet card still reads
*"Briefly draws matching fruit toward the one you are holding."* That describes
the behaviour from two redesigns ago.

The Bomb's copy was correctly updated to *"Plants as your next drop. Clears a
3x3 blast when its fuse ends."* — so this is an isolated miss, not a pattern.

Rewrite it to match whatever 9.2 lands on. **Add a check to the phase-9 work:
every power-up's shop description must describe its current behaviour.** Copy
that lies is worse than no copy.

---

## 9.9 — Reclaim the screen

**Observed:** across all gameplay shots — the board occupies roughly 60% of the
screen height, with large dead bands above and below.

This is the letterbox fix working correctly and it is not a bug. But on a 9:20
phone there is real room to scale the board up. Increase the board's rendered
size to fill more of the available height while preserving the logical aspect
and keeping the guard that refuses to size from a zero measurement.

Do this **after** 9.5 and the multi-aspect tap tests are green, not before —
changing the scale while a coordinate bug class is still open makes both harder
to reason about.
