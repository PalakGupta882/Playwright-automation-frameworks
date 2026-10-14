const { test, expect } = require('../fixtures/pageFixtures');
const { BASE_URL, URLS, TIMEOUTS } = require('../data/constants');
const { fetchListingRows, pdpUrl } = require('../utils/catalogue');

test.describe('Core pages - smoke checks', () => {

  // PLP — product listing page shows products
  test('PLP: product listing loads with products', async ({ page }) => {
    await page.goto(`${BASE_URL}${URLS.products}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('a[href*="/pd/"]').first()).toBeVisible({ timeout: TIMEOUTS.nav });
  });

  // PDP — one product page opens with a buy row.
  //
  // The control that appears depends on how the product is sold AND on whether
  // it is in stock, and the PDP SUBSTITUTES the control rather than disabling a
  // fixed one (CLAUDE.md): Buy Now / Subscribe when buyable, a disabled
  // "Sold Out" when stock is 0, "Pre-book Now" before launch.
  //
  // This pinned data.products[0], which on 23 Sep 2026 is iPhone 15 — now
  // `stock: 0, available: false`. Matching only /buy now|subscribe/ made a
  // correctly-rendered Sold Out page fail the smoke suite. A smoke check should
  // say "the buy row rendered", not "this particular product is in stock",
  // which is a catalogue fact that changes without the site breaking.
  //
  // The product is the first row of the LIVE listing API, not products.json — a
  // scrape that held 241 rows against 335 live on 5 Oct 2026, and whose first
  // entry (iPhone 15) had been delisted.
  test('PDP: a product detail page loads with a purchase option', async ({ page, request }) => {
    const [product] = await fetchListingRows(request);
    await page.goto(pdpUrl(product), { waitUntil: 'domcontentloaded' });
    await expect(
      page.getByRole('button', { name: /^(buy now|subscribe|sold out|pre-?book now)$/i }).first(),
      `${product.name} (${product.slug}/${product.variant.bpid}): the PDP rendered no buy-row control at all`
    ).toBeVisible({ timeout: TIMEOUTS.nav });
  });

  // Cart — cart page opens
  test('Cart: cart page opens', async ({ page }) => {
    await page.goto(`${BASE_URL}${URLS.cart}`, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(new RegExp(URLS.cart), { timeout: TIMEOUTS.nav });
  });

});