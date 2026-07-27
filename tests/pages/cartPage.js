class CartPage {
  constructor(page) {
    this.page = page;
  }

  // Open the listing, click the first product, add it, and open the cart
  async addFirstProductToCart() {
    await this.page.goto('https://www.bytepe.com/all-products', { waitUntil: 'domcontentloaded' });
    await this.page.getByRole('link', { name: /Brand New/i }).first().click();
    await this.page.getByRole('button', { name: 'Add to Cart' }).first().click({ timeout: 15000 });
    await this.page.getByRole('button', { name: 'Go to Cart' }).first().click({ timeout: 15000 });
  }
}

module.exports = { CartPage };