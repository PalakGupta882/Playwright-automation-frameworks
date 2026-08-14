// tests/api/pricing-api.spec.js
//
// Does the "Lowest Effective Price" actually hold up?
//
// The PDP banner makes a claim about money to every shopper, and until now
// nothing checked it. The pricing API does not just return a number — it
// returns its own working, and that working is verifiable:
//
//   best_price.best_upfront   the cheapest way to pay in full
//   best_price.best_emi       the cheapest monthly instalment
//
// Each carries a `competitors[]` array of the branches it beat, the coupon it
// chose, the formula it used, and its own selection rule as a string. So the
// question is not "is this number plausible" but "does this number follow from
// the inputs the service itself published". That is what this file asserts.
//
// Measured 10 Aug 2026, Galaxy Z Fold8 Ultra:
//
//   best_upfront  184999  (upfront/FULL_PAYMENT, coupon SF15K)
//     competitors  cc 194999 · nbfc 194999 · emi 194999
//
//   best_emi      8750/mo (cc/SUBSCRIPTION_CC, coupon SF5000, 24mo)
//     competitors  emi 8750/mo · nbfc 9121/mo
//     selection_rule "lowest monthly installment; exact tie ->
//                     subscription branch wins over card EMI"
//
// Note the two halves pick DIFFERENT coupons — SF15K for paying in full,
// SF5000 for EMI — out of a pool of three. That is deliberate, and asserting
// one coupon everywhere would be wrong.
//
// Public: no session, no writes, safe to run any time.

const { test, expect } = require('@playwright/test');
const { getApiContext, safeJson } = require('./apiHelper');
const { ENDPOINTS } = require('../data/apiEndpoints');
const { getWithRetry } = require('../utils/apiRetry');
const { products } = require('../data/products.json');

// Spread across the catalogue rather than the first N, which are all one brand.
// Derived from products.json so this follows `npm run discover` instead of
// pinning slugs that drift on their own.
const SAMPLE_SIZE = 4;
const step = Math.max(1, Math.floor(products.length / SAMPLE_SIZE));
const FIXTURES = products
  .filter((_, i) => i % step === 0)
  .slice(0, SAMPLE_SIZE)
  .map((entry) => {
    const m = /\/pd\/([^/?]+)\/([^/?]+)/.exec(entry.url || '');
    return m ? { name: entry.name, slug: m[1], bpid: m[2] } : null;
  })
  .filter(Boolean);

// Money here is genuinely fractional — a percentage coupon leaves paise, and 37
// of 40 sampled products carry one. Comparing with toBe would fail on float
// representation rather than on a pricing defect, so arithmetic is checked to
// the paisa and no further.
const PAISA = 2;

// Branches that represent a subscription rather than a card EMI. Needed for the
// documented tie-break below.
const SUBSCRIPTION_BRANCHES = new Set(['cc', 'nbfc']);

async function loadPricing(api, fixture) {
  const pdpRes = await getWithRetry(api, ENDPOINTS.productBySlug(fixture.slug, fixture.bpid));
  expect(
    pdpRes.status(),
    `${fixture.slug}/${fixture.bpid} — a 404 here is usually catalogue drift, not a defect. ` +
      'Re-run: npm run discover'
  ).toBe(200);

  const pdp = await safeJson(pdpRes);
  const priceRes = await getWithRetry(
    api,
    ENDPOINTS.variantPricing(fixture.slug, pdp.data.variant.id)
  );
  expect(priceRes.status()).toBe(200);

  const pricing = await safeJson(priceRes);
  return { variant: pdp.data.variant, data: pricing.data };
}

// `instant_discount_already_in_mop` is optional — measured 10 Aug 2026 it is
// present on Galaxy Z Fold8 Ultra (5000) and absent on three of four other
// sampled products. So this asserts the claim the field's name makes, only
// where the field exists: the discount is already inside MOP, which means MRP
// must sit at least that far above MOP. If it does not, the figure is being
// promised twice — once in the strike-through and again in the headline.
//
// An earlier version of this check compared total_amount against
// `mop - discount - instant`. That was wrong twice: NaN wherever the field is
// absent, and `total > total` (so always failing) wherever it is zero. It was
// also redundant, since total === mop - discount is asserted directly above it.
function assertInstantDiscountIsInsideMop(best, label) {
  const instant = best.instant_discount_already_in_mop;
  if (instant == null) return;

  expect(
    best.base.mrp - best.base.mop,
    `${label}: MOP ${best.base.mop} is only ${best.base.mrp - best.base.mop} below MRP ` +
      `${best.base.mrp}, but ${instant} is claimed to be already included in it`
  ).toBeGreaterThanOrEqual(instant);
}

