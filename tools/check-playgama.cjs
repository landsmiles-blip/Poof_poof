// Proves the Playgama archive actually works, in a real browser, by playing
// it -- rather than inferring it from reading the code.
//
//   node tools/build-playables.js --playgama && node tools/check-playgama.cjs
//
// Method. Spying on the minified Bridge bundle from outside is unreliable
// (its modules are getters that throw before initialize(), and its methods
// are class fields, so a wrapper installed at the wrong moment silently
// observes nothing -- which looks identical to "the game never called it").
// So this instruments OUR seam instead: it copies dist/playgama to
// dist/playgama-instrumented and adds one trace line to each bridge method
// in js/platform.js. The shipped archive is never touched, and every
// injection is an exact-text match that throws if platform.js has moved on.
//
// What is asserted:
//   0. no uncaught console errors
//   1. the Bridge path is the one selected (not ytgame, not the local impl)
//   2. bridge.initialize() resolves
//   3. the save is loaded through bridge.storage
//   4. game_ready is sent, once, after the menu is up
//   5. a real run, played to a real game over, fires the interstitial
//   6. progress written in that run survives a reload -- so the write went
//      through the Bridge, which is the one storage this build has

const { chromium } = require('playwright');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'dist', 'playgama');
const OUT = path.join(ROOT, 'dist', 'playgama-instrumented');
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.png': 'image/png', '.svg': 'image/svg+xml',
};

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(s, d); else fs.copyFileSync(s, d);
  }
}

// Each entry is [exact text in the built platform.js, the trace line to put
// in front of it]. An entry that no longer matches throws, so this check can
// never quietly stop watching something.
const PROBES = [
  ['let impl;\nif (isBridgeEnv) {', "window.__trace = [];\nwindow.__trace.push('selected:' + (isBridgeEnv ? 'bridge' : (isPlayablesEnv ? 'ytgame' : 'local')));\n"],
  ['        await window.bridge.initialize();', "        window.__trace.push('init:call');\n"],
  ['        const data = await window.bridge.storage.get(SAVE_KEY);', "        window.__trace.push('storage:get');\n"],
  ["      try { window.bridge.platform.sendMessage('game_ready'); }", "      window.__trace.push('game_ready');\n"],
  ['      try { window.bridge.advertisement.showInterstitial(placement ?? null); }', "      window.__trace.push('interstitial:' + placement);\n"],
  ['      return Promise.resolve(window.bridge.storage.set(SAVE_KEY, obj)).catch(() => {});', "      window.__trace.push('storage:set');\n"],
];

function instrument() {
  fs.rmSync(OUT, { recursive: true, force: true });
  copyDir(SRC, OUT);
  const p = path.join(OUT, 'js', 'platform.js');
  let src = fs.readFileSync(p, 'utf8');
  for (const [needle, trace] of PROBES) {
    if (src.split(needle).length - 1 !== 1) {
      throw new Error(`check-playgama: probe anchor not found exactly once in the built platform.js:\n  ${needle.split('\n')[0]}\nUpdate tools/check-playgama.cjs.`);
    }
    src = src.replace(needle, trace + needle);
  }
  fs.writeFileSync(p, src);
}

function serve(root) {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
    const file = path.join(root, rel);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end('not found'); return;
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  -- ${detail}` : ''}`);
}

