// tests/regression/variant-pricing-sanity.spec.js
//
// A variant that can be bought must have a price.
//
// DEFECT measured the morning of 14 Oct 2026; the product was priced (₹2,374
// every size) by that afternoon, before this file's first run. So this went
// green first time and its failure path has NOT been seen against the live
// defect. What it measured:
//
//   women-trendy-urban-casual-boots (Clog London), 12 size variants
//   listing row             the only one of 377 with NO `price` block
//   master UK 3  CLXFWWFXOA64L7   stock 0, available false -> PDP Sold Out (correct)
//   UK 5         CLXFWWFX0WOLIG   stock 1, available true
//     variant-pricing        200, upfront.price 0, cut_price 0, every ladder rung 0
//     PDP                    "₹0", "EMI From ₹0/mo", Buy Now DISABLED,
//                            cart icon ENABLED
//
// WHY THIS IS NOT THE CONFIRMED-EXPECTED ₹0. CLAUDE.md clears the ₹0 an upfront
// PDP shows when `variant-pricing` FAILS (429/500/abort/`data: {}`), because cart
// re-prices server-side from /api/cart and the zero never carries. Here the call
// SUCCEEDS and ₹0 is the configured price, so there is nothing correct for cart
// to fall back to. Whether cart accepts the line at ₹0 is unproven — finding out
// costs a live cart line — so this file asserts the two things that are visible
// without one: the price, and a buy row that contradicts itself.
//
// Footwear made this reachable: each SIZE is its own variant, stock runs 0–2 per
// size, and the listing links the master even when the master is sold out. A
// product can therefore be listed, unpriced, and buyable in a size nobody priced.
//
// Read-only and logged out. Nothing here clicks a buy control. Requests are
// throttled and capped (MAX_PRODUCTS × MAX_VARIANTS_PER_PRODUCT pricing calls),
// because the sweep runs against production.

const { test, expect } = require('../fixtures/pageFixtures');
const { BASE_URL, BASE_API_URL } = require('../data/constants');
const { getWithRetry } = require('../utils/apiRetry');
const { fetchListingRows, isPreBooking } = require('../utils/catalogue');
const { buyRowState, buyNowControl } = require('../utils/buyRow');
const { variantPricingPath } = require('../data/emiApi');

test.use({ storageState: { cookies: [], origins: [] } });
// A retry re-rolls stock, which moves per size between runs.
test.describe.configure({ retries: 0 });

const API = BASE_API_URL.replace(/\/+$/, '');
const bySlug = (slug, bpid) => `${API}/product-service/apps/products/by-slug/${slug}/${bpid}`;

// Request budget: 4 listing pages + MAX_PRODUCTS payloads + at most
// MAX_PRODUCTS × MAX_VARIANTS_PER_PRODUCT pricing calls ≈ 40.
const MAX_PRODUCTS = 8;
const MAX_VARIANTS_PER_PRODUCT = 3;
const GAP_MS = 1000;
const pause = () => new Promise((r) => setTimeout(r, GAP_MS));

const inStock = (v) => Boolean(v && v.available === true && v.stock > 0);
const pdpPath = (slug, bpid) => `${BASE_URL}/pd/${slug}/${bpid}`;

// Rows the listing could not price come first — they are where this defect
// lives. The rest of the budget is spread evenly across the catalogue rather
// than taken from the front, which the listing sorts by recency and badge.
function sampleRows(rows) {
  const unpriced = rows.filter((r) => !r.price);
  const priced = rows.filter((r) => r.price && !isPreBooking(r));
  const room = Math.max(0, MAX_PRODUCTS - unpriced.length);
  const step = room ? Math.max(1, Math.floor(priced.length / room)) : Infinity;
  const spread = priced.filter((_, i) => i % step === 0).slice(0, room);
  return [...unpriced.slice(0, MAX_PRODUCTS), ...spread].slice(0, MAX_PRODUCTS);
}

