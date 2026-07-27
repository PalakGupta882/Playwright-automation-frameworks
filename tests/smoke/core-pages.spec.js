const { test, expect } = require('../fixtures/pageFixtures');
const { BASE_URL, URLS, TIMEOUTS } = require('../data/constants');
const data = require('../data/products.json');

test.describe('Core pages - smoke checks', () => {

  // PLP — product listing page shows products
  test('PLP: product listing loads with products', async ({ page }) => {
    await page.goto(`${BASE_URL}${URLS.products}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('a[href*="/pd/"]').first()).toBeVisible({ timeout: TIMEOUTS.nav });
  });

  // PDP — one product page opens with a Buy Now option
  test('PDP: a product detail page loads with Buy Now', async ({ page }) => {
    const product = data.products[0]; // first product from your catalog
    const url = product.url.startsWith('http') ? product.url : `${BASE_URL}${product.url}`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(/buy now/i).first()).toBeVisible({ timeout: TIMEOUTS.nav });
  });

  // Cart — cart page opens
  test('Cart: cart page opens', async ({ page }) => {
    await page.goto(`${BASE_URL}${URLS.cart}`, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(new RegExp(URLS.cart), { timeout: TIMEOUTS.nav });
  });

});