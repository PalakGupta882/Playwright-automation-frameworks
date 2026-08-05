// tests/regression/emi-plan-config.spec.js
//
// Guards the EMI PLAN LADDER behind the "Choose your plan" box: how many
// tenures a product offers, what kind they are (NCEMI / LCEMI / EMI), that a
// Pay-in-Full price exists, and that a pre-priced cardless plan adds up.
//
// This is the gap regression/cardless-emi.spec.js does not cover. That spec
// pins one field (data.nbfc) on one plan (subscription). data.emi.emi_option[]
// — the tenure choices every EMI purchase is made from — was read only by the
// discovery script and asserted nowhere, so the whole ladder could drop from
// six tenures to one, or from No Cost to Standard interest, and the suite would
// stay green.
//
// CONFIGURATION ONLY. Nothing here touches per-shopper eligibility, which is
// unassertable (CLAUDE.md; docs/cardless-emi.md). It runs logged out for the
// same reason cardless-emi.spec.js does: a logged-in run would fold one
// account's credit standing into what is meant to be a product-configuration
// check.
//
// Prices are asserted as present and positive, never pinned to a figure — a
// price change is a business event, not a regression. Plan SHAPE is pinned,
// because losing a tenure or silently moving No Cost EMI to Standard EMI is a
// regression.
//
// Baseline: tests/data/cardless-emi.json (186 products, one row each).
// Regenerate with:
//   npx playwright test scripts/discover-cardless-emi.spec.js --project=chromium
// and diff it — never regenerate to make this file pass.

const { test, expect } = require('../fixtures/pageFixtures');
const {
  pdpApiPath,
  variantPricingPath,
  cardEmiOptionsFrom,
  cardlessEmiFrom,
} = require('../data/emiApi');
const { getWithRetry } = require('../utils/apiRetry');
const baseline = require('../data/cardless-emi.json');

test.use({ storageState: { cookies: [], origins: [] } });

// The only EMI kinds the catalogue has ever returned. A fourth appearing is
// worth a failed test and a conversation, not a silent pass.
const KNOWN_EMI_TYPES = ['EMI', 'LCEMI', 'NCEMI'];

const ALL = [...baseline.products.offered, ...baseline.products.notOffered];

// One product per distinct plan shape rather than all 186: the six shapes below
// cover every tenure count, every EMI-type combination and both payment modes
// in the catalogue, for 12 API calls instead of 372 against a production origin
// that already rate-limits this suite. Derived from the baseline, so
// regenerating it re-derives the sample instead of leaving a hand-picked list
// pointing at delisted products.
function representatives() {
  const byShape = new Map();
  for (const p of ALL) {
    const shape = `${p.cardEmiTenures} tenures · ${p.cardEmiTypes} · ${p.prodPaymentMode}`;
    if (!byShape.has(shape)) byShape.set(shape, { shape, ...p });
  }
  return [...byShape.values()];
}

const SAMPLE = representatives();

// Pre-priced cardless is only documented as stable on subscription products
// (prodPaymentMode BOTH). The handful of UPFRONT products carrying an nbfc
// figure are the recorded anomaly in docs/cardless-emi-bugs.md — confirmed
// harmless, and settled at eligibility time, so their figures are not a
// contract to assert against.
const PRE_PRICED = SAMPLE.filter((p) => p.prodPaymentMode === 'BOTH' && p.cardlessEmi);

async function fetchPricing(request, product) {
  const pdpRes = await getWithRetry(request, pdpApiPath(product.slug, product.bpid), {
    headers: { accept: 'application/json' },
    failOnStatusCode: false,
  });
  // A 200 with a "404 This page could not be found." body is what a drifted
  // slug looks like here, so a non-200 is the only thing worth calling out —
  // and it means the baseline needs regenerating, not that EMI is broken.
  expect(
    pdpRes.status(),
    `product API failed for ${product.slug}/${product.bpid} — the catalogue may have drifted; re-run npm run discover`
  ).toBe(200);
  const pdp = await pdpRes.json();

  const priceRes = await getWithRetry(
    request,
    variantPricingPath(product.slug, pdp.data.variant.id),
    { headers: { accept: 'application/json' }, failOnStatusCode: false }
  );
  expect(priceRes.status(), `variant pricing failed for ${product.slug}`).toBe(200);

  return priceRes.json();
}

