// tests/scripts/probe-plan-tabs-capture.spec.js
//
// Measurement only. For a few products, logged out and logged in, records the
// PDP header text and the plan dialog's text under EVERY funding tab, so the
// pricing comparison (probe-plan-pricing-vs-api) is written against copy the
// page really renders. READ-ONLY: cart, order and coin writes are aborted.
//
//   npx playwright test scripts/probe-plan-tabs-capture.spec.js --project=chromium --retries=0
//
// Output: test-results/plan-tabs-capture.json

const fs = require('fs');
const path = require('path');
const { test } = require('../fixtures/pageFixtures');
const { BASE_URL, TIMEOUTS } = require('../data/constants');
const { AUTH_PATH } = require('../data/env');
const { openPlanPanel, planDialog } = require('../utils/planPanel');
const { buyNowControl } = require('../utils/buyRow');
const { waitForApiQuiet } = require('../utils/harCapture');

const OUT = path.join(__dirname, '..', '..', 'test-results', 'plan-tabs-capture.json');
const WRITE = /create-order|wallet-service\/.*\/(apply|remove)|\/api\/cart(\/|\?|$)/;

const PRODUCTS = [
  { slug: 'galaxy-m47-5g', bpid: 'SAMSAMOBW4IQZM' },
  { slug: 'wf-c510-truly-wireless-headphones', bpid: 'SOAWIWIRNJK9XF' },
  { slug: 'pixel-11', bpid: 'GOOSAMOBXQE25Q' },
  { slug: 'pixel-11-pro-fold', bpid: 'GOOSAMOBESY6NH' },
];

test.describe.configure({ retries: 0 });

test('capture plan text per funding tab', async ({ browser }) => {
  test.setTimeout(600000);
  const out = [];

  for (const state of ['logged out', 'logged in']) {
    const context = await browser.newContext(
      state === 'logged in' ? { storageState: AUTH_PATH } : { storageState: { cookies: [], origins: [] } }
    );
    await context.route('**/api/**', (route) =>
      route.request().method() !== 'GET' && WRITE.test(route.request().url()) ? route.abort() : route.continue()
    );
    const page = await context.newPage();

    for (const p of PRODUCTS) {
      const rec = { state, ...p, tabs: {} };
      await page.goto(`${BASE_URL}/pd/${p.slug}/${p.bpid}`, { waitUntil: 'load' });
      await buyNowControl(page).first().waitFor({ state: 'visible', timeout: TIMEOUTS.nav }).catch(() => {});
      await waitForApiQuiet(page, { quietMs: 3000, maxMs: 30000 });
      rec.body = await page.locator('body').innerText();

      rec.panelOpened = await openPlanPanel(page);
      if (rec.panelOpened) {
        const dialog = planDialog(page).first();
        rec.tabRoles = await dialog.getByRole('tab').allInnerTexts().catch(() => []);
        rec.dialogDefault = await dialog.innerText();
        for (const name of ['Credit Card', 'Cardless EMI', 'Pay in Full']) {
          const tab = dialog.getByText(name, { exact: true }).first();
          if (!(await tab.isVisible().catch(() => false))) {
            rec.tabs[name] = null;
            continue;
          }
          await tab.click({ timeout: TIMEOUTS.action });
          await waitForApiQuiet(page, { quietMs: 2000, maxMs: 15000 });
          rec.tabs[name] = await dialog.innerText();
        }
      }
      out.push(rec);
      console.log(`${state} ${p.slug}: panel ${rec.panelOpened} tabs ${JSON.stringify(rec.tabRoles)} captured ${Object.keys(rec.tabs).filter((k) => rec.tabs[k]).join(',')}`);
    }
    await context.close();
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
  console.log(`\n${OUT}`);
});
