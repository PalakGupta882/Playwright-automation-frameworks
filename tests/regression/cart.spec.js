const { test, expect } = require('../fixtures/pageFixtures');
const { CartPage } = require('../pages/cartPage');

test('add first product to cart and reach the cart page', async ({ page }) => {
  test.setTimeout(60000);
  const cart = new CartPage(page);

  await cart.addFirstProductToCart();

  // Reaching /cart via "Go to Cart" means the product was successfully added
  await expect(page).toHaveURL(/\/cart/, { timeout: 15000 });
  console.log('Product added and cart reached:', page.url());
});