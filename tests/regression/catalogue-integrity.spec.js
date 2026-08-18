// tests/regression/catalogue-integrity.spec.js
//
// Identity integrity across the LIVE catalogue, at API level, logged out.
//
// WHY THIS FILE EXISTS, GIVEN site-health.spec.js ALREADY SWEEPS PRODUCTS.
// site-health reads tests/data/products.json, a scrape. On 18 Aug 2026 it
// failed on three Apple accessories, and the cause was not an outage:
//
//   fixture  "Apple Pencil Pro"   /pd/apple-pencil-pro/APPACACCMPT84E
//   live     "Pencil Pro"         /pd/pencil-pro/...
//
// The brand prefix was dropped from product names catalogue-wide, which moved
// every slug derived from one. That is the drift CLAUDE.md warns about, and a
// spec anchored on a scrape reports it as a broken site once per rename.
//
// This file starts from the listing the storefront itself renders, so drift
// cannot produce a failure here BY CONSTRUCTION: if a product is not in the
// live list it is not checked, and if it IS in the live list then a shopper can
// click it and it had better work. What survives is only what a shopper could
// actually hit.
//
// It also asks the question nothing else in the suite asks. Every pricing spec
// reconciles NUMBERS; CLAUDE.md's "identity before arithmetic" rule says the
// expensive failure is the catalogue naming the WRONG THING. Measured on
// 18 Aug 2026, with every price in the catalogue reconciling perfectly:
//
//   Pixel 11 Pro Fold   sku = PIXEL-11-PRO-XL-OLIVE-16GB-512GB
//   Buds 2 Plus         two products, identical display name, 5399 and 3199
//
// Neither is visible to a price check, and both are wrong in the way that ends
// with a shopper receiving something they did not order.
//
// Public and logged out: this is catalogue configuration, identical for every
// shopper. Safe for the CI public list.

const { test, expect } = require('../fixtures/pageFixtures');
const { BASE_API_URL } = require('../data/constants');
const { getWithRetry } = require('../utils/apiRetry');

test.use({ storageState: { cookies: [], origins: [] } });

// Confirmed 200 with {status, message, data:{items:[...]}} on 18 Aug 2026.
// `limit` above 100 is not honoured, hence the paging loop.
//
// PATHS ARE RELATIVE, WITH NO LEADING SLASH, and the baseURL below carries a
// trailing one. Playwright joins with the URL constructor: `new URL('/x',
// 'https://host/api')` resolves to `https://host/x` and silently drops the
// /api segment, which is a 404 with no hint as to why. Same rule as
// tests/api/apiHelper.js.
const PAGE_SIZE = 100;
const listingPage = (page) => `product-service/apps/products?page=${page}&limit=${PAGE_SIZE}`;
const bySlug = (slug, bpid) => `product-service/apps/products/by-slug/${slug}/${bpid}`;
const variantPricing = (slug, variantId) => `apps/variant-pricing/${slug}/${variantId}`;

// Slug-shaped, so "Pixel 11 Pro XL" and "PIXEL-11-PRO-XL-OLIVE-16GB-512GB"
// become comparable without a fuzzy match. Exact prefix comparison only —
// anything looser reads model numbers ("Buds 2" inside "Buds 2 Plus") as
// collisions and the file starts crying wolf.
const slugify = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

// Same worker pool as site-health, same reason: sweeping 226 products
// unthrottled earns a 429, and a 429 is not a defect.
//
// CONCURRENCY IS 2 HERE, NOT site-health's 4. The reasoning: this file sweeps
// the catalogue TWICE — once for PDP resolution, once for pricing — so at 4 it
// is the heaviest thing in a run, and getWithRetry protects THIS file from a
// 429 while nothing protects the specs running beside it.
//
// THAT REASONING IS NOT YET BACKED BY A MEASUREMENT, and the honest record is
// that the one attempt to measure it failed to show a benefit. 18 Aug 2026,
// same spec list both times:
//
//   this file at 4   74 passed,  7 failed, 1 flaky
//   this file at 2   73 passed,  8 failed, 1 flaky, 32 throttle events
//
// The run at 2 took MORE 429 damage, not less — product-pricing failed on a
// throttled request and one cardless test went flaky. Both runs came after a
// session that had already put several full catalogue sweeps through the
// origin, so what they most likely measured is cumulative traffic in the
// window rather than this constant. The comparison cannot separate the two.
//
// So: 2 is the cautious default, not a proven setting. Before raising it, get a
// clean comparison on a cold origin — and do not cite the numbers above as
// evidence in either direction, because they do not distinguish.
const SWEEP_CONCURRENCY = 2;

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

