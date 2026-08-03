class CartPage {
  constructor(page) {
    this.page = page;
  }

  // Open the listing, click the first product, add it, and open the cart
  async addFirstProductToCart() {
    await this.page.goto('https://www.bytepe.com/all-products', { waitUntil: 'domcontentloaded' });
    // Pick the card by what makes it a product card, not by a merchandising
    // label — the "Brand New" badge these used to carry was dropped site-side
    await this.page.locator('a[href*="/pd/"]').first().click();

    const addToCart = this.page.getByRole('button', { name: 'Add to Cart' }).first();
    try {
      await addToCart.waitFor({ state: 'visible', timeout: 10000 });
    } catch {
      // Subscription-first products lead with "Subscribe" and only expose the
      // upfront CTA once a plan is picked — same step the demo flow performs
      await this.selectBuyUpfrontPlan();
      await addToCart.waitFor({ state: 'visible', timeout: 20000 });
    }

    await addToCart.click();
    await this.page.getByRole('button', { name: 'Go to Cart' }).first().click({ timeout: 15000 });
  }

  // Mirrors ProductsListPage.selectBuyUpfrontPlan — the plan tile ignores a
  // plain click, so the event has to be dispatched directly
  async selectBuyUpfrontPlan() {
    const planCard = this.page.locator('.MuiBox-root.mui-1eub90p').filter({ visible: true }).first();
    await planCard.waitFor({ state: 'visible', timeout: 20000 });
    await planCard.dispatchEvent('click');
  }
}

module.exports = { CartPage };