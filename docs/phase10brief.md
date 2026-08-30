# Phase 10 brief — Swap replaces the Magnet, and the board gets tighter

Work on `playables`. Read `CLAUDE.md` and `docs/playables-plan.md` first.

Two changes, both about making the game interesting rather than correct. The
code has been correct for a while; this is the part that decides whether anyone
plays it twice.

Sections are independent. **Commit after each.**

---

## Why the Magnet is being removed, not fixed again

Three implementations, each technically successful, none of them fun. The last
one works exactly as specified — screenshots confirm the lane highlight, the
pull line, the falling fruit curving, settled stacks untouched, no board
corruption. It is good code.

The problem is the concept: **the Magnet does what dragging already does.** The
player aims with a finger, for free, with total precision. Any tool whose job is
"help the fruit reach the column you want" is a slower, weaker duplicate of a
control that already exists. No amount of implementation quality fixes that.

The useful question is what the player **cannot** do. They can choose a column.
That is the entire verb set. They cannot act on the board once fruit has landed
— and that is where this genre's real frustration lives: two matching fruit one
cell apart, with something wedged between them, and no way to fix it.

---

## 10.1 — Swap

**Tap two adjacent fruit. They trade places.** That is the whole mechanic.

### Rules

- **Adjacency is orthogonal only** — up, down, left, right. Same adjacency the
  merge rules already use. No diagonals.
- **Both cells must be occupied.** Swapping with an empty cell would create a
  hole in a column, which is the exact corruption class phase 9 eliminated.
  Reject it.
- **First tap selects** and highlights that fruit. A second tap on an adjacent
  fruit performs the swap. A tap on the same fruit deselects. A tap on a
  non-adjacent fruit moves the selection there rather than failing silently.
- **A charge is consumed only on a completed swap.** Selecting and cancelling
  costs nothing — a power-up that punishes you for looking is a power-up people
  stop touching.
- **Resolve merges after the swap.** That is the point of the tool.
- **Swap-caused merges feed the combo.** The player found and executed it; that
  is skill, not a wholesale board clear. Bomb-caused merges stay suppressed.
  Document the distinction in a comment so it is not re-litigated.

### The two things it must refuse

1. **A planted bomb.** It is a grid sentinel, like the rainbow. Swapping it
   would move a live fuse somewhere the player did not plant it, and worse, the
   same sentinel-collision family that phase 8 had to defend against. Reject
   `BOMB_TIER` explicitly, before any other check.
2. **Any empty cell**, per the adjacency rule above.

Both need their own test.

### Why this is the right shape

- It does the one thing dragging cannot: act on a settled board.
- It is understood before anyone explains it.
- It reuses the tap-a-cell input already built for the Remover.
- It is a decision every single time — which two, and is it worth a charge?
- **It cannot corrupt the board.** Swapping two occupied cells preserves every
  column height exactly. The invariant holds by construction, not by care.
- It is less code than any Magnet version, because it has no per-frame
  behaviour at all.

### Removing the Magnet

Delete it properly — constants, state fields, `stepMagnet`, `magnetPullFor`,
`magnetTargets`, the rail rendering, the icon, the shop entry, its tests. No
dead code, no flag, no commented-out block.

Swap takes the Magnet's place in the milestone ladder: unlocked at 1,000. The
shop copy must describe what Swap actually does.

---

## 10.2 — Tighten the board

**Observed across every gameplay screenshot:** at score 83, stacks are two or
three fruit tall in a seven-row board. The top half is permanently empty in
every shot. All play happens in the bottom third.

That is why the game feels sparse and why it never feels tense. The danger state
cannot do its job because the player is never near the top. The palette
progression cannot land because runs end long before the later milestones.

**Change `ROWS` from 7 to 5.** Treat 5 as a starting point — try 4, 5 and 6 by
feel and keep whichever is tensest without being unfair. The value must live in
`js/constants.js` with a comment explaining the reasoning, as the combo values
already do.

### THE LANDMINE — read before changing the constant

`comboWindowSecFor(state)` derives the combo window from the time an empty-board
fall takes, to preserve the invariant "longer than one fall, shorter than two."
That derivation depends on **board height**, which is what you are about to
change.

If anything in that path hardcodes `ROWS`, `7`, or a fixed pixel height rather
than reading the live board, the invariant silently breaks and early combos
become impossible again — the exact bug `js/constants.js` documents having
already been fixed once, at length, before this project started.

**Grep for every hardcoded `7` and every direct `ROWS` reference before
touching the constant.** Then extend the invariant test to sweep the new board
height across the full drop-count range.

### Consequences to handle

- **Extra Row is now worth far more.** Going 5 → 6 is a 20% increase in
  headroom, against 14% before. Either reprice it or accept it deliberately —
  do not let it change by accident.
- **Runs will get shorter.** That is intended. The goal is more runs per
  sitting, not longer single runs: a tense short run gets replayed, a slack long
  one gets abandoned. Do not compensate by slowing the ramp again.
- The danger state should now actually trigger during normal play. Confirm it
  does, and that it uses `theme.danger` rather than `theme.accent`.

---

## What must not change

- `js/physics.js` and `js/state.js` stay pure — no DOM, canvas, audio, storage
  or platform imports.
- `js/platform.js` stays the only file referencing `ytgame`, `localStorage` or
  `visibilitychange`.
- No image files, no webfonts, no network requests.
- The board-integrity invariant from phase 9: no column may ever hold an empty
  cell beneath a filled one. Swap must be covered by that test too.

---

## Finish

- All suites green, including the CSP run and the prohibited-API sweep.
- Multi-aspect tap tests still pass — Swap adds new tap targets, and the
  single-viewport gap is what hid two earlier bugs.
- Report the bundle size and file count.
- Commit per section, push `playables` only. Deploying is a separate step; see
  `docs/deploy-brief.md`, and remember `BUILD_VERSION` must be bumped **before**
  the push because it derives the service worker's cache name.
