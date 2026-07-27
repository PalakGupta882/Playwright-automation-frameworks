const { test, expect } = require('../fixtures/pageFixtures');
const { BASE_URL, URLS } = require('../data/constants');

test('full demo: (logged in) products search → subscription flow', async ({ page, homePage, productsListPage, productPage, reviewOrderPage }) => {
  test.setTimeout(180000);

  await homePage.goto();
  console.log('STEP 1 — On homepage:', page.url());

  // STEP 2 (login) removed — already logged in via saved session (auth.json)

  await productsListPage.goto();
  console.log('STEP 3 — On products page:', page.url());
  await productsListPage.searchFor('iphone air');
  await productsListPage.selectAutocompleteSuggestion('iPhone Air');
  await productsListPage.selectBuyUpfrontPlan();
  await productsListPage.clickAddToCart();
  await productsListPage.clickGoToCart();
  await expect(page).toHaveURL(new RegExp(URLS.cart));
  console.log('STEP 3 — Reached cart page:', page.url());

  await page.goto(`${BASE_URL}${URLS.subscription}`);
  console.log('STEP 4 — On subscription page:', page.url());
  await productPage.selectProductByImageName('apple iPhone 17 pro max');
  await productPage.clickSubscribe();
  await reviewOrderPage.isLoaded();
  console.log('STEP 4 — Reached Review Order page:', page.url());
  await reviewOrderPage.applyCoupon('BYTE500');
  await reviewOrderPage.clickContinue();
  await page.waitForTimeout(3000);
  console.log('STEP 4 — Final URL:', page.url());
  console.log('DEMO COMPLETE.');
});