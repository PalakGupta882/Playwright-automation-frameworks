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
  workers: process.env.CI ? 1 : undefined,
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