// CLAUDE.md: getByRole('button',{name:'Add to Cart'}).first() once reached the
// recommended-products carousel and added a ₹1,24,999 phone. Does the NEW
// icon-only control ("Add to cart") have the same hazard?
const { test } = require('@playwright/test');
test.setTimeout(300000);
const HOST = 'https://www.bytepe.com';
test.use({ storageState: { cookies: [], origins: [] } });

const SLUG = 'smash-heat-tennis-racquet-or-290g-or-100-sq-in-or-g3-4-38-or-strung';
const BPID = 'YXXSPTRXGORJ1R';

test('is the add-to-cart name unique once the carousel has rendered', async ({ page }) => {
  await page.goto(`${HOST}/pd/${SLUG}/${BPID}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Buy Now', exact: true }).first().waitFor({ state: 'visible', timeout: 45000 });

  const count = async (label) => {
    const exact = await page.getByRole('button', { name: 'Add to cart', exact: true }).count();
    const loose = await page.getByRole('button', { name: /add to cart/i }).count();
    const pdLinks = await page.locator('a[href*="/pd/"]').count();
    console.log(`  [${label}] exact="Add to cart"=${exact} loose=/add to cart/i=${loose} | /pd/ links on page=${pdLinks}`);
  };

  await count('before scroll');
  // Drive to the bottom so the recommended carousel mounts.
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, 2500);
    await page.waitForTimeout(1200);
  }
  await page.waitForTimeout(2500);
  await count('after scrolling to the carousel');

  // Where does each match live?
  const where = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button'))
      .filter((b) => (b.getAttribute('aria-label') || '').toLowerCase() === 'add to cart')
      .map((b) => {
        const r = b.getBoundingClientRect();
        const card = b.closest('a[href*="/pd/"]');
        return {
          rect: `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`,
          insideProductCard: Boolean(card),
          cardHref: card ? card.getAttribute('href') : null,
        };
      })
  );
  console.log('  matches:', JSON.stringify(where, null, 1));
});
