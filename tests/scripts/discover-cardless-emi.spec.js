// tests/scripts/discover-cardless-emi.spec.js
//
// Regenerates tests/data/cardless-emi.json — the baseline that
// regression/cardless-emi.spec.js asserts against.
//
// "Offered" here means the PRE-PRICED subscription cardless plan:
//   prodPaymentMode === 'BOTH'  AND  data.nbfc.emi_amount > 0
// It does NOT mean cardless EMI availability. Cardless EMI is offered on
// upfront products too, decided by a per-shopper credit check. See CLAUDE.md.
//
// Run this ONLY when the catalogue or the business rules have genuinely
// changed. Running it to make a failing test pass would erase the very
// regression you were meant to catch.
//
//   npx playwright test scripts/discover-cardless-emi.spec.js --project=chromium
//
// Read-only: public GETs, no auth, no writes.

const { test } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const {
  pdpApiPath,
  variantPricingPath,
  cardlessEmiFrom,
  creditCardEmiFrom,
  cardEmiOptionsFrom,
} = require('../data/emiApi');
const catalog = require('../data/products.json');

const OUT_PATH = path.join(__dirname, '..', 'data', 'cardless-emi.json');
const CONCURRENCY = 8;

const CATEGORY = {
  SMMOB: 'Smartphone', WIWIR: 'Wireless audio', AUAUD: 'Audio', ACACC: 'Accessory',
  ACMOB: 'Mobile accessory', HOAPP: 'Home appliance', HOHOM: 'Home care',
  LULUG: 'Luggage', PEPER: 'Personal care', TATAB: 'Tablet', LALAP: 'Laptop',
  SMSMA: 'Smartwatch',
};
const BRAND = {
  APP: 'Apple', SAM: 'Samsung', GOO: 'Google', MOT: 'Motorola', NOT: 'Nothing',
  VIV: 'Vivo', OPP: 'Oppo', XIA: 'Xiaomi', REA: 'Realme', ONE: 'OnePlus',
  AMB: 'Ambrane', MAR: 'Marshall', JBL: 'JBL', DYS: 'Dyson', MOK: 'Mokobara',
  PRO: 'ProTouch', PHI: 'Philips', KEN: 'Kent', WON: 'Wonderchef',
  PRE: 'Prestige', NES: 'Nestle', EDT: 'EdTech',
};

test('discover which products offer cardless EMI', async ({ request }) => {
  test.setTimeout(900000);

  const items = catalog.products
    .map((p) => {
      const m = p.url.match(/^\/pd\/([^/]+)\/([^/?]+)/);
      return m ? { name: p.name, slug: m[1], bpid: m[2] } : null;
    })
    .filter(Boolean);

  const found = [];
  const unreachable = [];
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const item = items[cursor++];

      const pdpRes = await request.get(pdpApiPath(item.slug, item.bpid), {
        headers: { accept: 'application/json' },
        failOnStatusCode: false,
      });
      if (!pdpRes.ok()) {
        unreachable.push({ ...item, status: pdpRes.status() });
        continue;
      }
      const pdp = await pdpRes.json();

      const priceRes = await request.get(
        variantPricingPath(item.slug, pdp.data.variant.id),
        { headers: { accept: 'application/json' }, failOnStatusCode: false }
      );
      if (!priceRes.ok()) {
        unreachable.push({ ...item, status: priceRes.status() });
        continue;
      }
      const pricing = await priceRes.json();

      found.push({
        name: item.name,
        slug: item.slug,
        bpid: item.bpid,
        // Recorded because the listing does not always link the master, and a
        // non-master bpid quotes a price no shopper lands on.
        isMaster: Boolean(pdp.data.variant.isMaster),
        brand: BRAND[item.bpid.slice(0, 3)] || item.bpid.slice(0, 3),
        category: CATEGORY[item.bpid.slice(3, 8)] || item.bpid.slice(3, 8),
        mop: ((pricing.data || {}).upfront || {}).price,
        prodPaymentMode: pdp.data.product.prodPaymentMode,
        cardlessEmi: cardlessEmiFrom(pricing),
        creditCardEmi: creditCardEmiFrom(pricing),
        cardEmiTenures: cardEmiOptionsFrom(pricing).length,
        cardEmiTypes: [...new Set(cardEmiOptionsFrom(pricing).map((o) => o.emi_type))].join('/'),
      });
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const byPrice = (a, b) => (b.mop || 0) - (a.mop || 0);
  const isOffered = (p) => p.prodPaymentMode === 'BOTH' && Boolean(p.cardlessEmi);

  const offered = found.filter(isOffered).sort(byPrice);
  const notOffered = found.filter((p) => !isOffered(p)).sort(byPrice);
  // Upfront products carrying a computed nbfc figure. Harmless, but recorded so
  // the oddity is visible rather than rediscovered every few months.
  const anomalies = found.filter((p) => p.prodPaymentMode !== 'BOTH' && p.cardlessEmi);

  fs.writeFileSync(
    OUT_PATH,
    `${JSON.stringify(
      {
        rule:
          'Offered = the pre-priced subscription cardless plan: prodPaymentMode==="BOTH" ' +
          'AND nbfc.emi_amount>0. NOT a measure of cardless EMI availability — see CLAUDE.md.',
        generatedFrom: 'by-slug prodPaymentMode + variant-pricing data.nbfc',
        scannedProducts: found.length,
        unreachable,
        offeredCount: offered.length,
        notOfferedCount: notOffered.length,
        anomalies,
        products: { offered, notOffered },
      },
      null,
      2
    )}\n`
  );

  console.log(
    `Scanned ${found.length} products — ${offered.length} pre-priced subscription ` +
      `cardless plans, ${notOffered.length} not, ${anomalies.length} anomalies, ` +
      `${unreachable.length} unreachable.`
  );
});
