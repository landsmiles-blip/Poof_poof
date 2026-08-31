// Phase 14's measurement harness -- how every number in docs/phase14brief.md
// was produced, so the reviewer can re-run them rather than take them on
// trust.
//
// This is NOT part of the test suite. It asserts nothing and gates nothing;
// it prints numbers and writes screenshots. It lives in the repo because
// docs/phase122brief.md section 4 records a simulation harness that
// disagreed with the real game and was believed anyway -- the fix for that
// is to measure in a browser AND to ship the thing that did the measuring.
//
//   python3 -m http.server 8642            # from the repo root
//   NODE_PATH=<where playwright lives> \
//   CHROMIUM_PATH=<chromium binary> \
//   node tools/measure-phase14.cjs [fill|fall|run|halo|cost|shots|all]
//
// `fall`, `halo` and `cost` are the ones worth running twice -- once on this
// build and once with it stashed -- since their whole point is a before/after
// comparison. Set TAG=<label> to name the run in the output and in any
// screenshot filenames.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = process.env.BASE_URL || 'http://localhost:8642';
const EXEC = process.env.CHROMIUM_PATH || undefined;
const TAG = process.env.TAG || 'now';
const SHOTS = path.join(__dirname, '..', 'tests', 'screenshots', 'phase14');
const WHAT = (process.argv[2] || 'all').toLowerCase();

fs.mkdirSync(SHOTS, { recursive: true });

const DEVICES = [
  { name: 'iPhone 12/13/14  390x844', width: 390, height: 844 },
  { name: 'Pixel 7          412x915', width: 412, height: 915 },
  { name: 'iPhone SE        375x667', width: 375, height: 667 },
  { name: 'iPhone 15 ProMax 430x932', width: 430, height: 932 },
  { name: 'tall/narrow 9:22 434x857', width: 434, height: 857 },
  { name: 'desktop window  1280x800', width: 1280, height: 800 },
];

