// One-off in-browser proof for the 17 rising floor: boot the real game in
// Chromium, play a greedy (shortest-column) run to its END, and confirm the
// mechanic works end-to-end -- rises actually fire, the render survives them,
// the run terminates, and no console error appears beyond the known
// SDK-offline one (youtube.com is blocked in this sandbox, so the Phase-16 SDK
// tag fails to load exactly as it does in Claude Code's own offline test).
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.addInitScript(() => { try { localStorage.clear(); } catch { /* blocked */ } });
  await page.goto('http://localhost:8642/index.html');
  await page.waitForSelector('#play-btn');
  await page.click('#play-btn');
  await page.waitForTimeout(400);

  const geom = await page.evaluate(() => {
    const r = document.getElementById('game-canvas').getBoundingClientRect();
    return { left: r.left, top: r.top, w: r.width, rows: window.__poofDebugState.grid.length };
  });
  const scale = geom.w / 384, HUD = 118, CELL = 64;
  const colX = (c) => geom.left + (c * CELL + CELL / 2) * scale;
  const y = geom.top + (HUD + Math.max(0, geom.rows - 2) * CELL + CELL / 2) * scale;

  // Deliberately pile into column 0 to build one tall stack fast: once it
  // reaches the ceiling, the next rise (past the level-3 grace) tops the board
  // out -- which forces the game-over path in ~20-25 drops instead of the ~130
  // a spread-out run takes, so this proves the END-to-end path in about a
  // minute. Natural-run termination is already proven exhaustively in the
  // pure-logic sim over the same modules.
  let rises = 0, lastSum = 0, lastIdx = -1;
  const deadline = Date.now() + 100000;
  while (Date.now() < deadline) {
    const s = await page.evaluate(() => {
      const st = window.__poofDebugState;
      if (!st) return null;
      return {
        screen: st.screen, active: !!st.active, idx: st.spawnIndex,
        sum: st.stackHeight.reduce((a, b) => a + b, 0),
        stacks: st.stackHeight.slice(), rows: st.grid.length,
        activeCol: st.active ? st.active.col : null,
      };
    });
    if (!s) { await page.waitForTimeout(50); continue; }
    if (s.screen !== 'playing') break;
    if (!s.active) { await page.waitForTimeout(30); continue; }
    if (s.idx === lastIdx) { await page.waitForTimeout(30); continue; }
    // A rise adds ~6 cells minus any it merges away; a jump of >=3 between
    // drops is a rise (a normal drop changes the sum by about +/-1).
    if (lastSum > 0 && s.sum - lastSum >= 3) rises++;
    lastSum = s.sum; lastIdx = s.idx;

    // Aim column 0 every drop to force a fast topout (the game redirects to the
    // nearest column with room once 0 is full, which is fine -- the point is to
    // drive the board to the ceiling quickly).
    const best = 0;
    await page.mouse.move(colX(s.activeCol ?? best), y);
    await page.mouse.down();
    await page.mouse.move(colX(best), y, { steps: 3 });
    await page.mouse.up();
    await page.evaluate((from) => new Promise((res) => {
      const st = window.__poofDebugState; const t0 = performance.now();
      const step = () => {
        if (st.screen !== 'playing' || st.spawnIndex > from || !st.active) res();
        else if (performance.now() - t0 > 8000) res();
        else requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }), s.idx);
  }

  const fin = await page.evaluate(() => {
    const st = window.__poofDebugState;
    return { screen: st.screen, score: st.score, drops: st.spawnIndex, level: Math.floor(st.spawnIndex / 10) + 1 };
  });
  await page.screenshot({ path: '/tmp/p17/floor-browser.png' });
  const unexpected = errors.filter((e) => !/game_api\/v1|youtube\.com|ERR_INTERNET|net::/i.test(e));
  console.log('FINAL: screen=' + fin.screen + ' drops=' + fin.drops + ' level=' + fin.level + ' score=' + fin.score);
  console.log('rises detected in-browser: ' + rises);
  console.log('total console/page errors: ' + errors.length + '  (benign SDK-offline: ' + (errors.length - unexpected.length) + ')');
  console.log('UNEXPECTED errors: ' + unexpected.length);
  unexpected.slice(0, 8).forEach((e) => console.log('  ! ' + e));
  await context.close();
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
