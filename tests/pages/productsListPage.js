class ProductsListPage {
  constructor(page) {
    this.page = page;
    this.searchBox = page.getByRole('textbox', { name: 'search' }).first();
  }

  async goto() {
    await this.page.goto('https://www.bytepe.com/all-products', { waitUntil: 'domcontentloaded' });
  }

  async searchFor(productName) {
    await this.searchBox.click({ force: true });
    await this.searchBox.fill(productName);
    await this.page.waitForTimeout(1000);
  }

  async selectAutocompleteSuggestion(suggestionText) {
    await this.page.getByRole('button', { name: new RegExp(suggestionText, 'i') }).first().click();
  }

  async selectBuyUpfrontPlan() {
    const card = this.page.locator('.MuiBox-root.mui-1eub90p').filter({ visible: true }).first();
    await card.dispatchEvent('click');
    await this.page.waitForTimeout(1000);
  }

  async clickAddToCart() {
    await this.page.getByRole('button', { name: 'Add to Cart' }).first().click({ timeout: 15000 });
  }

  async clickGoToCart() {
    await this.page.getByRole('button', { name: 'Go to Cart' }).first().click({ timeout: 15000 });
  }
}

module.exports = { ProductsListPage };