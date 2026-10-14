// tests/fixtures/pageFixtures.js
const base = require('@playwright/test');
const { HomePage } = require('../pages/homepage');
const { ProductPage } = require('../pages/productPage');
const { ProductsListPage } = require('../pages/productsListPage');
const { ReviewOrderPage } = require('../pages/reviewOrderPage');
const { EmiStorePage } = require('../pages/emiStorePage');
const { SubHomeTabsPage } = require('../pages/subHomeTabsPage');
const { installExchangeDialogHandler } = require('../utils/exchangeDialog');
const { saveRotatedSession, usableStorageState } = require('../utils/session');

const test = base.test.extend({
  // An expired saved session is replaced by a logged-out one, per test. Global
  // setup refreshes before the run, but a run longer than 15 minutes outlives the
  // access_token, and a page loaded with it revokes the single-use refresh_token.
  // Specs that pass their own storageState are untouched.
  storageState: async ({ storageState }, use) => {
    await use(usableStorageState(storageState));
  },

  // Overridden rather than added: the BytePe Exchange dialog opens on its own on
  // cart and Review Order and blocks pointer events until it is dismissed, so it
  // has to be handled for every spec, not the ones that remembered to ask.
  // Inert on pages and sessions where it never appears. See
  // tests/utils/exchangeDialog.js for the locator rationale.
  //
  // Teardown keeps auth.json current: the refresh_token is single-use, and a
  // page that let the app refresh would otherwise leave a revoked token on disk.
  // See saveRotatedSession in tests/utils/session.js.
  //
  // Teardown first waits out any refresh still in flight. Measured 5 Oct 2026: a
  // ~1s smoke test ended while the app's refresh-tokens call was on the wire —
  // the server consumed the token, the browser closed before storing the
  // replacement, and auth.json was left holding a revoked token anyway.
  page: async ({ page }, use) => {
    await installExchangeDialogHandler(page);
    const refreshes = [];
    page.on('request', (req) => {
      if (/\/auth\/refresh-tokens/.test(req.url())) refreshes.push(req.response().catch(() => null));
    });
    await use(page);
    await Promise.race([
      Promise.allSettled(refreshes),
      new Promise((resolve) => setTimeout(resolve, 10000)),
    ]);
    await saveRotatedSession(page.context());
  },

  homePage:         async ({ page }, use) => { await use(new HomePage(page)); },
  productPage:      async ({ page }, use) => { await use(new ProductPage(page)); },
  productsListPage: async ({ page }, use) => { await use(new ProductsListPage(page)); },
  reviewOrderPage:  async ({ page }, use) => { await use(new ReviewOrderPage(page)); },
  emiStorePage:     async ({ page }, use) => { await use(new EmiStorePage(page)); },
  subHomeTabsPage:  async ({ page }, use) => { await use(new SubHomeTabsPage(page)); },
});

const expect = base.expect;
module.exports = { test, expect };
