# Phase 12 — Stop the freeze, fix the spawn column, deepen the backdrop

**Branch:** `playables` (currently `aa7989a`, phase 11.2)
**Live:** `main` @ `09eb1cf`, `BUILD_VERSION = '2026.08.28-13'`
**Priority order is the order below.** 12.1 is a game-breaking bug with a proven reproduction. Everything else waits behind it.

---

## 12.1 — THE FREEZE (blocker)

### What the player sees

The board stops. The last frame stays on screen. No fruit falls. The pause button is drawn but does nothing. Only a page reload recovers it. It shows up after a run ends and a new one is started, and sometimes mid-run.

### Root cause — proven, not guessed

`requestAnimationFrame` is re-armed from exactly three places in `js/main.js`:

- line ~579, once at boot
- line ~438, `resumeRun()`
- line ~389, `loop()`'s own tail: `if (!state.paused) startLoop();`

**The Play and Play Again handlers do not re-arm it.** `showScreen()`'s `renderMenu`/`renderGameOver` callbacks only hide the overlay, unhide the canvas and re-sync sizes. They rely on the loop already running — which it normally is, because `loop()` keeps ticking on the menu to animate the backdrop.

So if the loop is dead at the moment the player taps Play, it stays dead forever. `startRun` sets `state.paused = false`, `state.screen = SCREEN.PLAYING`, the canvas is unhidden — and nothing ever calls `startLoop()`. The pause button is inert because `drainEvents()` only runs inside the dead loop.

The loop dies because `platform.onPause(pauseRun)` (line ~554) is wired **unconditionally**, while `platform.onResume` is guarded. `createLocalImpl` fires both off `visibilitychange` (`js/platform.js:181`). Backgrounding the browser, a screen lock, a notification, or an app switch fires `hidden` → `pauseRun()` → `cancelAnimationFrame`. In an in-app WebView — which is what the player's screenshots show, a `github.io` page inside an app's browser, not Chrome — the *resume* half of `visibilitychange` is exactly the unreliable one.

### The reproduction

Deterministic, on the current `playables` build:

1. Boot, tap Play, reach game over.
2. Fire `visibilitychange` with `document.hidden === true`. Do **not** fire the resume.
3. Tap Play Again.

Observed: `screen: "playing"`, `paused: false`, `active: false`, canvas shown, overlay hidden, pause panel hidden, rAF count frozen, pause taps do nothing. That is the player's screenshots exactly — including a populated board and no falling fruit when the same thing happens mid-run instead.

### The fix — all four parts, they are not alternatives

**(a) Re-arm on every entry into play.** Add `startLoop()` (guarded on `rafHandle === null`) to the point where a run begins — the `renderMenu`/`renderGameOver` start callbacks in `showScreen()`, or `startRun`'s call site. This alone removes the reported path.

**(b) Stop depending on one resume signal.** `visibilitychange` is not a contract in a WebView. Add `pageshow` and `window.focus` as additional resume triggers, and a document-level `pointerdown` fallback: if `state.paused && !pausePanelOpen`, resume. A tap on the screen must always be able to wake the game. All of it goes through the existing `resumeRun()` — do not add a second parallel mechanism, the 9.3 comment is right about that.

**(c) A liveness watchdog.** While paused, run a `setInterval` (500 ms is plenty) that checks `state.screen === SCREEN.PLAYING && !state.paused && rafHandle === null` and calls `startLoop()`. Clear it when the loop is running. This is the backstop that catches whatever path nobody has thought of yet — and this bug has now proved that path exists.

Keep `cancelAnimationFrame` on a genuine pause. A 500 ms interval is not a 60 Hz loop, and the certification concern the existing comment describes still holds.

**(d) The loop must not be able to die from a throw.** Wrap `loop()`'s body in `try/catch`: log the error, and re-arm anyway. An uncaught exception anywhere in `update()`, `drawFrame()` or `drawBackground()` currently skips the tail `startLoop()` and bricks the game identically. One bad frame is recoverable; a dead rAF chain is not.

### Tests that must exist afterwards

- **The reproduction above, as a Playwright test.** Force `document.hidden` true without a resume, tap Play Again, assert the rAF callback count keeps rising. This is the regression test; write it first and watch it fail.
- The same with `hidden` fired **mid-run**, then a tap on the canvas: assert the game resumes.
- A test that throws inside `drawBackground` once and asserts the loop survives.

### What is NOT the cause — checked, so nobody re-checks it

