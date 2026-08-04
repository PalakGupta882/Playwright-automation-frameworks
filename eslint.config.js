// ESLint flat config.
//
// The value here is eslint-plugin-playwright: it catches the test bugs that
// still pass silently — a missing await on an expect, a conditional wrapped
// around an assertion, a stray .only that skips the rest of the suite.

const playwright = require('eslint-plugin-playwright');

const nodeGlobals = {
  require: 'readonly',
  module: 'writable',
  process: 'readonly',
  console: 'readonly',
  __dirname: 'readonly',
  __filename: 'readonly',
};

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'playwright-report/**',
      'test-results/**',
      'blob-report/**',
    ],
  },

  // Specs and their helpers: CommonJS, Node globals, Playwright rules.
  {
    ...playwright.configs['flat/recommended'],
    files: ['tests/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: nodeGlobals,
    },
    rules: {
      ...playwright.configs['flat/recommended'].rules,
      // A committed .only silently skips every other test in the file.
      'playwright/no-focused-test': 'error',
      'playwright/no-skipped-test': 'warn',
    },
  },

  // tests/scripts/ are one-off discovery/crawl utilities that happen to run on
  // the Playwright runner. They branch and log rather than assert, by design.
  {
    files: ['tests/scripts/**/*.js'],
    rules: {
      'playwright/expect-expect': 'off',
      'playwright/no-conditional-in-test': 'off',
      'playwright/no-wait-for-timeout': 'off',
    },
  },

  // The video feature specs gate themselves on credentials and on a product
  // that actually has a video. Skipping is the design, not an oversight.
  {
    files: ['tests/regression/video-*.spec.js'],
    rules: { 'playwright/no-skipped-test': 'off' },
  },

  // page.pause() in the OTP helper is deliberate — it's how a human types the
  // code before resuming.
  {
    files: ['tests/utils/otpHelper.js'],
    rules: { 'playwright/no-page-pause': 'off' },
  },

  // The Playwright config is the one ESM file in an otherwise CommonJS repo.
  {
    files: ['playwright.config.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: nodeGlobals,
    },
  },
];
