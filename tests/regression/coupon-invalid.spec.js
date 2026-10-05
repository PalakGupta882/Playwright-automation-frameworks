const { test, expect } = require('../fixtures/pageFixtures');
const { TIMEOUTS } = require('../data/constants');
const { assertFreshSession } = require('../utils/session');
const { pickProduct, pdpUrl } = require('../utils/catalogue');
const { buyNowControl } = require('../utils/buyRow');

// Subscribe only reaches Review Order while logged in; logged out it diverts to
// an OTP screen and the coupon assertion would time out for the wrong reason.
test.beforeAll(() => assertFreshSession());

test('invalid coupon shows an error message', async ({ page, productPage, reviewOrderPage }) => {
  test.setTimeout(90000);

  // Picked from the listing API rather than by image alt text on the
  // subscription listing: a hardcoded product name drifts (renames,
  // pre-booking, Sold Out) and the iPhone it used to name sits in a page
  // /all-products drops. BOTH = subscription-capable.
  const product = await pickProduct(page.request, { mode: 'BOTH' });
  expect(product, 'no in-stock, non-pre-booking BOTH-mode product in the listing').toBeTruthy();
  console.log(`product: ${product.name} (${product.slug}/${product.variant.bpid})`);

  await page.goto(pdpUrl(product), { waitUntil: 'domcontentloaded' });

  // Waiting for the buy row, not networkidle. This page keeps analytics and
  // pixel requests going indefinitely, so networkidle only ever resolves by
  // timing out.
  await buyNowControl(page).first().waitFor({ state: 'visible', timeout: TIMEOUTS.nav });
  await productPage.clickSubscribe();

  await reviewOrderPage.isLoaded();
  console.log('Reached Review Order page:', page.url());

  await reviewOrderPage.applyCoupon('INVALIDCODE123');
  const hasError = await reviewOrderPage.getCouponErrorMessage();
  expect(hasError).toBe(true);

  console.log('Confirmed: invalid coupon correctly shows an error.');
});
