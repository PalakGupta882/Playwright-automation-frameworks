// tests/regression/cardless-emi.spec.js
//
// Guards the PRE-PRICED subscription cardless EMI plan against silent removal.
//
// This does NOT test cardless EMI availability. Cardless EMI is offered on
// upfront products too, and whether any given shopper can use it depends on a
// per-user credit check whose answer changes between page loads. None of that
// is assertable. See the BytePe selling model in CLAUDE.md.
//
// What IS stable, and what this pins: on subscription-eligible products the
// cardless figure is pre-computed and shown without any eligibility check.
// That needs both:
//   prodPaymentMode === 'BOTH'   (catalog API — the subscription plan exists)
//   data.nbfc.emi_amount > 0     (pricing API — the figure is pre-computed)
//
// Runs logged out on purpose: logging in would replace product configuration
// with one account's credit eligibility, which is exactly what must not be
// asserted.
//
// The baseline in tests/data/cardless-emi.json is a snapshot of what was live
// when it was generated. If the business intentionally changes which products
// carry cardless EMI, regenerate it:
//   npx playwright test scripts/discover-cardless-emi.spec.js --project=chromium

const { test, expect } = require('../fixtures/pageFixtures');
const { pdpApiPath, variantPricingPath, cardlessEmiFrom } = require('../data/emiApi');
const { getWithRetry } = require('../utils/apiRetry');
const baseline = require('../data/cardless-emi.json');

test.use({ storageState: { cookies: [], origins: [] } });

const EXPECTED = baseline.products.offered;

test.describe('Subscription cardless EMI pricing', () => {
  // The whole suite is meaningless if the field moves or is renamed.
  test('pricing API still exposes an nbfc block', async ({ request }) => {
    test.setTimeout(60000);

    const sample = EXPECTED[0];
    const pdp = await (
      await getWithRetry(request, pdpApiPath(sample.slug, sample.bpid), {
        headers: { accept: 'application/json' },
      })
    ).json();

    const res = await getWithRetry(request, variantPricingPath(sample.slug, pdp.data.variant.id), {
      headers: { accept: 'application/json' },
    });
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(
      body.data,
      'pricing payload lost its data envelope — the cardless EMI contract has changed'
    ).toHaveProperty('nbfc');
  });

  // One test per product, so a report names exactly which one lost its offer
  // rather than failing as a single opaque "3 products changed".
  for (const product of EXPECTED) {
    test(`${product.name} still shows a pre-priced cardless EMI plan`, async ({ request }) => {
      test.setTimeout(60000);

      const pdpRes = await getWithRetry(request, pdpApiPath(product.slug, product.bpid), {
        headers: { accept: 'application/json' },
        failOnStatusCode: false,
      });
      expect(pdpRes.status(), `product page API failed for ${product.slug}`).toBe(200);

      const pdp = await pdpRes.json();

      // Half the rule: without the subscription plan there is no box to show
      // cardless EMI in, whatever the pricing service returns.
      expect(
        pdp.data.product.prodPaymentMode,
        `${product.name} is no longer sold on subscription, so cardless EMI is no longer offered`
      ).toBe('BOTH');

      const priceRes = await getWithRetry(
        request,
        variantPricingPath(product.slug, pdp.data.variant.id),
        { headers: { accept: 'application/json' }, failOnStatusCode: false }
      );
      expect(priceRes.status()).toBe(200);

      const offer = cardlessEmiFrom(await priceRes.json());
      expect(
        offer,
        `${product.name} no longer offers cardless EMI — it was ₹${product.cardlessEmi.monthly}/mo over ${product.cardlessEmi.tenureMonths} months`
      ).not.toBeNull();

      // A tenure that silently drops to 0 breaks the offer just as badly as
      // removing it, and would otherwise slip past an "exists" check.
      expect(offer.tenureMonths).toBeGreaterThan(0);
      expect(offer.monthly).toBeGreaterThan(0);
    });
  }
});
