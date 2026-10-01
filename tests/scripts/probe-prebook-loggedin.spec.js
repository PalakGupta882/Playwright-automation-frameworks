// Read-only. Does NOT press Pre-book Now (that would mint a real ₹99 order).
const { test } = require('@playwright/test');
test.setTimeout(240000);
const HOST = 'https://www.bytepe.com';
const P = { slug: 'watch-ultra-4', bpid: 'APPSMSMA5WNTNY' };

test('prebooking PDP, logged in', async ({ page }) => {
  await page.goto(`${HOST}/pd/${P.slug}/${P.bpid}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(7000);

  const btns = page.getByRole('button').filter({ visible: true });
  const n = await btns.count();
  const names = [];
  for (let i = 0; i < n; i++) {
    const b = btns.nth(i);
    const t = (await b.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    if (t && !/^\d+$/.test(t)) names.push(`${t}${(await b.isEnabled()) ? '' : ' [DISABLED]'}`);
  }
  console.log('BUTTONS:', JSON.stringify(names));

  const txt = (await page.locator('body').innerText()).replace(/\n{2,}/g, '\n');
  console.log('logged in?', txt.includes('My Profile') || !txt.includes('Login'));
  for (const probe of ['Add to Cart', 'Buy Now', 'Pre-book Now', 'Already pre-booked', 'Sign in to buy', 'Pre-booking Price', 'Sold Out', 'Subscribe']) {
    console.log(`  "${probe}": ${txt.includes(probe)}`);
  }
  const i = txt.search(/Pre-booking Price|Pre-book Now/);
  console.log('--- around the buy row ---');
  console.log(txt.slice(Math.max(0, i - 500), i + 300));
});
