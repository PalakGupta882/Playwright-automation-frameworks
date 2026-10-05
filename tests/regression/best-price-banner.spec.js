// tests/regression/best-price-banner.spec.js
//
// The "Lowest Effective Price" banner on the PDP.
//
// What it is: the pricing API returns a `best_price` object per variant, and
// the PDP renders its headline figure as
//
//     Lowest Effective Price
//     ₹1,84,999 with Discount & Coupon
//
// Note the naming mismatch — the API field is `best_price`, the on-screen copy
// is "Lowest Effective Price". Grepping the page for "best price" finds nothing.
//
// PRICE IS PER VARIANT. Measured 10 Aug 2026 across the seven variants of
// Galaxy Z Fold8 Ultra — three distinct tiers, each with its own banner figure:
//
//     SAMSAMOB10ZXEG  MOP 199999  ->  banner 184999   (master)
//     SAMSAMOB0AWV5W  MOP 199999  ->  banner 184999
//     SAMSAMOBZL1PRX  MOP 199999  ->  banner 184999
//     SAMSAMOBHYSYOB  MOP 219999  ->  banner 204999
//     SAMSAMOBZFLH3Q  MOP 219999  ->  banner 204999
//     SAMSAMOB2EHCKK  MOP 219999  ->  banner 204999
//     SAMSAMOBVI553V  MOP 259999  ->  banner 244999
//
// Every figure here is read from the API at run time rather than pinned. The
// banner is a cached computation — `ttl_seconds` was 21600 (6h) with
// `computed_at` on the payload — so a hardcoded rupee value is a scheduled
// false failure the first time merchandising changes a coupon.
//
// WHAT THIS DELIBERATELY DOES NOT ASSERT: `best_price.bucket` (observed
// "PLATINUM"). A bucket reads like a per-shopper tier, and per CLAUDE.md
// per-shopper state must never be asserted — it can differ between two loads
// for the same user. The spec pins the arithmetic, which is product
// configuration, and leaves eligibility alone.
//
// Public — runs logged out on purpose. Product configuration is the same for
// everyone, and pinning the logged-out view keeps a stale auth.json from ever
// being the reason this fails.

const { test, expect } = require('../fixtures/pageFixtures');
const { BASE_URL, TIMEOUTS } = require('../data/constants');
const { getWithRetry } = require('../utils/apiRetry');

test.use({ storageState: { cookies: [], origins: [] } });

const PRODUCT = {
  name: 'Galaxy Z Fold8 Ultra',
  slug: 'galaxy-z-fold8-ultra',
  bpid: 'SAMSAMOB10ZXEG',
};

// THE BANNER ROUNDS. best_upfront.total_amount is fractional far more often
// than not — measured 10 Aug 2026, 37 of 40 sampled products carried paise,
// because most carry the percentage coupon FREEDOM while this file's primary
// fixture happens to carry the flat ₹15,000 SF15K and lands on a whole rupee.
//
// The rendered figure is Math.round, not a truncation. Confirmed on three
// products whose fractional part exceeds 0.5, which is the only sample that can
// tell the two apart:
//
//     Kilburn III        30231.81 -> ₹30,232
//     CMF 33W Charger     1184.61 -> ₹1,185
//     30W USB-C Adapter    3556.8 -> ₹3,557
//
// So a second fixture is pinned deliberately. Without it every assertion here
// runs on the 7.5% of the catalogue that never exercises rounding, and the
// spec would go green while being wrong for almost every product on the site.
const FRACTIONAL_PRODUCT = {
  name: 'Kilburn III Portable Bluetooth Speaker',
  slug: 'kilburn-iii-portable-bluetooth-speaker-with-50-hours-of-portable-playtime',
  bpid: 'MARAUAUDSLOYTE',
};

// What the shopper should see for a given API figure.
function asDisplayed(totalAmount) {
  return Math.round(totalAmount);
}

const DRIFT_HINT =
  'A 404 here is usually catalogue drift rather than a defect — slugs follow product ' +
  'names and the listing links whichever variant is featured. Re-run: npm run discover';

function pdpApi(slug, bpid) {
  return `${BASE_URL}/api/product-service/apps/products/by-slug/${slug}/${bpid}`;
}

function pricingApi(slug, variantId) {
  return `${BASE_URL}/api/apps/variant-pricing/${slug}/${variantId}`;
}

async function readJson(request, url) {
  const res = await getWithRetry(request, url, { headers: { accept: 'application/json' } });
  expect(res.status(), `${url}\n${DRIFT_HINT}`).toBe(200);
  return res.json();
}

async function openProduct(page, bpid = PRODUCT.bpid, slug = PRODUCT.slug) {
  await page.goto(`${BASE_URL}/pd/${slug}/${bpid}`, { waitUntil: 'domcontentloaded' });
  await page.keyboard.press('Escape').catch(() => {}); // promo modal, if present
}