- `js/physics.js` is clean: 3,000 simulated runs, 531,826 random operations (drops, hard drops, remover, swap, bomb, Extra Row on and off) with an invariant assert after every step — `stackHeight[c]` always equalled the true column count, no column ever held a hole, nothing ever threw.
- The ordinary game-over path works: spawn column full → `endRun('grid-full')` → game-over overlay, 40 restart cycles clean.
- The save blob (`toSaveBlob`) holds no grid, score or screen, so a reload cannot restore a broken mid-run state.
- `js/background.js` guards its null cases (`boardRect`, `shapes`) correctly.

---

## 12.2 — Run length: the spawn column is the whole problem

### What I found by playing it

On the live `-13` build, I started a run and **touched nothing**. Game over in **13 seconds**, after 9 spawns, score 11, final column heights `0,0,0,7,0,0`.

Five of six columns completely empty. **35 of 42 cells unused. The board was 17% full and the run was over.**

That is not a difficulty setting, it is a structural flaw. `spawnFruit` always spawns at `Math.floor(COLS / 2)` = column 3, and `isGameOver` checks only that same column. Every fruit the player fails to steer lands in the one column that ends the game, and no amount of free space anywhere else counts for anything.

It also explains the player's own screenshots exactly: column 3 at 7/7, every other column at 2–3.

### The ramp is not the cause

Bot data, 400 runs per level on the current build:

| player | median drops | median run | median score | board used at end |
|--------|--------------|------------|--------------|-------------------|
| novice (55% good placements) | 281 | 3m 56s | 5,904 | 83% |
| casual (75%) | 456 | 5m 54s | 10,652 | 98% |

And the ramp itself opens at 156 px/s (0.6× baseline), reaches 260 px/s only at drop 40, and caps at 1.3×. A run that ends in under a minute did not end because the game got fast. **Do not spend this phase slowing the game down.**

### Measured comparison of three spawn rules

300 runs each, same bot, same everything else:

| spawn rule | does nothing | novice | casual |
|------------|--------------|--------|--------|
| **ends when column 3 fills (today)** | 16s · 37 pts · 17% board | 236s · 5,904 | 354s · 10,652 |
| spawn relocates to nearest open column | 151s · **5,645** · 100% | 257s · 6,884 | 357s · 10,369 |
| **spawn column varies each drop** | **136s · 2,416 · 100%** | 252s · 6,512 | 334s · 9,669 |

Relocation alone fixes the length but breaks the game the other way: a player who does *literally nothing* scores 5,645, more than double the owner's real personal best. Everything lands in one column, and with `SPAWN_POOL` half cherries they merge themselves.

**Varying the spawn column is the answer.** A passive run goes from 16s to 136s — long enough to learn the game — while scoring only 2,416, because scattered fruit do not self-merge. Skilled play gets slightly *harder* (−6% time, −9% score), which is the right direction.

### What to build

1. **Vary the spawn column each drop.** Pick a column per drop; if it is full, fall back to the nearest open one — `columnForX` already contains that exact search, so reuse it rather than writing a second copy.
2. **Game over becomes "no column has room", not "column 3 is full".** `isGameOver` currently reads one index; it must check all of them.
3. **The player must be able to see where the next fruit will drop.** This is the part that is not a one-liner. The "Next" preview currently shows *what* is coming; it now has to show *where* too — the honest minimum is highlighting the incoming column on the board before the fruit appears. Without it, varying the spawn is just unfair.
4. **The danger indicator follows.** `drawDangerState` currently pulses the spawn column. With a varying spawn it should mark *any* column within `DANGER_ROWS_REMAINING` of the top.

### Also worth doing, and much cheaper

**A spawn hang.** Hold each new fruit at the top for ~0.35 s before gravity engages — one counter on `state.active`. Tetris calls it lock delay. It adds decision time to every drop without touching the difficulty curve, and it pairs well with (3) above: the beat where the fruit hangs is exactly when the player reads which column it is in.

### Sequencing

Ship 12.1 first and **re-judge the pacing after it**. Some of "runs are too short" is runs cut short by the freeze. And do not change `SPAWN_POOL`, `MILESTONE_SCORES`, the combo window, or `ROWS` in the same phase as the spawn rule — one lever at a time, or nobody can tell what did what.

## 12.3 — The backdrop, with depth

### What the new reference image adds

Falling Tetris blocks against a sunset, above cloud. It shares the framing of the earlier three references, but it carries one thing they did not: **depth, built from scale.** Large blocks near the camera, tiny ones far away, all of them falling and tumbling. That is what makes it read as a world rather than a pattern.

Phase 11's shapes are uniform-ish in size, uniform in alpha, and drift *upward*. Change three things:

**(a) They fall.** Reverse `vy`. The backdrop becomes a slower, larger echo of what the player is doing, instead of decoration that happens to move. This is the whole idea.

