const { test, request } = require('@playwright/test');
test.setTimeout(400000);
const HOST = 'https://www.bytepe.com';

test('is Add to Cart still on the PDP buy row', async ({ page }) => {
  const api = await request.newContext({ baseURL: HOST });
  const r = await api.get('/api/product-service/apps/products?page=3&limit=12');
  const rows = ((await r.json()).data?.items || []).filter((x) => !(x.variant?.tags || []).length);
  await api.dispose();

  for (const row of rows.slice(0, 6)) {
    await page.goto(`${HOST}/pd/${row.slug}/${row.variant.bpid}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Buy Now', exact: true })
      .first()
      .waitFor({ state: 'visible', timeout: 30000 })
      .catch(() => {});
    await page.waitForTimeout(2500);

    const counts = {};
    for (const n of ['Buy Now', 'Add to Cart', 'Subscribe', 'Go to Cart']) {
      counts[n] = await page.getByRole('button', { name: n, exact: true }).count();
    }
    // scroll to the recommended carousel and re-count
    await page.mouse.wheel(0, 6000);
    await page.waitForTimeout(2500);
    const afterScroll = await page.getByRole('button', { name: 'Add to Cart', exact: true }).count();

    console.log(
      `${row.name.slice(0, 38).padEnd(40)} mode=${String(row.prodPaymentMode).padEnd(12)} ` +
        `BuyNow=${counts['Buy Now']} AddToCart=${counts['Add to Cart']} ` +
        `Subscribe=${counts.Subscribe} | AddToCart after scroll=${afterScroll}`
    );
  }
});
