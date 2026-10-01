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

    // THE OTHER TWO FIGURES ON THE TILE. Added 2 Sep 2026 — the listing row
    // carries a whole price block, not just a price:
    //
    //   price: { mrp: 186999, mop: 178999, minEmi: 8369, discount: 4 }
    //
    // mop and mrp are checked above. discount is the "% off" badge and minEmi
    // is the "EMI from ₹X/mo" line, and both were unverified against anything —
    // a tile could advertise a 40% saving or a ₹99/mo plan that no pricing
    // record supports and the whole suite passed.
    //
    // Where each comes from, measured across 30 products, exact on every one:
    //
    //   price.discount -> upfront.off_on_amount
    //   price.minEmi   -> the emi ladder, NOT cc.emi_amount
    //
    // CORRECTED 16 Sep 2026. This used to compare `minEmi` against
    // `cc.emi_amount` and reported five flagships as mismatched:
    //
    //   Galaxy Z Fold8 Ultra  tile ₹8661  cc ₹8754
    //   Galaxy Z Flip8 5G     tile ₹5355  cc ₹5402
    //   Galaxy Z Fold8 5G     tile ₹7730  cc ₹7823
    //   Phone (4b)            tile ₹1769  cc ₹1770
    //   Galaxy Z Fold7        tile ₹7683  cc ₹7684
    //
    // All five were FALSE POSITIVES. Re-measured across 45 sampled products:
    //
    //   minEmi === emi.emi_option[].installment_amount   45 of 45
    //   minEmi === cc.emi_amount                          4 of 45
    //
    // `ccOnly` was 0 and `neither` was 0 — the four agreements are the cases
    // where the two figures simply coincide. `cc.emi_amount` is a
    // bank-specific quote (note `cc.pickedFrom.bank`), while the tile quotes
    // the cheapest rung of the ladder, which is what the PDP renders too. So
    // the tile was right on all five and this check was asking the wrong
    // question.
    //
    // Compare against the ladder instead, and accept either the longest tenure
    // or the minimum instalment — they are the same rung on every product
    // measured, and naming both means a re-ordered ladder is not a failure.
    //
    // Reported in one list rather than two tests: both are read off the same
    // sweep, and a tile that has drifted has usually drifted in both.
    const badgeMismatch = [];
    for (const r of results) {
      const listed = r.product.price || {};
      const upfront = r.data.upfront || {};
      const cc = r.data.cc || {};
      const where = `${r.product.slug}/${r.product.variant.bpid}`;

      if (listed.discount !== undefined && listed.discount !== upfront.off_on_amount) {
        badgeMismatch.push(
          `${r.product.name} | tile badge ${listed.discount}% off vs ` +
            `upfront.off_on_amount ${upfront.off_on_amount} | ${where}`
        );
      }

      // Only where the product actually has an EMI ladder. It is empty on
      // products with no EMI offer, and comparing against nothing would report
      // every one of them.
      const rungs = (r.data.emi && r.data.emi.emi_option) || [];
      if (listed.minEmi !== undefined && rungs.length) {
        const longest = rungs[rungs.length - 1].installment_amount;
        const cheapest = Math.min(...rungs.map((o) => o.installment_amount));
        if (listed.minEmi !== longest && listed.minEmi !== cheapest) {
          badgeMismatch.push(
            `${r.product.name} | tile "EMI from ₹${listed.minEmi}/mo" vs ladder ` +
              `longest ₹${longest} / cheapest ₹${cheapest} (cc.emi_amount ₹${cc.emi_amount}) | ${where}`
          );
        }
      }
    }

    expect(
      badgeMismatch,
      'the listing tile advertises a discount or an EMI-from figure its own pricing record ' +
        'does not support'
    ).toEqual([]);
  });

  // THE LISTING NOW ADVERTISES BUNDLED ADD-ONS, and it is a second copy of a
  // list that lives somewhere else. Added 2 Sep 2026, when the field appeared:
  //
  //   listing row   vas: ["12 mo Device Protection", "Free Wireless Charger"]
  //   GET /api/apps/product-vas/:slug/:bpid   the records the PDP renders
  //
  // 30 of 217 rows carry one. A stale copy here advertises a free charger on
  // the tile that the product page then does not offer, which is the kind of
  // difference a shopper notices and nothing else in the suite looks at —
  // pricing-consistency reads the VAS API for the saving arithmetic, never for
  // what the tile claims.
  //
  // Names only. The tile shows no prices for these rows, so vas_mrp/vas_price
  // are out of scope here; the money is checked in pricing-consistency.
  test('the add-ons the listing advertises are the add-ons the product serves', async () => {
    test.setTimeout(300000);

    const advertised = catalogue.filter((p) => Array.isArray(p.vas) && p.vas.length > 0);

    // Non-vacuity, and the reason this is a sample rather than a sweep. If the
    // field ever stops being populated, `advertised` empties and every
    // comparison below passes without comparing anything.
    expect(
      advertised.length,
      'no listing row advertises an add-on. Either the catalogue stopped bundling them — in ' +
        'which case pricing-consistency\'s saving arithmetic has lost its largest term — or ' +
        'the listing dropped the field and this check is now inert.'
    ).toBeGreaterThan(0);

    // A control group: rows claiming NO add-ons are checked too, on a sample.
    // Otherwise a listing that under-reports (says nothing, product bundles a
    // freebie) is invisible here, and that is the direction that costs the
    // shopper a benefit they were entitled to.
    const silent = catalogue.filter((p) => !Array.isArray(p.vas) || p.vas.length === 0).slice(0, 15);

    const checked = [...advertised, ...silent];
    const results = await mapWithPool(checked, SWEEP_CONCURRENCY, async (product) => {
      const res = await getWithRetry(
        api,
        `apps/product-vas/${product.slug}/${product.variant.bpid}`,
        { failOnStatusCode: false, timeout: 30000 }
      );
      const body = await res.json().catch(() => null);
      return { product, status: res.status(), body };
    });

    const unreadable = results
      .filter((r) => r.status !== 200 || !r.body || !r.body.data)
      .map((r) => `${r.product.name} -> product-vas ${r.status}`);
    expect(unreadable, 'the VAS endpoint did not answer for these products').toEqual([]);

    const sorted = (names) => [...names].sort().join(', ') || '(none)';

    const mismatched = results
      .map((r) => {
        const listed = (r.product.vas || []).filter((n) => typeof n === 'string' && n.trim());
        const served = ((r.body.data.vas || []) || [])
          .map((row) => row.vas_name)
          .filter((n) => typeof n === 'string' && n.trim());
        if (sorted(listed) === sorted(served)) return null;
        return (
          `${r.product.name} | tile advertises [${sorted(listed)}] but the product serves ` +
          `[${sorted(served)}] | ${r.product.slug}/${r.product.variant.bpid}`
        );
      })
      .filter(Boolean);

    expect(
      mismatched,
      'the listing tile and the VAS record disagree about which add-ons come with the product'
    ).toEqual([]);
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

      // How many leading hyphen-separated tokens two names share. A SKU belongs
      // to whichever product name it agrees with FURTHEST, not merely to any
      // name it happens to start with.
      const sharedDepth = (a, b) => {
        const x = a.split('-');
        const y = b.split('-');
        let n = 0;
        while (n < x.length && n < y.length && x[n] === y[n]) n++;
        return n;
      };

      const matches = slugs
        .filter((slug) => sku === slug || sku.startsWith(`${slug}-`))
        .sort((a, b) => b.length - a.length);

      // A SHORT, GENERIC SLUG IS NOT EVIDENCE OF A CROSSED SKU. Added
      // 16 Sep 2026. "iPad Mini (A17 Pro)" (slug ipad-mini-a17-pro) ships
      // IPAD-MINI-SPACE-GREY-WI-FI-128GB, and a different product is slugged
      // plain "ipad" — so the prefix test matched `ipad-` and reported the Mini
      // as carrying the iPad's SKU. It does not: the SKU agrees with its own
      // product for two tokens (ipad, mini) and with "ipad" for only one.
      //
      // Comparing depth instead of mere prefix keeps the real case. Pixel 11
      // Pro Fold's PIXEL-11-PRO-XL-* SKU still agrees with the XL name more
      // deeply than with its own, so it is still flagged and still relies on
      // the allowlist below.
      const ownDepth = Math.max(sharedDepth(sku, own), sharedDepth(sku, deDuped));
      const crossedDeeper = matches.filter((slug) => sharedDepth(sku, slug) > ownDepth);

      if (crossedDeeper.length && matches[0] !== own && matches[0] !== deDuped) {
        crossed.push(
          `${product.name} | slug ${own} | sku ${product.variant.sku} | SKU names "${crossedDeeper[0]}"`
        );
      }
    }

    // ACCEPTED, confirmed expected 20 Aug 2026.
    //
    // Pixel 11 Pro Fold shipping a PIXEL-11-PRO-XL-* SKU was confirmed as
    // intended catalogue data, not a mis-mapping. It is allowlisted by exact
    // slug+sku pair rather than by switching the check off, so a DIFFERENT
    // product crossing SKUs still fails here on the next run.
    //
    // Anything added to this list needs the same confirmation. Do not add an
    // entry to make a red run green.
    const ACCEPTED_CROSSED_SKUS = new Set([
      'pixel-11-pro-fold::PIXEL-11-PRO-XL-OLIVE-16GB-512GB',
    ]);

    const unaccepted = crossed.filter((line) => {
      const slug = (line.match(/slug (\S+)/) || [])[1];
      const sku = (line.match(/sku (\S+)/) || [])[1];
      return !ACCEPTED_CROSSED_SKUS.has(`${slug}::${sku}`);
    });

    expect(unaccepted, 'these variants carry a SKU belonging to another product').toEqual([]);
  });

  // Two tiles, same words, different prices, nothing on screen to tell them
  // apart. Measured after the brand prefix was stripped from product names:
  // Motorola's "Buds 2 Plus" (5399) and Nothing's (3199) became the same string.
  test('no two products are displayed under the same name', () => {
    // DEDUPE BY IDENTITY FIRST. Added 21 Aug 2026.
    //
    // On the 21 Aug run this reported 244 collisions and every one of them was
    // a product colliding with ITSELF — same slug, same brand, same price on
    // both sides:
    //
    //   "Pixel 11 Pro Fold" -> google pixel-11-pro-fold @ 178999
    //                        | google pixel-11-pro-fold @ 178999
    //
    // The paged sweep in beforeAll had returned the whole catalogue twice, in
    // page-1 order. It did not reproduce on retry, and a direct probe of
    // ?page=1..3 immediately after returned 244 rows / 244 unique slugs with
    // zero overlap — so it is an intermittent listing anomaly, not a naming
    // one.
    //
    // Grouping raw rows by name turned that into "two products share a name",
    // which is the wrong culprit for the wrong team — exactly the failure mode
    // the diagnostic order in CLAUDE.md exists to prevent. Step 1 is "is it the
    // SAME product?", and here it plainly was.
    //
    // So: collapse identical identities before grouping, and report the
    // duplication separately below as what it is.
    const seen = new Map();
    for (const product of catalogue) {
      const id = `${product.slug}::${(product.variant && product.variant.bpid) || ''}`;
      if (!seen.has(id)) seen.set(id, { product, count: 0 });
      seen.get(id).count += 1;
    }

    const repeated = [...seen.values()]
      .filter((e) => e.count > 1)
      .map((e) => `${e.product.name} (${e.product.slug}) appeared ${e.count}x`);

    // Non-fatal on purpose: a repeated row is a listing/paging fault, not a
    // catalogue naming fault, and this test is about names. Failing here would
    // put the wrong label on it again.
    //
    // Logged on EVERY run, not only when it trips, so the shape of the sweep is
    // always on the record — 488 rows resolving to 244 products is the signature
    // of the 21 Aug anomaly, and it is invisible if the line only prints on
    // failure.
    console.log(
      `paged sweep: ${catalogue.length} rows -> ${seen.size} unique products, ` +
        `${repeated.length} returned more than once. A repeated row is a ` +
        'listing/pagination fault, not a name collision; the check below dedupes them.'
    );
    console.log(repeated.slice(0, 10).map((r) => `  repeated: ${r}`).join('\n'));

    const unique = [...seen.values()].map((e) => e.product);

    const byName = new Map();
    for (const product of unique) {
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

    // ACCEPTED, confirmed expected 20 Aug 2026.
    //
    // Motorola and Nothing both sell a "Buds 2 Plus"; after the brand prefix
    // was dropped from product names the two tiles read identically. Confirmed
    // intended, so it is allowlisted by name rather than by deleting the check
    // -- a NEW pair of products colliding still fails.
    const ACCEPTED_DUPLICATE_NAMES = new Set([
      'buds 2 plus',
    ]);

    const unacceptedNames = collisions.filter((line) => {
      const name = (line.match(/^"([^"]+)"/) || [])[1];
      return !ACCEPTED_DUPLICATE_NAMES.has(String(name || "").trim().toLowerCase());
    });

    expect(unacceptedNames, 'the listing shows these products under an identical name').toEqual([]);
  });
});
