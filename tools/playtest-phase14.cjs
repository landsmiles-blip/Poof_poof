// An actual played run, with real pointer input on the canvas -- not a
// passive one and not a simulation. A greedy bot: for each falling fruit it
// looks at the real board, picks the column whose top fruit matches the tier
// it is holding (falling back to the shortest column), drags there with real
// pointer events, and lets gravity do the rest.
//
// It exists to answer ONE mechanical question honestly: with a ten-row board,
// does the player have enough time to steer where they meant to go? That is
// measurable -- did the fruit land in the column that was aimed at, and how
// much slack was left. It CANNOT answer whether the wait feels boring. Only a
// person can answer that, and this harness should never be quoted as if it
// had.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = process.env.BASE_URL || 'http://localhost:8642';
const EXEC = process.env.CHROMIUM_PATH || undefined;
const TAG = process.env.TAG || 'now';
const SECONDS = Number(process.env.SECONDS || 180);
const SHOTS = path.join(__dirname, '..', 'tests', 'screenshots', 'phase14');
fs.mkdirSync(SHOTS, { recursive: true });

(async () => {
  const browser = await chromium.launch({ executablePath: EXEC });
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, hasTouch: true, reducedMotion: 'no-preference',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => { try { localStorage.clear(); } catch { /* blocked */ } });
  await page.goto(`${BASE}/index.html`);
  await page.waitForSelector('#play-btn');
  await page.click('#play-btn');
  await page.waitForTimeout(400);

  const geom = await page.evaluate(() => {
    const r = document.getElementById('game-canvas').getBoundingClientRect();
    const st = window.__poofDebugState;
    return { left: r.left, top: r.top, w: r.width, h: r.height, rows: st.grid.length, cols: st.stackHeight.length };
  });
  const scale = geom.w / 384;           // logical -> CSS px
  const HUD = 118;
  const CELL = 64;
  const colToX = (c) => geom.left + (c * CELL + CELL / 2) * scale;
  const boardY = (row) => geom.top + (HUD + row * CELL + CELL / 2) * scale;

  const drops = [];
  const deadline = Date.now() + SECONDS * 1000;
  let lastIndex = -1;

  while (Date.now() < deadline) {
    const s = await page.evaluate(() => {
      const st = window.__poofDebugState;
      if (!st || st.screen !== 'playing' || !st.active) return null;
      const rows = st.grid.length;
      const tops = st.stackHeight.map((h, c) => (h > 0 ? st.grid[rows - h][c] : null));
      return {
        idx: st.spawnIndex, tier: st.active.tier, col: st.active.col,
        stacks: st.stackHeight.slice(), tops, score: st.score, rows,
      };
    });
    if (!s) {
      const over = await page.evaluate(() => window.__poofDebugState && window.__poofDebugState.screen);
      if (over && over !== 'playing') { console.log(`[${TAG}] run ended at ${over} after ${drops.length} drops`); break; }
      await page.waitForTimeout(40);
      continue;
    }
    if (s.idx === lastIndex) { await page.waitForTimeout(40); continue; }
    lastIndex = s.idx;

    // Greedy target: a column whose top fruit is the same tier as the one in
    // hand (a merge on landing), else the shortest column with room.
    let target = -1;
    for (let c = 0; c < s.stacks.length; c++) {
      if (s.tops[c] === s.tier && s.stacks[c] < s.rows) { target = c; break; }
    }
    if (target < 0) {
      let best = Infinity;
      for (let c = 0; c < s.stacks.length; c++) {
        if (s.stacks[c] < s.rows && s.stacks[c] < best) { best = s.stacks[c]; target = c; }
      }
    }
    if (target < 0) { await page.waitForTimeout(60); continue; }

    // Real pointer input: press on the board, drag to the target column,
    // release. Exactly the gesture a thumb makes.
    const t0 = Date.now();
    const y = boardY(Math.max(0, s.rows - 2));
    await page.mouse.move(colToX(s.col), y);
    await page.mouse.down();
    await page.mouse.move(colToX(target), y, { steps: 6 });
    await page.mouse.up();

    // Wait for this fruit to land (spawnIndex advances) and record whether it
    // actually got where it was aimed.
    // Where the fruit ended up. The watcher is gated on spawnIndex, NOT on
    // st.active being truthy: the frame a fruit locks, the NEXT one spawns in
    // the middle column immediately, and a watcher that just reads st.active
    // records that new fruit's spawn column instead of where the old one
    // actually landed. A first pass at this did exactly that and reported a
    // 17% hit rate that was entirely an artefact of the harness.
    const landed = await page.evaluate(({ from }) => new Promise((resolve) => {
      const st = window.__poofDebugState;
      const started = performance.now();
      let lastCol = st.active ? st.active.col : null;
      const step = () => {
        if (st.spawnIndex > from || !st.active) {
          resolve({ ms: Math.round(performance.now() - started), col: lastCol });
          return;
        }
        lastCol = st.active.col;
        if (performance.now() - started > 15000) { resolve({ ms: -1, col: null }); return; }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }), { from: s.idx });

    drops.push({
      idx: s.idx, tier: s.tier, from: s.col, target, landed: landed.col,
      hit: landed.col === target, ms: landed.ms, wallMs: Date.now() - t0, score: s.score,
    });
  }

  const done = await page.evaluate(() => {
    const st = window.__poofDebugState;
    return { screen: st.screen, score: st.score, drops: st.spawnIndex, stacks: st.stackHeight.join(','), rows: st.grid.length };
  });
  await page.screenshot({ path: path.join(SHOTS, `${TAG}-played.png`) });

  const hits = drops.filter((d) => d.hit).length;
  const times = drops.map((d) => d.ms).filter((m) => m > 0).sort((a, b) => a - b);
  const median = times.length ? times[Math.floor(times.length / 2)] : 0;
  console.log(`\n[${TAG}] rows=${done.rows}  played ${SECONDS}s with real pointer drags`);
  console.log(`[${TAG}] first five drops, spawn to land: ${drops.slice(0, 5).map((d) => d.ms + 'ms').join(', ')}`);
  console.log(`[${TAG}] drops: ${drops.length}   median time to land: ${median} ms`);
  console.log(`[${TAG}] reached the column it aimed at: ${hits}/${drops.length}`
    + ` (${drops.length ? Math.round((hits / drops.length) * 100) : 0}%)`);
  const far = drops.filter((d) => Math.abs(d.target - d.from) >= 3);
  const farHits = far.filter((d) => d.hit).length;
  console.log(`[${TAG}]   of those, 3+ columns away: ${farHits}/${far.length}`
    + ` (${far.length ? Math.round((farHits / far.length) * 100) : 0}%) -- the hardest steer there is`);
  // Does the game actually get faster as you play it? Bucketed by drop index,
  // because that is what the gravity ramp is keyed to. This is the number that
  // answers "the speed only changes so slightly you can hardly notice" -- if
  // consecutive buckets are within a few percent of each other, no player will
  // ever feel the difference.
  console.log(`[${TAG}] does it speed up? median time-to-land by drop bucket:`);
  const BUCKET = 20;
  let prevMed = null;
  for (let lo = 0; lo < drops.length; lo += BUCKET) {
    const slice = drops.slice(lo, lo + BUCKET).map((d) => d.ms).filter((m) => m > 0).sort((a, b) => a - b);
    if (!slice.length) continue;
    const med = slice[Math.floor(slice.length / 2)];
    const change = prevMed === null ? '' : `${((med - prevMed) / prevMed * 100).toFixed(0)}%`;
    console.log(`   drops ${String(lo + 1).padStart(3)}-${String(Math.min(lo + BUCKET, drops.length)).padStart(3)}`
      + `   ${String(med).padStart(5)} ms   ${change.padStart(6)}`);
    prevMed = med;
  }
  console.log(`[${TAG}] ended: screen=${done.screen} score=${done.score} stacks=${done.stacks}`);
  if (errors.length) console.log(`[${TAG}] ERRORS: ${errors.slice(0, 4).join(' | ')}`);

  await context.close();
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
