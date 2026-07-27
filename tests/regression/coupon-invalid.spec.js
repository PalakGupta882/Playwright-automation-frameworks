const { test, expect } = require('../fixtures/pageFixtures');
const { BASE_URL, URLS } = require('../data/constants');

test('invalid coupon shows an error message', async ({ page, productPage, reviewOrderPage }) => {
  test.setTimeout(60000);

  await page.goto(`${BASE_URL}${URLS.subscription}`);
  await page.waitForLoadState('networkidle');

  await productPage.selectProductByImageName('apple iPhone 17 pro max');
  await productPage.clickSubscribe();

  await reviewOrderPage.isLoaded();
  console.log('Reached Review Order page:', page.url());

  await reviewOrderPage.applyCoupon('INVALIDCODE123');
  const hasError = await reviewOrderPage.getCouponErrorMessage();
  expect(hasError).toBe(true);

  console.log('Confirmed: invalid coupon correctly shows an error.');
});