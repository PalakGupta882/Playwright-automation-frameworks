// tests/regression/emi-checkout-flow.spec.js
//
// The EMI tenure ladder: what a shopper is offered, and whether the numbers
// add up.
//
// WHAT THIS IS NOT, AND WHY.
//
// This was requested as a UI checkout flow — "Select EMI Tenure" options for
// 3 / 6 / 12 months, each showing EMI amount, interest and total, click one,
// watch the amount update. That UI does not exist on this storefront.
// Measured on a product with the full six-tenure ladder, logged out:
//
//   text /select emi tenure/i   0        radio inputs        0
//   text /buy on emi/i          0        text /interest/i    0
//   text /emi option/i          0        text /no cost emi/i 0
//
// Clicking the "Credit Card EMI" plan row, and the "Buy Upfront" row, changed
// none of that — no tenure list appeared, no radios, no interest figures. The
// only tenure-shaped things on the page are a buyback slider and a single
// "₹1,510 x 12mo" summary. So there is nothing to select, and a
// selectEMITenure(months) helper would have no control to drive.
//
// The ladder is real, it is simply not a UI choice — it lives in the pricing
// API as data.emi.emi_option[], six entries for this product. That is what
// this spec tests, and it is where a pricing error would actually originate.
//
// The payment gateway is likewise out of reach: it lives on /payment-summary,
// which is only entered by pressing Continue on Review Order, and that mints a
// real order. checkout-flow.spec.js documents that boundary.
//
// Public and logged out: which tenures exist and what they cost is product
// configuration, identical for every shopper. Per-shopper eligibility is never
// asserted here — see CLAUDE.md.

const { test, expect } = require('../fixtures/pageFixtures');
const { pdpApiPath, variantPricingPath, cardEmiOptionsFrom } = require('../data/emiApi');
const { getWithRetry } = require('../utils/apiRetry');
const { BASE_URL, TIMEOUTS } = require('../data/constants');
const baseline = require('../data/cardless-emi.json');

test.use({ storageState: { cookies: [], origins: [] } });

// A handful of products spanning the ladder shapes seen in the catalogue:
// six tenures down to two, NCEMI-only and mixed NCEMI/LCEMI.
const PRODUCTS = baseline.products.offered.slice(0, 4);

async function pricingFor(request, product) {
  const pdp = await (
    await getWithRetry(request, pdpApiPath(product.slug, product.bpid), {
      headers: { accept: 'application/json' },
    })
  ).json();

  const pricing = await (
    await getWithRetry(request, variantPricingPath(product.slug, pdp.data.variant.id), {
      headers: { accept: 'application/json' },
    })
  ).json();

  return pricing;
}

