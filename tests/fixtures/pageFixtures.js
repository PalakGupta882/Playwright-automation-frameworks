// tests/fixtures/pageFixtures.js
const base = require('@playwright/test');
const { HomePage } = require('../pages/homepage');
const { ProductPage } = require('../pages/productPage');
const { ProductsListPage } = require('../pages/productsListPage');
const { ReviewOrderPage } = require('../pages/reviewOrderPage');
const { EmiStorePage } = require('../pages/emiStorePage');
const { SubHomeTabsPage } = require('../pages/subHomeTabsPage');
const { installExchangeDialogHandler } = require('../utils/exchangeDialog');

const test = base.test.extend({
  // Overridden rather than added: the BytePe Exchange dialog opens on its own on
  // cart and Review Order and blocks pointer events until it is dismissed, so it
  // has to be handled for every spec, not the ones that remembered to ask.
  // Inert on pages and sessions where it never appears. See
  // tests/utils/exchangeDialog.js for the locator rationale.
  page: async ({ page }, use) => {
    await installExchangeDialogHandler(page);
    await use(page);
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
