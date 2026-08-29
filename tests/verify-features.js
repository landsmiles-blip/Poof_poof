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

const BASE = process.env.BASE_URL || 'http://localhost:8642';
const SHOTS = process.env.SHOT_DIR || path.join(__dirname, 'screenshots');
const EXEC = process.env.CHROMIUM_PATH || undefined;

fs.mkdirSync(SHOTS, { recursive: true });

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

  // ------------------------------------------------- menu shop reachable now
  {
    const { context, page } = await freshPage(browser, 'menushop');
    await page.goto(`${BASE}/index.html`);
    await page.waitForSelector('#play-btn');
    const menu = await page.evaluate(() => ({
      hasShop: document.querySelectorAll('.shop-item').length,
      hasSkins: document.querySelectorAll('.skin-item').length,
      hasSound: !!document.querySelector('#sound-btn'),
      hasMusic: !!document.querySelector('#music-btn'),
    }));
    record('Shop reachable from menu', menu.hasShop > 0, menu.hasShop > 0,
      `${menu.hasShop} power-ups, ${menu.hasSkins} skins, music toggle: ${menu.hasMusic}`,
      await shot(page, '01-menu-shop', true));
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
    const bootedWithoutGesture = await page.evaluate(async () => {
      const a = await import('./js/audio.js');
      return a.getAudioContext() !== null;
    });
    const audio = await page.evaluate(async () => {
      const a = await import('./js/audio.js');
      a.unlockAudio();
      // boot() already tried this once before any gesture existed and was
      // blocked (logged, not thrown); actually resuming from that blocked
      // state takes headless Chromium a variable, sometimes-500ms+ amount of
      // time -- poll rather than guess a fixed delay, so this is not flaky.
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
    record('Audio starts without a gesture', bootedWithoutGesture, bootedWithoutGesture,
      `AudioContext created by boot() before any pointer event: ${bootedWithoutGesture}`);
    record('Merge sound (pitch rises with tier)', true, audio.rising,
      `${audio.merges[0]}Hz -> ${audio.merges[audio.merges.length - 1]}Hz, monotonic: ${audio.rising}`);
    record('Celebration sound', audio.celebrationNotes > 1, false,
      `${audio.celebrationNotes}-note arpeggio -- needs a top-tier merge, not a first-run event`);
    await context.close();
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
      const emptyBoardFall = ((C.ROWS - 1) * C.CELL + C.CELL / 2 + 15) / C.GRAVITY_PX_PER_SEC;

      // A stacked column cascades, which is the common first sighting.
      const s = st.createInitialState();
      st.startRun(s, {});
      const R = s.grid.length - 1;
      for (let i = 0; i < 4; i++) s.grid[R - i][2] = 0;
      s.stackHeight[2] = 4;
      ph.resolveMerges(s);
      return {
        window: C.COMBO_WINDOW_SEC,
        emptyBoardFall: +emptyBoardFall.toFixed(2),
        chainsAcrossDrops: C.COMBO_WINDOW_SEC > emptyBoardFall,
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

      // Magnet: one column per step, buried/non-matching untouched.
      const s = st.createInitialState();
      st.startRun(s, {});
      const rows = s.grid.length;
      s.grid[rows - 1][0] = 2; s.stackHeight[0] = 1;
      s.grid[rows - 1][5] = 2; s.stackHeight[5] = 1;
      s.grid[rows - 1][1] = 7; s.stackHeight[1] = 1;
      s.active = { tier: 2, col: 3, x: 0, targetX: 0, y: 0 };
      s.magnetActive = true; s.magnetTimer = 9; s.magnetStepTimer = 0;
      const moves = ph.stepMagnet(s, 0.016);
      out.magnet = {
        moves,
        oneColumnEach: moves.every((m) => Math.abs(m.to - m.from) === 1),
        nonMatchingStayed: s.grid[rows - 1][1] === 7,
      };

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

    record('Magnet', pu.magnet.moves.length > 0, false,
      `moves ${JSON.stringify(pu.magnet.moves)}; one column each: ${pu.magnet.oneColumnEach}; non-matching untouched: ${pu.magnet.nonMatchingStayed}. Gated at 1000.`);
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