test.describe('EMI tenure ladder', () => {
  // PRESENCE — the ladder exists and every rung carries the fields a shopper
  // needs to compare offers.
  test('the pricing API offers EMI tenures with amounts and interest', async ({ request }) => {
    test.setTimeout(60000);

    const pricing = await pricingFor(request, PRODUCTS[0]);
    const options = cardEmiOptionsFrom(pricing);

    expect(options.length, `${PRODUCTS[0].name} offers no EMI tenures at all`).toBeGreaterThan(0);

    for (const option of options) {
      expect(option.tenure, 'an EMI option has no tenure').toBeGreaterThan(0);
      expect(option.installment_amount, `the ${option.tenure}-month option has no instalment`)
        .toBeGreaterThan(0);
      // interest is legitimately 0 on a No Cost EMI, so this checks the field
      // is present and numeric rather than non-zero.
      expect(typeof option.interest, `the ${option.tenure}-month option has no interest field`)
        .toBe('number');
      expect(option.emi_type, 'an EMI option has no type').toBeTruthy();
    }
  });

  // PRESENCE (UI) — the plan box advertises EMI with a real monthly figure.
  //
  // This is as far as the interface goes. It is worth pinning because it is
  // what a shopper actually sees, and because it ties the rendered figure back
  // to the API below.
  test('the product page advertises a Credit Card EMI plan with a monthly figure', async ({ page }) => {
    test.setTimeout(60000);

    const product = PRODUCTS[0];
    await page.goto(`${BASE_URL}/pd/${product.slug}/${product.bpid}`, { waitUntil: 'domcontentloaded' });
    await page.keyboard.press('Escape').catch(() => {});

    await expect(page.getByText(/choose your plan/i).first()).toBeVisible({ timeout: TIMEOUTS.nav });
    await expect(page.getByText(/^Credit Card EMI$/i).first()).toBeVisible({ timeout: TIMEOUTS.nav });

    // A plan name with no price is not an offer. Matching /mo specifically so
    // this cannot be satisfied by any of the other rupee figures on the page.
    await expect(page.getByText(/₹\s?[\d,]+\s*\/\s*mo/i).first()).toBeVisible({ timeout: TIMEOUTS.nav });
  });

  // CORRECTNESS — the arithmetic behind every rung.
  //
  //   installment_amount x tenure === upfront price - discount + interest
  //
  // Verified exact on 6 of 6 tenures for the reference product. Note this is
  // NOT (price + interest) / tenure, which was the assumed formula: that omits
  // the discount term and matches 0 of 6. Getting this wrong in the lenient
  // direction would produce a test that passes on any numbers at all.
  for (const product of PRODUCTS) {
    test(`${product.name}: every EMI tenure adds up`, async ({ request }) => {
      test.setTimeout(90000);

      const pricing = await pricingFor(request, product);
      const options = cardEmiOptionsFrom(pricing);
      const price = pricing.data.upfront.price;

      expect(options.length, `${product.name} lost its EMI ladder`).toBeGreaterThan(0);
      expect(price, `${product.name} has no upfront price to reconcile against`).toBeGreaterThan(0);

      const mismatches = options
        .map(o => ({
          tenure: o.tenure,
          charged: o.installment_amount * o.tenure,
          expected: price - o.discount + o.interest,
        }))
        .filter(r => r.charged !== r.expected)
        .map(r => `${r.tenure}mo: instalments total ${r.charged}, price-discount+interest is ${r.expected}`);

      expect(
        mismatches,
        `${product.name} quotes instalments that do not reconcile with its price. ` +
          'A shopper on one of these tenures is being charged something other than ' +
          'the advertised price plus interest.'
      ).toEqual([]);

      console.log(`${product.name}: ${options.length} tenures reconcile (₹${price} base)`);
    });
  }

  // BEHAVIOUR — the ladder behaves like a ladder.
  test('a longer tenure always costs less per month and more overall', async ({ request }) => {
    test.setTimeout(90000);

    const pricing = await pricingFor(request, PRODUCTS[0]);
    const options = [...cardEmiOptionsFrom(pricing)].sort((a, b) => a.tenure - b.tenure);
    expect(options.length, 'need at least two tenures to compare').toBeGreaterThan(1);

    const monthlyRises = [];
    const interestFalls = [];
    for (let i = 1; i < options.length; i++) {
      const prev = options[i - 1];
      const curr = options[i];

      if (curr.installment_amount > prev.installment_amount) {
        monthlyRises.push(`${curr.tenure}mo costs ${curr.installment_amount}/mo vs ${prev.tenure}mo at ${prev.installment_amount}/mo`);
      }

      // Interest, not instalments x tenure. Instalments are whole rupees, so a
      // total can miss by up to a rupee per instalment — measured, 3mo totals
      // 227901 against a 227900 price while 6mo totals 227898. Comparing totals
      // therefore reports rounding as a pricing fault. Interest is the exact
      // figure and is what "a longer tenure costs more" actually means.
      if (curr.interest < prev.interest) {
        interestFalls.push(`${curr.tenure}mo charges ${curr.interest} interest, less than ${prev.tenure}mo at ${prev.interest}`);
      }
    }

    expect(monthlyRises, 'a longer tenure charged more per month').toEqual([]);
    expect(interestFalls, 'a longer tenure charged less interest').toEqual([]);
  });

  // NEGATIVE — the ladder contains nothing a shopper could not actually take.
  //
  // The requested negative case was "skip tenure selection and expect an
  // error". There is no selection step to skip. This asks the equivalent
  // question of the data: is anything on offer that cannot be honoured?
  test('no tenure is offered with a zero amount or a duplicate', async ({ request }) => {
    test.setTimeout(90000);

    const pricing = await pricingFor(request, PRODUCTS[0]);
    const options = cardEmiOptionsFrom(pricing);

    // Non-vacuous: an empty ladder would satisfy every check below.
    expect(options.length, 'no EMI options returned — nothing was checked').toBeGreaterThan(0);

    const unusable = options
      .filter(o => !(o.installment_amount > 0) || !(o.tenure > 0))
      .map(o => `${o.tenure}mo at ${o.installment_amount}`);
    expect(unusable, 'an EMI option is offered that cannot be paid').toEqual([]);

    const tenures = options.map(o => o.tenure);
    expect(new Set(tenures).size, `duplicate tenures offered: ${tenures.join(', ')}`)
      .toBe(tenures.length);

    // A No Cost EMI must actually be no-cost. Allowing one rupee per
    // instalment: instalments are whole rupees, so a 3-month plan on a 227,900
    // product legitimately totals 227,901. Anything beyond that rounding
    // allowance is a real charge on a plan advertised as costing nothing.
    const price = pricing.data.upfront.price;
    const noCostOverCharging = options
      .filter(o => o.emi_type === 'NCEMI')
      .filter(o => o.installment_amount * o.tenure - price > o.tenure)
      .map(o => `${o.tenure}mo NCEMI totals ${o.installment_amount * o.tenure} on a ₹${price} product, ` +
        `which is ${o.installment_amount * o.tenure - price} more than rounding explains`);
    expect(noCostOverCharging, 'a "No Cost EMI" costs meaningfully more than paying upfront').toEqual([]);
  });
});
