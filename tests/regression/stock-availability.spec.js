// tests/regression/stock-availability.spec.js
//
// Sold Out: a variant the API reports as unavailable must not offer a live buy
// control.
//
// NEW SURFACE, NEVER COVERED. `data.variant.stock` and `data.variant.available`
// are on the PDP payload and nothing in this repo had ever read them. Measured
// 2 Sep 2026 across all 217 listed products, 2 come back unavailable:
//
//   Edge 70 Fusion              /pd/edge-70-fusion/MOTSMMOBH1YG73        stock 0
//   The Aisle Trunk - Cabin 40L /pd/the-aisle-trunk-cabin/MOKLULUGW1IWON stock 0
//
// Both are still linked from the live listing, still priced, and still render a
// full plan box — so the ONLY thing standing between a shopper and an order for
// stock that does not exist is the state of that one button.
//
// What the page does today is correct, and this file pins it. Measured on both:
//
//   in stock   "Add to Cart" (enabled) and "Buy Now" (enabled), same row
//   sold out   the same slots hold a DISABLED button labelled "Sold Out"
//
// It is a substitution, not an overlay — the upfront product swaps both buttons,
// the subscription one swaps its single Subscribe control.
//
// WHY "Buy Now" IS THE ANCHOR. CLAUDE.md records what it cost to locate the buy
// CTA by the name "Add to Cart": the recommended-products carousel further down
// the PDP has its own, and `getByRole('button', {name:'Add to Cart'}).first()`
// reached it and added a ₹1,24,999 phone to the live cart. Carousel tiles carry
// no "Buy Now", so that name identifies the real buy control and nothing else,
// which is why the absence assertion below is written against it. Nothing here
// clicks anything.
//
// Public and logged out — availability is catalogue state, the same for every
// shopper. Read-only: no cart is touched.

const { test, expect } = require('../fixtures/pageFixtures');
const { BASE_URL, BASE_API_URL } = require('../data/constants');
const { getWithRetry } = require('../utils/apiRetry');

test.use({ storageState: { cookies: [], origins: [] } });

const PAGE_SIZE = 100;
const listingPage = (page) => `product-service/apps/products?page=${page}&limit=${PAGE_SIZE}`;
const bySlug = (slug, bpid) => `product-service/apps/products/by-slug/${slug}/${bpid}`;

// Same pool and same reasoning as catalogue-integrity: sweeping the catalogue
// unthrottled earns a 429, and a 429 is not a defect.
const SWEEP_CONCURRENCY = 2;

// Opening a PDP costs ~9s. Two unavailable products today, but a bad day could
// leave dozens, and this file is not the right place to spend ten minutes.
const MAX_PDPS = 3;

async function mapWithPool(items, concurrency, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < items.length) {
        const index = next++;
        out[index] = await fn(items[index], index);
      }
    })
  );
  return out;
}

// Both flags are read, and either one is enough. They agreed on every product
// measured, but they are separate fields and a page that trusts one while the
// other says otherwise is itself the bug — so this takes the pessimistic view
// and a disagreement is reported rather than resolved.
function unavailable(variant) {
  if (!variant) return false;
  return variant.available === false || variant.stock === 0;
}

