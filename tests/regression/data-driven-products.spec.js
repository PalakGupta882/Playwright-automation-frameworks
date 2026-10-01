const { test, expect } = require('../fixtures/pageFixtures');
const { BASE_URL, TIMEOUTS } = require('../data/constants');
const data = require('../data/products.json');

// One test per product. First 5 while learning; remove ".slice(0, 5)" for all.
data.products.slice(0, 5).forEach((product, index) => {
  test(`product page loads #${index + 1}: ${product.name}`, async ({ page }) => {
    const url = product.url.startsWith('http') ? product.url : `${BASE_URL}${product.url}`;
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    // A working product page offers some way to buy — but "some way" includes
    // the states where buying is correctly refused. CLAUDE.md records that the
    // PDP SUBSTITUTES the buy row rather than overlaying it:
    //
    //   in stock, UPFRONT   "Add to cart" (icon) + "Buy Now"
    //   in stock, BOTH      "Buy Now"
    //   out of stock        a DISABLED "Sold Out" in the same slot
    //   pre-booking         "Pre-book Now", and no normal buy control
    //
    // Matching only /buy now|subscribe/ therefore failed on 23 Sep 2026 for
    // iPhone 15, which is `stock: 0, available: false` and correctly renders
    // "Sold Out". That is the page working, not the page broken — the spec was
    // asserting a state the product is not in.
    //
    // Matched by role and full name on purpose — a loose /subscribe/i text
    // match would also hit the "Subscription" link in the header and pass on a
    // page that never rendered a product.
    const buyRowControl = page
      .getByRole('button', { name: /^(buy now|subscribe|sold out|pre-?book now)$/i })
      .first();

    await expect(
      buyRowControl,
      'the PDP rendered no buy-row control at all — not Buy Now, not Subscribe, ' +
        'not Sold Out, not Pre-book Now'
    ).toBeVisible({ timeout: TIMEOUTS.nav });

    // Name the state in the log so a "passing" run still says whether the
    // product was buyable, rather than hiding a catalogue-wide stock-out behind
    // a green tick.
    console.log(`${product.name}: buy row shows "${(await buyRowControl.innerText()).trim()}"`);
  });
});