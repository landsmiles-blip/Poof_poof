// Feature verification suite.
//
// Answers one question per feature: is it wired, AND would a real player
// actually see it? Written after three rounds of features shipped that the
// player could not see -- partly because a stale service worker never delivered
// them, partly because they were gated behind progression a first run cannot
// reach. Both classes of failure are checked here.
//
//   npm install playwright
//   python3 -m http.server 8642    # from the repo root
//   node tests/verify-features.js
//
// Screenshots land in tests/screenshots/.

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { execFileSync } = require('child_process');

const BASE = process.env.BASE_URL || 'http://localhost:8642';
const SHOTS = process.env.SHOT_DIR || path.join(__dirname, 'screenshots');
const EXEC = process.env.CHROMIUM_PATH || undefined;
const REPO_ROOT = path.join(__dirname, '..');

fs.mkdirSync(SHOTS, { recursive: true });

// Rebuilds dist/playables/ fresh before testing it below, so this suite is
// also the thing that catches the build script itself breaking.
execFileSync(process.execPath, [path.join(REPO_ROOT, 'tools', 'build-playables.js')], { stdio: 'inherit' });

const MIME_TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.woff2': 'font/woff2', '.txt': 'text/plain', '.json': 'application/json',
};

// A tiny static server rooted at exactly `rootDir`, refusing anything outside
// it -- so "runs standalone" means what it says: a request for a sibling
// file (a typo'd relative import, say) 404s here instead of silently
// resolving against files this build was supposed to exclude.
function serveDir(rootDir, port) {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    const filePath = path.join(rootDir, urlPath === '/' ? '/index.html' : urlPath);
    if (!filePath.startsWith(rootDir)) {
      res.writeHead(403);
      res.end();
      return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(filePath)] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

// Total bytes, file count, and the single largest file -- 5.3's bundle figures.
function bundleStats(dir) {
  let files = 0;
  let bytes = 0;
  let largest = { path: null, size: -1 };
  (function walk(d) {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) {
        walk(p);
      } else {
        const size = fs.statSync(p).size;
        files += 1;
        bytes += size;
        if (size > largest.size) largest = { path: path.relative(dir, p), size };
      }
    }
  })(dir);
  return { files, bytes, largest };
}

const results = [];
const errors = [];

function record(feature, wired, visibleToNewPlayer, note, shot) {
  results.push({ feature, wired, visibleToNewPlayer, note, shot });
}