// ============================================================================
// DISABLED — THE FEATURE WAS WITHDRAWN, NOT BROKEN.
//
// `best_price` is gone from variant-pricing. Swept the whole live catalogue on
// 18 Aug 2026: present on 0 of 226 products. The response now carries only
// abb, cc, cc_y2, emi, emi_price, nbfc, upfront. The banner does not render on
// the PDP either, so the UI cases below fail for the same single reason.
//
// The offer behind it ended; confirmed by the team on 14 Aug 2026. CLAUDE.md
// is explicit that this must never fail a run or be reported as a pricing
// defect. api/pricing-api.spec.js was updated on that decision and this file
// was not — so it kept failing six tests, and it is in the CI public list, which
// means CI was red on main for a product decision rather than a regression.
//
// SKIPPED, NOT DELETED. Everything here — the per-variant banner figures, the
// rounding behaviour, the MOP-minus-coupon formula — was measured against a
// live feature on 10 Aug and is not recoverable from anything else in the repo.
// If the offer returns, re-enabling this is one word; re-deriving it is not.
//
// Do not "fix" this by asserting the field is absent. That pins the withdrawal
// as if it were the contract, and the day merchandising switches the offer back
// on, the suite would fail for the feature WORKING.
//
// Live pricing coverage does not depend on this file. It is carried by:
//   regression/pricing-consistency.spec.js       (PLP -> PDP, per plan)
//   regression/catalogue-integrity.spec.js       (listing -> variant-pricing)
//   regression/pricing-checkout-consistency.spec.js
// ============================================================================
test.describe.skip('Lowest Effective Price banner', () => {
  // 1. PRESENCE — the banner is on the page at all.
  test('the PDP renders the banner with a label and an amount', async ({ page, productPage }) => {
    test.setTimeout(90000);
    await openProduct(page);

    await expect(productPage.lowestEffectivePriceLabel).toBeVisible({ timeout: TIMEOUTS.nav });
    await expect(productPage.lowestEffectivePriceRow).toBeVisible({ timeout: TIMEOUTS.nav });

    // The caption is the claim the banner makes. A figure with the caption
    // missing is a different, weaker promise than the one being tested.
    await expect(productPage.lowestEffectivePriceRow).toContainText(/with Discount & Coupon/i);
  });

  // 2. CORRECTNESS — the number on screen is the number the API computed.
  //
  // Asserting only "a rupee figure is displayed" would pass on any of the 14
  // rupee nodes this PDP renders. Tying it to best_price.best_upfront is what
  // makes this test mean something.
  // Run for both fixtures: one whose best price is a whole rupee, one whose is
  // not. The second is the one that actually exercises rounding, and rounding
  // is what almost the whole catalogue does.
  for (const fixture of [PRODUCT, FRACTIONAL_PRODUCT]) {
    test(`the banner amount equals best_price.best_upfront — ${fixture.name}`, async ({
      page,
      productPage,
      request,
    }) => {
      test.setTimeout(90000);
      await openProduct(page, fixture.bpid, fixture.slug);

      const pdp = await readJson(request, pdpApi(fixture.slug, fixture.bpid));
      const pricing = await readJson(request, pricingApi(fixture.slug, pdp.data.variant.id));

      const total = pricing.data.best_price.best_upfront.total_amount;
      const displayed = await productPage.getLowestEffectivePrice();

      expect(
        displayed,
        'the banner shows a different figure than best_price.best_upfront.total_amount — ' +
          'the shopper is being promised a price the pricing service did not compute.\n' +
          `  API returned ₹${total}\n` +
          `  rounded      ₹${asDisplayed(total)}\n` +
          `  banner shows ₹${displayed}`
      ).toBe(asDisplayed(total));

      // The banner is always whole rupees even when the computation is not.
      // Asserting it directly means a future change that starts printing paise
      // is reported as the presentation change it is, rather than as an
      // arithmetic failure somewhere else.
      expect(Number.isInteger(displayed), 'the banner rendered a fractional rupee figure').toBe(
        true
      );
    });
  }

  // 3. CORRECTNESS — the banner is genuinely a saving, and the saving reconciles.
  test('the banner price is below MOP and equals MOP minus the applied coupon', async ({
    request,
  }) => {
    test.setTimeout(60000);

    const pdp = await readJson(request, pdpApi(PRODUCT.slug, PRODUCT.bpid));
    const pricing = await readJson(request, pricingApi(PRODUCT.slug, pdp.data.variant.id));

    const mop = pricing.data.upfront.price;
    const best = pricing.data.best_price.best_upfront;

    expect(
      best.total_amount,
      'the "lowest effective price" is not lower than the plain upfront price'
    ).toBeLessThan(mop);

    // The banner's own stated formula is MOP - coupon_discount. Pinning it
    // catches a coupon being counted twice, or an instant discount being
    // subtracted a second time on top of a MOP that already includes it.
    const couponDiscount = best.coupon?.applied ? best.coupon.discount_amount : 0;
    expect(
      best.total_amount,
      `MOP ${mop} minus coupon ${couponDiscount} should be ${mop - couponDiscount}`
    ).toBe(mop - couponDiscount);
  });

  // 4. BEHAVIOUR — the banner tracks the variant.
  //
  // This is the whole point of the feature: pick a different configuration and
  // the promised price must follow it. Measured: choosing 512GB navigates from
  // SAMSAMOB10ZXEG to SAMSAMOBHYSYOB and the banner moves 184999 -> 204999.
  test('choosing a different storage updates the banner to that variant\'s price', async ({
    page,
    productPage,
    request,
  }) => {
    test.setTimeout(120000);
    await openProduct(page);

    const before = await productPage.getLowestEffectivePrice();
    const urlBefore = page.url();

    await productPage.selectVariantOption('512GB');

    // The variant switch is a navigation. Wait for the bpid to actually change
    // before reading, or this races the re-render and re-reads the old figure —
    // which would make the assertion below pass or fail on timing rather than
    // on behaviour.
    await page.waitForURL((url) => url.toString() !== urlBefore, { timeout: TIMEOUTS.nav });

    const switchedBpid = page.url().split('?')[0].split('/').pop();
    expect(switchedBpid, 'selecting a storage option did not change the variant').not.toBe(
      PRODUCT.bpid
    );

    const pdp = await readJson(request, pdpApi(PRODUCT.slug, switchedBpid));
    const pricing = await readJson(request, pricingApi(PRODUCT.slug, pdp.data.variant.id));
    const expected = asDisplayed(pricing.data.best_price.best_upfront.total_amount);

    await expect
      .poll(() => productPage.getLowestEffectivePrice(), {
        timeout: TIMEOUTS.nav,
        message: 'the banner never updated to the newly selected variant',
      })
      .toBe(expected);

    const after = await productPage.getLowestEffectivePrice();
    expect(
      after,
      'the banner showed the same price for two differently priced variants'
    ).not.toBe(before);
  });

  // 5. CORRECTNESS, across the whole variant set.
  //
  // One variant proves the banner works; the catalogue is where it breaks. This
  // walks every sibling and checks each one's best price is internally
  // consistent, which is what catches a single mis-priced configuration.
  test('every variant has a coherent best price', async ({ request }) => {
    test.setTimeout(120000);

    const pdp = await readJson(request, pdpApi(PRODUCT.slug, PRODUCT.bpid));
    const variants = [pdp.data.variant, ...(pdp.data.siblingVariants || [])];

    // Non-vacuous: a product that returned no siblings would make the loop
    // below assert nothing while still reporting green.
    expect(
      variants.length,
      `${PRODUCT.name} returned no variants to check`
    ).toBeGreaterThan(1);

    const seen = [];

    for (const variant of variants) {
      const pricing = await readJson(request, pricingApi(PRODUCT.slug, variant.id));
      const mop = pricing.data.upfront.price;
      const best = pricing.data.best_price?.best_upfront;

      expect(best, `variant ${variant.bpid} has no best_price.best_upfront`).toBeTruthy();

      expect(best.total_amount, `variant ${variant.bpid}: best price is not a positive number`)
        .toBeGreaterThan(0);
      expect(
        best.total_amount,
        `variant ${variant.bpid}: best price ${best.total_amount} exceeds MOP ${mop}`
      ).toBeLessThanOrEqual(mop);

      // The banner is served per variant, so a payload computed for a different
      // variant is a cache-key bug — and one that would show a shopper someone
      // else's configuration price.
      expect(
        pricing.data.best_price.variant_id,
        `variant ${variant.bpid}: best_price was computed for a different variant`
      ).toBe(variant.id);

      seen.push({ bpid: variant.bpid, mop, best: best.total_amount });
    }

    console.log(
      seen.map((v) => `${v.bpid} MOP ${v.mop} -> best ${v.best}`).join('\n')
    );

    // The feature's premise. If every variant priced identically there would be
    // nothing per-variant about this banner, and a regression that collapsed
    // them all onto the master's price would otherwise pass every check above.
    const distinct = new Set(seen.map((v) => v.best));
    expect(
      distinct.size,
      `all ${seen.length} variants share one best price — per-variant pricing appears to ` +
        'have collapsed, or this product genuinely has a single tier and is the wrong ' +
        'fixture for this test'
    ).toBeGreaterThan(1);
  });
});
