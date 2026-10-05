// Does the PDP add-to-cart icon track prodPaymentMode?
const { test, request } = require('@playwright/test');
test.setTimeout(600000);
const HOST = 'https://www.bytepe.com';
test.use({ storageState: { cookies: [], origins: [] } });

test('add-to-cart icon vs prodPaymentMode', async ({ page }) => {
  const api = await request.newContext({ baseURL: HOST });
  const rows = [];
  for (let p = 1; p <= 30; p++) {
    const r = await api.get(`/api/product-service/apps/products?page=${p}&limit=12`);
    if (!r.ok()) break;
    const arr = (await r.json()).data?.items || [];
    if (!arr.length) break;
    rows.push(...arr);
  }
  await api.dispose();

  const preBook = (r) => (r.variant?.tags || []).some((t) => /pre-?book/i.test(t.name));
  const both = rows.filter((r) => r.prodPaymentMode === 'BOTH' && !preBook(r)).slice(0, 4);
  const upfront = rows.filter((r) => r.prodPaymentMode === 'UPFRONT' && !preBook(r)).slice(0, 4);
  const pre = rows.filter(preBook).slice(0, 2);

  for (const row of [...both, ...upfront, ...pre]) {
    await page.goto(`${HOST}/pd/${row.slug}/${row.variant.bpid}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /buy now|pre-?book now/i }).first()
      .waitFor({ state: 'visible', timeout: 40000 }).catch(() => {});
    await page.waitForTimeout(1500);

    const addToCart = await page.getByRole('button', { name: 'Add to cart', exact: true }).count();
    const buyNow = await page.getByRole('button', { name: 'Buy Now', exact: true }).count();
    const preBookNow = await page.getByRole('button', { name: /pre-?book now/i }).count();

    console.log(
      `${String(row.prodPaymentMode).padEnd(8)} ${preBook(row) ? 'PREBOOK ' : '        '}` +
        `addToCart=${addToCart} buyNow=${buyNow} preBook=${preBookNow}  ${row.name.slice(0, 40)}`
    );
  }
});