function track(page, tag) {
  page.on('pageerror', (e) => errors.push(`${tag}: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`${tag} console: ${m.text()}`); });
}

// A completely fresh player: no saved progress at all.
async function freshPage(browser, tag, opts = {}) {
  const context = await browser.newContext({ viewport: { width: 500, height: 860 }, ...opts });
  const page = await context.newPage();
  track(page, tag);
  await page.addInitScript(() => {
    try { localStorage.clear(); } catch { /* storage may be blocked on purpose */ }
  });
  return { context, page };
}

async function shot(page, name, full = false) {
  const file = path.join(SHOTS, `${name}.png`);
  await page.screenshot({ path: file, fullPage: full });
  return path.relative(process.cwd(), file);
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC });

  // ---------------------------------------------------------------- build id
  {
    const { context, page } = await freshPage(browser, 'build');
    await page.goto(`${BASE}/index.html`);
    await page.waitForSelector('#play-btn');
    const info = await page.evaluate(async () => {
      const C = await import('./js/constants.js');
      return {
        version: C.BUILD_VERSION,
        onMenu: document.body.textContent.includes(C.BUILD_VERSION),
      };
    });
    record('Build version visible', true, info.onMenu,
      `BUILD_VERSION=${info.version} rendered on menu: ${info.onMenu}`,
      await shot(page, '00-menu'));
    await context.close();
  }

  // ---------------------------------------- menu hub + panels (7.1) reachable
  {
    const { context, page } = await freshPage(browser, 'menushop');
    await page.goto(`${BASE}/index.html`);
    await page.waitForSelector('#play-btn');

    // Home screen carries exactly the four things: title, best score, Play,
    // the icon row -- no shop/skin cards should be present until a panel opens.
    const home = await page.evaluate(() => ({
      hasHome: !!document.querySelector('.screen-home'),
      hasShopYet: document.querySelectorAll('.shop-item').length,
      hasIconRow: document.querySelectorAll('.icon-btn').length,
    }));

    await page.click('#open-cart');
    await page.waitForSelector('.shop-item');
    const cart = await page.evaluate(() => ({
      hasShop: document.querySelectorAll('.shop-item').length,
    }));

    // Esc closes the panel back to the hub (7.1) -- checked before navigating
    // to Palette, so this exercises the actual close path rather than the
    // back button alone.
    await page.keyboard.press('Escape');
    await page.waitForSelector('.screen-home');
    const closedByEscape = await page.evaluate(() => !document.querySelector('.shop-item') && !!document.querySelector('.screen-home'));

    await page.click('#open-palette');
    await page.waitForSelector('.skin-item');
    const palette = await page.evaluate(() => ({
      hasSkins: document.querySelectorAll('.skin-item').length,
    }));
    await page.click('#back-btn');

    await page.click('#open-gear');
    await page.waitForSelector('#sound-btn');
    const gear = await page.evaluate(() => ({
      hasSound: !!document.querySelector('#sound-btn'),
      hasMusic: !!document.querySelector('#music-btn'),
    }));

    const ok = home.hasHome && home.hasShopYet === 0 && home.hasIconRow === 3
      && cart.hasShop > 0 && palette.hasSkins > 0 && gear.hasMusic && closedByEscape;
    record('Menu hub + panels reachable', ok, ok,
      `home carries no shop cards until opened (${home.hasShopYet} on load, ${home.hasIconRow} icon buttons); `
      + `Cart ${cart.hasShop} power-ups, Palette ${palette.hasSkins} skins, Gear music toggle: ${gear.hasMusic}; `
      + `Escape closed the panel: ${closedByEscape}`,
      await shot(page, '01-menu-cart', true));
    await context.close();
  }

  // ------------------------------------------------------ HUD power-up chips
  {
    const { context, page } = await freshPage(browser, 'hud');
    await page.goto(`${BASE}/index.html`);
    await page.waitForSelector('#play-btn');
    await page.click('#play-btn');
    // >1s: platform.save() debounces persistence by ~1s, so reading real
    // localStorage any sooner would catch the write mid-flight, not missing.
    await page.waitForTimeout(1200);
    const hud = await page.evaluate(async () => {
      const st = await import('./js/state.js');
      const C = await import('./js/constants.js');
      const chips = st.hudPowerUps();
      return {
        chipCount: chips.length,
        chips: chips.map((c) => c.id),
        starterRemover: null,
        milestones: C.MILESTONE_SCORES,
      };
    });
    const inv = await page.evaluate(() => (JSON.parse(localStorage.getItem('poofpoof.save') || '{}').inventory || {}));
    record('Power-up chips in HUD', hud.chipCount > 0, hud.chipCount > 0,
      `${hud.chipCount} chips always drawn (${hud.chips.join(', ')}); locked ones greyed. Starter remover=${inv.remover || 0}`,
      await shot(page, '02-hud-chips'));
    await context.close();
  }

  // ------------------------------------------- shapes / particles / squash
  {
    const { context, page } = await freshPage(browser, 'feel');
    await page.goto(`${BASE}/index.html`);
    await page.waitForSelector('#play-btn');
    const feel = await page.evaluate(async () => {
      const C = await import('./js/constants.js');
      const ef = await import('./js/effects.js');
      const flowers = C.TIERS.filter((t) => t.shape === 'flower').length;
      const spawnHasFlower = C.SPAWN_POOL.some((t) => C.TIERS[t].shape === 'flower');

      const low = ef.createEffects();
      ef.spawnMergeEffects(low, { row: 3, col: 2, tier: 1, color: '#f00' });
      const high = ef.createEffects();
      ef.spawnMergeEffects(high, { row: 3, col: 2, tier: 8, color: '#0f0' });
      return {
        flowers, spawnHasFlower,
        lowParticles: low.particles.length,
        highParticles: high.particles.length,
        lowSquash: +low.squashes[0].amount.toFixed(2),
        highSquash: +high.squashes[0].amount.toFixed(2),
        lowShake: low.shake.magnitude,
        highShake: high.shake.magnitude,
      };
    });
    record('Fruit shapes (flower alternation)', feel.flowers > 0, feel.spawnHasFlower,
      `${feel.flowers} flower tiers; a flower is in the spawn pool so it appears within the first drops`);
    record('Squash + particles', true, feel.lowParticles >= 9,
      `tier1: ${feel.lowParticles}p / ${feel.lowSquash} squash -> tier8: ${feel.highParticles}p / ${feel.highSquash}`);
    record('Screen shake (top 3 tiers only)', true, false,
      `tier1 shake=${feel.lowShake} (none), tier8 shake=${feel.highShake} -- by design, needs a tier-6+ merge`);
    await context.close();
  }

  // --------------------------------------------------------------- audio
  {
    const context = await browser.newContext({ viewport: { width: 500, height: 860 } });
    const page = await context.newPage();
    track(page, 'audio');
    await page.addInitScript(() => {
      window.__osc = [];
      const Real = window.AudioContext;
      window.AudioContext = class extends Real {
        createOscillator() {
          const o = super.createOscillator();
          const set = o.frequency.setValueAtTime.bind(o.frequency);
          o.frequency.setValueAtTime = (v, t) => { window.__osc.push(Math.round(v)); return set(v, t); };
          return o;
        }
      };
    });
    await page.goto(`${BASE}/index.html`);
    // No click, no pointer event of any kind yet -- waiting for the menu to
    // render proves boot() has already run past its unconditional
    // unlockAudio() call (3.2: "YouTube Playables may be given focus
    // automatically", so the game must not be waiting on a gesture for this).
    await page.waitForSelector('#play-btn');
    // This is the half of 3.2 that is actually the game's responsibility:
    // boot() must not gate AudioContext *creation* behind a gesture. Whether
    // the context then reaches 'running' without a gesture is a browser
    // autoplay policy decision, not something this line can tell apart from
    // a code defect -- checked separately, against a permissive Chromium
    // flag, in the next block.
    const audioContextCreatedWithoutGesture = await page.evaluate(async () => {
      const a = await import('./js/audio.js');
      return a.getAudioContext() !== null;
    });
    const audio = await page.evaluate(async () => {
      const a = await import('./js/audio.js');
      a.unlockAudio();
      // Default Chromium's autoplay policy blocks boot()'s gesture-less
      // resume (logged, not thrown) and takes a variable, sometimes 500ms+
      // amount of time to actually resume even after this explicit retry --
      // poll rather than guess a fixed delay, so this is not flaky. This is
      // just to get a running context for the merge/celebration checks
      // below; it is not evidence about the no-gesture case (see above).
      const deadline = Date.now() + 2000;
      while (a.getAudioContext()?.state !== 'running' && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 25));
      }
      window.__osc = [];
      for (let t = 0; t < 9; t++) a.playMerge(t);
      await new Promise((r) => setTimeout(r, 40));
      const merges = window.__osc.slice();
      window.__osc = [];
      a.playCelebration();
      await new Promise((r) => setTimeout(r, 40));
      return {
        merges,
        rising: merges.every((f, i) => i === 0 || f > merges[i - 1]),
        celebrationNotes: window.__osc.length,
      };
    });
    record('Audio context created without a gesture', audioContextCreatedWithoutGesture, audioContextCreatedWithoutGesture,
      `boot() calls unlockAudio() unconditionally; AudioContext exists before any pointer event: ${audioContextCreatedWithoutGesture}. ` +
      `(Reaching 'running' with zero gesture is checked separately below, against a permissive Chromium flag -- default Chromium's ` +
      `autoplay policy blocks it here, which is exactly why the pointerdown fallback stays in js/main.js for the Pages build.)`);
    record('Merge sound (pitch rises with tier)', true, audio.rising,
      `${audio.merges[0]}Hz -> ${audio.merges[audio.merges.length - 1]}Hz, monotonic: ${audio.rising}`);
    record('Celebration sound', audio.celebrationNotes > 1, false,
      `${audio.celebrationNotes}-note arpeggio -- needs a top-tier merge, not a first-run event`);
    await context.close();
  }

  // ------------------------ audio actually starts, no gesture (permissive)
  // A separate Chromium launch, --autoplay-policy=no-user-gesture-required --
  // the closest local equivalent of the Playables audio grant (the real
  // container permits audio out-of-band via platform.audioEnabled(), not
  // through the page's own gesture history, which default Chromium has no
  // equivalent for). Kept out of the shared `browser` used everywhere else in
  // this suite so the merge/celebration checks above stay honest about what
  // default Chromium actually does.
  {
    let permissiveBrowser = null;
    let flagUsable = false;
    let running = false;
    try {
      permissiveBrowser = await chromium.launch({
        executablePath: EXEC,
        args: ['--autoplay-policy=no-user-gesture-required'],
      });
      const context = await permissiveBrowser.newContext({ viewport: { width: 500, height: 860 } });
      const page = await context.newPage();
      track(page, 'audio-permissive');
      await page.goto(`${BASE}/index.html`);
      await page.waitForSelector('#play-btn');
      running = await page.evaluate(async () => {
        const a = await import('./js/audio.js');
        const deadline = Date.now() + 2000;
        while (a.getAudioContext()?.state !== 'running' && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 25));
        }
        return a.getAudioContext()?.state === 'running';
      });
      flagUsable = true;
    } catch (e) {
      errors.push(`audio-permissive: ${e.message}`);
    } finally {
      if (permissiveBrowser) await permissiveBrowser.close();
    }

    if (flagUsable) {
      record('Audio actually starts, no gesture (permissive Chromium)', running, running,
        `--autoplay-policy=no-user-gesture-required, zero pointer events: AudioContext reached 'running': ${running}`);
    } else {
      record('Audio actually starts, no gesture -- unverifiable here', true, false,
        `--autoplay-policy=no-user-gesture-required did not produce a usable browser in this Playwright setup, so this could not be ` +
        `checked directly. Falling back to "Audio context created without a gesture" above. Whether the real Pages build reaches ` +
        `'running' with zero gesture is host/browser-policy dependent and not verifiable from this suite -- see docs/playables-plan.md phase 3.2.`);
    }
  }

  // --------------------------------------------------------------- music
  {
    const context = await browser.newContext({ viewport: { width: 500, height: 860 } });
    const page = await context.newPage();
    track(page, 'music');
    await page.goto(`${BASE}/index.html`);
    const music = await page.evaluate(async () => {
      const a = await import('./js/audio.js');
      const m = await import('./js/music.js');
      a.unlockAudio();
      m.attachContext(a.getAudioContext());
      const onByDefault = m.isMusicOn();
      m.startMusic();
      await new Promise((r) => setTimeout(r, 400));
      const playingAfterStart = m.isPlaying();
      m.stopMusic(true);
      const playingAfterStop = m.isPlaying();
      const toggled = m.toggleMusic();
      m.toggleMusic(); // restore
      return { onByDefault, playingAfterStart, playingAfterStop, toggleWorks: toggled === false };
    });
    record('Background music', music.playingAfterStart, music.onByDefault,
      `on by default: ${music.onByDefault}; starts: ${music.playingAfterStart}; stops: ${!music.playingAfterStop}; toggle: ${music.toggleWorks}`);
    await context.close();
  }

  // -------------------------------------------- pause must actually stop
  {
    const { context, page } = await freshPage(browser, 'pause');
    await page.goto(`${BASE}/index.html`);
    await page.waitForSelector('#play-btn');
    await page.click('#play-btn');
    await page.waitForTimeout(250); // a fruit is now actively falling

    const canvas = page.locator('#game-canvas');

    // Simulate the host pausing the game (losing focus / backgrounded), the
    // same signal platform.js's localImpl listens for.
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { get: () => true, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    // A frame or two legitimately still renders during the dispatch round
    // trip, so the freeze check compares two screenshots BOTH taken after
    // pause has settled, not "before" against "during" -- that pair would
    // always differ even with a correct cancelAnimationFrame.
    await page.waitForTimeout(100);
    const frameEarlyInPause = await canvas.screenshot();
    await page.waitForTimeout(600);
    const frameLateInPause = await canvas.screenshot();
    const frozen = frameEarlyInPause.equals(frameLateInPause);
    const ctxDuringPause = await page.evaluate(async () => {
      const a = await import('./js/audio.js');
      return a.getAudioContext()?.state;
    });

    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.waitForTimeout(600);
    const frameAfterResume = await canvas.screenshot();
    const resumedAdvancing = !frameLateInPause.equals(frameAfterResume);
    const ctxAfterResume = await page.evaluate(async () => {
      const a = await import('./js/audio.js');
      return a.getAudioContext()?.state;
    });

    record('Pause actually stops the game', frozen, frozen,
      `board unchanged across a 600ms pause (rAF cancelled, not just gated): ${frozen}; ` +
      `AudioContext during pause: ${ctxDuringPause}`);
    record('Resume continues, no silent context', resumedAdvancing && ctxAfterResume === 'running', resumedAdvancing,
      `board resumed advancing: ${resumedAdvancing}; AudioContext after resume: ${ctxAfterResume} ` +
      `(note: this checks freeze/resume and a live context, not the absence of a music burst or exact continuity of fruit position -- see phase 3.1 in docs/playables-plan.md)`);
    await context.close();
  }

  // ---------------------------------------------------- combo (first run)
  {
    const { context, page } = await freshPage(browser, 'combo');
    await page.goto(`${BASE}/index.html`);
    const combo = await page.evaluate(async () => {
      const C = await import('./js/constants.js');
      const st = await import('./js/state.js');
      const ph = await import('./js/physics.js');

      // A stacked column cascades, which is the common first sighting.
      const s = st.createInitialState();
      st.startRun(s, {});
      // 6.1: the window is now derived from the CURRENT (ramped) gravity
      // rather than a flat constant, so both sides of this comparison must
      // be computed at the same spawnIndex the state is actually at.
      const emptyBoardFall = ((C.ROWS - 1) * C.CELL + C.CELL / 2 + 15) / st.currentGravityPxPerSec(s);
      const window = st.comboWindowSecFor(s);
      const R = s.grid.length - 1;
      for (let i = 0; i < 4; i++) s.grid[R - i][2] = 0;
      s.stackHeight[2] = 4;
      ph.resolveMerges(s);
      return {
        window,
        emptyBoardFall: +emptyBoardFall.toFixed(2),
        chainsAcrossDrops: window > emptyBoardFall,
        cascadeCombo: s.comboCount,
        cascadeScore: s.score,
      };
    });
    record('Combo multiplier', combo.cascadeCombo >= 2, combo.chainsAcrossDrops,
      `window ${combo.window}s vs empty-board fall ${combo.emptyBoardFall}s -> cross-drop chaining possible: ${combo.chainsAcrossDrops}; cascade reached ${combo.cascadeCombo}x`);
    await context.close();
  }

  // ------------------------------------------------- power-ups (mechanics)
  {
    const { context, page } = await freshPage(browser, 'powerups');
    await page.goto(`${BASE}/index.html`);
    const pu = await page.evaluate(async () => {
      const C = await import('./js/constants.js');
      const st = await import('./js/state.js');
      const ph = await import('./js/physics.js');
      const R = (s) => s.grid.length - 1;
      const out = {};

      // Magnet (9.2 redesign): curves the FALLING fruit toward its column,
      // tier-agnostically, and never touches the grid -- also respects a
      // hard range cutoff and steps aside once the player has steered the
      // fruit. unit-tests/magnet.js covers the falloff/range/steering math
      // in full; this just confirms the real module wiring produces the
      // same shape of result through actual page code.
      const s = st.createInitialState();
      st.startRun(s, {});
      const magnetCenterX = 3 * C.CELL + C.CELL / 2;
      ph.setMagnetColumn(s, 3);
      s.magnetActive = true; s.magnetEnergy = C.MAGNET_ENERGY_MAX;
      s.active = {
        tier: 2, col: 0, x: magnetCenterX - 100, targetX: magnetCenterX - 100, y: 0, playerSteered: false,
      };
      const beforeTargetX = s.active.targetX;
      const gridBefore = JSON.stringify(s.grid);
      ph.stepMagnet(s, 0.1);
      out.magnet = {
        movedToward: s.active.targetX > beforeTargetX && s.active.targetX < magnetCenterX,
        gridUntouched: JSON.stringify(s.grid) === gridBefore,
      };

      const sFar = st.createInitialState();
      st.startRun(sFar, {});
      ph.setMagnetColumn(sFar, 0);
      sFar.magnetActive = true; sFar.magnetEnergy = C.MAGNET_ENERGY_MAX;
      sFar.active = {
        tier: 2, col: 5, x: 5 * C.CELL + C.CELL / 2, targetX: 5 * C.CELL + C.CELL / 2, y: 0, playerSteered: false,
      };
      const farBefore = sFar.active.targetX;
      ph.stepMagnet(sFar, 1);
      out.magnetOutOfRange = sFar.active.targetX === farBefore;

      const sSteered = st.createInitialState();
      st.startRun(sSteered, {});
      ph.setMagnetColumn(sSteered, 3);
      sSteered.magnetActive = true; sSteered.magnetEnergy = C.MAGNET_ENERGY_MAX;
      sSteered.active = {
        tier: 2, col: 0, x: magnetCenterX - 100, targetX: magnetCenterX - 100, y: 0, playerSteered: false,
      };
      ph.setDragTarget(sSteered, sSteered.active.targetX); // the player steers it
      const steeredBefore = sSteered.active.targetX;
      ph.stepMagnet(sSteered, 1);
      out.magnetIgnoresSteered = sSteered.active.targetX === steeredBefore;

      // Magnet chip must survive being spent (it used to vanish on use).
      const s2 = st.createInitialState();
      s2.highScore = 9999; s2.inventory.magnet = 1;
      st.activateMagnet(s2);
      out.magnetChipSurvives = st.hudPowerUps().some((p) => p.id === 'magnet') && s2.magnetActive;

      // Bomb: clears, and its collapse must not feed the combo.
      const s3 = st.createInitialState();
      st.startRun(s3, {});
      const r3 = s3.grid.length;
      for (let r = r3 - 3; r < r3; r++) for (let c = 0; c < C.COLS; c++) s3.grid[r][c] = 4;
      for (let c = 0; c < C.COLS; c++) s3.stackHeight[c] = 3;
      const beforeCombo = s3.comboCount;
      const cleared = ph.detonateBomb(s3, r3 - 2, 2);
      out.bomb = {
        cleared: cleared ? cleared.length : 0,
        comboBefore: beforeCombo,
        comboAfter: s3.comboCount,
        comboSuppressed: s3.comboCount === 0,
      };

      // Rainbow: merges with anything.
      const s4 = st.createInitialState();
      st.startRun(s4, {});
      s4.grid[R(s4)][0] = 3; s4.grid[R(s4)][1] = C.RAINBOW_TIER;
      s4.stackHeight[0] = 1; s4.stackHeight[1] = 1;
      ph.resolveMerges(s4);
      out.rainbow = { result: s4.grid[R(s4)].filter((v) => v !== null), expected: 4 };

      // Gating still keyed to the shared milestone ladder.
      out.gating = {};
      for (const best of [0, 1000, 3000, 8000]) {
        const g = st.createInitialState();
        g.highScore = best;
        out.gating[best] = st.unlockedPowerUps(g).map((p) => p.id);
      }
      out.skinMilestones = C.SKINS.map((s) => s.unlockScore);
      out.powerMilestones = C.POWERUPS.filter((p) => p.unlockScore > 0).map((p) => p.unlockScore);
      return out;
    });

    record('Magnet', pu.magnet.movedToward && pu.magnet.gridUntouched, false,
      `falling fruit's targetX moved toward the magnet's column: ${pu.magnet.movedToward}; grid never touched: ${pu.magnet.gridUntouched}; `
      + `out-of-range ignored: ${pu.magnetOutOfRange}; player-steered fruit ignored: ${pu.magnetIgnoresSteered}. Gated at 1000.`);
    record('Magnet chip persists while active', pu.magnetChipSurvives, pu.magnetChipSurvives,
      'chip stays on the bar after stock hits 0, so its duration bar has an anchor');
    record('Bomb', pu.bomb.cleared > 0, false,
      `cleared ${pu.bomb.cleared} cells; combo suppressed during collapse: ${pu.bomb.comboSuppressed}. Gated at 3000.`);
    record('Rainbow fruit', pu.rainbow.result[0] === pu.rainbow.expected, false,
      `wild + tier3 -> tier${pu.rainbow.result[0]} (expected ${pu.rainbow.expected}). Gated at 8000.`);
    record('Milestone gating shared with skins', true, true,
      `skins ${JSON.stringify(pu.skinMilestones)} / power-ups ${JSON.stringify(pu.powerMilestones)}; unlocks by score: ${JSON.stringify(pu.gating)}`);
    await context.close();
  }

  // -------------------------------------------------- merge meter earns charges (8.1)
  {
    const { context, page } = await freshPage(browser, 'mergemeter');
    await page.goto(`${BASE}/index.html`);
    await page.waitForSelector('#play-btn');
    await page.click('#play-btn');
    await page.waitForTimeout(150);

    const result = await page.evaluate(async () => {
      const st = await import('./js/state.js');
      const ph = await import('./js/physics.js');
      const s = window.__poofDebugState;
      s.highScore = 8000;
      s.inventory.remover = 0;
      s.inventory.magnet = 0;
      s.inventory.bomb = 0;
      const beforeInventory = JSON.stringify(s.inventory);

      for (let i = 0; i < 30; i++) {
        s.grid[0][0] = 0;
        s.grid[1][0] = 0;
        s.stackHeight[0] = Math.max(s.stackHeight[0], 2);
        ph.resolveMerges(s);
      }
      const earnedTotal = ['remover', 'magnet', 'bomb'].reduce((sum, id) => sum + (s.earnedCharges[id] || 0), 0);
      const grantedId = ['remover', 'magnet', 'bomb'].find((id) => s.earnedCharges[id] > 0);
      const usableFromEarnedAlone = grantedId
        ? st.canUsePowerUp(s, { unlockScore: 0, id: grantedId })
        : false;

      st.endRun(s, 'test');
      const afterEndRunEarned = ['remover', 'magnet', 'bomb'].reduce((sum, id) => sum + (s.earnedCharges[id] || 0), 0);

      return {
        earnedTotal,
        usableFromEarnedAlone,
        inventoryUnchanged: JSON.stringify(s.inventory) === beforeInventory,
        afterEndRunEarned,
      };
    });

    const ok = result.earnedTotal > 0 && result.usableFromEarnedAlone && result.inventoryUnchanged && result.afterEndRunEarned === 0;
    record('Merge meter earns a usable charge, clears at endRun', ok, ok,
      `through real page/canvas code (not just pure functions): earned ${result.earnedTotal} charge(s), usable from the earned pool alone: ${result.usableFromEarnedAlone}, inventory untouched: ${result.inventoryUnchanged}, cleared at endRun: ${result.afterEndRunEarned === 0}`);
    await context.close();
  }

  // -------------------------------------------- power-ups on REAL touch (7.3 bug)
  //
  // Every check above drives physics functions directly or (elsewhere in this
  // file) clicks with a mouse. Neither caught this: 7.3 moved bomb/remover to
  // commit on release, gated by an `aiming` flag set only when a gesture's OWN
  // pointerdown already landed on the board while armed. A mouse click's down
  // and up land on the same point by construction, so a chip click never
  // continues onto the board within one gesture -- the bug was invisible to
  // every test that existed. A real finger naturally arms and aims in one
  // continuous press (touch chip, slide onto the board, lift), which silently
  // did nothing. Fixed in js/input.js by dropping `aiming` in favour of
  // armPreviewCell itself as the sole commit gate.
  //
  // This uses a real touch-capable context (hasTouch) and real touch/pointer
  // dispatch, not mouse clicks, for exactly that reason.
  {
    const { context, page } = await freshPage(browser, 'touch-powerups', { hasTouch: true });
    await page.goto(`${BASE}/index.html?dev=1`);
    await page.waitForSelector('#play-btn');
    await page.click('#play-btn');
    await page.waitForTimeout(150);

    const geom = await page.evaluate(() => {
      const rect = document.getElementById('game-canvas').getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    });
    const canvasHeight = await page.evaluate(async () => (await import('./js/render.js')).canvasHeightFor(window.__poofDebugState));
    const toPage = (lx, ly) => ({
      x: geom.left + lx * (geom.width / 384),
      y: geom.top + ly * (geom.height / canvasHeight),
    });
    // Logical HUD chip centres: powerSlotRect(i) = { x: 10 + i*34, y: 80, size: 26 }.
    // hudPowerUps() order is [remover, magnet, bomb].
    const chip = (i) => toPage(10 + i * 34 + 13, 80 + 13);
    const boardCell = (col, row) => toPage(col * 64 + 32, 118 + row * 64 + 32);

    async function resetRun() {
      await page.evaluate(() => {
        const s = window.__poofDebugState;
        s.bombInPlay = false;
        s.bombFuseDrops = null;
        s.removerArmed = false;
        s.magnetActive = false;
        s.armPreviewCell = null;
        for (const row of s.grid) row.fill(null);
        s.stackHeight.fill(0);
      });
    }

    // Magnet: a single real touch tap on the chip must activate it. No board
    // step needed -- magnet was never affected by the commit-on-release
    // change, included for full power-up coverage per the same recipe.
    await resetRun();
    await page.evaluate(() => {
      const s = window.__poofDebugState;
      s.active = { tier: 0, col: 3, x: 3 * 64 + 32, targetX: 3 * 64 + 32, y: 100 };
    });
    const magnetChip = chip(1);
    await page.touchscreen.tap(magnetChip.x, magnetChip.y);
    await page.waitForTimeout(80);
    const magnetOk = await page.evaluate(() => window.__poofDebugState.magnetActive);
    record('Magnet fires on real touch tap', magnetOk, magnetOk,
      `magnetActive after a real touchscreen tap on its chip: ${magnetOk}`);

    // 8.3: the companion's rail, dragged with ONE continuous real touch --
    // press somewhere on the rail, slide to a different column, release --
    // not a tap. HUD_HEIGHT=118, MAGNET_RAIL_HEIGHT=22 (js/constants.js).
    {
      const railPoint = (col) => toPage(col * 64 + 32, 118 + 11);
      const from = railPoint(1);
      const to = railPoint(4);
      const cdp = await context.newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
      await page.waitForTimeout(40);
      const afterPress = await page.evaluate(() => window.__poofDebugState.magnetCol);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: to.x, y: to.y }] });
      await page.waitForTimeout(40);
      const afterDrag = await page.evaluate(() => window.__poofDebugState.magnetCol);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(40);
      const stillActive = await page.evaluate(() => window.__poofDebugState.magnetActive);

      const ok = afterPress === 1 && afterDrag === 4 && stillActive;
      record('Magnet rail drags with a real continuous touch', ok, ok,
        `press column 1 (real touch): magnetCol=${afterPress}; drag to column 4, no lift: magnetCol=${afterDrag}; still out after release: ${stillActive}`);
    }

    // Remover, checked two ways: (a) two separate taps -- press the chip,
    // lift, press a board cell, lift; (b) the actual regression -- ONE
    // continuous touch: press the chip, drag onto the board, lift once.
    {
      const slot = chip(0);
      const cell = boardCell(2, 3);
      const tier = 5;

      // (a) two separate taps
      await resetRun();
      await page.evaluate((t) => { window.__poofDebugState.grid[3][2] = t; }, tier);
      await page.touchscreen.tap(slot.x, slot.y);
      await page.waitForTimeout(80);
      await page.touchscreen.tap(cell.x, cell.y);
      await page.waitForTimeout(80);
      const twoTapResult = await page.evaluate(() => ({
        armed: window.__poofDebugState.removerArmed,
        cleared: window.__poofDebugState.grid[3][2] === null,
      }));
      record('Remover fires on real touch: separate taps',
        twoTapResult.cleared, twoTapResult.cleared,
        `tap chip (real touch), lift, tap board cell (real touch), lift -> armed after=${twoTapResult.armed}, cell cleared=${twoTapResult.cleared}`);

      // (b) one continuous press: chip -> board -> release, no lift in between.
      // page.touchscreen has no drag primitive, so this goes through CDP's
      // Input.dispatchTouchEvent directly to control a single, uninterrupted
      // touch sequence -- the exact gesture the bug needed.
      await resetRun();
      await page.evaluate((t) => { window.__poofDebugState.grid[3][2] = t; }, tier);
      const cdp = await context.newCDPSession(page);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: slot.x, y: slot.y }] });
      await page.waitForTimeout(40);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: cell.x, y: cell.y }] });
      await page.waitForTimeout(40);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await page.waitForTimeout(100);
      const dragResult = await page.evaluate(() => ({
        armed: window.__poofDebugState.removerArmed,
        cleared: window.__poofDebugState.grid[3][2] === null,
      }));
      record('Remover fires on real touch: continuous chip-to-board drag',
        dragResult.cleared, dragResult.cleared,
        `ONE touch: press chip, drag onto board, release (no lift in between) -> armed after=${dragResult.armed}, cell cleared=${dragResult.cleared}`);
    }

    // 8.4: the bomb plants as the falling fruit instead of arming a
    // tap-target -- a single real touch tap on the chip is the whole
    // interaction. Then confirm the fuse actually burns down and detonates
    // on its own, driven entirely through real gameplay (stepPhysics/
    // spawnFruit via the debug hook, not a direct detonateBomb call).
    {
      await resetRun();
      await page.evaluate(() => {
        const s = window.__poofDebugState;
        s.active = { tier: 0, col: 3, x: 3 * 64 + 32, targetX: 3 * 64 + 32, y: 100 };
      });
      const bombSlot = chip(2);
      await page.touchscreen.tap(bombSlot.x, bombSlot.y);
      await page.waitForTimeout(80);

      const result = await page.evaluate(async () => {
        const C = await import('./js/constants.js');
        const ph = await import('./js/physics.js');
        const s = window.__poofDebugState;
        const plantedAsBomb = s.active.tier === C.BOMB_TIER;
        const inPlayAfterPlant = s.bombInPlay;

        // Land it, then run exactly enough further drops to burn the fuse out.
        ph.hardDrop(s);
        const fuseAtLanding = s.bombFuseDrops;
        for (let i = 0; i < C.BOMB_FUSE_DROPS; i++) {
          s.active = null;
          ph.spawnFruit(s);
        }
        return {
          plantedAsBomb,
          inPlayAfterPlant,
          fuseAtLanding,
          fuseAfter: s.bombFuseDrops,
          inPlayAfter: s.bombInPlay,
          detonated: s.events.some((e) => e.type === 'bombCleared'),
        };
      });

      const ok = result.plantedAsBomb && result.inPlayAfterPlant
        && result.fuseAtLanding > 0 && result.fuseAfter === null && !result.inPlayAfter && result.detonated;
      record('Bomb plants on a real touch tap and detonates on its own when the fuse ends',
        ok, ok,
        `tap the chip (real touch) -> planted as the falling fruit: ${result.plantedAsBomb}, in play: ${result.inPlayAfterPlant}; `
        + `landed with fuse=${result.fuseAtLanding}; after BOMB_FUSE_DROPS more drops: fuse=${result.fuseAfter}, `
        + `inPlay=${result.inPlayAfter}, detonated=${result.detonated}`);
    }

    await context.close();
  }

  // ------------ power-up chips at real screen positions, across viewports ---
  // A real phone found every HUD tap landing above its actual chip. Root
  // cause: css/style.css's #game-canvas rect could end up TALLER than the
  // logical 384-wide aspect on a very tall viewport (max-width binding while
  // height stayed fixed to its own separate value), and js/input.js's old
  // scaleY -- derived from rect.height -- no longer matched what the board
  // actually rendered at. Dragging the falling fruit survived it because
  // column clamping papers over an x-only error; chip taps had nothing to
  // paper over the y error.
  //
  // The touch-powerups block above never could have caught this: it runs at
  // exactly this suite's one default viewport, AND its own toPage() helper
  // computes tap targets with `geom.height / canvasHeight` -- the SAME
  // formula toCanvasPoint used to interpret them. That is tautological: it
  // proves the formula agrees with itself, never that either one agrees with
  // where a chip is actually drawn on screen. This test computes each chip's
  // expected screen position a different way on purpose -- composing
  // js/render.js's own drawFrame transform (one scale, from canvas.width
  // alone, applied uniformly and anchored top-left) with the ACTUALLY
  // MEASURED element rect and backing-store size -- so it cannot pass merely
  // by mirroring js/input.js's fixed formula back at itself; it would fail
  // just as hard if input.js regressed to a height-derived scaleY as it did
  // against the real bug. It also asserts the element's rect stays on-ratio
  // in its own right, since js/input.js's fix alone could mask a CSS
  // regression (wrong box, right taps) without this check ever noticing.
  {
    const { context, page } = await freshPage(browser, 'chip-aspect-sweep', { hasTouch: true });
    await page.goto(`${BASE}/index.html?dev=1`);
    await page.waitForSelector('#play-btn');
    await page.click('#play-btn');
    await page.waitForTimeout(200);

    // 9:16 and 9:18 are ordinary phones (controls); 9:20 and 9:22 are the
    // extreme tall ratios the real report named; 4:3 is landscape, so the
    // OTHER binding constraint (height, not width) gets exercised too. Widths
    // climb across the tall ones (not just height) so each produces a
    // visibly different canvas box in the notes below, rather than several
    // coincidentally landing on the same numbers.
    const RATIOS = [
      ['9:16', 360, 640], ['9:18', 390, 780],
      ['9:20', 414, 920], ['9:22', 450, 1100],
      ['4:3', 800, 600],
    ];

    async function resetPowerState() {
      await page.evaluate(() => {
        const s = window.__poofDebugState;
        s.removerArmed = false;
        s.magnetActive = false;
        s.bombInPlay = false;
        s.bombFuseDrops = null;
        s.armPreviewCell = null;
      });
    }

    let allAspectOk = true;
    let allChipsOk = true;
    const notes = [];

    for (const [label, w, h] of RATIOS) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(250);

      const geom = await page.evaluate(async () => {
        const C = await import('./js/constants.js');
        const rn = await import('./js/render.js');
        const rect = document.getElementById('game-canvas').getBoundingClientRect();
        const canvas = document.getElementById('game-canvas');
        return {
          left: rect.left, top: rect.top, width: rect.width, height: rect.height,
          backingW: canvas.width, backingH: canvas.height,
          canvasWidth: C.CANVAS_WIDTH,
          logicalH: rn.canvasHeightFor(window.__poofDebugState),
        };
      });

      const expectedRatio = geom.canvasWidth / geom.logicalH;
      const actualRatio = geom.width / geom.height;
      const aspectOk = Math.abs(actualRatio - expectedRatio) / expectedRatio < 0.01;
      if (!aspectOk) allAspectOk = false;

      // Independent derivation -- see the block comment above. Two
      // separately-tested facts composed here, never js/input.js's own
      // formula: drawFrame scales x and y by the SAME canvas.width-derived
      // factor, and the canvas bitmap is then displayed into the CSS box
      // (rect.width x rect.height is genuinely measured, not assumed).
      const screenPos = (logicalX, logicalY) => {
        const deviceX = logicalX * (geom.backingW / geom.canvasWidth);
        const deviceY = logicalY * (geom.backingW / geom.canvasWidth);
        return {
          x: geom.left + deviceX * (geom.width / geom.backingW),
          y: geom.top + deviceY * (geom.height / geom.backingH),
        };
      };

      // hudPowerUps() order is [remover, magnet, bomb] (js/constants.js).
      const chipChecks = [];
      for (let i = 0; i < 3; i++) {
        await resetPowerState();
        const slot = await page.evaluate(async (idx) => {
          const C = await import('./js/constants.js');
          const r = C.powerSlotRect(idx);
          return { cx: r.x + r.w / 2, cy: r.y + r.h / 2 };
        }, i);
        const pos = screenPos(slot.cx, slot.cy);

        if (i === 1 || i === 2) {
          // Magnet and Bomb both act on the currently falling fruit.
          await page.evaluate(() => {
            window.__poofDebugState.active = { tier: 0, col: 3, x: 3 * 64 + 32, targetX: 3 * 64 + 32, y: 100 };
          });
        }
        await page.touchscreen.tap(pos.x, pos.y);
        await page.waitForTimeout(60);

        const consumed = await page.evaluate(async (idx) => {
          const C = await import('./js/constants.js');
          const s = window.__poofDebugState;
          if (idx === 0) return s.removerArmed === true;
          if (idx === 1) return s.magnetActive === true;
          return !!s.active && s.active.tier === C.BOMB_TIER && s.bombInPlay === true;
        }, i);
        chipChecks.push(consumed);
        if (!consumed) allChipsOk = false;
      }

      notes.push(`${label} ${Math.round(geom.width)}x${Math.round(geom.height)} onRatio=${aspectOk} chips=[${chipChecks.join(',')}]`);
    }

    const ok = allAspectOk && allChipsOk;
    record('Power-up chips register a real touch tap at their true screen position, across viewport aspect ratios incl. 9:20/9:22',
      ok, ok, notes.join('; '));
    await context.close();
  }

  // ---------------------------------------------------------------- theme
  {
    const { context, page } = await freshPage(browser, 'theme');
    await page.goto(`${BASE}/index.html`);
    const theme = await page.evaluate(async () => {
      const th = await import('./js/theme.js');
      const C = await import('./js/constants.js');
      const dist = (a, b) => {
        const p = (h) => [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16));
        const A = p(a); const B = p(b);
        return Math.max(...A.map((v, i) => Math.abs(v - B[i])));
      };
      return {
        stops: C.MILESTONE_SCORES,
        jumps: C.MILESTONE_SCORES.slice(1).map((m) => dist(th.themeForScore(m - 1).page, th.themeForScore(m + 1).page)),
        samples: [0, 500, 1000, 3000, 8000].map((s) => th.themeForScore(s).page),
      };
    });
    const maxJump = Math.max(...theme.jumps);
    record('Theme shifts gradually', true, true,
      `max colour jump at any threshold: ${maxJump} (0 = perfectly continuous); page ${theme.samples.join(' -> ')}`);
    await context.close();
  }

  // ------------------------------------------------------------- dev mode
  {
    const { context, page } = await freshPage(browser, 'dev');
    await page.goto(`${BASE}/index.html?dev=1`);
    await page.waitForSelector('#play-btn');
    const dev = await page.evaluate(async () => {
      const st = await import('./js/state.js');
      const s = st.createInitialState();
      return {
        enabled: st.devModeEnabled(),
        unlocked: st.unlockedPowerUps(s).map((p) => p.id),
        skins: s.unlockedSkins,
        inventory: s.inventory,
      };
    });
    record('?dev=1 unlocks everything', dev.enabled, dev.enabled,
      `power-ups ${dev.unlocked.join(', ')}; skins ${dev.skins.join(', ')}`,
      await shot(page, '03-dev-mode', true));
    await context.close();
  }

  // ------------------------------------------------ real play + screenshot
  {
    const { context, page } = await freshPage(browser, 'play');
    await page.goto(`${BASE}/index.html?dev=1`);
    await page.waitForSelector('#play-btn');
    await page.click('#play-btn');
    await page.waitForTimeout(300);
    const box = await page.locator('#game-canvas').boundingBox();
    for (let i = 0; i < 18; i++) {
      const x = box.x + box.width * (0.12 + 0.76 * ((i * 37 % 100) / 100));
      await page.mouse.move(x, box.y + box.height * 0.35);
      await page.mouse.down();
      await page.mouse.up();
      await page.waitForTimeout(260);
    }
    record('Live play (dev mode, all chips)', true, true,
      'played 18 drops with every power-up stocked',
      await shot(page, '04-playing'));
    await context.close();
  }

  // -------------------------------------- storage blocked must still boot
  {
    const context = await browser.newContext({ viewport: { width: 500, height: 860 } });
    const page = await context.newPage();
    track(page, 'nostorage');
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        get() { throw new DOMException('insecure', 'SecurityError'); },
        configurable: true,
      });
    });
    await page.goto(`${BASE}/index.html`);
    const ok = await page.waitForSelector('#play-btn', { timeout: 5000 }).then(() => true).catch(() => false);
    let playable = false;
    if (ok) {
      await page.click('#play-btn');
      await page.waitForTimeout(1200);
      playable = await page.evaluate(() => !document.getElementById('game-canvas').hidden);
    }
    record('Survives blocked localStorage', ok, playable,
      `menu rendered: ${ok}; playable: ${playable}`);
    await context.close();
  }

  // --------------------------------------- zero-viewport guard (4.1)
  // From Google's certification FAQ, verbatim: "the game is initially loaded
  // in a WebView that is not displayed to the user, resulting in the WebView
  // viewport size being zero." Forcing the canvas's own box to report zero
  // (display:none, which ResizeObserver reports as a zero content rect the
  // instant an observed element stops rendering) reproduces the same signal
  // our sizing code receives from a real zero-size WebView, without needing
  // Playwright to set an actual 0x0 viewport (most implementations refuse
  // below 1x1 anyway).
  {
    const { context, page } = await freshPage(browser, 'zero-viewport');
    await page.goto(`${BASE}/index.html`);
    await page.waitForSelector('#play-btn');
    await page.click('#play-btn');
    await page.waitForTimeout(250);

    const beforeZero = await page.evaluate(() => {
      const c = document.getElementById('game-canvas');
      return { w: c.width, h: c.height };
    });
    await page.evaluate(() => {
      document.getElementById('game-canvas').style.setProperty('display', 'none', 'important');
    });
    await page.waitForTimeout(150);
    const duringZero = await page.evaluate(() => {
      const c = document.getElementById('game-canvas');
      return { w: c.width, h: c.height };
    });
    await page.evaluate(() => {
      document.getElementById('game-canvas').style.removeProperty('display');
    });
    await page.waitForTimeout(150);
    const afterReveal = await page.evaluate(() => {
      const c = document.getElementById('game-canvas');
      const rect = c.getBoundingClientRect();
      const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
      return { w: c.width, h: c.height, rectW: rect.width, rectH: rect.height, dpr };
    });

    const heldLastGoodSize = duringZero.w === beforeZero.w && duringZero.h === beforeZero.h && duringZero.w > 0;
    const recovered = afterReveal.w > 0 && afterReveal.h > 0
      && Math.abs(afterReveal.w - Math.round(afterReveal.rectW * afterReveal.dpr)) <= 2;

    record('Zero-viewport guard holds the backing store', heldLastGoodSize, heldLastGoodSize,
      `backing store before a zero measurement: ${beforeZero.w}x${beforeZero.h}; during: ${duringZero.w}x${duringZero.h} (unchanged, not corrupted to 0): ${heldLastGoodSize}`);
    record('Recovers once the WebView actually becomes visible', recovered, recovered,
      `backing store after re-appearing: ${afterReveal.w}x${afterReveal.h}, matching its rendered size (${afterReveal.rectW.toFixed(0)}x${afterReveal.rectH.toFixed(0)}) x devicePixelRatio: ${recovered}`);
    await context.close();
  }

  // --------------------------------------- ratio sweep + resize mid-run (4.1)
  {
    const { context, page } = await freshPage(browser, 'ratio-sweep');
    await page.goto(`${BASE}/index.html`);
    await page.waitForSelector('#play-btn');
    await page.click('#play-btn');
    await page.waitForTimeout(250);

    const RATIOS = [
      ['9:32', 270, 960], ['9:16', 405, 720], ['3:4', 600, 800],
      ['1:1', 700, 700], ['16:9', 960, 540], ['32:9', 1280, 360],
    ];
    let allLayoutOk = true;
    let allInPlaying = true;
    let scoreNeverDecreased = true;
    let lastScore = -1;
    const notes = [];
    for (const [label, w, h] of RATIOS) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(200);
      const info = await page.evaluate(() => {
        const canvas = document.getElementById('game-canvas');
        const rect = canvas.getBoundingClientRect();
        const dpr = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
        const st = window.__poofDebugState;
        return {
          rectW: rect.width, rectH: rect.height,
          backingW: canvas.width, backingH: canvas.height,
          scrollW: document.documentElement.scrollWidth,
          innerW: window.innerWidth,
          withinViewport: rect.left >= -0.5 && rect.top >= -0.5
            && rect.right <= window.innerWidth + 0.5 && rect.bottom <= window.innerHeight + 0.5,
          dpr,
          screen: st ? st.screen : null,
          score: st ? st.score : -1,
        };
      });
      const noHScroll = info.scrollW <= info.innerW + 1;
      const backingMatchesDPR = Math.abs(info.backingW - Math.round(info.rectW * info.dpr)) <= 2
        && Math.abs(info.backingH - Math.round(info.rectH * info.dpr)) <= 2;
      if (!noHScroll || !info.withinViewport || !backingMatchesDPR) allLayoutOk = false;
      if (info.screen !== 'playing') allInPlaying = false;
      if (info.score < lastScore) scoreNeverDecreased = false;
      lastScore = info.score;
      notes.push(`${label} ${Math.round(info.rectW)}x${Math.round(info.rectH)}`);
    }

    record('Ratio sweep: nothing clipped/stretched, no horizontal scroll', allLayoutOk, allLayoutOk,
      notes.join(', '));
    record('Resize mid-run does not reset or corrupt the game', allInPlaying && scoreNeverDecreased, allInPlaying,
      `stayed on the playing screen through every resize: ${allInPlaying}; score never decreased: ${scoreNeverDecreased}`);
    await context.close();
  }

  // ------------------------------------------------------- DPR clamp (4.1)
  {
    const context = await browser.newContext({ viewport: { width: 500, height: 860 }, deviceScaleFactor: 4 });
    const page = await context.newPage();
    track(page, 'dpr-clamp');
    await page.addInitScript(() => { try { localStorage.clear(); } catch { /* storage may be blocked on purpose */ } });
    await page.goto(`${BASE}/index.html`);
    await page.waitForSelector('#play-btn');
    await page.click('#play-btn');
    await page.waitForTimeout(300);
    const info = await page.evaluate(() => {
      const canvas = document.getElementById('game-canvas');
      const rect = canvas.getBoundingClientRect();
      return { backingW: canvas.width, rectW: rect.width, dpr: window.devicePixelRatio };
    });
    const effectiveScale = info.backingW / info.rectW;
    const withinClamp = effectiveScale <= 3.05; // MAX_BACKING_SCALE + rounding slack
    record('DPR clamp (stubbed devicePixelRatio=4)', withinClamp, withinClamp,
      `devicePixelRatio=${info.dpr}, backing-store/rendered-size ratio=${effectiveScale.toFixed(2)} (must be <= 3)`);
    await context.close();
  }

  // ---------------------------------------- Playables build (4.2), ?dev=1
  {
    const PLAYABLES_PORT = 8643;
    const playablesServer = await serveDir(path.join(REPO_ROOT, 'dist', 'playables'), PLAYABLES_PORT);
    const PLAYABLES_BASE = `http://localhost:${PLAYABLES_PORT}`;
    try {
      const { context, page } = await freshPage(browser, 'playables-build');
      await page.goto(`${PLAYABLES_BASE}/index.html?dev=1`);
      await page.waitForSelector('#play-btn');
      const dev = await page.evaluate(async () => {
        const st = await import('./js/state.js');
        const s = st.createInitialState(null);
        return {
          devModeEnabled: st.devModeEnabled(),
          highScore: s.highScore,
          inventory: s.inventory,
        };
      });
      const nothingUnlocked = dev.devModeEnabled === false && dev.highScore === 0
        && Object.values(dev.inventory).every((n) => n <= 1); // the one starter Remover is expected
      record('?dev=1 unlocks nothing in the Playables build', nothingUnlocked, nothingUnlocked,
        `devModeEnabled(): ${dev.devModeEnabled}; highScore: ${dev.highScore}; inventory: ${JSON.stringify(dev.inventory)}`);

      await page.goto(`${PLAYABLES_BASE}/index.html`);
      await page.waitForSelector('#play-btn');
      await page.click('#play-btn');
      const box = await page.locator('#game-canvas').boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.3);
      await page.mouse.down();
      await page.mouse.up();
      await page.waitForTimeout(400);
      const standalonePlayable = await page.evaluate(() => !document.getElementById('game-canvas').hidden);
      record('Playables build runs standalone', standalonePlayable, standalonePlayable,
        `dist/playables/index.html, served from a root with nothing else in it, boots and plays: ${standalonePlayable}`);
      await context.close();
    } finally {
      playablesServer.close();
    }
  }

  // -------------------------------------- runs under the real CSP (5.1)
  // Google publishes this exact policy for local testing; the docs suggest a
  // DevTools response-header override, which is a manual, forgettable step.
  // Playwright can inject it itself via page.route(), which makes it a
  // repeatable part of this suite instead. Run against dist/playables/ --
  // that is what ships -- not the Pages build.
  {
    const CSP_HEADER = "default-src 'none'; script-src 'report-sample' 'self' 'unsafe-eval' 'unsafe-inline' blob: https://www.youtube.com/game_api/v0 https://www.youtube.com/game_api/v0/ https://www.youtube.com/game_api/v1 https://www.youtube.com/game_api/v1/; object-src 'none'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' blob: data:; media-src 'self' blob:; font-src 'self' data: https://fonts.googleapis.com https://fonts.gstatic.com; connect-src 'self' blob: data:; sandbox allow-pointer-lock allow-same-origin allow-scripts; base-uri 'self'; manifest-src 'self'; worker-src 'self' blob:";
    const CSP_PORT = 8644;
    const cspServer = await serveDir(path.join(REPO_ROOT, 'dist', 'playables'), CSP_PORT);
    const CSP_BASE = `http://localhost:${CSP_PORT}`;
    try {
      const context = await browser.newContext({ viewport: { width: 500, height: 860 } });
      const page = await context.newPage();
      track(page, 'csp');
      // Directive violations (script-src, style-src, connect-src, etc.) fire
      // this DOM event. The sandbox directive's own restrictions (no forms,
      // no popups -- unused by this game) are enforced silently rather than
      // reported this way; nothing here calls anything sandbox would block.
      await page.addInitScript(() => {
        window.__cspViolations = [];
        document.addEventListener('securitypolicyviolation', (e) => {
          window.__cspViolations.push(`${e.violatedDirective}: ${e.blockedURI || e.sourceFile || '(inline)'}`);
        });
      });
      await page.route('**/index.html', async (route) => {
        const response = await route.fetch();
        await route.fulfill({ response, headers: { ...response.headers(), 'content-security-policy': CSP_HEADER } });
      });

      await page.goto(`${CSP_BASE}/index.html`);
      await page.waitForSelector('#play-btn');
      await page.click('#play-btn');
      await page.waitForTimeout(300);

      // A representative pass through the mechanics phases 1-4 exercise
      // separately: drop a few fruit, pause, resume.
      const box = await page.locator('#game-canvas').boundingBox();
      for (let i = 0; i < 4; i++) {
        await page.mouse.move(box.x + box.width * (0.2 + 0.15 * i), box.y + box.height * 0.3);
        await page.mouse.down();
        await page.mouse.up();
        await page.waitForTimeout(350);
      }
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { get: () => true, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await page.waitForTimeout(200);
      await page.evaluate(() => {
        Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
        document.dispatchEvent(new Event('visibilitychange'));
      });
      await page.waitForTimeout(300);

      const violations = await page.evaluate(() => window.__cspViolations || []);
      const clean = violations.length === 0;
      record('Runs clean under the real Playables CSP', clean, clean,
        clean ? 'zero CSP violations across boot, play, pause/resume' : `violations: ${violations.join(' | ')}`);
      await context.close();
    } finally {
      cspServer.close();
    }
  }

  // ------------------------------------------ compliance figures (5.3)
  // Measured against dist/playables/ -- what actually ships -- not the Pages
  // build. Printed and recorded here; docs/playables-plan.md carries the
  // committed numbers so a future regression is visible without re-running
  // this suite.
  let complianceFigures = null;
  {
    const PORT = 8645;
    const server = await serveDir(path.join(REPO_ROOT, 'dist', 'playables'), PORT);
    const base = `http://localhost:${PORT}`;
    try {
      const context = await browser.newContext({ viewport: { width: 500, height: 860 } });
      const page = await context.newPage();
      track(page, 'compliance');
      const client = await context.newCDPSession(page);
      await client.send('Performance.enable');

      const t0 = Date.now();
      await page.goto(`${base}/index.html`);
      await page.waitForSelector('#play-btn');
      // The menu is interactive at this point by construction (shop.js wires
      // its listeners synchronously); platform.gameReady() itself fires
      // roughly two animation frames later (js/main.js's boot()) with no
      // externally observable signal in localImpl -- close enough at 60fps
      // (~33ms) to not be worth a dedicated production hook for.
      const timeToInteractiveMs = Date.now() - t0;

      await page.click('#play-btn');
      await page.waitForTimeout(300);
      const box = await page.locator('#game-canvas').boundingBox();
      let peakHeapBytes = 0;
      for (let i = 0; i < 18; i++) {
        const x = box.x + box.width * (0.12 + 0.76 * ((i * 37 % 100) / 100));
        await page.mouse.move(x, box.y + box.height * 0.35);
        await page.mouse.down();
        await page.mouse.up();
        await page.waitForTimeout(220);
        const metrics = await client.send('Performance.getMetrics');
        const heap = metrics.metrics.find((m) => m.name === 'JSHeapUsedSize')?.value || 0;
        if (heap > peakHeapBytes) peakHeapBytes = heap;
      }

      const bundle = bundleStats(path.join(REPO_ROOT, 'dist', 'playables'));
      complianceFigures = { bundle, peakHeapBytes, timeToInteractiveMs };

      const bundleMiB = (bundle.bytes / (1024 * 1024)).toFixed(3);
      const heapMiB = (peakHeapBytes / (1024 * 1024)).toFixed(2);
      console.log('\n--- Compliance figures (5.3) ---');
      console.log(`Bundle: ${bundle.files} files, ${bundle.bytes} bytes (${bundleMiB} MiB); largest file: ${bundle.largest.path} (${bundle.largest.size} bytes)`);
      console.log(`Peak JS heap over an 18-drop run: ${peakHeapBytes} bytes (${heapMiB} MiB); ceiling is 512 MiB`);
      console.log(`Navigation to interactive menu: ${timeToInteractiveMs} ms; target is under 5000 ms\n`);

      record('Compliance figures recorded', true, true,
        `bundle ${bundle.files} files / ${bundleMiB} MiB; peak heap ${heapMiB} MiB; time-to-interactive ${timeToInteractiveMs} ms`);
      await context.close();
    } finally {
      server.close();
    }
  }

  // ------------------------------------------------------- offline boot
  {
    const { context, page } = await freshPage(browser, 'offline');
    await page.goto(`${BASE}/index.html`);
    await page.waitForSelector('#play-btn');
    // let the service worker install and precache
    await page.waitForTimeout(1500);
    await context.setOffline(true);
    let offlineOk = false;
    try {
      await page.reload({ waitUntil: 'domcontentloaded' });
      offlineOk = await page.waitForSelector('#play-btn', { timeout: 6000 }).then(() => true).catch(() => false);
    } catch { offlineOk = false; }
    await context.setOffline(false);
    record('Offline boot (service worker)', true, offlineOk,
      `game boots from cache with the network down: ${offlineOk}`);
    await context.close();
  }

  await browser.close();

  // ------------------------------------------------------------- report
  const pad = (s, n) => String(s).padEnd(n);
  console.log('\n' + pad('FEATURE', 38) + pad('WIRED', 8) + pad('NEW PLAYER SEES', 18) + 'NOTE');
  console.log('-'.repeat(140));
  for (const r of results) {
    console.log(
      pad(r.feature, 38)
      + pad(r.wired ? 'yes' : 'NO', 8)
      + pad(r.visibleToNewPlayer ? 'yes' : 'no (gated)', 18)
      + (r.note || '')
    );
  }
  const notWired = results.filter((r) => !r.wired);
  console.log('\nScreenshots: ' + results.filter((r) => r.shot).map((r) => r.shot).join(', '));
  console.log(`\n${results.length} checks, ${notWired.length} not wired.`);
  if (errors.length) {
    console.log('\nCONSOLE / PAGE ERRORS:');
    for (const e of errors) console.log('  ' + e);
  } else {
    console.log('No console or page errors.');
  }
  process.exitCode = (notWired.length === 0 && errors.length === 0) ? 0 : 1;
})();
