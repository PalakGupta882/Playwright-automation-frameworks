// tests/scripts/probe-unpriced-add.spec.js
//
// DIAGNOSTIC. With variant-pricing blocked, what does clicking the cart icon do
// now? Logged in. Can add ONE real cart line if the add goes through.
const { test } = require('@playwright/test');
const { clickAddToCart, addToCartControl } = require('../utils/buyRow');

test.describe.configure({ retries: 0 });
const HOST = 'https://www.bytepe.com';

test('cart icon on an unpriced upfront PDP', async ({ page }) => {
  test.setTimeout(120000);
  const seen = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith('/api/') && r.method() !== 'GET') seen.push(`${r.method()} ${u.pathname}`);
  });
  await page.route('**/api/apps/variant-pricing/**', (r) => r.abort('failed'));
  await page.goto(`${HOST}/pd/jbl-flip-7/JBLAUAUD10QE32`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Buy Now', exact: true }).waitFor({ timeout: 30000 });
  await page.waitForTimeout(4000);
  const icon = addToCartControl(page);
  console.log(`cart icon count=${await icon.count()} enabled=${await icon.first().isEnabled()} ` +
    `Buy Now enabled=${await page.getByRole('button', { name: 'Buy Now', exact: true }).isEnabled()}`);
  await clickAddToCart(page).catch((e) => console.log(`clickAddToCart threw: ${e.message.split('\n')[0]}`));
  await page.waitForTimeout(4000);
  const toasts = await page.locator('[role=alert], .MuiSnackbar-root, .Toastify, [class*=toast]').allInnerTexts();
  console.log(`non-GET api calls after click: ${seen.join(', ') || 'none'}`);
  console.log(`toasts: ${JSON.stringify(toasts)}  url now: ${page.url().replace(HOST, '')}`);
  await page.screenshot({ path: 'test-results/unpriced-add.png' });
});
