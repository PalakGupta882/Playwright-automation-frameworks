const { test, expect } = require('../fixtures/pageFixtures');
const { BASE_URL, TIMEOUTS } = require('../data/constants');
const data = require('../data/products.json');

// One test per product. First 5 while learning; remove ".slice(0, 5)" for all.
data.products.slice(0, 5).forEach((product, index) => {
  test(`product page loads #${index + 1}: ${product.name}`, async ({ page }) => {
    const url = product.url.startsWith('http') ? product.url : `${BASE_URL}${product.url}`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    // A working product page offers some way to buy. Which control appears
    // depends on how the product is sold: upfront products show "Buy Now",
    // subscription products show "Subscribe" instead. Matching only "Buy Now"
    // passed by luck until the catalogue reordered and put a subscription
    // product in this slice.
    //
    // Matched by role and full name on purpose — a loose /subscribe/i text
    // match would also hit the "Subscription" link in the header and pass on a
    // page that never rendered a product.
    await expect(
      page.getByRole('button', { name: /^(buy now|subscribe)$/i }).first()
    ).toBeVisible({ timeout: TIMEOUTS.nav });
  });
});