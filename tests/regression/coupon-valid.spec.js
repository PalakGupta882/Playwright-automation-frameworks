const { test, expect } = require('../fixtures/pageFixtures');
const { BASE_URL, URLS } = require('../data/constants');

test('valid coupon BYTE500 is accepted (no error shown)', async ({ page, productPage, reviewOrderPage }) => {
  test.setTimeout(60000);

  await page.goto(`${BASE_URL}${URLS.subscription}`);
  await productPage.selectProductByImageName('apple iPhone 17 pro max');
  await productPage.clickSubscribe();
  await reviewOrderPage.isLoaded();

  await reviewOrderPage.applyCoupon('BYTE500');

  // A valid coupon should NOT show the "invalid coupon" error
  const hasError = await reviewOrderPage.getCouponErrorMessage();
  expect(hasError).toBe(false);

  console.log('Valid coupon accepted — no error shown.');
});