test.describe('EMI plan configuration', () => {
  // Every assertion in this file reads through data.emi and data.upfront. If
  // either block is renamed, the per-product tests below would fail as "0
  // tenures" and read like a catalogue change. Fail once, clearly, instead.
  test('pricing API still exposes the EMI and upfront blocks', async ({ request }) => {
    test.setTimeout(60000);

    const body = await fetchPricing(request, SAMPLE[0]);

    expect(
      body.data,
      'pricing payload lost data.emi — the EMI tenure contract has changed'
    ).toHaveProperty('emi');
    expect(
      body.data,
      'pricing payload lost data.upfront — the Pay in Full contract has changed'
    ).toHaveProperty('upfront');
    expect(
      Array.isArray(body.data.emi.emi_option),
      'data.emi.emi_option is no longer an array'
    ).toBe(true);
  });

  // One test per shape, so a report names the configuration that moved rather
  // than failing as a single opaque "EMI changed".
  for (const product of SAMPLE) {
    test(`${product.name} still offers ${product.shape}`, async ({ request }) => {
      test.setTimeout(60000);

      const body = await fetchPricing(request, product);
      const options = cardEmiOptionsFrom(body);

      // Presence before anything else: every per-option assertion below is
      // vacuous on an empty array.
      expect(
        options.length,
        `${product.name} offers no EMI tenures at all — it had ${product.cardEmiTenures}`
      ).toBeGreaterThan(0);

      expect(
        options,
        `${product.name} moved from ${product.cardEmiTenures} EMI tenures to ${options.length}`
      ).toHaveLength(product.cardEmiTenures);

      const types = [...new Set(options.map((o) => o.emi_type))].sort();
      expect(
        types.join('/'),
        `${product.name} changed EMI kind — was ${product.cardEmiTypes}`
      ).toBe([...new Set(product.cardEmiTypes.split('/'))].sort().join('/'));

      // A new emi_type would sail past the comparison above only if the
      // baseline were regenerated first; this says so at the moment it appears.
      for (const type of types) {
        expect(KNOWN_EMI_TYPES, `unrecognised emi_type "${type}" on ${product.name}`).toContain(
          type
        );
      }

      // Pay in Full is on every product per CLAUDE.md, and an unpriced plan is
      // as broken as a missing one.
      expect(
        body.data.upfront && body.data.upfront.price,
        `${product.name} has no Pay in Full price`
      ).toBeGreaterThan(0);
    });
  }

  // Internal coherence of the quoted subscription cardless plan. Holds exactly
  // — not approximately — for all 35 products in the baseline that carry an
  // nbfc figure: instalments plus downpayment equal financed amount plus
  // interest. A plan whose parts stop reconciling is quoting a shopper a number
  // that is not the number they will be charged, and no "field exists" check
  // catches it.
  for (const product of PRE_PRICED) {
    test(`${product.name} quotes a cardless plan that adds up`, async ({ request }) => {
      test.setTimeout(60000);

      const body = await fetchPricing(request, product);
      const offer = cardlessEmiFrom(body);

      expect(
        offer,
        `${product.name} lost its pre-priced cardless plan — it was ₹${product.cardlessEmi.monthly}/mo over ${product.cardlessEmi.tenureMonths} months`
      ).not.toBeNull();

      expect(offer.tenureMonths, `${product.name} cardless tenure collapsed to 0`).toBeGreaterThan(0);
      expect(offer.monthly, `${product.name} cardless instalment collapsed to 0`).toBeGreaterThan(0);

      expect(
        offer.monthly * offer.tenureMonths + offer.downpayment,
        `${product.name} cardless plan does not reconcile: ` +
          `${offer.monthly} x ${offer.tenureMonths} + ${offer.downpayment} downpayment ` +
          `should equal ${offer.total} financed + ${offer.interest} interest`
      ).toBe(offer.total + offer.interest);
    });
  }
});
