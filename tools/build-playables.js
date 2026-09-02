// Produces dist/playables/ -- a build containing only the game itself, for
// the YouTube Playables container. No bundler: this copies exactly the files
// Playables needs, rewrites index.html to drop everything that only serves
// the PWA/Pages target, and strips ?dev=1 from THIS build only -- the Pages
// build keeps it (tests/verify-features.js still exercises it there; see
// docs/playables-plan.md item 1.5).
//
//   node tools/build-playables.js
//
// Exit code is non-zero if anything expected to be strippable (devModeEnabled,
// screen.orientation.lock, createLocalImpl's storage/lifecycle code) doesn't
// match what this script expects, rather than silently shipping an
// unstripped build.

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, 'dist', 'playables');

const INCLUDE_DIRS = ['css', 'js', path.join('assets', 'fonts')];

// Everything not explicitly included above is excluded by construction --
// package.json, node_modules/, tests/, unit-tests/, docs/, .github/, tools/,
// manifest.json, icons/, service-worker.js, CLAUDE.md, README.md, and any
// dotfiles never get copied in the first place.

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

function walk(dir, cb) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, cb);
    else cb(p);
  }
}

function countFilesAndBytes(dir) {
  let files = 0;
  let bytes = 0;
  walk(dir, (p) => {
    files += 1;
    bytes += fs.statSync(p).size;
  });
  return { files, bytes };
}

// Orientation must never be locked, in the manifest (excluded entirely from
// this build) or in code. Verified here, not just assumed, so a future
// addition trips the build rather than certification.
function assertNoOrientationLock() {
  let found = false;
  walk(path.join(ROOT, 'js'), (p) => {
    if (!p.endsWith('.js')) return;
    if (fs.readFileSync(p, 'utf8').includes('screen.orientation.lock')) {
      found = true;
      console.error(`build-playables: found screen.orientation.lock in ${path.relative(ROOT, p)}`);
    }
  });
  if (found) {
    throw new Error('build-playables: orientation lock is prohibited outright -- refusing to build.');
  }
}

// ?dev=1 is a testing affordance for the Pages build only -- a URL-parameter
// cheat that unlocks everything has no place in a certification build.
// Matched against exact known source rather than a loose regex, so a change
// to js/state.js that this script has not been updated for fails the build
// instead of silently shipping dev mode.
function stripDevMode() {
  const statePath = path.join(OUT, 'js', 'state.js');
  // Normalized once here rather than assumed: this repo is checked out with
  // CRLF line endings on Windows, and an exact-match check that only knew
  // about LF would fail this build every time for a reason that has nothing
  // to do with ?dev=1 actually being present.
  const src = fs.readFileSync(statePath, 'utf8').replace(/\r\n/g, '\n');
  const original = `export function devModeEnabled() {
  try {
    return new URLSearchParams(window.location.search).get('dev') === '1';
  } catch {
    return false;
  }
}`;
  if (!src.includes(original)) {
    throw new Error(
      'build-playables: devModeEnabled() in js/state.js did not match the text this script ' +
      'expects -- update tools/build-playables.js before ?dev=1 can be confirmed stripped.',
    );
  }
  const replacement = `// ?dev=1 is stripped from the Playables build -- see tools/build-playables.js.
// The Pages build keeps the real implementation (js/state.js in the repo).
export function devModeEnabled() {
  return false;
}`;
  fs.writeFileSync(statePath, src.replace(original, replacement));
}

// Prevents the generated index.html from silently falling behind the real
// one. buildIndexHtml() below generates from scratch rather than stripping --
// the right call, since regex-surgery on an evolving file is more fragile
// long-term -- but that creates exactly this failure mode: if index.html
// later gains a stylesheet, a font preload, or a script the game needs, the
// generated copy will not have it, and the game breaks in Playables while
// passing every test on Pages. Anything genuinely Pages-only (the manifest,
// the icons) is named on the ignore list below, with a reason -- everything
// else referenced by index.html must show up somewhere in the generated HTML.
const INDEX_IGNORE_LIST = new Map([
  ['manifest.json', 'PWA-only, has no role in the Playables container'],
  ['icons/icon-192.png', 'PWA-only icon (rel=icon and rel=apple-touch-icon both point here)'],
]);

function collectIndexAssetRefs(html) {
  const refs = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const hrefMatch = m[0].match(/\bhref=["']([^"']+)["']/i);
    const relMatch = m[0].match(/\brel=["']([^"']+)["']/i);
    if (hrefMatch) refs.push({ kind: `link[rel=${relMatch ? relMatch[1] : '?'}]`, target: hrefMatch[1] });
  }
  for (const m of html.matchAll(/<script\b[^>]*>/gi)) {
    const srcMatch = m[0].match(/\bsrc=["']([^"']+)["']/i);
    if (srcMatch) refs.push({ kind: 'script', target: srcMatch[1] });
  }
  return refs;
}