// The coupon block is the same shape on both halves, so its invariants are
// checked in one place. Pulled out of the test bodies to keep the conditional
// (a coupon may legitimately not apply) out of the assertions themselves.
function assertCouponIsSane(coupon, label) {
  if (!coupon || !coupon.applied) return;

  expect(coupon.discount_amount, `${label}: coupon discount is not positive`).toBeGreaterThan(0);

  // A cap that does not cap is the classic off-by-one in discount code.
  expect(
    coupon.discount_amount,
    `${label}: coupon ${coupon.code} gave ${coupon.discount_amount} above its max of ${coupon.max_discount}`
  ).toBeLessThanOrEqual(coupon.max_discount);

  // capped_at_max_discount must describe what actually happened.
  const shouldBeCapped = coupon.raw_discount > coupon.max_discount;
  expect(
    Boolean(coupon.capped_at_max_discount),
    `${label}: coupon ${coupon.code} raw ${coupon.raw_discount} vs max ${coupon.max_discount} — ` +
      `capped_at_max_discount says ${coupon.capped_at_max_discount}`
  ).toBe(shouldBeCapped);

  // Uncapped, the applied discount is the raw one.
  const expectedApplied = shouldBeCapped ? coupon.max_discount : coupon.raw_discount;
  expect(coupon.discount_amount, `${label}: applied discount does not follow from raw/max`).toBeCloseTo(
    expectedApplied,
    PAISA
  );

  // The minimum-order gate must actually have been met, or this coupon should
  // never have been chosen. This is the check that catches a coupon leaking
  // onto orders too small to qualify for it.
  expect(
    coupon.min_order_gate_amount,
    `${label}: coupon ${coupon.code} needs a min order of ${coupon.min_order_amount} but the ` +
      `gate was measured at ${coupon.min_order_gate_amount}`
  ).toBeGreaterThanOrEqual(coupon.min_order_amount);
}

