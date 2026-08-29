# Phase 8 brief — power-ups become play

Work on `playables`. `CLAUDE.md`'s hard rules apply throughout.

This is the biggest gameplay change in the project. The goal in the owner's
words: derive the most fun, and make it smooth and flawless.

**Four sections. Commit after each.** 8.1 and 8.2 are the ones that change how
long a run lasts; 8.3 and 8.4 are the ones that make it feel good. If you only
land two, land 8.1 and 8.2.

---

## The problem being solved

Power-ups today are inventory, not play. You earn coins **at the end** of a run
and spend them **before the next one** — so during the run where you are
actually in trouble, nothing can arrive to help. The reward loop is one run out
of phase. That is why players hoard charges and forget they exist.

---

## 8.1 — Earn charges during the run

A meter in the HUD fills as you merge. Fill it and a charge lands, ready to use
immediately.

- Fills on merges. Weight by tier so a big merge is worth more than a cherry
  pair — that rewards playing well rather than playing fast.
- On fill: grant **one random charge from the power-ups the player has already
  unlocked**. Random, not fixed — the fill should be a small surprise.
- Announce it: the chip pulses, a short rising sound, a haptic tick. This is a
  reward moment and it should feel like one.

### Temporary by design — do not skip this

Charges earned this way are **run-scoped**. They are not added to
`inventory`, they never persist to the save, and they are discarded at
`endRun`. Track them separately from purchased stock.

If earned charges entered the inventory, the shop would die and coins would stop
meaning anything. Purchased charges are permanent stock; earned charges are a
rescue rope for the run you are in. Keep them distinct in the HUD too — a small
marker distinguishing "earned, this run only" from owned stock.

### Acceptance

- Merging enough grants a charge; the charge is usable in the same run.
- After `endRun`, earned charges are gone and `inventory` is byte-identical to
  what it was before the run started.
- A locked power-up is never granted.

---

## 8.2 — Stretch the ramp, hard

Current: 0.6x... no — current is `0.7x`, reaching `1.0x` by drop 20, capping at
`1.4x` by drop 60. Drop 20 is roughly ninety seconds in. That is not a ramp, it
is a short runway, and the owner felt it immediately.

New shape:

- Start at **0.6x**.
- Do not reach today's normal speed (`1.0x`) until around **drop 40**.
- Cap at **1.3x** around **drop 120**.
- **Ease in**: nearly flat for the first ~15 drops, then climbing. The opening
  should feel genuinely generous, not merely slower.

Put all of it in `js/constants.js` with a comment explaining the curve's intent.

### The invariant still has to hold

`comboWindowSecFor(state)` derives the combo window from the ramped gravity to
keep "longer than one fall, shorter than two". That was built in phase 6 and it
should survive this change by construction — but the range is now much wider at
the slow end. **Extend the invariant test to sweep the new full range**, drop 0
through drop 150, not the old one.

---

## 8.3 — The Magnet becomes a companion

Stop treating it as a consumable that ticks down invisibly. It becomes a thing
on the board.

- It rides a rail across the top of the play area.
- Drag it to a column. While it sits there it tugs matching fruit toward that
  column, with visible field arcs.
- A charge meter drains while it is actively pulling and refills slowly when
  idle, so it is always present and never simply "spent".
- Ring the fruit it has targeted so the player can see it choosing.

**Every movement it causes must be tweened.** A magnet-moved fruit currently
crosses a full 64px cell between two frames, which reads as a rendering glitch
rather than attraction. The grid stays authoritative; only the drawn position
lags, exactly as `effects.js` already does for squash. This has been open since
the first review and it is the single thing most responsible for the magnet
feeling broken.

---

## 8.4 — The Bomb becomes a planted object

Instead of arm-then-tap, the bomb **drops into the board like a fruit**, with a
lit fuse that burns down over a few drops. You place it where you think trouble
is coming, keep playing, and it detonates where it sits when the fuse ends.

Draw the fuse burning down. This is the most visible object in the game while it
is live.

### THE LANDMINE — read before writing any code

A bomb in the grid is a second sentinel alongside `RAINBOW_TIER = 99`. Follow
that pattern — but the rainbow is exactly what makes this dangerous.

`pairTier()` currently returns a merge for a rainbow against **anything**. So
`pairTier(BOMB, RAINBOW)` would merge the wildcard *into the bomb*. The board
would eat the bomb, or worse, produce a tier from a sentinel.

So, explicitly, and in this order:

1. **Reject the bomb in `pairTier` before the rainbow wildcard check.** A bomb
   never merges with anything, wildcard included.
2. **Exclude the bomb in `stepMagnet`** — a held rainbow must not target it.
3. Give it a `tierDef` entry so anything asking for a radius works.
4. It falls and settles normally, and it counts toward stack height and
   game-over — it takes up space, which is part of the cost of planting it.
5. It awards no score, and its detonation keeps the existing `suppressCombo`
   behaviour.

Write a test for each of those five, especially the rainbow one. That
interaction is invisible until it happens and then it corrupts the board.

---

## Also

`js/theme.js` now has a dedicated `danger` colour. Phase 6's danger pulse still
uses `theme.accent`. Point it at `theme.danger` — that colour exists precisely
so the alarm reads as an alarm and nothing else in the game shares it.

---

## Smooth and flawless — the standard for this phase

- **Nothing teleports.** Any position that changes by more than a few pixels in
  one frame gets a tween.
- **Every new interaction gets a real touch test** — `hasTouch` context, tap and
  drag gestures, not mouse clicks. The last bug was invisible to a mouse by
  construction; assume the next one is too.
- **Test the continuous gesture**, not just discrete taps: press, slide,
  release. That is what a finger actually does.

---

## What must not change

- `js/physics.js` and `js/state.js` stay pure.
- `js/platform.js` stays the only file touching `ytgame`, `localStorage` or
  `visibilitychange`.
- Purchased inventory and the coin economy are untouched by 8.1.

---

## Finish

- All suites green, including the CSP run and the prohibited-API sweep.
- Report the new bundle size and file count.
- Commit per section, then `git push origin playables`.
- **Do not push `main`.** This gets played on a phone before it goes live.