function assertGeneratedIndexInSync(generatedHtml) {
  const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const missing = collectIndexAssetRefs(src).filter(
    (ref) => !INDEX_IGNORE_LIST.has(ref.target) && !generatedHtml.includes(ref.target),
  );
  if (missing.length > 0) {
    throw new Error(
      'build-playables: index.html references ' +
      missing.map((r) => `${r.kind}="${r.target}"`).join(', ') +
      ' -- not present in the generated dist/playables/index.html, and not on the ' +
      'explicit INDEX_IGNORE_LIST in tools/build-playables.js. If this is genuinely ' +
      'Pages-only, add it to that list with a reason; otherwise the Playables build is ' +
      'missing something the game needs.',
    );
  }
}

function buildIndexHtml() {
  const src = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const titleMatch = src.match(/<title>([^<]*)<\/title>/);
  const descMatch = src.match(/<meta name="description" content="([^"]*)">/);
  if (!titleMatch || !descMatch) {
    throw new Error('build-playables: could not find <title> or the description meta in index.html.');
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">
<meta name="description" content="${descMatch[1]}">
<title>${titleMatch[1]}</title>
<link rel="stylesheet" href="css/style.css">
</head>
<body>
<canvas id="bg-canvas" aria-hidden="true"></canvas>
<div id="app">
  <canvas id="game-canvas" hidden></canvas>
  <div id="overlay"></div>
</div>
<!-- YouTube Playables SDK -- must load before js/main.js, since js/platform.js
     reads window.ytgame.IN_PLAYABLES_ENV at import time to choose an
     implementation. Tag copied verbatim from Google's getting-started docs
     (developers.google.com/youtube/gaming/playables/reference/getting_started).
     Phase 16 closed the gap left open since phase 2 -- see docs/phase16brief.md. -->
<script src="https://www.youtube.com/game_api/v1"></script>
<script type="module" src="js/main.js"></script>
</body>
</html>
`;
  assertGeneratedIndexInSync(html);
  fs.writeFileSync(path.join(OUT, 'index.html'), html);
}

// 5.0.2: window.__poofDebugState is already gated behind platform.isPlayablesEnv
// at runtime (defense in depth), but the container should never see the
// identifier at all -- stripped from the built copy entirely, matched
// against exact source text so a change this script has not been updated
// for fails the build instead of silently shipping the hook.
function stripDebugHook() {
  const mainPath = path.join(OUT, 'js', 'main.js');
  const src = fs.readFileSync(mainPath, 'utf8').replace(/\r\n/g, '\n');
  const original = `  // Test-only hook: lets an automated check (e.g. "state survives a resize")
  // read the running game's actual state without a bespoke IPC channel for
  // it. Gated out of the Playables container at runtime (defense in depth)
  // AND stripped from dist/playables/ entirely by tools/build-playables.js
  // -- the container should never see this identifier at all, not just have
  // it be inert. Pages-only, where tests/verify-features.js uses it.
  if (!platform.isPlayablesEnv) window.__poofDebugState = state;
`;
  if (!src.includes(original)) {
    throw new Error(
      'build-playables: the __poofDebugState hook in js/main.js did not match the text ' +
      'this script expects -- update tools/build-playables.js.',
    );
  }
  fs.writeFileSync(mainPath, src.replace(original, ''));
}

// Phase 16 (R1 of the certification audit). Once index.html loads the real
// SDK tag, `isPlayablesEnv` is true everywhere inside the actual container
// and createLocalImpl is never CALLED there -- but its source, including
// `window.localStorage` and `visibilitychange`/`pageshow`/`focus`, still
// SHIPS in dist/playables/js/platform.js, because this build copies the file
// unchanged. Correct at runtime is not the same claim as clean under static
// review: Integration §4 is "Game MUST NOT use any OTHER MECHANISM to save
// user progress" and Integration §6 is "Game MUST NOT use the web Page
// Visibility API" -- both read the code, not just the code path a debugger
// happens to hit. Google says minification is fine but "MUST NOT obfuscate
// code or conceal the functionality of the game" (Privacy §5), so hiding
// this behind an unreachable branch instead of removing it is the wrong
// direction to fix it in.
//
// The replacement below is NOT a stub that throws. It keeps the same
// interface, entirely in-memory, so that IF isPlayablesEnv is ever somehow
// false inside the real container (a host bug, a race at import time) the
// game degrades to "progress does not persist this session" instead of a
// hard crash -- the same fail-open philosophy createYtgameImpl's own guards
// already use. What it removes is only the two things the requirements
// name: no localStorage, no document-level lifecycle listener. Matched
// against exact source text, same pattern as stripDevMode/stripDebugHook
// above, so a future edit to createLocalImpl that this script has not been
// updated for fails the build instead of silently shipping the old text (or
// silently shipping storage/lifecycle code the new text added).
function stripLocalImplForCertification() {
  const platformPath = path.join(OUT, 'js', 'platform.js');
  const src = fs.readFileSync(platformPath, 'utf8').replace(/\r\n/g, '\n');
  const original = `function createLocalImpl() {
  const memoryStore = new Map();
  let backendChecked = false;
  let hasLocalStorage = false;
  let readOnly = false;

  // Sandboxed iframes, Safari private mode, and browsers with site data
  // blocked can make \`localStorage\` throw on *access*, not just on read or
  // write. When storage is unavailable we fall back to an in-memory store:
  // progress stops surviving a reload, but the game still runs.
  function localStorageAvailable() {
    if (backendChecked) return hasLocalStorage;
    backendChecked = true;
    try {
      const probe = '__poofpoof_probe__';
      if (readOnly) {
        // The usual probe writes and removes a key. In read-only mode that
        // would still be a write, so confirm access with a read instead --
        // reads must keep working, since dev mode should show the real save.
        window.localStorage.getItem(probe);
      } else {
        window.localStorage.setItem(probe, '1');
        window.localStorage.removeItem(probe);
      }
      hasLocalStorage = true;
    } catch {
      hasLocalStorage = false;
    }
    return hasLocalStorage;
  }

  function readRaw(key) {
    // In read-only mode anything written this session lives only in the
    // memory store, and must win over the real save -- otherwise a dev
    // session value would read back as the untouched old one.
    if (readOnly && memoryStore.has(key)) return memoryStore.get(key);
    if (localStorageAvailable()) {
      try {
        return window.localStorage.getItem(key);
      } catch {
        // Fall through to the memory store rather than crashing.
      }
    }
    return memoryStore.has(key) ? memoryStore.get(key) : null;
  }

  function writeRaw(key, value) {
    memoryStore.set(key, value);
    if (readOnly) return;
    if (!localStorageAvailable()) return;
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // Quota exceeded or storage revoked mid-session; memory store holds it.
    }
  }

  function numberOr(raw, fallback) {
    const n = raw === null ? NaN : Number(raw);
    return Number.isFinite(n) ? n : fallback;
  }

  function jsonOr(raw, fallback) {
    if (raw === null) return fallback;
    try {
      const parsed = JSON.parse(raw);
      return parsed === null || typeof parsed !== 'object' ? fallback : parsed;
    } catch {
      return fallback;
    }
  }

  // Migrates the seven pre-platform keys into the versioned blob shape, once.
  // Returns null when there is nothing to migrate (a genuinely fresh save).
  function migrateLegacy() {
    const rawHigh = readRaw(LEGACY_STORAGE_KEYS.highScore);
    const rawCoins = readRaw(LEGACY_STORAGE_KEYS.coins);
    const rawInventory = readRaw(LEGACY_STORAGE_KEYS.inventory);
    const rawSkins = readRaw(LEGACY_STORAGE_KEYS.unlockedSkins);
    const rawSelected = readRaw(LEGACY_STORAGE_KEYS.selectedSkin);
    const rawMuted = readRaw(LEGACY_STORAGE_KEYS.muted);
    const rawMusicOn = readRaw(LEGACY_STORAGE_KEYS.musicOn);

    const anyPresent = [rawHigh, rawCoins, rawInventory, rawSkins, rawSelected, rawMuted, rawMusicOn]
      .some((v) => v !== null);
    if (!anyPresent) return null;

    return {
      v: 1,
      highScore: numberOr(rawHigh, 0),
      coins: numberOr(rawCoins, 0),
      inventory: jsonOr(rawInventory, {}),
      unlockedSkins: jsonOr(rawSkins, ['classic']),
      selectedSkin: rawSelected || 'classic',
      // Legacy stored "muted" (true = silent); the blob stores "sfxOn" (true
      // = sound on) -- inverted on the way through, once, here.
      musicOn: rawMusicOn === null ? true : rawMusicOn !== '0',
      sfxOn: rawMuted === null ? true : rawMuted !== '1',
    };
  }

  async function load() {
    const raw = readRaw(SAVE_KEY);
    if (raw !== null) {
      const parsed = jsonOr(raw, null);
      if (parsed) return parsed;
    }
    const migrated = migrateLegacy();
    if (migrated) writeRaw(SAVE_KEY, JSON.stringify(migrated));
    return migrated;
  }

  const saver = createDebouncedSaver((obj) => writeRaw(SAVE_KEY, JSON.stringify(obj)));

  const pauseHandlers = [];
  const resumeHandlers = [];
  let lifecycleWired = false;

  function wireLifecycle() {
    if (lifecycleWired) return;
    // Guarded, not just for browsers without the API: it also lets this impl
    // be exercised directly by a plain-node unit test with no DOM at all.
    if (typeof document === 'undefined' || !document.addEventListener) return;
    lifecycleWired = true;
    document.addEventListener('visibilitychange', () => {
      const handlers = document.hidden ? pauseHandlers : resumeHandlers;
      for (const cb of handlers) cb();
    });
    // 12.1: visibilitychange's resume half proved to be exactly the
    // unreliable signal in an in-app WebView (a github.io page inside an
    // app's own browser, not Chrome) -- the freeze's reproduction is a
    // hidden that fires with no matching resume ever arriving. pageshow
    // (bfcache/back-forward restore) and window focus are independent
    // signals that the page is visible again; wired to the SAME
    // resumeHandlers list visibilitychange's resume half already drives, so
    // callers (js/main.js) still see exactly one resume path. Resume-only on
    // purpose: there is no matching pagehide/blur pause here, since a
    // missed pause is invisible to the player (the game just keeps running
    // a beat longer) while a missed resume is the freeze itself.
    window.addEventListener('pageshow', () => {
      for (const cb of resumeHandlers) cb();
    });
    window.addEventListener('focus', () => {
      for (const cb of resumeHandlers) cb();
    });
  }

  return {
    async init() { wireLifecycle(); },
    load,
    save: saver.save,
    flush: saver.flush,
    firstFrameReady() {},
    gameReady() {},
    onPause(cb) { pauseHandlers.push(cb); },
    onResume(cb) { resumeHandlers.push(cb); },
    audioEnabled() { return true; },
    onAudioEnabledChange() {}, // never fires locally -- audio is always enabled
    async submitScore() {},
    async language() { return 'en'; },
    // Not part of the Playables-facing interface -- a local-only extension so
    // ?dev=1 (js/state.js's devModeEnabled) can keep inflating inventory and
    // highScore in memory without ever persisting it over a real save.
    setReadOnly(value) { readOnly = Boolean(value); },
    isReadOnly() { return readOnly; },
  };
}`;
  if (!src.includes(original)) {
    throw new Error(
      'build-playables: createLocalImpl() in js/platform.js did not match the text this ' +
      'script expects -- update tools/build-playables.js before the certification build\'s ' +
      'localStorage/visibility code can be confirmed stripped.',
    );
  }
  const replacement = `// Phase 16: stripped to an in-memory-only fallback for the certification
