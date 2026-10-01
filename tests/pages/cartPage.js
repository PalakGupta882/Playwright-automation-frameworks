const { BASE_URL, BASE_API_URL } = require('../data/constants');
const { clickAddToCart, addToCartControl, rowOffersAddToCart } = require('../utils/buyRow');
const { openPlanPanel } = require('../utils/planPanel');
const { getWithRetry } = require('../utils/apiRetry');

class CartPage {
  constructor(page) {
    this.page = page;
  }

  // Open a product that can actually be added, add it, and open the cart.
  //
  // REWRITTEN 16 Sep 2026 — the old version broke twice over.
  //
  // 1. "Add to Cart" is no longer a text button. It is an icon-only control,
  //    `aria-label="Add to cart"`, so getByRole({name:'Add to Cart'}) matched
  //    nothing and this timed out on a control that was on screen. See
  //    utils/buyRow.js for the measured buy-row contract.
  //
  // 2. "the first product on /all-products" is no longer addable. The listing
  //    now sorts PRE-BOOKING products to the front, and those render a single
  //    "Pre-book Now" with no cart control at all; BOTH-mode products render
  //    Buy Now with no cart control either. The cart icon is an UPFRONT-only
  //    affordance. So the product is chosen from the API by payment mode
  //    instead of by listing position.
  async addFirstProductToCart() {
    const product = await this.pickAddableProduct();
    if (!product) throw new Error('no in-stock UPFRONT, non-pre-booking product to add to the cart');

    await this.page.goto(`${BASE_URL}/pd/${product.slug}/${product.variant.bpid}`, {
      waitUntil: 'domcontentloaded',
    });

    // Wait on the buy row, not on the cart icon: the icon renders a beat after
    // Buy Now, and waiting on the icon alone cannot tell "not ready yet" from
    // "this product has no cart control".
    await this.page
      .getByRole('button', { name: 'Buy Now', exact: true })
      .first()
      .waitFor({ state: 'visible', timeout: 30000 });
    await addToCartControl(this.page).first().waitFor({ state: 'visible', timeout: 20000 });

    // Confirm the add by its REQUEST, not by a label. CLAUDE.md: the control
    // renders before its handler binds, so an early click is silently inert.
    // Re-adding is a 200 no-op, so a retry cannot double the line.
    let posted = null;
    for (let attempt = 1; attempt <= 3 && !posted; attempt++) {
      const waiter = this.page
        .waitForResponse(
          (r) => /\/api\/cart/.test(r.url()) && r.request().method() === 'POST',
          { timeout: 8000 }
        )
        .catch(() => null);
      const clicked = await clickAddToCart(this.page);
      if (!clicked) throw new Error(`${product.slug}: no cart control before Buy Now`);
      posted = await waiter;
    }
    if (!posted) throw new Error(`${product.slug}: clicking add-to-cart sent no POST /api/cart`);

    await this.page.goto(`${BASE_URL}/cart`, { waitUntil: 'domcontentloaded' });
  }

  // Straight from the live listing API — see the note above on why listing
  // position no longer identifies an addable product.
  //
  // Two traps, both hit on 29 Sep 2026:
  // - A 429 on the listing call used to return null, which the caller reported
  //   as "no addable product" — a rate limit dressed up as a catalogue fact. It
  //   now retries, and a listing that still fails throws with its status.
  // - The listing does not say whether the linked variant is in stock. The
  //   first UPFRONT row that day (Nord CE 6 Lite) was Sold Out, which renders a
  //   disabled cart icon. Stock is read from the PDP payload before choosing.
  async pickAddableProduct() {
    const api = BASE_API_URL.replace(/\/+$/, '');
    const res = await getWithRetry(this.page.request, `${api}/product-service/apps/products?page=1&limit=100`, {
      failOnStatusCode: false,
    });
    if (!res.ok()) throw new Error(`listing API returned ${res.status()} — cannot choose a product to add`);
    const items = (await res.json())?.data?.items || [];
    const candidates = items.filter((p) => p?.slug && p?.variant?.bpid && rowOffersAddToCart(p));

    for (const p of candidates.slice(0, 15)) {
      const pd = await getWithRetry(this.page.request, `${api}/product-service/apps/products/by-slug/${p.slug}/${p.variant.bpid}`, {
        failOnStatusCode: false,
      });
      const variant = pd.ok() ? (await pd.json())?.data?.variant : null;
      if (variant && variant.available && variant.stock > 0) return p;
    }
    return null;
  }

  // Mirrors ProductsListPage.selectBuyUpfrontPlan. Rewritten 23 Sep 2026 for the
  // same reason: `.MuiBox-root.mui-1eub90p` is a build hash that no longer
  // resolves, plans now sit behind "See Plans", and the panel has no radio
  // inputs to dispatch a synthetic click at. See utils/planPanel.js.
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
}

module.exports = { CartPage };