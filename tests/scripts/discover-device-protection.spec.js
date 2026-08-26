// tests/scripts/discover-device-protection.spec.js
//
// Builds tests/data/device-protection.json: for a spread of the catalogue, the
// payment mode and the BytePe Secure (Device Protection) figures the PDP shows.
//
// Needed because Device Protection is priced PER PRODUCT and the price varies —
// measured ₹1,999 on Galaxy Z Fold8 Ultra and ₹1 on Macbook Pro M5 — while the
// pricing API reports vas_amount 0 for both. So the only source for the figure
// is the rendered PDP, and a spec that wants a product with a non-trivial
// protection price has to know which ones those are.
//
// Public and logged out. Read-only.

const fs = require('fs');
const path = require('path');
const { test } = require('@playwright/test');
const { BASE_URL } = require('../data/constants');
const { pdpApiPath } = require('../data/emiApi');
const { parseAddOn, parsePdpHeader } = require('../utils/priceText');

test.use({ storageState: { cookies: [], origins: [] } });

const SAMPLE = 24;

test('discover which products carry Device Protection and at what price', async ({
  page,
  request,
}) => {
  test.setTimeout(900000);

  await page.goto(`${BASE_URL}/all-products`, { waitUntil: 'domcontentloaded' });
  await page.locator('a[href*="/pd/"]').first().waitFor({ state: 'visible', timeout: 30000 });

  let last = 0;
  let stable = 0;
  while (stable < 3 || last === 0) {
    await page.mouse.wheel(0, 4000);
    await page.waitForTimeout(1000);
    const n = await page.locator('a[href*="/pd/"]').count();
    if (n === last && n > 0) stable++;
    else {
      stable = 0;
      last = n;
    }
  }

  const cards = page.locator('a[href*="/pd/"]');
  const total = await cards.count();
  const seen = new Map();
  for (let i = 0; i < total; i++) {
    const href = await cards.nth(i).getAttribute('href');
    const m = /\/pd\/([^/?]+)\/([^/?]+)/.exec(href || '');
    if (m && !seen.has(m[1])) seen.set(m[1], { slug: m[1], bpid: m[2] });
  }

  const all = [...seen.values()];
  const step = Math.max(1, Math.floor(all.length / SAMPLE));
  const picks = all.filter((_, i) => i % step === 0).slice(0, SAMPLE);
  console.log(`listing has ${all.length} products; sampling ${picks.length}`);

  const products = [];
  for (const p of picks) {
    let mode = null;
    try {
      const res = await request.get(pdpApiPath(p.slug, p.bpid), {
        headers: { accept: 'application/json' },
      });
      if (res.ok()) mode = (await res.json()).data?.product?.prodPaymentMode ?? null;
    } catch {
      mode = null;
    }

    await page.goto(`${BASE_URL}/pd/${p.slug}/${p.bpid}`, { waitUntil: 'domcontentloaded' });
    await page.keyboard.press('Escape').catch(() => {});
    await page
      .getByText(/^₹[\d,]+$/)
      .first()
      .waitFor({ state: 'visible', timeout: 20000 })
      .catch(() => {});
    // The add-on sits below the buyback slider, so it renders late.
    await page.waitForTimeout(2500);

    const body = await page.locator('body').innerText();
    const addOn = parseAddOn(body);
    const header = parsePdpHeader(body);

    const entry = {
      slug: p.slug,
      bpid: p.bpid,
      prodPaymentMode: mode,
      price: header ? header.price : null,
      deviceProtectionList: addOn ? addOn.list : null,
      deviceProtectionPaid: addOn ? addOn.paid : null,
    };
    products.push(entry);

    console.log(
      `${p.slug.slice(0, 40).padEnd(42)} mode=${String(mode).padEnd(8)} ` +
        `price=${entry.price ?? '-'}  secure=${entry.deviceProtectionList ?? '-'}->${entry.deviceProtectionPaid ?? '-'}`
    );
  }

  const withProtection = products.filter((p) => p.deviceProtectionPaid !== null);
  const paidPrices = [...new Set(withProtection.map((p) => p.deviceProtectionPaid))].sort(
    (a, b) => a - b
  );

  console.log(
    `\n${withProtection.length}/${products.length} sampled products advertise Device Protection`
  );
  console.log(`distinct paid prices: ${paidPrices.join(', ')}`);

  fs.writeFileSync(
    path.join(__dirname, '..', 'data', 'device-protection.json'),
    JSON.stringify(
      {
        generatedFrom: 'PDP "BytePe Secure ₹list ₹paid" text + by-slug prodPaymentMode',
        note:
          'Device Protection is priced per product and is NOT in the pricing API — ' +
          'upfront.vas_amount is 0 even where the PDP advertises a charge.',
        sampled: products.length,
        withProtection: withProtection.length,
        distinctPaidPrices: paidPrices,
        products,
      },
      null,
      2
    )
  );
  console.log('wrote tests/data/device-protection.json');
});
