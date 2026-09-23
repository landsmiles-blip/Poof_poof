# Phase 24 — the Playgama Bridge, and an ad at game over

## Why

Playgama's upload form states it plainly: "The Playgama SDK must be integrated
into the game." Without it the submission cannot be made at all, on any
platform. Their API overview lists six required steps, and the sixth is not
optional either: "Show interstitial ads at natural pauses, such as level
transitions or game over."

So this phase is not "add ads if we feel like it." It is the minimum that makes
the game submittable, plus the one ad that submission requires.

## What the Bridge is

One JavaScript file that sits between the game and whichever site the game is
running on — about thirty of them, YouTube Playables included. It detects the
site by hostname (Playables is `usercontent.goog`) and translates one API into
whatever that site actually speaks.

Playgama publishes to YouTube under their own master publisher account, so the
Bridge's YouTube path wraps exactly the `ytgame` calls `createYtgameImpl`
already makes: `game.loadData`/`saveData`, `system.onPause`/`onResume`,
`system.isAudioEnabled`, `engagement.sendScore`, `ads.requestInterstitialAd`.

## The shape of the change

`js/platform.js` was already an adapter — one interface, two implementations
chosen once at boot. This adds a third, `createBridgeImpl`, behind the same
interface. No other file learns that the Bridge exists.

Selection order is Bridge, then ytgame, then local. Where the Bridge is present
it owns the platform including YouTube, because running both layers would put
two wrappers on one SDK. The Bridge script ships only in the Playgama archive,
so on GitHub Pages and in a direct Playables submission `window.bridge` is
undefined and selection is byte-for-byte what it was before.

Each required step and where it is answered:

| Playgama's required step | Answered by |
| --- | --- |
| wait for initialization | `init()` awaits `bridge.initialize()` |
| localize via `platform.language` | `language()` |
| save/load through Storage | `load()` / `save()` / `flush()` → `bridge.storage` |
| subscribe to pause and audio | `onPause`/`onResume` (one `pause_state_changed` event, split on its edge), `onAudioEnabledChange` |
| send `game_ready` | `gameReady()` → `platform.sendMessage('game_ready')` |
| interstitial at a natural pause | `showInterstitial()`, called by `js/main.js` on game over |

`firstFrameReady()` is deliberately a no-op on this path: the Bridge's own
YouTube implementation calls `ytgame.game.firstFrameReady()` when its
`initialize()` resolves, and calling it again here would double it.

The score goes through `bridge.leaderboards.setScore('highscore', n)`. The id
matters: Playgama's YouTube bridge rejects a leaderboard that is not marked
`isMain`, and routes a main one to the same `engagement.sendScore({ value })`
the direct build already calls. Hence the one entry in the config.

## The interstitial

Fired in `js/main.js` after `showScreen()` on game over, so the ad closes back
onto the finished board and the Play Again button rather than a blank frame.
Wired on the ytgame path too, not just the Bridge — the direct Playables
submission should earn as well, and the requirements name
`ytgame.ads.requestInterstitialAd()` as the integration point.

Not fired on quit-to-menu: that is the player choosing to leave, and charging
them an ad for it reads as a punishment.

No throttle of our own. Both hosts enforce a minimum gap (the Bridge defaults
to 60 seconds and drops early calls itself) and a second timer on our side
would only disagree with theirs.

## Three findings from reading their source, not their docs

**The YouTube SDK tag is not optional in the Playgama archive.** The Bridge
reaches `ytgame` through a `waitFor` helper that is a bare `setInterval` with
no timeout. Nothing in the Bridge loads Google's SDK. Drop the
`https://www.youtube.com/game_api/v1` tag and `bridge.initialize()` never
resolves — the game hangs on the loading screen with no error to read. The tag
stays, and `tools/build-playables.js` has a comment saying why.

**Cross-promo would breach a Playables rule, and is off by default.** On pause
the Bridge's YouTube path can render tiles to other games as real
`<a target="_blank">` links. Playables §6.2: "Game MUST NOT display clickable
links that take users directly to external content, such as other sites or
games." The module reads a `crossPromo` block from the config; with none, its
game list is empty and it returns before rendering. The config has none, and
that is a decision, not an omission.

