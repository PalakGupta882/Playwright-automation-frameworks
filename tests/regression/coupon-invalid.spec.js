const { test, expect } = require('../fixtures/pageFixtures');
const { BASE_URL, URLS, TIMEOUTS } = require('../data/constants');

test('invalid coupon shows an error message', async ({ page, productPage, reviewOrderPage }) => {
  test.setTimeout(60000);

  await page.goto(`${BASE_URL}${URLS.subscription}`);

  // Waiting for the product tile itself, not networkidle. This page keeps
  // analytics and pixel requests going indefinitely, so networkidle only ever
  // resolved by timing out — and under a parallel run it did not resolve at all.
  await page
    .getByRole('img', { name: 'apple iPhone 17 pro max' })
    .first()
    .waitFor({ state: 'visible', timeout: TIMEOUTS.nav });

  await productPage.selectProductByImageName('apple iPhone 17 pro max');
  await productPage.clickSubscribe();

  await reviewOrderPage.isLoaded();
  console.log('Reached Review Order page:', page.url());

  await reviewOrderPage.applyCoupon('INVALIDCODE123');
  const hasError = await reviewOrderPage.getCouponErrorMessage();
  expect(hasError).toBe(true);

  console.log('Confirmed: invalid coupon correctly shows an error.');
});