test.describe('Pricing API — best price is genuinely the best', () => {
  let api;

  test.beforeAll(async () => {
    api = await getApiContext();
  });

  test.afterAll(async () => {
    await api.dispose();
  });

  test('there are fixtures to check', () => {
    // Non-vacuous guard: every test below loops the same list, and an empty
    // list would make all of them pass while asserting nothing.
    expect(FIXTURES.length, 'products.json yielded no usable /pd/ URLs').toBeGreaterThan(1);
  });

  // best_price IS INTENTIONALLY DISABLED — the offer behind it has ended.
  //
  // Confirmed by the team on 14 Aug 2026. The field is absent from
  // variant-pricing on every product, and that is a product decision, not a
  // defect. Nothing here may fail, or report it as a pricing bug.
  //
  // A coverage guard briefly lived at this spot and asserted the field was
  // still published. It was removed on the same decision — it was answering a
  // question that has now been answered.
  //
  // The per-fixture `test.skip(!best, ...)` calls below are therefore correct
  // and are left alone. They report as skips with a reason, which is the honest
  // status of a feature that no longer exists: not "we could not check", but
  // "there is nothing left to check". Do not re-add a guard here, and do not
  // let the checkout pricing suite depend on this file.
  //
  // Live checkout pricing is covered instead by:
  //   regression/pricing-consistency.spec.js            (PLP -> PDP, per plan)
  //   regression/pricing-checkout-consistency.spec.js   (PDP -> cart -> review)
  //   regression/device-protection-consistency.spec.js  (review -> payment)

  for (const fixture of FIXTURES) {
    test.describe(fixture.name, () => {
      // ---- best_upfront ------------------------------------------------

      test('the chosen upfront price beats every branch it was compared against', async () => {
        const { data } = await loadPricing(api, fixture);
        const best = data.best_price?.best_upfront;
        test.skip(!best, `${fixture.name} has no best_price.best_upfront`);

        const rivals = best.competitors || [];
        expect(rivals.length, 'no competitors were recorded, so "best" means nothing').toBeGreaterThan(0);

        const cheapest = Math.min(...rivals.map((c) => c.total_amount), best.total_amount);

        // The claim on the PDP. If a competitor is cheaper, the shopper is being
        // shown a "Lowest Effective Price" that is not the lowest one available.
        expect(
          best.total_amount,
          `winner ${best.total_amount} (${best.source?.branch}) is not the cheapest — ` +
            rivals.map((c) => `${c.branch}:${c.total_amount}`).join(' ')
        ).toBeCloseTo(cheapest, PAISA);
      });

      test('the upfront total follows from MOP and the coupon it chose', async () => {
        const { data } = await loadPricing(api, fixture);
        const best = data.best_price?.best_upfront;
        test.skip(!best, `${fixture.name} has no best_price.best_upfront`);

        const discount = best.coupon?.applied ? best.coupon.discount_amount : 0;

        // The service publishes this formula as total_amount_formula:
        // "MOP - coupon_discount". Hold it to its own arithmetic.
        expect(
          best.mop_after_coupon,
          `${fixture.name}: mop_after_coupon should be ${best.base.mop} - ${discount}`
        ).toBeCloseTo(best.base.mop - discount, PAISA);

        expect(
          best.total_amount,
          `${fixture.name}: total_amount should equal mop_after_coupon for an upfront payment`
        ).toBeCloseTo(best.mop_after_coupon, PAISA);

        assertInstantDiscountIsInsideMop(best, fixture.name);
        assertCouponIsSane(best.coupon, `${fixture.name} upfront`);
      });

      // ---- best_emi ----------------------------------------------------

      test('the chosen EMI has the lowest monthly instalment, and ties break as documented', async () => {
        const { data } = await loadPricing(api, fixture);
        const best = data.best_price?.best_emi;
        test.skip(!best, `${fixture.name} has no best_price.best_emi`);

        const rivals = (best.competitors || []).filter((c) => c.emi_amount > 0);

        // Measured 10 Aug 2026: three of four sampled products return an EMI
        // winner with an empty competitors[]. Fold8 Ultra records two rivals;
        // the cheaper products record none. So for those, "lowest instalment"
        // is a claim with nothing behind it that this test can check — the
        // service published a winner without publishing what it beat.
        //
        // Skipping rather than passing, because a green result here would imply
        // the comparison was made.
        test.skip(
          rivals.length === 0,
          `${fixture.name}: best_emi has no competitors[], so "lowest instalment" cannot be verified`
        );

        const lowest = Math.min(...rivals.map((c) => c.emi_amount), best.emi_amount);

        expect(
          best.emi_amount,
          `winner ${best.emi_amount}/mo (${best.source?.branch}) is not the lowest — ` +
            rivals.map((c) => `${c.branch}:${c.emi_amount}`).join(' ')
        ).toBeCloseTo(lowest, PAISA);

        // selection_rule: "lowest monthly installment; exact tie -> subscription
        // branch wins over card EMI". When a card-EMI branch ties the winner,
        // the winner must be a subscription branch. Observed live: cc and emi
        // both at 8750, and cc won.
        const tiedCardEmi = rivals.some(
          (c) => !SUBSCRIPTION_BRANCHES.has(c.branch) && Math.abs(c.emi_amount - best.emi_amount) < 0.01
        );
        const winnerIsSubscription = SUBSCRIPTION_BRANCHES.has(best.source?.branch);

        expect(
          !tiedCardEmi || winnerIsSubscription,
          `${fixture.name}: a card-EMI branch tied at ${best.emi_amount}/mo but the winner was ` +
            `"${best.source?.branch}". selection_rule says the subscription branch wins a tie.`
        ).toBe(true);
      });

      test('the EMI total and the coupon saving both reconcile', async () => {
        const { data } = await loadPricing(api, fixture);
        const best = data.best_price?.best_emi;
        test.skip(!best, `${fixture.name} has no best_price.best_emi`);

        const discount = best.coupon?.applied ? best.coupon.discount_amount : 0;
        const emiDiscount = best.emi_discount || 0;

        // Published formula: "MOP - emi_discount - coupon_discount".
        expect(
          best.total_amount,
          `${fixture.name}: total should be ${best.base.mop} - ${emiDiscount} - ${discount}`
        ).toBeCloseTo(best.base.mop - emiDiscount - discount, PAISA);

        expect(best.mop_after_coupon).toBeCloseTo(best.base.mop - discount, PAISA);

        // A coupon must never make the monthly payment worse.
        expect(
          best.emi_amount,
          `${fixture.name}: applying a coupon raised the instalment from ` +
            `${best.emi_amount_before_coupon} to ${best.emi_amount}`
        ).toBeLessThanOrEqual(best.emi_amount_before_coupon);

        // ...and the advertised saving must be the difference it actually made.
        expect(
          best.emi_saving_from_coupon,
          `${fixture.name}: emi_saving_from_coupon should be ` +
            `${best.emi_amount_before_coupon} - ${best.emi_amount}`
        ).toBeCloseTo(best.emi_amount_before_coupon - best.emi_amount, PAISA);

        assertCouponIsSane(best.coupon, `${fixture.name} emi`);
      });

      // ---- the payload describes the variant that was asked for --------

      test('the computation belongs to the variant requested', async () => {
        const { variant, data } = await loadPricing(api, fixture);
        const bp = data.best_price;
        test.skip(!bp, `${fixture.name} has no best_price`);

        // A mismatch is a cache-key bug, and it would show one shopper another
        // configuration's price — the most expensive kind of wrong here.
        expect(
          bp.variant_id,
          `${fixture.name}: best_price was computed for a different variant`
        ).toBe(variant.id);

        // The banner is a cached computation. If the TTL ever comes back zero or
        // missing, it is being recomputed per request and the cost of that is
        // worth knowing before it shows up as latency.
        expect(bp.ttl_seconds, `${fixture.name}: best_price has no TTL`).toBeGreaterThan(0);
        expect(bp.schema_version, `${fixture.name}: best_price has no schema_version`).toBeTruthy();
      });
    });
  }
});
