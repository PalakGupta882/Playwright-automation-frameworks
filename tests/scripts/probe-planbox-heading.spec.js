const { test, request } = require('@playwright/test');
test.setTimeout(400000);
const HOST = 'https://www.bytepe.com';
test.use({ storageState: { cookies: [], origins: [] } });

test('what anchors the plan box now', async ({ page }) => {
  const api = await request.newContext({ baseURL: HOST });
  const rows = [];
  for (const p of [1, 5, 9]) {
    const r = await api.get(`/api/product-service/apps/products?page=${p}&limit=12`);
    if (!r.ok()) continue;
    const arr = (await r.json()).data?.items || [];
    const pre = (x) => (x.variant?.tags || []).some((t) => /pre-?book/i.test(t.name));
    const up = arr.find((x) => x.prodPaymentMode === 'UPFRONT' && !pre(x));
    const both = arr.find((x) => x.prodPaymentMode === 'BOTH' && !pre(x));
    if (up) rows.push(up);
    if (both) rows.push(both);
  }
  await api.dispose();

  const CANDIDATES = [
    'Choose your plan', 'Choose Your Plan', 'Select your plan', 'Your plan',
    'Recommended', 'Pay in Full', 'Buy Upfront', 'Credit Card EMI',
    'Cardless EMI', 'All payment modes', 'Subscription',
  ];

  for (const row of rows.slice(0, 6)) {
    await page.goto(`${HOST}/pd/${row.slug}/${row.variant.bpid}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /buy now|pre-?book now/i }).first()
      .waitFor({ state: 'visible', timeout: 40000 }).catch(() => {});
    await page.waitForTimeout(2000);
    const body = await page.locator('body').innerText();
    const present = CANDIDATES.filter((c) => body.includes(c));
    console.log(`${String(row.prodPaymentMode).padEnd(8)} ${row.name.slice(0, 32).padEnd(34)} -> ${present.join(' | ')}`);
  }
});
