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
// screen.orientation.lock) doesn't match what this script expects, rather
// than silently shipping an unstripped build.

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
<div id="app">
  <canvas id="game-canvas" hidden></canvas>
  <div id="overlay"></div>
</div>
<!-- YouTube Playables SDK -- must load before js/main.js, since js/platform.js
     reads window.ytgame.IN_PLAYABLES_ENV at import time to choose an
     implementation. Deliberately left uninserted here rather than guessed:
     an invented <script src> would be indistinguishable from a verified one
     to a future reader. Needs the real tag from Google's onboarding docs
     before certification -- see docs/playables-plan.md item 2.3. -->
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
  buildIndexHtml();
  assertNoDebugHookString();

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
