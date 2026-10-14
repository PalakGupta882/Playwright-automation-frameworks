// tests/regression/size-variants.spec.js
//
// Size-variant products: footwear, live since 6 Oct 2026.
//
// NEW SURFACE. 56 footwear products (Neeman's, Clog London) arrived between the
// 5 Oct baseline and 14 Oct 2026. Every SIZE is its own variant — own bpid, own
// SKU (`…-BROWN-UK-5`), own stock — listed under `siblingVariants` with a
// `Size` attribute next to `Colour`. Stock runs 0–2 per size, so on any given
// day a product has sizes that can and cannot be bought side by side.
//
// What the PDP does, measured 14 Oct 2026 logged out:
//
//   "Size" heading, then one MUI chip per size: UK 3 … UK 8
//   the selected size is a filled dark chip
//   sold-out and in-stock sizes are VISUALLY IDENTICAL — no strike, no fade,
//   no disabled state. You learn a size is gone only after choosing it.
//
// That last line is an OBSERVATION awaiting a product ruling, not a defect, so
// it is recorded as an annotation and never asserted. See CLAUDE.md.
//
// WHY `.MuiChip-root` + exact text. The chips carry no test id and no stable
// app class; the MUI component class is the library's own and survives build
// hashing (unlike `mui-zv7ju9`-style classes). Matching on the exact size label
// taken from the API keeps the locator off any other chip on the page — the
// listing badges and bank-offer pills are chips too.
//
// UNVERIFIED on first write: that choosing a chip navigates to that size's own
// /pd/<slug>/<bpid>. The test fails naming the URL it landed on if not.
//
// Read-only and logged out. Choosing a size is not a write; no buy control is
// clicked.

const { test, expect } = require('../fixtures/pageFixtures');
const { BASE_URL, BASE_API_URL } = require('../data/constants');
const { getWithRetry } = require('../utils/apiRetry');
const { fetchListingRows, isPreBooking } = require('../utils/catalogue');
const { buyRowState, buyNowControl } = require('../utils/buyRow');

test.use({ storageState: { cookies: [], origins: [] } });
// Stock moves per size between runs; a retry would test a different product.
test.describe.configure({ retries: 0 });

const API = BASE_API_URL.replace(/\/+$/, '');
const bySlug = (slug, bpid) => `${API}/product-service/apps/products/by-slug/${slug}/${bpid}`;
const pdpPath = (slug, bpid) => `${BASE_URL}/pd/${slug}/${bpid}`;

const MAX_CANDIDATES = 5;
const pause = () => new Promise((r) => setTimeout(r, 1000));

const attr = (v, name) => ((v && v.attributes) || []).find((a) => a.attribute === name)?.value;
const hasSize = (row) => ((row.variant && row.variant.attributes) || []).some((a) => a.attribute === 'Size');
const inStock = (v) => Boolean(v && v.available === true && v.stock > 0);

test.describe('Size variants', () => {
  /** every product inspected: { name, slug, variants[] } */
  const products = [];
  /** the product the UI tests use: one colour with sizes both in stock and sold out */
  let subject = null;

  test.beforeAll(async ({ request }) => {
    test.setTimeout(180000);
    const rows = (await fetchListingRows(request)).filter(
      (r) => hasSize(r) && r.prodPaymentMode === 'UPFRONT' && !isPreBooking(r) && r.price
    );

    for (const row of rows.slice(0, MAX_CANDIDATES)) {
      await pause();
      const res = await getWithRetry(request, bySlug(row.slug, row.variant.bpid), { failOnStatusCode: false });
      if (!res.ok()) continue;
      const data = (await res.json())?.data || {};
      const variants = [data.variant, ...(data.siblingVariants || [])].filter(Boolean);
      products.push({ name: row.name, slug: row.slug, variants });

      if (subject) continue;
      const colour = attr(data.variant, 'Colour');
      const group = variants.filter((v) => attr(v, 'Colour') === colour && attr(v, 'Size'));
      const buyable = group.find(inStock);
      const gone = group.find((v) => !inStock(v));
      if (buyable && gone) subject = { name: row.name, slug: row.slug, group, buyable, gone };
    }
    console.log(
      `size variants: ${products.length} products inspected; subject ` +
        (subject ? `${subject.name} (${subject.group.length} sizes)` : 'none')
    );
  });

  test('no two variants of one colour share a size', () => {
    expect(products.length, 'no size-variant product could be read').toBeGreaterThan(0);

    const clashes = [];
    for (const p of products) {
      const seen = new Map();
      for (const v of p.variants) {
        const key = `${attr(v, 'Colour') ?? '-'} / ${attr(v, 'Size')}`;
        if (seen.has(key)) clashes.push(`${p.name}: ${key} is both ${seen.get(key)} and ${v.bpid}`);
        else seen.set(key, v.bpid);
      }
    }
    expect(clashes, 'one size chip would stand for two variants with separate stock and price').toEqual([]);
  });

  test('the size picker lists exactly the sizes the API sells', async ({ page }) => {
    test.setTimeout(120000);
    test.skip(!subject, 'no size product with both an in-stock and a sold-out size in the first candidates — a skip, not a pass');

    await page.goto(pdpPath(subject.slug, subject.buyable.bpid), { waitUntil: 'domcontentloaded' });
    await expect(buyNowControl(page), 'the PDP rendered no buy row').toBeVisible({ timeout: 30000 });

    const expected = subject.group.map((v) => attr(v, 'Size'));
    for (const size of expected) {
      await expect(
        page.locator('.MuiChip-root').filter({ hasText: new RegExp(`^${size}$`) }),
        `size ${size} is sold by the API but has no chip`
      ).toHaveCount(1);
    }
  });

  test('choosing a sold-out size shows Sold Out for that exact variant', async ({ page }) => {
    test.setTimeout(120000);
    test.skip(!subject, 'no size product with both an in-stock and a sold-out size in the first candidates — a skip, not a pass');

    const { buyable, gone } = subject;
    const goneSize = attr(gone, 'Size');

    await page.goto(pdpPath(subject.slug, buyable.bpid), { waitUntil: 'domcontentloaded' });
    await expect(buyNowControl(page), `${buyable.sku} is in stock but shows no Buy Now`).toBeEnabled({ timeout: 30000 });

    const chip = page.locator('.MuiChip-root').filter({ hasText: new RegExp(`^${goneSize}$`) });
    await expect(chip).toHaveCount(1);

    // The observation, recorded and never asserted.
    const look = await chip.evaluate((el) => ({
      disabled: el.getAttribute('aria-disabled') === 'true' || el.classList.contains('Mui-disabled'),
      opacity: getComputedStyle(el).opacity,
      strike: getComputedStyle(el).textDecorationLine,
    }));
    test.info().annotations.push({
      type: 'sold-out size chip',
      description: `${goneSize} (${gone.bpid}, stock ${gone.stock}): disabled=${look.disabled}, opacity=${look.opacity}, text-decoration=${look.strike}`,
    });

    await chip.click();

    // Identity first: the page must now be THAT size, not a neighbour.
    await expect(page, `choosing ${goneSize} should open variant ${gone.bpid}`).toHaveURL(new RegExp(`/${gone.bpid}(\\?|$)`), {
      timeout: 15000,
    });
    await expect
      .poll(() => buyRowState(page), { timeout: 15000, message: `${gone.sku} is sold out but still offers a buy control` })
      .toEqual({ buyNow: null, soldOut: false, cart: false });
  });
});
