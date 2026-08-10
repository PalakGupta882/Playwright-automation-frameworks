const { test, expect } = require('../fixtures/pageFixtures');
const { BASE_URL, URLS } = require('../data/constants');
const { assertFreshSession } = require('../utils/session');
const { writesAllowed, writeSkipReason } = require('../utils/writes');

// Opt-in only. This spec presses Continue on Review Order, and that is what
// mints the order id — it produced CM1008266A1D25 / C1008260B1AAF on the run of
// 10 Aug 2026, before any payment step was reached.
test.skip(
  !writesAllowed(),
  writeSkipReason('This spec creates a real order')
);

// Subscribe only goes straight to Review Order while logged in
test.beforeAll(() => assertFreshSession());

test('subscribe to iPhone 17 Pro Max through to review order', async ({ page, productPage, reviewOrderPage }) => {
  test.setTimeout(60000);

  await page.goto(`${BASE_URL}${URLS.subscription}`);

  await productPage.selectProductByImageName('apple iPhone 17 pro max');
  await productPage.clickSubscribe();

  // Already logged in — Subscribe click goes straight to Review Order
  await reviewOrderPage.isLoaded();
  console.log('Reached Review Order page:', page.url());

  await reviewOrderPage.applyCoupon('BYTE500');
  await page.screenshot({ path: 'test-results/after-apply-click.png', fullPage: true });

  await reviewOrderPage.clickContinue();
  await page.waitForTimeout(3000);
  await page.screenshot({ path: 'test-results/after-continue-click.png', fullPage: true });
  console.log('Current URL after Continue:', page.url());
});