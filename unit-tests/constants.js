// Sanity check that the harness can import the real modules and that
// BUILD_VERSION -- the only way to tell which build a browser is running --
// is actually present and shaped like a date-plus-counter.
import assert from 'node:assert/strict';
import { BUILD_VERSION } from '../js/constants.js';

assert.match(BUILD_VERSION, /^\d{4}\.\d{2}\.\d{2}-\d+$/);