// build -- see tools/build-playables.js stripLocalImplForCertification().
// No browser storage API and no document-level lifecycle listener of any
// kind: Integration §4 and §6 read the shipped code, not just the path
// isPlayablesEnv routes around. The Pages build keeps the real
// implementation (js/platform.js in the repo), where local persistence and
// the visibility-event fallback are both needed.
function createLocalImpl() {
  const memoryStore = new Map();
  let readOnly = false;

  async function load() {
    return memoryStore.has(SAVE_KEY) ? JSON.parse(memoryStore.get(SAVE_KEY)) : null;
  }

  const saver = createDebouncedSaver((obj) => {
    if (readOnly) return;
    memoryStore.set(SAVE_KEY, JSON.stringify(obj));
  });

  return {
    async init() {},
    load,
    save: saver.save,
    flush: saver.flush,
    firstFrameReady() {},
    gameReady() {},
    onPause() {},
    onResume() {},
    audioEnabled() { return true; },
    onAudioEnabledChange() {},
    async submitScore() {},
    async language() { return 'en'; },
    setReadOnly(value) { readOnly = Boolean(value); },
    isReadOnly() { return readOnly; },
  };
}`;
  let out = src.replace(original, replacement);

  // Three prose comments elsewhere in the file describe the REPO's rule
  // ("this file may reference localStorage") or its history ("moved here
  // from js/storage.js's localStorage access") -- true of js/platform.js in
  // the repo, and harmless as English, but assertNoLocalStorageOrVisibilityAPI
  // below (deliberately) does not distinguish prose from code, on the theory
  // that a scanner reading the submitted bundle may not either. Rewritten
  // for the certification copy only; matched exactly so a future edit to
  // either comment fails the build instead of silently leaving stale text.
  const headerOriginal = `// This is the ONLY file in the codebase permitted to reference \`ytgame\`,
