// tests/fixtures/pageFixtures.js
const base = require('@playwright/test');
const { HomePage } = require('../pages/homepage');
const { ProductPage } = require('../pages/productPage');
const { ProductsListPage } = require('../pages/productsListPage');
const { ReviewOrderPage } = require('../pages/reviewOrderPage');
const { EmiStorePage } = require('../pages/emiStorePage');
const { SubHomeTabsPage } = require('../pages/subHomeTabsPage');

const test = base.test.extend({
  homePage:         async ({ page }, use) => { await use(new HomePage(page)); },
  productPage:      async ({ page }, use) => { await use(new ProductPage(page)); },
  productsListPage: async ({ page }, use) => { await use(new ProductsListPage(page)); },
  reviewOrderPage:  async ({ page }, use) => { await use(new ReviewOrderPage(page)); },
  emiStorePage:     async ({ page }, use) => { await use(new EmiStorePage(page)); },
  subHomeTabsPage:  async ({ page }, use) => { await use(new SubHomeTabsPage(page)); },
});

const expect = base.expect;
module.exports = { test, expect };