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
  use: {
    storageState: 'auth.json',
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