// \`localStorage\`, or a document-level lifecycle event (\`visibilitychange\`,
// \`pageshow\`, \`focus\`). Everything else -- including js/state.js -- goes
// through the exported functions below.`;
  const headerReplacement = `// This is the ONLY file in the codebase permitted to reference \`ytgame\`.
// In the repo (Pages build) it is also the only file permitted to touch
// browser storage or a document-level lifecycle event; this certification
// copy has had that half stripped entirely -- see
// stripLocalImplForCertification() in tools/build-playables.js.`;
  if (!out.includes(headerOriginal)) {
    throw new Error('build-playables: platform.js header comment did not match -- update tools/build-playables.js.');
  }
  out = out.replace(headerOriginal, headerReplacement);

  const localImplBlurbOriginal = `// --- localImpl -------------------------------------------------------------
// Wraps today's guarded-localStorage behaviour (moved here from the old
// js/storage.js, defensive design intact) behind load/save, visibilitychange
// behind onPause/onResume, and the ?dev=1 read-only mode.`;
  const localImplBlurbReplacement = `// --- localImpl -------------------------------------------------------------`;
  if (!out.includes(localImplBlurbOriginal)) {
    throw new Error('build-playables: platform.js localImpl section comment did not match -- update tools/build-playables.js.');
  }
  out = out.replace(localImplBlurbOriginal, localImplBlurbReplacement);

  const ytgameBlurbOriginal = `// every call is guarded the same way js/storage.js's localStorage access
// always was: a platform that misbehaves must never take the game down.`;
  const ytgameBlurbReplacement = `// every call is guarded so a platform that misbehaves must never take the
// game down.`;
  if (!out.includes(ytgameBlurbOriginal)) {
    throw new Error('build-playables: platform.js ytgameImpl section comment did not match -- update tools/build-playables.js.');
  }
  out = out.replace(ytgameBlurbOriginal, ytgameBlurbReplacement);

  fs.writeFileSync(platformPath, out);
}

