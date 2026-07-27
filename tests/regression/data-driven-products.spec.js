const { test, expect } = require('../fixtures/pageFixtures');
const { BASE_URL, TIMEOUTS } = require('../data/constants');
const data = require('../data/products.json');

// One test per product. First 5 while learning; remove ".slice(0, 5)" for all.
data.products.slice(0, 5).forEach((product, index) => {
  test(`product page loads #${index + 1}: ${product.name}`, async ({ page }) => {
    const url = product.url.startsWith('http') ? product.url : `${BASE_URL}${product.url}`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    // A working product page shows a "Buy Now" option
    await expect(page.getByText(/buy now/i).first()).toBeVisible({ timeout: TIMEOUTS.nav });
  });
});