test.describe('Catalogue integrity', () => {
  /** @type {import('@playwright/test').APIRequestContext} */
  let api;
  const catalogue = [];

  test.beforeAll(async ({ playwright }) => {
    // storageState IS PASSED EXPLICITLY, not left to test.use() above.
    // playwright.request.newContext() reads config `use.storageState`, and
    // apiHelper.js records what that costs: an "anonymous" context that
    // silently came up logged in locally and only behaved in CI, where
    // auth.json is empty. Catalogue configuration is the same for everyone, so
    // a leaked session would not change an assertion here — it would change
    // what this file is honestly able to claim.
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
  });

  test.afterAll(async () => {
    await api.dispose();
  });

  // Guards the guard. Every test below loops `catalogue`; an empty or truncated
  // list would let all of them pass while asserting nothing at all.
  test('the live listing returned a plausible catalogue', () => {
    expect(catalogue.length, 'the products listing returned nothing to check').toBeGreaterThan(50);

    const unaddressable = catalogue
      .filter((p) => !(p && p.slug && p.variant && p.variant.bpid && p.variant.id))
      .map((p) => (p && p.name) || '(unnamed row)');

    expect(
      unaddressable,
      'listing rows missing slug/bpid/variant.id — nothing downstream can address these'
    ).toEqual([]);
  });

  // Not drift: the listing is what the storefront renders right now, so a row
  // here is a tile a shopper can click. A row whose PDP does not resolve is a
  // dead link in the live catalogue.
  test('every product the listing advertises resolves to a product', async () => {
    test.setTimeout(300000);

    const results = await mapWithPool(catalogue, SWEEP_CONCURRENCY, async (product) => {
      const res = await getWithRetry(api, bySlug(product.slug, product.variant.bpid), {
        failOnStatusCode: false,
        timeout: 30000,
      });
      const body = await res.json().catch(() => null);
      return { product, status: res.status(), body };
    });

    const dead = results
      .filter((r) => r.status !== 200 || !(r.body && r.body.data && r.body.data.variant))
      .map(
        (r) =>
          `${r.product.name} -> ${r.status} ${(r.body && r.body.message) || ''} ` +
          `/pd/${r.product.slug}/${r.product.variant.bpid}`
      );

    expect(dead, 'the live listing links product pages that do not resolve').toEqual([]);
  });

  // Cross-surface, the rule CLAUDE.md sets for pricing: the same figure has to
  // be the same figure on every surface. Listing tile vs the pricing call the
  // PDP itself makes, for the same variant id, so nothing here is comparing two
  // different configurations.
  test('the listing price is the price the PDP will fetch', async () => {
    test.setTimeout(300000);

    const results = await mapWithPool(catalogue, SWEEP_CONCURRENCY, async (product) => {
      const res = await getWithRetry(api, variantPricing(product.slug, product.variant.id), {
        failOnStatusCode: false,
        timeout: 30000,
      });
      const body = await res.json().catch(() => null);
      return { product, status: res.status(), data: body && body.data };
    });

    const unreadable = results
      .filter((r) => r.status !== 200 || !(r.data && r.data.upfront))
      .map((r) => `${r.product.name} -> variant-pricing ${r.status}`);

    expect(unreadable, 'variant-pricing did not answer for these listed products').toEqual([]);

    // mop is the selling price, mrp the struck-through one. Both are compared:
    // a listing that agrees on the price but not the MRP advertises the wrong
    // discount, which is the number the tile shouts loudest.
    const mismatched = results
      .filter((r) => {
        const listed = r.product.price || {};
        return listed.mop !== r.data.upfront.price || listed.mrp !== r.data.upfront.cut_price;
      })
      .map(
        (r) =>
          `${r.product.name} | listing ${r.product.price.mop}/${r.product.price.mrp} vs ` +
          `pricing ${r.data.upfront.price}/${r.data.upfront.cut_price} | ` +
          `${r.product.slug}/${r.product.variant.bpid}`
      );

    expect(mismatched, 'listing tile and variant-pricing disagree on price/MRP').toEqual([]);
  });

  // IDENTITY. The SKU is what reaches create-order and what a warehouse packs
  // against, so a SKU naming a different catalogue product is the wrong-item
  // failure at its source — before any surface has had a chance to render it.
  //
  // Exact-prefix only, and the product's own slug always wins, so a legitimate
  // family SKU ("BUDS-2-PLUS-..." on buds-2-plus) never registers. What
  // registers is a SKU whose longest matching prefix is some OTHER slug.
  test('no variant SKU names a different product in the catalogue', () => {
    const slugs = catalogue.map((p) => slugify(p.slug)).filter(Boolean);

    const crossed = [];
    for (const product of catalogue) {
      const sku = slugify(product.variant && product.variant.sku);
      if (!sku) continue;

      const own = slugify(product.slug);
      // A slug that collided keeps its name and gains a numeric suffix
      // ("buds-2-plus" taken -> "buds-2-plus-1"), so its perfectly correct SKU
      // prefixes the OTHER product's slug. That is the name collision the next
      // test reports, not a crossed SKU, and counting it here would report the
      // same defect twice under the wrong heading.
      const deDuped = own.replace(/-\d+$/, '');

      const matches = slugs
        .filter((slug) => sku === slug || sku.startsWith(`${slug}-`))
        .sort((a, b) => b.length - a.length);

      if (matches.length && matches[0] !== own && matches[0] !== deDuped) {
        crossed.push(
          `${product.name} | slug ${own} | sku ${product.variant.sku} | SKU names "${matches[0]}"`
        );
      }
    }

    expect(crossed, 'these variants carry a SKU belonging to another product').toEqual([]);
  });

  // Two tiles, same words, different prices, nothing on screen to tell them
  // apart. Measured after the brand prefix was stripped from product names:
  // Motorola's "Buds 2 Plus" (5399) and Nothing's (3199) became the same string.
  test('no two products are displayed under the same name', () => {
    const byName = new Map();
    for (const product of catalogue) {
      const key = String(product.name || '').trim().toLowerCase();
      if (!key) continue;
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push(product);
    }

    const collisions = [...byName.values()]
      .filter((group) => group.length > 1)
      .map(
        (group) =>
          `"${group[0].name}" -> ` +
          group
            .map((p) => {
              // brand is an object on this payload, not a string — printing it
              // raw gave "[object Object]" and the message lost the one detail
              // that tells the two tiles apart.
              const brand = (p.brand && (p.brand.name || p.brand.slug)) || p.brand || '?';
              return `${brand} ${p.slug} @ ${p.price && p.price.mop}`;
            })
            .join(' | ')
      );

    expect(collisions, 'the listing shows these products under an identical name').toEqual([]);
  });
});
