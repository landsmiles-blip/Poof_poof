// Greps dist/playables/ for APIs prohibited by the Playables sandbox/CSP,
// failing on any match outside js/platform.js -- the one file CLAUDE.md
// permits to reference storage or lifecycle APIs at all. Commit this as a
// script so it can be re-run before every future submission:
//
//   node tools/build-playables.js && node tools/check-prohibited-apis.js

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TARGET = path.join(ROOT, 'dist', 'playables');

const PROHIBITED = [
  'localStorage', 'sessionStorage', 'indexedDB', 'document.cookie',
  'visibilitychange', 'navigator.language', 'navigator.languages', 'fetch(',
  'XMLHttpRequest', 'WebSocket', 'eval(', 'new Worker', 'WebAssembly',
  'alert(', 'confirm(', 'prompt(', 'screen.orientation',
];

// Storage and lifecycle terms are the ones js/platform.js is explicitly
// allowed to reference (CLAUDE.md's "one platform seam" rule) -- everything
// else on the list must never appear anywhere in the build, platform.js
// included (there is no legitimate reason for it to contain a fetch(), an
// eval(, or a WebSocket either).
const ALLOWED_ONLY_IN_PLATFORM = new Set([
  'localStorage', 'sessionStorage', 'indexedDB', 'document.cookie', 'visibilitychange',
]);

function walk(dir, cb) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, cb);
    else cb(p);
  }
}

function main() {
  if (!fs.existsSync(TARGET)) {
    console.error(`check-prohibited-apis: ${path.relative(ROOT, TARGET)} does not exist -- run tools/build-playables.js first.`);
    process.exit(1);
  }

  const violations = [];
  walk(TARGET, (file) => {
    if (!/\.(js|html)$/i.test(file)) return;
    const rel = path.relative(TARGET, file).split(path.sep).join('/');
    const isPlatform = rel === 'js/platform.js';
    const text = fs.readFileSync(file, 'utf8');
    for (const term of PROHIBITED) {
      if (!text.includes(term)) continue;
      if (isPlatform && ALLOWED_ONLY_IN_PLATFORM.has(term)) continue;
      violations.push({ file: rel, term });
    }
  });

  if (violations.length > 0) {
    console.error('check-prohibited-apis: found prohibited references:');
    for (const v of violations) console.error(`  ${v.file}: ${v.term}`);
    process.exit(1);
  }
  console.log(`check-prohibited-apis: clean -- no prohibited API references outside js/platform.js in ${path.relative(ROOT, TARGET)}`);
}

main();