test.describe('Stock availability', () => {
  /** @type {import('@playwright/test').APIRequestContext} */
  let api;
  const catalogue = [];
  /** @type {Array<{name:string, slug:string, bpid:string, stock:*, available:*}>} */
  const outOfStock = [];
  /** @type {Array<{name:string, slug:string, bpid:string}>} */
  const inStock = [];
  const disagreed = [];

  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(300000);

    api = await playwright.request.newContext({
      baseURL: `${BASE_API_URL.replace(/\/+$/, '')}/`,
      storageState: { cookies: [], origins: [] },
    });

    for (let page = 1; page <= 20; page++) {
      const res = await getWithRetry(api, listingPage(page), { failOnStatusCode: false });
      expect(res.status(), `listing page ${page} did not return 200`).toBe(200);
      const body = await res.json();
      const items = (body && body.data && body.data.items) || [];
      catalogue.push(...items);
      if (items.length < PAGE_SIZE) break;
    }

    const resolved = await mapWithPool(catalogue, SWEEP_CONCURRENCY, async (product) => {
      const res = await getWithRetry(api, bySlug(product.slug, product.variant.bpid), {
        failOnStatusCode: false,
        timeout: 30000,
      });
      const body = await res.json().catch(() => null);
      return { product, status: res.status(), data: body && body.data };
    });

    for (const row of resolved) {
      if (row.status !== 200 || !row.data || !row.data.variant) continue;
      const variant = row.data.variant;
      const entry = {
        name: (row.data.product && row.data.product.name) || row.product.name,
        slug: row.product.slug,
        bpid: row.product.variant.bpid,
        stock: variant.stock,
        available: variant.available,
        // Read from the PDP payload rather than the listing tag, so a product
        // whose badge has not propagated yet is still excluded as a control.
        preBooking: Boolean(row.data.product && row.data.product.isPrebookingAllow),
      };
      // A zero stock that still reports available, or the reverse. Collected
      // rather than asserted per product so the report names all of them.
      if ((variant.stock === 0) !== (variant.available === false)) disagreed.push(entry);
      if (unavailable(variant)) outOfStock.push(entry);
      else inStock.push(entry);
    }

    console.log(
      `availability sweep: ${inStock.length} available, ${outOfStock.length} unavailable ` +
        `of ${catalogue.length} listed`
    );
    outOfStock.forEach((p) => console.log(`  unavailable: ${p.name} — /pd/${p.slug}/${p.bpid}`));
  });

  test.afterAll(async () => {
    await api.dispose();
  });

  test('stock and available agree with each other', () => {
    expect(inStock.length + outOfStock.length, 'the sweep resolved nothing').toBeGreaterThan(50);

    expect(
      disagreed.map((p) => `${p.name}: stock=${p.stock} available=${p.available} (/pd/${p.slug}/${p.bpid})`),
      'variant.stock and variant.available contradict each other. Both drive the buy control, ' +
        'so whichever the page happens to read decides whether stock that does not exist can ' +
        'still be ordered.'
    ).toEqual([]);
  });

  // THE CONTROL CASE, and the reason the next test cannot pass vacuously.
  //
  // "No enabled Buy Now on this page" is also true of a page that failed to
  // render, of a 404 body, and of a selector that stopped matching after a
  // deploy. This proves the same locator DOES find a live buy control on an
  // available product, so an absence downstream means absence.
  test('an available product renders a live buy control', async ({ page }) => {
    test.setTimeout(120000);
    expect(inStock.length, 'no available product to use as a control').toBeGreaterThan(0);

    // PRE-BOOKING PRODUCTS ARE NOT VALID CONTROLS. They are in stock and
    // available, but their buy row is deliberately substituted for a single
    // "Pre-book Now" — no Add to Cart and no Buy Now — because
    // can_place_normal_order is false until launch. See
    // regression/prebooking.spec.js.
    //
    // This took the first available product, and on 16 Sep 2026 that was Watch
    // Ultra 4, which the listing now sorts to the front and which is
    // pre-booking. The control then failed with "Watch Ultra 4 is available but
    // renders no Buy Now" — the page was correct and the control was
    // ineligible.
    const buyable = inStock.filter((p) => !p.preBooking);
    expect(
      buyable.length,
      'every available product is pre-booking, so none can act as a buy-control'
    ).toBeGreaterThan(0);

    const product = buyable[0];
    await page.goto(`${BASE_URL}/pd/${product.slug}/${product.bpid}`, {
      waitUntil: 'domcontentloaded',
    });

    const buyNow = page.getByRole('button', { name: 'Buy Now', exact: true });
    await expect(
      buyNow,
      `${product.name} is available but renders no Buy Now — if this is a redesign rather than ` +
        'a defect, the Sold Out test below is now asserting nothing and needs a new anchor.'
    ).toBeEnabled({ timeout: 30000 });

    await expect(
      page.getByRole('button', { name: 'Sold Out', exact: true }),
      `${product.name} reports stock ${product.stock} but the page says Sold Out`
    ).toHaveCount(0);
  });

  test('an unavailable product offers no way to buy it', async ({ page }) => {
    test.setTimeout(300000);

    test.skip(
      outOfStock.length === 0,
      'every listed product is in stock right now, so there is nothing to check. This is a ' +
        'skip and not a pass: the Sold Out state is unverified until the catalogue holds one.'
    );

    const failures = [];

    for (const product of outOfStock.slice(0, MAX_PDPS)) {
      await page.goto(`${BASE_URL}/pd/${product.slug}/${product.bpid}`, {
        waitUntil: 'domcontentloaded',
      });

      // Wait for the buy row to exist before judging it. Every button on this
      // PDP renders before its handler is bound, and an early read would see a
      // page with no buttons at all and call it correct.
      const soldOut = page.getByRole('button', { name: 'Sold Out', exact: true });
      const rendered = await soldOut
        .first()
        .waitFor({ state: 'visible', timeout: 30000 })
        .then(() => true)
        .catch(() => false);

      if (!rendered) {
        failures.push(
          `${product.name} (stock=${product.stock}, available=${product.available}) renders no ` +
            `Sold Out control — /pd/${product.slug}/${product.bpid}`
        );
        continue;
      }

      // Every Sold Out control must actually be dead. A label alone stops
      // nobody.
      const live = [];
      for (const button of await soldOut.all()) {
        if (await button.isEnabled()) live.push('an enabled button labelled "Sold Out"');
      }

      // Buy Now is the anchor: the recommended-products carousel has "Add to
      // Cart" but never "Buy Now", so a match here is the real buy control.
      const buyNow = page.getByRole('button', { name: 'Buy Now', exact: true });
      for (const button of await buyNow.all()) {
        if (await button.isEnabled()) live.push('an enabled "Buy Now"');
      }

      if (live.length) {
        failures.push(
          `${product.name} (stock=${product.stock}, available=${product.available}) still offers ` +
            `${live.join(' and ')} — /pd/${product.slug}/${product.bpid}`
        );
      }
    }

    expect(
      failures,
      'a product with no stock can still be bought from its product page'
    ).toEqual([]);
  });
});
