const { test } = require('@playwright/test');
test.setTimeout(300000);
const HOST = 'https://www.bytepe.com';
test.use({ storageState: { cookies: [], origins: [] } });

const PRODUCTS = [
  ['phone-4b', 'NOTSMMOBK25WT5'],
  ['smash-heat-tennis-racquet-or-290g-or-100-sq-in-or-g3-4-38-or-strung', 'YXXSPTRXGORJ1R'],
  ['watch-ultra-4', 'APPSMSMA5WNTNY'], // pre-booking: expect NO cart control
];

for (const [slug, bpid] of PRODUCTS) {
  test(`cart control name on ${slug}`, async ({ page }) => {
    await page.goto(`${HOST}/pd/${slug}/${bpid}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /buy now|pre-?book now/i }).first()
      .waitFor({ state: 'visible', timeout: 45000 }).catch(() => console.log('  no buy control'));
    await page.waitForTimeout(2000);

    const cart = page.getByRole('button', { name: /cart/i });
    const n = await cart.count();
    console.log(`${slug}: role=button name=/cart/i -> ${n}`);
    for (let i = 0; i < n; i++) {
      const el = cart.nth(i);
      const r = await el.boundingBox();
      const details = await el.evaluate((b) => ({
        aria: b.getAttribute('aria-label'),
        text: (b.innerText || '').trim(),
        svgTestId: b.querySelector('svg') && b.querySelector('svg').getAttribute('data-testid'),
        inHeader: Boolean(b.closest('header')),
      }));
      console.log(`  [${i}] ${JSON.stringify(details)} rect=${r ? `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}` : 'null'}`);
    }

    // The PDP one specifically: exclude the header's Cart control.
    const pdpCart = page.locator('button:has(svg[data-testid="ShoppingCartOutlinedIcon"])').filter({ visibleOnly: undefined });
    console.log(`  :has(svg[data-testid=ShoppingCartOutlinedIcon]) -> ${await page.locator('button:has(svg[data-testid="ShoppingCartOutlinedIcon"])').count()}`);
    void pdpCart;
  });
}
