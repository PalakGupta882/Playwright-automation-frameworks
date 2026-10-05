// tests/scripts/probe-stage-payment-summary.spec.js
//
// READ-ONLY. Re-opens an already-created, unpaid STAGE order's Payment Summary
// and dumps every figure the page shows next to the APIs it was built from, so
// each rupee can be reconciled. Mints nothing, pays nothing.
//
//   BASE_URL=https://stage-web.bytepe.com MASTER_ORDER_ID=DCM... npx playwright test scripts/probe-stage-payment-summary.spec.js --project=chromium --retries=0

const { test, expect } = require('@playwright/test');
const { BASE_URL, BASE_API_URL, SITE_HOST } = require('../data/env');

test('dump stage payment summary figures', async ({ page }) => {
  test.setTimeout(180000);
  expect(SITE_HOST).toBe('stage-web.bytepe.com');
  const id = process.env.MASTER_ORDER_ID;
  expect(id, 'set MASTER_ORDER_ID').toBeTruthy();

  const apis = {};
  page.on('response', async (r) => {
    const m = r.url().match(/\/api\/payments\/v2\/([a-z-]+(?:\/[a-z]+)?)\//);
    if (m) { try { apis[m[1]] = await r.json(); } catch { /* ignore */ } }
  });
  await page.goto(`${BASE_URL}/payment-summary?master_order_id=${id}`, { waitUntil: 'domcontentloaded' });
  await page.getByText(/^order total$/i).first().waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForTimeout(4000);
  const text = await page.locator('body').innerText();
  console.log('PAGE\n' + text.split('\n').map((l) => l.trim()).filter(Boolean).join('\n'));
  const sum = await page.request.get(`${BASE_API_URL}/payments/v2/payment-summary/${id}`);
  console.log('\nAPI payment-summary\n' + JSON.stringify((await sum.json()).data, null, 1).slice(0, 6000));
  for (const [k, v] of Object.entries(apis)) console.log(`\nAPI ${k}\n` + JSON.stringify(v.data, null, 0).slice(0, 5000));
});
