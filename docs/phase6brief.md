# Phase 6 brief — feel, difficulty, and the SHOULD-level items

Work on `playables`. `CLAUDE.md`'s hard rules apply throughout.

Certification does not require any of this. Item 6.1 should still be done before
submission: "it starts too fast" is a first-thirty-seconds impression, and a
curated programme forms one.

Everything here is gameplay and presentation. Nothing touches `platform.js`,
the build target, or any compliance surface.

---

## 6.1 — A difficulty ramp

**The gap, found by playing rather than reading:** `GRAVITY_PX_PER_SEC` is a
flat `260` from the first drop of a run to the last. The only speed variation in
the entire game is the Slow Drop power-up. There is no difficulty curve at all —
a new player's first drop falls exactly as fast as an expert's hundredth.

The intent: start gentle, tighten as the run goes on.

### Key it off drops, not score

`state.spawnIndex` already exists — phase 1 added it for the Rainbow schedule,
and `startRun` already resets it. Reuse it.

Drops, not score, because: score already drives the milestone unlocks and the
theme interpolation, and coupling a third system to it makes all three harder to
reason about. "The more you play" means time in the run, which is what a drop
count measures.

### The curve

Put every number in `js/constants.js` with a comment, as that file already does
for the combo values. A starting point, to be tuned by feel:

- Begin around `0.7x` (~182 px/s) — noticeably gentler than today.
- Reach `1.0x` (today's 260) somewhere around drop 20.
- Continue to roughly `1.4x` (~364 px/s) by drop 60.
- **Cap it there.** Unbounded speed stops being difficulty and starts being
  noise.

For the record on why a cap is safe rather than merely wise: `stepPhysics`
advances `active.y` by `gravity * dt` with `dt` clamped to 0.05, so at 364 px/s
a fruit moves at most ~18px per frame against a 64px cell. There is no
tunnelling risk in that range. Do not remove the cap on the grounds that it
"seems fine" — the clamp is what makes it fine.

Slow Drop keeps multiplying the *ramped* value, so it stays proportionally
useful late in a run rather than becoming irrelevant.

### The landmine — read this before writing any code

`COMBO_WINDOW_SEC` is `1.8`, and `js/constants.js` carries a long comment
explaining exactly why. A fruit falling to an empty board takes ~1.66s at
260 px/s. The window was 1.2s, which sat *below* one fall and made cross-drop
combos arithmetically impossible for a new player — the comment records that the
combo meter was first seen at a median of drop 13. It was raised to 1.8s so it
sits just above one fall and below two.

**Slowing the early game re-breaks that.** At `0.7x`, an empty-board fall takes
about 2.5 seconds — well past the 1.8s window. A new player would once again be
unable to chain across drops, which is precisely the bug that comment describes
being fixed.

So the combo window can no longer be a constant. **Derive it from the current
fall time**, preserving the documented invariant: longer than one fall, shorter
than two. Something of the shape `window = currentEmptyBoardFallTime * 1.08`
reproduces today's 1.8s at today's gravity, and keeps the relationship true at
every point on the ramp.

Keep the original comment. Extend it to explain that the value is now derived
and why. That comment is the reason this trap was visible at all.

### Tests

- Gravity rises with drop count and never exceeds the cap.
- **The invariant test, and the important one:** at every point on the ramp,
  one empty-board fall is shorter than the combo window and two falls are
  longer. Sample the whole range, not the endpoints.
- A run's ramp resets on `startRun`.

---

## 6.2 — A danger state

The run ends when the centre column fills, with no warning of any kind. Losing
should be something the player saw coming.

Tint the top row, or pulse the spawn column's outline, when the centre column is
within two of full. Keep it in the existing theme palette — `theme.accent` — so
it moves with the milestone colours instead of fighting them.

Pairs naturally with 6.1: as the drops get faster, seeing the danger earlier is
what makes the speed feel fair rather than cheap.

---

## 6.3 — Honour `prefers-reduced-motion`

Squash, particles and shake all shipped with no opt-out. Read the media query at
startup, and feed the same toggle path that haptics already uses. Reduced motion
should mean: no shake, no particles, and a much smaller squash — not a dead
board.

---

## 6.4 — Keyboard, and `Esc`

Both SHOULD-level in the design requirements. Left/right to steer the falling
fruit, space or down to drop it, `Esc` to close the shop overlay. Reuse
`setDragTarget` rather than writing a second path into the physics.

---

## 6.5 — `platform.submitScore()`

Call it in `endRun`. The requirement is that the score sent matches the best
score in the save, which is trivial now the save is a single blob. `localImpl`
can no-op.

---

## 6.6 — Record effect positions at merge time

`spawnMergeEffects` is called from `drainEvents` at end of frame, using the row
and column recorded *before* `settleColumns` ran. During a cascade, a particle
burst can land on a cell whose contents have already shifted. The squash guards
against this with a tier check; the particles do not. Record the position at
merge time and carry it on the event.

---

## 6.7 — A colour-blind-safe skin

Tiers currently separate by hue, size, and two shapes. Add a skin whose palette
holds up under deuteranopia and protanopia — or, better, extend the shape
vocabulary per tier so colour is never the only channel. Accessibility is
SHOULD-level; this is the cheapest meaningful step, and it doubles as visual
interest.

---

## What must not change

- `js/physics.js` and `js/state.js` stay pure.
- `js/platform.js` stays the only file touching `ytgame`, `localStorage` or
  `visibilitychange`.
- The Playables build must still pass the CSP run and the grep sweep from
  phase 5. Re-run both before committing.

---

## Finish

- All suites green, including the CSP run.
- Commit, then `git push origin playables`.
- Do not push `main` and do not bump `BUILD_VERSION` — deploying this is a
  separate decision, taken after it has been played.
- Report per file what changed, which tests you added, and anything here that
  turned out to be wrong.
