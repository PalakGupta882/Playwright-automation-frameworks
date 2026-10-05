const { BASE_URL } = require('../data/env');
const { clickAddToCart } = require('../utils/buyRow');
const { openPlanPanel } = require('../utils/planPanel');
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
    await this.page.goto(`${BASE_URL}/all-products`, { waitUntil: 'domcontentloaded' });
  }

  async searchFor(productName) {
    // No force: the locator above now resolves to a genuinely visible box, so
    // a real click is both possible and a meaningful check that it is usable.
    await this.searchBox.click();
    await this.searchBox.fill(productName);
    await this.page.waitForTimeout(1000);
  }

  // The autocomplete dropdown, scoped to the header popup it actually lives in.
  //
  // Measured on /all-products (scripts/probe-search-dropdown.spec.js): every
  // suggestion is an <li> under a single
  //   MuiToolbar-root > ... > MuiPaper-root > ul.MuiList-root
  // and there is exactly one such container in the document. There is no
  // data-testid, no role="listbox", and no role attribute on the items, so a
  // role-only anchor for the container does not exist.
  //
  // Anchored on MuiToolbar/MuiPaper/MuiList and NOT on mui-14iv2rf / mui-10taw13:
  // those are emotion build hashes and change on every rebuild -- the same trap
  // documented for the plan box in CLAUDE.md. The MuiXxx-root names are MUI own
  // component classes and survive a rebuild.
  //
  // The scope matters even though nothing else on this page emits an <li>
  // today: unscoped, .first() means the first <li> in the document rather than
  // the top hit, so one nav or footer list added later would silently retarget
  // the assertion instead of failing loudly.
  //
  // Suggestions read "<product name><brand>", which is why a brand term such as
  // "Apple" matches even when the product name does not contain it.
  get suggestionList() {
    return this.page.locator('.MuiToolbar-root .MuiPaper-root ul.MuiList-root');
  }

  get suggestions() {
    return this.suggestionList.getByRole('listitem').filter({ hasText: /\S/ });
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

  // REWRITTEN 23 Sep 2026 for the new plan panel.
  //
  // This used to dispatch a click at `.MuiBox-root.mui-1eub90p`, a build-hashed
  // class that no longer resolves. Two things changed underneath it: plans are
  // now hidden behind a "See Plans" disclosure, and the revealed panel carries
  // no `input[type=radio]` at all — so there is no plan tile to dispatch at.
  //
  // Anchoring on the row's own COPY instead, which is what the redesign kept
  // stable. "Pay in Full" is the upfront plan's label on the UPFRONT layout and
  // "Buy Upfront" on the BOTH layout, so both are accepted.
  //
  // Returns false when the product exposes no upfront plan — a real answer for
  // a sold-out or subscription-only product, not an error.
  async selectBuyUpfrontPlan() {
    const opened = await openPlanPanel(this.page);
    if (!opened) return false;

    const row = this.page.getByText(/^(Pay in Full|Buy Upfront)$/i).first();
    const present = await row
      .waitFor({ state: 'visible', timeout: 10000 })
      .then(() => true)
      .catch(() => false);
    if (!present) return false;

    await row.click();
    return true;
  }

  // The cart control is icon-only as of 16 Sep 2026 — `aria-label="Add to cart"`,
  // no text — so the old name no longer matches. Routed through utils/buyRow.js
  // so it keeps the structural "before Buy Now" anchor that stops this reaching
  // the recommended-products carousel (CLAUDE.md: that once added a ₹1,24,999
  // phone to a live cart). Returns false when the product has no cart control,
  // which is the correct answer for a BOTH-mode or pre-booking product.
  async clickAddToCart() {
    return clickAddToCart(this.page);
  }

  // No .first(): strict mode fails loudly on two matches instead of clicking
  // whichever comes first. Only demos/full-demo-flow calls this. Since the 16 Sep
  // buy-row redesign the cart control is an icon (utils/buyRow.js) and the
  // transient "Go to Cart" label may no longer render at all — unmeasured.
  async clickGoToCart() {
    await this.page.getByRole('button', { name: 'Go to Cart' }).click({ timeout: 15000 });
  }
}

module.exports = { ProductsListPage };