// reducedMotion is pinned rather than left to the browser's default: headless
// Chromium can report `reduce`, which makes js/background.js draw exactly
// once and turns any backdrop timing into a measurement of nothing.
async function boot(browser, width, height) {
  const context = await browser.newContext({
    viewport: { width, height }, hasTouch: true, reducedMotion: 'no-preference',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => { try { localStorage.clear(); } catch { /* blocked on purpose */ } });
  await page.goto(`${BASE}/index.html`);
  await page.waitForSelector('#play-btn');
  return { context, page, errors };
}

// Rewrites the board to a silhouette expressed as FRACTIONS of its height, so
// one call produces a comparable situation on a 7-row build and a 10-row one
// instead of the same absolute stack.
const setBoardFractions = (frac) => {
  const st = window.__poofDebugState;
  const rows = st.grid.length;
  for (let c = 0; c < st.stackHeight.length; c++) {
    const h = Math.max(0, Math.min(rows, Math.round(frac[c] * rows)));
    for (let r = 0; r < rows; r++) st.grid[r][c] = null;
    for (let i = 0; i < h; i++) st.grid[rows - 1 - i][c] = (i + c) % 4;
    st.stackHeight[c] = h;
  }
};

// ------------------------------------------------------------------ fill --
async function measureFill(browser) {
  console.log('=== SCREEN FILL (measured off the live element, not off the CSS formula) ===');
  console.log('device                     canvas         height%  area%   cell px');
  for (const d of DEVICES) {
    const { context, page } = await boot(browser, d.width, d.height);
    await page.click('#play-btn');
    await page.waitForTimeout(500);
    const m = await page.evaluate(() => {
      const r = document.getElementById('game-canvas').getBoundingClientRect();
      return { w: r.width, h: r.height, vw: window.innerWidth, vh: window.innerHeight };
    });
    console.log(
      `${d.name.padEnd(26)} ${String(Math.round(m.w)).padStart(4)}x${String(Math.round(m.h)).padEnd(5)} `
      + `${((m.h / m.vh) * 100).toFixed(0).padStart(6)}% `
      + `${(((m.w * m.h) / (m.vw * m.vh)) * 100).toFixed(0).padStart(6)}% `
      + `${(m.w / 6).toFixed(1).padStart(7)}`);
    await context.close();
  }
}

// ------------------------------------------------------------------ fall --
// The cost of a taller board, in the only unit that matters to a player: how
// long they wait for the first fruit of a fresh run to land.
async function measureFall(browser) {
  const { context, page } = await boot(browser, 390, 844);
  await page.click('#play-btn');
  await page.waitForTimeout(300);
  const fall = await page.evaluate(() => new Promise((resolve) => {
    const st = window.__poofDebugState;
    const started = performance.now();
    const from = st.spawnIndex;
    const tick = () => {
      if (st.spawnIndex > from) resolve({ ms: Math.round(performance.now() - started), rows: st.grid.length });
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }));
  console.log(`\n[${TAG}] rows=${fall.rows}  first drop, spawn to the next spawn: ${fall.ms} ms`);
  await context.close();
}

// ------------------------------------------------------------------- run --
// The same shape of measurement docs/phase122brief.md sections 1 and 5
// report, so all three builds sit on one axis.
async function measurePassiveRun(browser) {
  console.log('\n=== PASSIVE RUN (390x844, no input at all) ===');
  const { context, page, errors } = await boot(browser, 390, 844);
  await page.click('#play-btn');
  console.log('   t   drops  score  board%  stacks');
  let last = 0;
  for (const t of [15, 30, 60, 90, 150]) {
    await page.waitForTimeout((t - last) * 1000);
    last = t;
    const s = await page.evaluate(() => {
      const st = window.__poofDebugState;
      if (!st) return null;
      const rows = st.grid.length;
      const filled = st.stackHeight.reduce((a, b) => a + b, 0);
      return {
        screen: st.screen, drops: st.spawnIndex, score: st.score,
        board: Math.round((filled / (rows * st.stackHeight.length)) * 100),
        stacks: st.stackHeight.join(','),
      };
    });
    if (!s) { console.log('  (window.__poofDebugState missing -- is this the Playables build?)'); break; }
    console.log(`${String(t).padStart(4)}s ${String(s.drops).padStart(6)} ${String(s.score).padStart(6)} `
      + `${String(s.board).padStart(6)}%  ${s.stacks}${s.screen !== 'playing' ? '   <- RUN OVER' : ''}`);
  }
  if (errors.length) console.log('  ERRORS:', errors.slice(0, 4).join(' | '));
  await context.close();
}

// ------------------------------------------------------------------ halo --
// Is the halo still doing anything? Samples the backdrop canvas itself (not a
// screenshot of the composite) up the vertical centre line, from the screen's
// top edge to the board's top edge. A flat set of samples means the "lit from
// behind" effect has collapsed into a uniform tint.
async function probeHalo(browser) {
  const { context, page } = await boot(browser, 390, 844);
  await page.click('#play-btn');
  await page.waitForTimeout(800);
  const probe = await page.evaluate(() => {
    const bg = document.getElementById('bg-canvas');
    const board = document.getElementById('game-canvas').getBoundingClientRect();
    const g = bg.getContext('2d', { willReadFrequently: true });
    const cx = Math.round(bg.width / 2);
    const top = Math.max(0, Math.round(board.top));
    const samples = [];
    for (let i = 0; i <= 4; i++) {
      const y = Math.min(bg.height - 1, Math.round((top * i) / 4));
      const d = g.getImageData(cx, y, 1, 1).data;
      samples.push({ y, rgb: `${d[0]},${d[1]},${d[2]}` });
    }
    return { boardTop: Math.round(board.top), boardH: Math.round(board.height), vh: window.innerHeight, samples };
  });

  console.log(`\n[${TAG}] board top edge at y=${probe.boardTop}, board ${probe.boardH}px tall in a ${probe.vh}px viewport`);
  console.log(`[${TAG}] backdrop up the centre line, screen edge -> board edge:`);
  for (const s of probe.samples) console.log(`   y=${String(s.y).padStart(4)}  rgb(${s.rgb})`);
  // max-minus-min per channel across every sample, NOT first-versus-last: the
  // rectangle glow peaks just outside the board edge and the final sample
  // sits on the board's own boundary pixel (clipped out of the glow), so a
  // first-vs-last comparison calls a clearly peaked profile flat.
  const chans = [0, 1, 2].map((i) => probe.samples.map((s) => Number(s.rgb.split(',')[i])));
  console.log(`[${TAG}] largest channel spread across that strip: `
    + `${Math.max(...chans.map((c) => Math.max(...c) - Math.min(...c)))}`);
  await context.close();
}

// ------------------------------------------------------------------ cost --
// What the backdrop costs per redraw, against the ~66ms it gets at
// BG_MIN_REDRAW_INTERVAL_SEC's ~15fps.
async function probeCost(browser) {
  console.log('');
  for (const s of [DEVICES[0], DEVICES[5]]) {
    const { context, page } = await boot(browser, s.width, s.height);
    await page.click('#play-btn');
    await page.waitForTimeout(1200);
    const out = await page.evaluate(async () => {
      const bg = await import('./js/background.js');
      const th = await import('./js/theme.js');
      const C = await import('./js/constants.js');
      const theme = { ...th.themeForScore(0), skinColors: C.TIERS.map((t) => t.color) };
      const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      // Chromium's canvas2d is GPU-backed and queues draw calls, so timing
      // the calls alone measures how long they take to ISSUE, not to raster
      // -- which is how a first pass at this reported 0.10ms for two large
      // shadow blurs. A 1x1 getImageData forces the flush.
      const g = document.getElementById('bg-canvas').getContext('2d');
      const flush = () => g.getImageData(0, 0, 1, 1);
      // A moving timestamp defeats drawBackground's own redraw throttle.
      for (let i = 0; i < 10; i++) { bg.drawBackground(theme, 1000 + i); flush(); }
      const t0 = performance.now();
      const N = 60;
      for (let i = 0; i < N; i++) { bg.drawBackground(theme, 2000 + i); flush(); }
      return { ms: (performance.now() - t0) / N, reduced };
    });
    console.log(`[${TAG}] ${s.name}: ${out.ms.toFixed(2)} ms per backdrop redraw `
      + `(budget ~66 ms at ~15fps), prefers-reduced-motion=${out.reduced}`);
    await context.close();
  }
}

// ----------------------------------------------------------------- shots --
async function takeShots(browser) {
  console.log('\n=== SCREENSHOTS ===');
  const { context, page } = await boot(browser, 390, 844);
  await page.screenshot({ path: path.join(SHOTS, `${TAG}-menu.png`) });

  await page.click('#play-btn');
  await page.waitForTimeout(9000);
  await page.screenshot({ path: path.join(SHOTS, `${TAG}-early-run.png`) });

  await page.evaluate(setBoardFractions, [0.3, 0.5, 0.2, 0.4, 0.1, 0.3]);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOTS, `${TAG}-30pct.png`) });

  await page.evaluate(setBoardFractions, [0.7, 0.9, 0.6, 0.8, 0.5, 0.7]);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOTS, `${TAG}-70pct.png`) });

  // The mercy path: the middle column is full, so the chute has to move --
  // the one case where a marker could become a lie.
  await page.evaluate(setBoardFractions, [0.4, 0.6, 0.8, 1.0, 0.7, 0.5]);
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOTS, `${TAG}-chute-redirected.png`) });

  console.log(`  written to ${path.relative(process.cwd(), SHOTS)} as ${TAG}-*.png`);
  await context.close();
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC });
  const all = WHAT === 'all';
  if (all || WHAT === 'fill') await measureFill(browser);
  if (all || WHAT === 'fall') await measureFall(browser);
  if (all || WHAT === 'run') await measurePassiveRun(browser);
  if (all || WHAT === 'halo') await probeHalo(browser);
  if (all || WHAT === 'cost') await probeCost(browser);
  if (all || WHAT === 'shots') await takeShots(browser);
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
