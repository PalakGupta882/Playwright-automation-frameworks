// @ts-check
import { defineConfig, devices } from '@playwright/test';

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
  ],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  // Capped on purpose. These specs hit live production, and an uncapped local
  // run (6 workers on this machine) rate-limits the origin: a full regression
  // pass returned 429s and timed out UI flows that pass fine on their own.
  workers: process.env.CI ? 1 : 3,
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
    storageState: 'auth.json',
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