const { test, expect } = require('../fixtures/pageFixtures');
const { TIMEOUTS } = require('../data/constants');
const { assertFreshSession } = require('../utils/session');
const { pickProduct, pdpUrl } = require('../utils/catalogue');
const { buyNowControl } = require('../utils/buyRow');

// Reaching Review Order to apply a coupon requires a live session
test.beforeAll(() => assertFreshSession());

test('valid coupon BYTE500 is accepted (no error shown)', async ({ page, productPage, reviewOrderPage }) => {
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
  await reviewOrderPage.isLoaded();

  await reviewOrderPage.applyCoupon('BYTE500');

  // A valid coupon should NOT show the "invalid coupon" error
  const hasError = await reviewOrderPage.getCouponErrorMessage();
  expect(hasError).toBe(false);

  console.log('Valid coupon accepted — no error shown.');
});
