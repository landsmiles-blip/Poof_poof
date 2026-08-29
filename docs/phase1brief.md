# Phase 1 brief

Work on the `playables` branch. `CLAUDE.md`'s hard rules apply throughout.

Scope is exactly what is below. Do not start phase 2, and do not touch anything
not named here.

---

## 1.3 — Rainbow: guaranteed delivery and an honest preview

Both halves are still broken, confirmed by `unit-tests/rainbow.js`: ~84% of
8-drop runs lose a purchased charge, and ~1,160 of 8,000 spawns did not match
what the HUD promised.

### Delivery: replace the roll with a schedule

`startRun` currently sets `rainbowRemaining = 2` and `rainbowChance = 0.12`, and
`spawnFruit` rolls per spawn. Replace that with a fixed schedule computed at
`startRun`.

- Add a spawn counter to state.
- Schedule the wilds at spawn indices **3 and 8**. Both are early enough that a
  short run still gets value, which is the whole point.
- Delete `rainbowChance`. It becomes dead.

### Preview: decide the wild one drop early

`spawnFruit` currently overrides `state.nextTier` at spawn time, so the fruit the
HUD promised is not the fruit that drops. In a game whose only skill expression
is planning the next placement, that is not acceptable.

Decide the wild at the moment `nextTier` is rolled — at the end of `spawnFruit`,
and in `startRun` — by letting `state.nextTier` hold `RAINBOW_TIER` directly.

**This costs almost nothing in rendering.** `render.js` already routes
`RAINBOW_TIER` through `tierDefFor()` and `colorFor()`, so the preview draws the
wild correctly with no change to `render.js` at all. Verify that rather than
assuming it, but do not add a special case unless the check fails.

Mind the off-by-one: the schedule must be consulted against the index of the
fruit `nextTier` will *become*, not the one currently falling.

### Refund: only when nothing was delivered

`endRun` must return the charge to inventory **only if zero wilds were
delivered** in that run.

Do not refund on partial delivery. "Refund if any wild went undelivered" is
farmable: buy a Rainbow, take the wild at spawn 3, end the run deliberately,
get the coins back, repeat. Zero-delivery-only closes that, and with wilds
scheduled at 3 and 8 a refund should be rare.

### Acceptance

`unit-tests/rainbow.js` passes, and specifically asserts:

- Over 1,000 simulated 8-drop runs, every purchased charge is either delivered
  or refunded. Never silently lost.
- The previewed tier equals the tier that actually spawns, on every spawn,
  across those runs.
- A run that survives to spawn 3 and then ends receives no refund.

---

## 1.4 — One feedback path, not two

`-5` wired bomb feedback through `state.events`. `input.js` still declares three
callbacks — `onBombUsed`, `onRemoverUsed`, `onLockedPowerUp` — that nothing
passes, because `main.js` calls `attachInput(canvas, state)` with two arguments.

**Decision: the events path wins.** It already exists, it already works for the
bomb, and it matches the architecture rule in `CLAUDE.md` — physics pushes
events, `main.js` turns them into sound and effects, and `input.js` stays free of
presentation concerns.

So:

- **Remover.** Push the event from `removeFruitAt()` in `js/physics.js`, where
  the board actually changes — not from `input.js`. Give it the row, column and
  the tier that was removed, so `main.js` can spawn a burst in the right colour.
- **Locked power-up tap.** This one changes no board state, so push it from
  `input.js` onto `state.events` — it is the same presentation queue, and one
  mechanism beats two. Carry the item id and its unlock score. Feedback should
  be small: a muted tick, and a brief flash on that chip. The unlock score is
  already drawn beneath locked chips, so do not add a second label.
- **Delete the dead code.** Remove the `callbacks` parameter from `attachInput`,
  its default, and all three `callbacks.x?.()` call sites. `main.js`'s two-argument
  call then becomes correct rather than accidentally correct, and nobody wires a
  competing mechanism in six months.

### Acceptance

Update `unit-tests/input-callbacks.js` to assert the new contract: using the
remover pushes exactly one event, tapping a locked chip pushes exactly one
event, and `attachInput` no longer accepts a third argument.

---

## 1.2 — Decided, close it

Magnet-assisted merges keep feeding the combo multiplier. Only Bomb-caused
merges stay suppressed via `suppressCombo`.

Rationale to record in the code comment: after 1.1, the Magnet no longer merges
anything by itself — it only moves fruit into position. The merge still requires
the player to drop a fruit, which makes it a real merge and worth the streak.
The Bomb is different: it clears the board wholesale, and letting its cascade
build a multiplier would make detonating the cheapest way to run the streak up.

Mark 1.2 done in `docs/playables-plan.md`.

---

## 1.5 — Deferred, and here is why

**Do not remove `?dev=1` in this phase.**

`tests/verify-features.js` contains a check that exercises `?dev=1`. Removing dev
mode now breaks a currently-green e2e suite, and the tempting repair — deleting
the check — quietly costs coverage.

Dev mode should be stripped by the same build-target mechanism that strips the
manifest and the service worker, which phase 4.2 introduces. Move the remaining
half of 1.5 into phase 4.2 in `docs/playables-plan.md` and note the dependency.
The storage half is already fixed and stays closed.

---

## Plan amendments to record

Add to phase 4.2 in `docs/playables-plan.md`: the Playables bundle must exclude
`package.json`, `node_modules/`, `tests/`, `unit-tests/`, `docs/`, `.github/`,
the web app manifest, the icons, and the service worker. Nothing that is not the
game itself ships.

---

## Settle the live-version question

Last report said the live site serves `-5` and attributed an observed `-4` to a
stale service worker. That explanation does not hold: the `-4` reading came from
a server-side fetch, with no browser and no service worker in the path, and the
deploy predated it.

Fetch `https://landsmiles-blip.github.io/Poof_poof/js/constants.js` with a
cache-busting query string appended, and print the `BUILD_VERSION` line
verbatim. Report exactly what came back. This decides whether the public is
currently playing a build with known defects, so do not summarise it — quote it.

---

## Finish

- Both suites green: `unit-tests/` and `tests/verify-features.js`.
- Commit.
- Push `main`, `playables` and the tag to origin. Nothing has been pushed yet,
  and the work is currently one disk failure from gone.
- Do not bump `BUILD_VERSION` — this is not a deploy.