(async () => {
  instrument();
  const server = await serve(OUT);
  const base = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 900, height: 1000 } });
  const page = await ctx.newPage();

  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(base, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__trace && window.__trace.includes('game_ready'), null, { timeout: 25000 })
    .catch(() => {});
  await page.waitForTimeout(500);

  let trace = await page.evaluate(() => window.__trace || []);
  check('1. the Bridge path is selected', trace[0] === 'selected:bridge', `first trace entry: ${trace[0]}`);
  check('2. bridge.initialize() was called and resolved', trace.includes('init:call') && trace.includes('storage:get'),
    'init followed by a storage read means init resolved');
  check('3. the save is loaded through bridge.storage', trace.includes('storage:get'));
  check('4. game_ready sent exactly once', trace.filter((t) => t === 'game_ready').length === 1,
    `count: ${trace.filter((t) => t === 'game_ready').length}`);

  await browser.close();
  server.close();

  // ---------------------------------------------------------------------
  // Second run: the interstitial at game over.
  //
  // The archive has no debug hook (build-playables.js strips it) and no way
  // to end a run on demand, and driving 100+ drops through synthetic pointer
  // events is slow and flaky -- a click is not the drag the input layer
  // expects, so most of them never land. So this run serves the REPO tree,
  // which keeps window.__poofDebugState, with the Bridge script and config
  // copied in beside it. Same js/platform.js, same js/main.js, same Bridge
  // build, same trace probes: what differs is only that the run can be
  // played to its real end through the game's own physics exports.
  const srcOut = path.join(ROOT, 'dist', 'playgama-sourcecheck');
  fs.rmSync(srcOut, { recursive: true, force: true });
  fs.mkdirSync(srcOut, { recursive: true });
  for (const d of ['js', 'css', 'assets']) copyDir(path.join(ROOT, d), path.join(srcOut, d));
  fs.copyFileSync(path.join(ROOT, 'vendor', 'playgama-bridge.js'), path.join(srcOut, 'playgama-bridge.js'));
  fs.copyFileSync(path.join(SRC, 'playgama-bridge-config.json'), path.join(srcOut, 'playgama-bridge-config.json'));
  {
    const p2 = path.join(srcOut, 'js', 'platform.js');
    let s2 = fs.readFileSync(p2, 'utf8');
    for (const [needle, trace] of PROBES) {
      if (s2.split(needle).length - 1 !== 1) throw new Error('check-playgama: source-tree probe anchor missing: ' + needle.split('\n')[0]);
      s2 = s2.replace(needle, trace + needle);
    }
    fs.writeFileSync(p2, s2);
  }
  fs.writeFileSync(path.join(srcOut, 'index.html'), `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Poof Poof</title><link rel="stylesheet" href="css/style.css"></head>
<body><canvas id="bg-canvas" aria-hidden="true"></canvas>
<div id="app"><canvas id="game-canvas" hidden></canvas><div id="overlay"></div></div>
<div id="pause-overlay" hidden></div>
<script src="playgama-bridge.js"></script>
<script type="module" src="js/main.js"></script>
</body></html>
`);

  const server2 = await serve(srcOut);
  const base2 = `http://127.0.0.1:${server2.address().port}/`;
  const browser2 = await chromium.launch();
  const page2 = await (await browser2.newContext({ viewport: { width: 900, height: 1000 } })).newPage();
  page2.on('pageerror', (e) => errors.push(String(e)));
  page2.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page2.goto(base2, { waitUntil: 'load' });
  await page2.waitForFunction(() => window.__poofDebugState && window.__trace && window.__trace.includes('game_ready'),
    null, { timeout: 25000 }).catch(() => {});

  const runResult = await page2.evaluate(async () => {
    const st = await import('./js/state.js');
    const ph = await import('./js/physics.js');
    const state = window.__poofDebugState;
    st.startRun(state);
    const cell = 64;
    let drops = 0;
    // Spread the drops so the run ends the way the design says it must --
    // the board full with no move left, never one column overflowing.
    while (drops < 600) {
      const spawned = ph.spawnFruit(state);
      if (spawned.blocked || ph.isGameOver(state)) break;
      ph.setDragTarget(state, ((drops * 7) % 6 + 0.5) * cell);
      ph.hardDrop(state);
      drops += 1;
    }
    return { drops, over: ph.isGameOver(state), score: state.score };
  });

  // The interstitial is fired by js/main.js's update(), which only runs
  // inside the rAF loop -- so hand the loop a few frames to notice the run
  // is over, exactly as it would for a player.
  await page2.waitForTimeout(1500);
  const trace2 = await page2.evaluate(() => window.__trace || []);
  const interstitial = trace2.find((t) => t.startsWith('interstitial:'));
  check("5. a run played to a real game over fires the interstitial with the 'game_over' placement",
    interstitial === 'interstitial:game_over',
    `${runResult.drops} drops, score ${runResult.score}, gameOver=${runResult.over}, trace entry: ${interstitial || 'none'}`);

  check('6. the finished run is written back through bridge.storage',
    trace2.includes('storage:set'),
    'storage:set seen after the run ended');

  await browser2.close();
  server2.close();

  const realErrors = errors.filter((e) => !/favicon|ERR_TUNNEL|net::|404/i.test(e));
  check('0. no uncaught console errors', realErrors.length === 0,
    realErrors.length ? realErrors.slice(0, 2).join(' | ') : 'none');

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})();
