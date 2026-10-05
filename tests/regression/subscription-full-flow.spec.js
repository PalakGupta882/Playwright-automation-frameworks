const { test, expect } = require('../fixtures/pageFixtures');
const { TIMEOUTS, URLS } = require('../data/constants');
const { assertFreshSession } = require('../utils/session');
const { writesAllowed, writeSkipReason } = require('../utils/writes');
const { pickProduct, pdpUrl } = require('../utils/catalogue');
const { buyNowControl } = require('../utils/buyRow');

// Opt-in only. This spec presses Continue on Review Order, and that is what
// mints the order id — it produced <order-A> / <sub-order-A> on the run of
// 10 Aug 2026, before any payment step was reached.
test.skip(
  !writesAllowed(),
  writeSkipReason('This spec creates a real order')
);

// Subscribe only goes straight to Review Order while logged in
test.beforeAll(() => assertFreshSession());

test('subscribe to an in-stock product through to review order', async ({ page, productPage, reviewOrderPage }) => {
  test.setTimeout(90000);

  // Picked from the listing API rather than by image alt text on the
  // subscription listing — same reason as coupon-invalid.spec.js.
  // BOTH = subscription-capable.
  const product = await pickProduct(page.request, { mode: 'BOTH' });
  expect(product, 'no in-stock, non-pre-booking BOTH-mode product in the listing').toBeTruthy();
  console.log(`product: ${product.name} (${product.slug}/${product.variant.bpid})`);

  await page.goto(pdpUrl(product), { waitUntil: 'domcontentloaded' });
  await buyNowControl(page).first().waitFor({ state: 'visible', timeout: TIMEOUTS.nav });
  await productPage.clickSubscribe();

  // Already logged in — Buy Now on a BOTH product goes straight to Review Order
  await reviewOrderPage.isLoaded();
  console.log('Reached Review Order page:', page.url());

  await reviewOrderPage.applyCoupon('BYTE500');
  await page.screenshot({ path: 'test-results/after-apply-click.png', fullPage: true });

  // MINTS A REAL ORDER. clickContinue goes through orderContinueButton().
  await reviewOrderPage.clickContinue();

  // Wait for the destination rather than a flat 3s: the old sleep asserted
  // nothing, so a Continue that went nowhere passed.
  await page.waitForURL(new RegExp(URLS.orderSummary), { timeout: 60000 });
  await page.screenshot({ path: 'test-results/after-continue-click.png', fullPage: true });
  console.log('Current URL after Continue:', page.url());
});
