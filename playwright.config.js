// @ts-check
import { existsSync } from 'fs';
import path from 'path';
import { defineConfig, devices } from '@playwright/test';

// __dirname, not import.meta.url. This file is written as ESM but package.json
// sets "type": "commonjs", so Playwright loads it through its own transpiler and
// it executes as CJS — `import.meta` throws "Cannot use 'import.meta' outside a
// module" there, while __dirname is provided. Resolving from the config's own
// directory (rather than cwd) keeps this correct when run from a subdirectory.
const HERE = __dirname;

// SESSION — optional on purpose, so a fresh clone can run.
//
// auth.json is gitignored (it holds a real access token), so it does NOT exist
// after `git clone`. Pointing storageState at a missing file makes Playwright
// fail every test before it starts, with
//
//   Error reading storage state from auth.json: ENOENT
//
// including the public specs that need no session at all. A new engineer's
// first `npm test` then fails 100% and looks like a broken framework.
//
// So: use the file when it is there, and start logged out when it is not.
// Login-gated specs still refuse to run without a session — assertFreshSession()
// in tests/utils/session.js fails them fast with the real reason and a pointer
// to `npm run auth`. CI is unaffected: it writes an empty auth.json before the
// run, so this resolves to that file exactly as before.
const AUTH_FILE = path.join(HERE, 'auth.json');
const storageState = existsSync(AUTH_FILE) ? AUTH_FILE : undefined;

// DIAGNOSTIC SCRIPTS — excluded from a bare `npx playwright test`.
//
// tests/scripts/ holds ~24 probes, discovery runs and the page-health sweep.
// They are real Playwright files, so testMatch collects them: a bare
// `npx playwright test` was picking up 352 tests in 66 files and pointing all of
// them at production, including a 15-minute full-catalogue sweep. Someone typing
// the Playwright command they already know should not trigger that.
//
// They stay runnable when you ASK for them. The ignore lifts if the command
// names a path under scripts/ (so `npx playwright test scripts/probe-x.spec.js`
// and `npm run discover` / `npm run page-health` all work unchanged), or if
// BYTEPE_INCLUDE_SCRIPTS=1 is set.
const argv = process.argv.slice(2);
const targetsScripts = argv.some(
  (a) => !a.startsWith('-') && a.replace(/\\/g, '/').includes('scripts/')
);
const includeScripts = targetsScripts || process.env.BYTEPE_INCLUDE_SCRIPTS === '1';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.js',
  // Helpers live under tests/ but are not specs. Without these, testMatch
  // collects them as test files and a bare `npx playwright test` fails with
  // "test file X should not import test file Y" and collects nothing.
  testIgnore: [
    '**/pages/**',
    '**/wip/**',
    '**/data/**',
    '**/fixtures/**',
    '**/utils/**',
    // tests/api/ holds specs, so it is not ignored wholesale — but its one
    // shared helper sits alongside them and would otherwise be collected as a
    // spec. Any further helper added under tests/api/ needs its own entry here,
    // or it belongs in data/ or utils/ instead.
    '**/api/apiHelper.js',
    ...(includeScripts ? [] : ['**/scripts/**']),
  ],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  // Capped on purpose. These specs hit live production, and an uncapped local
  // run (6 workers on this machine) rate-limits the origin: a full regression
  // pass returned 429s and timed out UI flows that pass fine on their own.
  //
  // Lowered 3 -> 2 after measuring. At 3 workers every full run lost 2-5 tests
  // to timeouts and 429s — never the same ones, which is contention rather than
  // defects. The same specs passed 103/103 with retries off in a smaller set.
  // Retries were absorbing the difference, which meant a real regression would
  // have looked like the usual noise.
  workers: process.env.CI ? 1 : 2,
  reporter: 'html',
  // Matches what nearly every spec already sets for itself. Existing
  // test.setTimeout() calls stay and simply become no-ops at the same value;
  // the outliers (subscription-e2e at 180s) keep their override.
  timeout: 60000,
  // Up from Playwright's 5s default. The specs that flaked under load are the
  // ones with bare expects — product-search, product-pricing, account — while
  // most others already pass an explicit 15s, so this only lifts the floor.
  expect: { timeout: 10000 },
  use: {
    // Resolved above: the real file when present, otherwise undefined (a fresh,
    // logged-out context) so a clone without auth.json can still run.
    storageState,
    // The important one. Unset, actionTimeout defaults to 0, meaning an action
    // waits forever — so a click on an overlay-covered control consumed the
    // entire test budget instead of failing, and any retry loop around it never
    // reached its second attempt. 30s sits above every explicit timeout in the
    // repo (10-20s), so nothing that passes today changes; what changes is that
    // a hang becomes a legible failure.
    actionTimeout: 30000,
    navigationTimeout: 30000,
    trace: 'on-first-retry',
    // Every failing test leaves a PNG in test-results/ and in the HTML report
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    },
  ],
});