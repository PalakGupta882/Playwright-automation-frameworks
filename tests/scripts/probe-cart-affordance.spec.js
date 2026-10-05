// Is there ANY add-to-cart affordance on the PDP — text button or icon?
const { test, request } = require('@playwright/test');
test.setTimeout(400000);
const HOST = 'https://www.bytepe.com';
test.use({ storageState: { cookies: [], origins: [] } });

test('add-to-cart affordance across the catalogue', async ({ page }) => {
  const api = await request.newContext({ baseURL: HOST });
  const picked = [];
  for (const p of [1, 4, 8]) {
    const r = await api.get(`/api/product-service/apps/products?page=${p}&limit=12`);
    if (!r.ok()) continue;
    const rows = ((await r.json()).data?.items || []).filter((x) => !(x.variant?.tags || []).length);
    picked.push(...rows.slice(0, 2));
  }
  await api.dispose();

  for (const row of picked) {
    await page.goto(`${HOST}/pd/${row.slug}/${row.variant.bpid}`, { waitUntil: 'domcontentloaded' });
    const buy = page.getByRole('button', { name: 'Buy Now', exact: true }).first();
    const ok = await buy.waitFor({ state: 'visible', timeout: 40000 }).then(() => true).catch(() => false);
    if (!ok) {
      console.log(`${row.name.slice(0, 34).padEnd(36)} mode=${String(row.prodPaymentMode).padEnd(11)} NO Buy Now`);
      continue;
    }
    await page.waitForTimeout(1500);

    const res = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const buy = btns.find((b) => b.innerText.trim() === 'Buy Now');
      if (!buy) return null;
      // the buy row container: walk up to the grid item holding it
      let row = buy.parentElement;
      for (let i = 0; i < 2 && row.parentElement; i++) row = row.parentElement;
      const clickables = Array.from(row.querySelectorAll('button,[role="button"],a')).map((c) => ({
        text: (c.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 24),
        svg: c.querySelectorAll('svg').length,
        cls: String(c.className).slice(0, 40),
      }));
      const cartIcon = row.querySelector('svg[class*="Cart"], svg[data-testid*="Cart"]');
      return { clickables, cartIconInRow: Boolean(cartIcon) };
    });

    const iconish = (res?.clickables || []).filter((c) => !c.text && c.svg > 0).length;
    console.log(
      `${row.name.slice(0, 34).padEnd(36)} mode=${String(row.prodPaymentMode).padEnd(11)} ` +
        `rowControls=[${(res?.clickables || []).map((c) => c.text || `<icon svg:${c.svg}>`).join(', ')}] ` +
        `iconOnly=${iconish} cartSvgInRow=${res?.cartIconInRow}`
    );
  }
});
