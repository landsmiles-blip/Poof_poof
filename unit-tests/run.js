// Plain-node test runner. No framework, no dependencies.
//
// Discovers every unit-tests/*.js file (besides this one), imports it, and treats a
// thrown error during import as a failing test -- each test file is expected
// to run its assertions at module-evaluation time via node:assert.
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const files = readdirSync(testDir)
  .filter((f) => f.endsWith('.js') && f !== 'run.js')
  .sort();

let failed = 0;

for (const file of files) {
  const name = file.replace(/\.js$/, '');
  try {
    await import(pathToFileURL(path.join(testDir, file)));
    console.log(`ok - ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL - ${name}`);
    console.error(err.stack || err.message);
  }
}

console.log(`\n${files.length - failed}/${files.length} passed`);
process.exit(failed > 0 ? 1 : 0);
