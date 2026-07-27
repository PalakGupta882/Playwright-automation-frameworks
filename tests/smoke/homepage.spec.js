const { test, expect } = require('../fixtures/pageFixtures');
const { URLS, TIMEOUTS } = require('../data/constants');

test.describe('Homepage - smoke checks', () => {

  test('homepage loads', async ({ homePage }) => {
    await homePage.goto();
    expect(await homePage.isLoaded()).toBeTruthy();
  });

  test('navigate to Subscription page', async ({ homePage, page }) => {
    await homePage.goto();
    await homePage.goToSubscription();
    await expect(page).toHaveURL(new RegExp(URLS.subscription), { timeout: TIMEOUTS.nav });
  });

  test('navigate to Products page', async ({ homePage, page }) => {
    await homePage.goto();
    await homePage.goToProducts();
    await expect(page).toHaveURL(new RegExp(URLS.products), { timeout: TIMEOUTS.nav });
  });

  test('navigate to EMI Store page', async ({ homePage, page }) => {
    await homePage.goto();
    await homePage.goToEmiStore();
    await expect(page).toHaveURL(new RegExp(URLS.emiStore), { timeout: TIMEOUTS.nav });
  });

  test('navigate to About Us page', async ({ homePage, page }) => {
    await homePage.goto();
    await homePage.goToAboutUs();
    await expect(page).toHaveURL(new RegExp(URLS.aboutUs), { timeout: TIMEOUTS.nav });
  });

  test('navigate to Cart page', async ({ homePage, page }) => {
    await homePage.goto();
    await homePage.goToCart();
    await expect(page).toHaveURL(new RegExp(URLS.cart), { timeout: TIMEOUTS.nav });
  });

});