**(b) Three depth bands, not one population.** Assign each shape a band at build time:

| band | radius | alpha | speed | count |
|------|--------|-------|-------|-------|
| far | 10–22 px | 0.04 | 4–8 px/s | 8 |
| mid | 28–48 px | 0.07 | 10–18 px/s | 6 |
| near | 65–115 px | 0.10 | 25–40 px/s | 4 |

Parallax is what the eye reads as depth. The near band being large, faster, and partly hidden behind the board panel — which happens for free, the board canvas is on top — is the effect.

**(c) Slow tumble.** Raise `spin` for the near band only; a large shape rotating slowly reads as mass, a small one reads as noise.

**Known weak spot to fix while in here:** on the Midnight theme (score ≥ 8000, `page: #05080F`) the ground darkened a further 30% is effectively black and the whole backdrop disappears. Raise `BG_HALO_PEAK_ALPHA` and reduce `BG_GROUND_DARKEN` on the darkest stop so the composition survives the end of a good run — which is exactly when the player is most invested.

Still no image files, still no network requests, still nothing drawn that is not drawn in code.

---

## 12.4 — The menu, and the type

### The copy

Current: *"Drag falling fruit, merge matching pairs, chase the watermelon."*

It is an instruction manual on a title screen, and it gives away the ending in the first sentence anyone reads. Split invitation from instruction:

```
Two of a kind, and — poof.
```

as the lead, with the mechanic demoted to a smaller line beneath:

```
Drag to steer. Match to merge.
```

The name of the game becomes the payoff of the sentence, the player learns the rule in five words, and nothing is spoiled.

### The face

Fredoka is not a bad choice — rounded, warm, and its numerals are genuinely good at 13 px, which matters more than it sounds when the HUD is four stacked readouts. Do not throw it away. **Pair it instead:**

- **Baloo 2** (SIL OFL, variable, on Google Fonts) for the display type — the title and the headings on the menu, shop and game-over screens. Heavier, more candy, more character than Fredoka at large sizes.
- **Fredoka stays** for body copy and, critically, for everything drawn on the canvas.

Self-host it in `assets/fonts` exactly as Fredoka is, with the OFL text alongside — a CDN font cannot be precached by the service worker and would break offline play. That is already written down in `css/style.css`'s `@font-face` comment; follow it.

**LANDMINE.** `FONT_FAMILY` in `js/constants.js` feeds every `ctx.font` in `js/render.js`, and the HUD layout is tuned to Fredoka's metrics — `POWER_SLOT`'s own comment records digits spilling 6 px over the board at `y=86`. **Do not point `FONT_FAMILY` at the new face.** Baloo 2 is a DOM-only change: the menu, shop and game-over screens. The canvas keeps Fredoka. If anyone wants the canvas changed too, that is its own phase with its own screenshots.

---

## 12.5 — Pre-existing, log it, do not fix it here

The shipped game's worst text-on-board contrast is **4.5587:1 at score ~5515**, against a 4.5:1 floor — a margin of six hundredths. `unit-tests/theme-contrast.js` passes, which is why nobody has noticed. Any future change to `THEMES` stop 2 or 3, to `MILESTONE_SCORES`, or to anything drawn behind the HUD text breaks legibility on live.

Not phase 12's job. Write it into `docs/playables-plan.md` as a known risk so the next person to touch the palette knows the margin they are working inside.

---

## Definition of done

- [ ] 12.1 (a)–(d) implemented; the freeze reproduction exists as a Playwright test and passes; the mid-run variant and the throw-survival test pass
- [ ] spawn column varies per drop; game over is board-full, not column-full; the incoming column is shown to the player before the fruit appears; danger indicator follows any column; spawn hang in
- [ ] `SPAWN_POOL`, `MILESTONE_SCORES`, the combo window, `ROWS` and the gravity ramp all UNCHANGED this phase
- [ ] backdrop shapes fall, in three depth bands; Midnight stop retuned so the backdrop survives it
- [ ] menu copy replaced; Baloo 2 self-hosted and used in the DOM only; `FONT_FAMILY` unchanged
- [ ] contrast margin recorded in `docs/playables-plan.md`
- [ ] all unit tests, prohibited-API sweep, `build-playables.js` and the Playwright suite green
- [ ] `BUILD_VERSION` → `2026.08.28-14` in **both** `js/constants.js` and `service-worker.js`
- [ ] screenshots at 390×844: menu, mid-run, Midnight-theme run
- [ ] committed as **12.1 — the freeze**, then **12.2 — the spawn column**, then **12.3/12.4 — backdrop and type**, so the freeze fix can be deployed on its own if the rest needs more work
