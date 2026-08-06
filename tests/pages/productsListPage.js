class ProductsListPage {
  constructor(page) {
    this.page = page;
    // The header renders FOUR inputs with the accessible name "search" —
    // desktop and mobile variants, two of them hidden. Measured:
    //
    //   [0] placeholder="Search for Products..."         HIDDEN
    //   [1] placeholder="Search for Products, brands..."
    //   [2] placeholder="Search for Products..."         HIDDEN
    //   [3] placeholder="Search for Products, brands..."
    //
    // .first() therefore resolved to a hidden input, which is what the
    // `force: true` on the click below was compensating for. Typing into a
    // hidden box does nothing useful, and the click intermittently timed out
    // waiting on an element that was never going to become stable.
    this.searchBox = page
      .getByRole('textbox', { name: 'search' })
      .filter({ visible: true })
      .first();
  }

  async goto() {
    await this.page.goto('https://www.bytepe.com/all-products', { waitUntil: 'domcontentloaded' });
  }

  async searchFor(productName) {
    // No force: the locator above now resolves to a genuinely visible box, so
    // a real click is both possible and a meaningful check that it is usable.
    await this.searchBox.click();
    await this.searchBox.fill(productName);
    await this.page.waitForTimeout(1000);
  }

  // The autocomplete dropdown. Suggestions render as list items reading
  // "<product name> <brand>", which is why a brand term such as "Apple"
  // matches even when the product name does not contain it.
  get suggestions() {
    return this.page.getByRole('listitem').filter({ hasText: /\S/ });
  }

  // Types a term and waits for the dropdown to settle. Returns how many
  // suggestions came back, so a caller can assert on the count without
  // re-querying and racing the next keystroke.
  //
  // fill('') first: the box keeps the previous term otherwise, and the results
  // would be for the concatenation of the two.
  async search(term, { retries = 2 } = {}) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      await this.searchBox.click();
      await this.searchBox.fill('');
      await this.searchBox.fill(term);
      // The dropdown is debounced; there is no request to wait on from here.
      await this.page.waitForTimeout(2500);

      const count = await this.suggestions.count();
      // A term that should match can come back empty when the search endpoint
      // is rate-limited by the rest of the suite. Retrying distinguishes "no
      // matches" from "the request was refused"; a genuinely unmatched term
      // still returns 0 after every attempt, just a little slower.
      if (count > 0 || attempt === retries) return count;
      await this.page.waitForTimeout(2000 * (attempt + 1));
    }
    return 0;
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