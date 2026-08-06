const { test, expect } = require('../fixtures/pageFixtures');
const { BASE_URL, URLS, TIMEOUTS } = require('../data/constants');
const data = require('../data/products.json');

test.describe('Core pages - smoke checks', () => {

  // PLP — product listing page shows products
  test('PLP: product listing loads with products', async ({ page }) => {
    await page.goto(`${BASE_URL}${URLS.products}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('a[href*="/pd/"]').first()).toBeVisible({ timeout: TIMEOUTS.nav });
  });

  // PDP — one product page opens with a way to buy.
  // Upfront products show "Buy Now", subscription products show "Subscribe",
  // so match either: which one appears depends on how products.json happens to
  // be ordered after the last catalogue scrape, not on the page being healthy.
  test('PDP: a product detail page loads with a purchase option', async ({ page }) => {
    const product = data.products[0]; // first product from your catalog
    const url = product.url.startsWith('http') ? product.url : `${BASE_URL}${product.url}`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await expect(
      page.getByRole('button', { name: /^(buy now|subscribe)$/i }).first()
    ).toBeVisible({ timeout: TIMEOUTS.nav });
  });

  // Cart — cart page opens
  test('Cart: cart page opens', async ({ page }) => {
    await page.goto(`${BASE_URL}${URLS.cart}`, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(new RegExp(URLS.cart), { timeout: TIMEOUTS.nav });
  });

});