test.describe('Variant pricing sanity', () => {
  let rows = [];
  /** in-stock variants that were priced, one entry per variant */
  const checked = [];
  /** in-stock variants priced at zero */
  const zeroPriced = [];

  test.beforeAll(async ({ request }) => {
    test.setTimeout(300000);
    rows = await fetchListingRows(request);

    for (const row of sampleRows(rows)) {
      await pause();
      const res = await getWithRetry(request, bySlug(row.slug, row.variant.bpid), { failOnStatusCode: false });
      if (!res.ok()) {
        console.log(`  by-slug ${row.slug}/${row.variant.bpid} returned ${res.status()} — skipped`);
        continue;
      }
      const data = (await res.json())?.data || {};
      const variants = [data.variant, ...(data.siblingVariants || [])].filter(inStock);

      for (const v of variants.slice(0, MAX_VARIANTS_PER_PRODUCT)) {
        await pause();
        const pr = await getWithRetry(request, variantPricingPath(row.slug, v.id), { failOnStatusCode: false });
        const upfront = pr.ok() ? (await pr.json())?.data?.upfront : null;
        const entry = {
          name: row.name, slug: row.slug, bpid: v.bpid, sku: v.sku, stock: v.stock,
          status: pr.status(), price: upfront ? upfront.price : undefined,
        };
        checked.push(entry);
        if (pr.ok() && upfront && !(upfront.price > 0)) zeroPriced.push(entry);
      }
    }
    console.log(`variant pricing: ${checked.length} in-stock variants checked, ${zeroPriced.length} priced at zero`);
  });

  test('every listing row carries a price block', () => {
    expect(rows.length, 'the listing returned nothing').toBeGreaterThan(50);

    const unpriced = rows
      .filter((r) => !r.price || !(r.price.mop > 0))
      .map((r) => `${r.name} — ${pdpPath(r.slug, r.variant.bpid)} (price: ${JSON.stringify(r.price ?? null)})`);

    expect(
      unpriced,
      'listing rows with no usable price block. The tile has no figure to show, and the ' +
        'listed variant has no configured price.'
    ).toEqual([]);
  });

  test('an in-stock variant is never priced at zero', () => {
    // Non-vacuous: proves the sweep reached real priced variants at all, so an
    // empty zeroPriced list means "none found", not "none looked at".
    expect(
      checked.filter((c) => c.price > 0).length,
      'no in-stock variant came back priced — the sweep checked nothing'
    ).toBeGreaterThan(0);

    const unreadable = checked.filter((c) => c.status !== 200);
    if (unreadable.length) {
      test.info().annotations.push({
        type: 'unreadable pricing',
        description: unreadable.map((c) => `${c.sku} → ${c.status}`).join('; '),
      });
    }

    expect(
      zeroPriced.map((z) => `${z.name} ${z.sku} (stock ${z.stock}) — ${pdpPath(z.slug, z.bpid)} — upfront.price ${z.price}`),
      'in stock and available, yet variant-pricing returns 200 with a zero price. This is ' +
        'configured pricing, not the failed-call ₹0 CLAUDE.md clears.'
    ).toEqual([]);
  });

  // The control: a normally priced in-stock variant must show both controls
  // enabled. Without it, "the buy row agrees" could pass on a page whose buy row
  // never rendered, or after a redesign that renamed both controls.
  test('the buy row agrees with itself', async ({ page }) => {
    test.setTimeout(180000);

    const control = checked.find((c) => c.price > 0 && rows.find((r) => r.slug === c.slug)?.prodPaymentMode === 'UPFRONT');
    expect(control, 'no priced UPFRONT in-stock variant to use as a control').toBeTruthy();

    // Arm before goto: the controls render before pricing lands, and the state
    // worth judging is the one after it.
    const open = async (t) => {
      const priced = page.waitForResponse((r) => r.url().includes('/variant-pricing/'), { timeout: 45000 }).catch(() => null);
      await page.goto(pdpPath(t.slug, t.bpid), { waitUntil: 'domcontentloaded' });
      await priced;
      await expect(buyNowControl(page), `${t.sku}: no Buy Now rendered`).toBeVisible({ timeout: 30000 });
    };

    await open(control);
    await expect
      .poll(() => buyRowState(page), { timeout: 15000, message: `control ${control.sku} should offer both controls` })
      .toEqual({ buyNow: true, soldOut: null, cart: true });

    const contradictions = [];
    for (const t of zeroPriced.slice(0, 2)) {
      await open(t);

      // Poll for agreement, so a mid-render frame cannot fail the test; a row
      // still split after 10s is the steady state.
      const agrees = (s) => s.cart === null || s.cart === s.buyNow;
      const settled = await expect
        .poll(async () => agrees(await buyRowState(page)), { timeout: 10000 })
        .toBe(true)
        .then(() => true, () => false);
      if (!settled) {
        const s = await buyRowState(page);
        contradictions.push(`${t.name} ${t.sku} — ${pdpPath(t.slug, t.bpid)}: Buy Now ${s.buyNow ? 'enabled' : 'disabled'}, cart icon ${s.cart ? 'enabled' : 'disabled'}`);
      }
    }

    expect(
      contradictions,
      'the cart icon and Buy Now disagree on whether this variant can be bought'
    ).toEqual([]);
  });
});