**Analytics disables itself on YouTube, so it is left on.** The analytics
module posts to `api.playgama.com`, which Playables §3 would forbid — but
`AnalyticsModule.initialize` reads
`this._platformBridge.isPlatformExternalCallsSupported`, and
`YoutubePlatformBridge` returns `false` for it, so analytics turns itself off
there. Everywhere else it is what feeds Playgama's dashboard. Setting
`sendAnalyticsEvents: false` would buy nothing on YouTube and cost the play
counts everywhere else.

**Not resolved: the subscribe prompt.** On YouTube desktop the Bridge injects
an animated "SUBSCRIBE" button during loading, removed when `game_ready` is
sent. There is no config flag for it — `#createSubscribeNotification()` is
called unconditionally for `DEVICE_TYPE.DESKTOP`. Playables §6.1 is "Game MUST
NOT display in-game sharing prompts." A subscribe prompt is not literally a
sharing prompt, but it is adjacent, and we do not control it. This is a reason
the direct submission keeps its own Bridge-free build rather than a reason to
avoid Playgama.

## Not in this phase

The rewarded ad. It is the highest-paying format and it fits the Phase 23
clutch, but "what does watching an ad actually give the player" is a game
design decision, not an SDK chore. Bolting a reward on inside an integration
commit is how an economy gets broken. It gets its own phase.

`videoPreviews` is also left out of the config for now. `{ image, videoId }`
puts a channel video in the corner of the desktop loading screen, opened
through `ytgame.engagement.openYTContent` — which is in Google's own Playables
reference, so it is a sanctioned call, not a workaround. It needs a video
chosen first.

## Builds

One script, two archives:

    node tools/build-playables.js              -> dist/playables/   0.447 MiB
    node tools/build-playables.js --playgama   -> dist/playgama/    0.732 MiB

One script and not two on purpose. Every guard — the orientation check, the
`?dev=1` strip, the debug-hook strip, the `createLocalImpl` certification
strip, the index.html sync check — has to hold for both, because Playgama can
distribute the Playgama archive to Playables. A forked second script would
drift and quietly lose one.

The Bridge is vendored at `vendor/playgama-bridge.js` (v2.2.0, from the
published npm package, LGPL-3.0) rather than loaded from Playgama's CDN.
Playables §3 forbids external calls to anything that is not a Google or
YouTube API, and a `<script src="https://bridge.playgama.com/...">` tag is
exactly that. 298 KB raw, 73.5 KB gzipped, against a 30 MiB limit.

## Verification

`node tools/check-playgama.cjs` — seven checks, in a real browser, against
the built archive:

    1. the Bridge path is selected                           selected:bridge
    2. bridge.initialize() was called and resolved
    3. the save is loaded through bridge.storage
    4. game_ready sent exactly once
    5. a run played to a real game over fires the
       interstitial with the 'game_over' placement           85 drops, score 1542
    6. the finished run is written back through bridge.storage
    0. no uncaught console errors

Method note, because the first attempt was wrong and produced four false
failures. Spying on the minified Bridge bundle from outside does not work: its
modules are getters that throw before `initialize()`, and its methods are class
fields, so a wrapper installed at the wrong moment silently observes nothing —
which looks exactly like "the game never called it." The checker now
instruments *our* seam instead, in a throwaway copy of the archive, with
exact-text anchors that throw if `js/platform.js` moves on. The shipped archive
is never modified.

Check 5 runs against the repo tree rather than the archive, with the Bridge and
config copied in beside it: the archive has no debug hook (the build strips it)
and driving a hundred drops through synthetic pointer events proved slow and
unreliable — a click is not the drag the input layer expects, and most of them
never landed. Same `platform.js`, same `main.js`, same Bridge build, same
probes; what differs is only that the run can be played to its real end.

Also green: 38/38 unit tests (`unit-tests/bridge.js` is new — it holds the
Bridge impl to the same "must never take the game down" contract as the other
two, and asserts the exact calls and arguments the SDK receives), and
`tools/check-prohibited-apis.js` still clean on `dist/playables`.