function assertNoLocalStorageOrVisibilityAPI() {
  const platformPath = path.join(OUT, 'js', 'platform.js');
  const src = fs.readFileSync(platformPath, 'utf8');
  const forbidden = ['localStorage', 'visibilitychange', 'pageshow', "addEventListener('focus'"];
  const found = forbidden.filter((s) => src.includes(s));
  if (found.length > 0) {
    throw new Error(
      `build-playables: ${found.join(', ')} still present in dist/playables/js/platform.js ` +
      'after stripLocalImplForCertification() -- the strip did not remove everything it should have.',
    );
  }
}

function assertNoDebugHookString() {
  let found = false;
  walk(OUT, (p) => {
    if (fs.readFileSync(p, 'utf8').includes('__poofDebugState')) {
      found = true;
      console.error(`build-playables: found __poofDebugState in ${path.relative(OUT, p)}`);
    }
  });
  if (found) {
    throw new Error('build-playables: __poofDebugState must not appear anywhere in dist/playables/.');
  }
}

function main() {
  assertNoOrientationLock();

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  for (const dir of INCLUDE_DIRS) {
    copyDir(path.join(ROOT, dir), path.join(OUT, dir));
  }

  stripDevMode();
  stripDebugHook();
  stripLocalImplForCertification();
  buildIndexHtml();
  assertNoDebugHookString();
  assertNoLocalStorageOrVisibilityAPI();

  const { files, bytes } = countFilesAndBytes(OUT);
  const mib = (bytes / (1024 * 1024)).toFixed(3);
  console.log(`dist/playables/: ${files} files, ${bytes} bytes (${mib} MiB)`);
  console.log('Limits: 30 MiB initial (measured to gameReady), 250 MiB total, 30 MiB/file, 8000 files.');
  if (files > 8000) throw new Error(`build-playables: ${files} files exceeds the 8000-file limit.`);
  if (bytes > 250 * 1024 * 1024) throw new Error(`build-playables: ${bytes} bytes exceeds the 250 MiB total limit.`);
  walk(OUT, (p) => {
    const size = fs.statSync(p).size;
    if (size > 30 * 1024 * 1024) throw new Error(`build-playables: ${path.relative(OUT, p)} (${size} bytes) exceeds the 30 MiB per-file limit.`);
  });
}

main();
