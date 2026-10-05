// Read-only. Does a fabricated order id render someone's order, or does the app
// just fall back to the orders list?
const { test } = require('@playwright/test');
test.setTimeout(180000);
const HOST = 'https://www.bytepe.com';

const FAKE = '00000000-0000-4000-8000-000000000000';

test('unknown order id', async ({ page }) => {
  const seen = [];
  page.on('response', (r) => {
    const u = r.url();
    if (/order/i.test(u) && !/\.(js|css|png|jpg|webp|svg)/i.test(u)) seen.push(`${r.status()} ${u}`);
  });

  await page.goto(`${HOST}/orders/my-orders/${FAKE}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);

  console.log('final URL:', page.url());
  console.log('--- order-ish responses ---');
  seen.forEach((s) => console.log('  ' + s));

  const body = (await page.locator('body').innerText()).replace(/\n{2,}/g, '\n');
  console.log('--- body ---');
  console.log(body.slice(0, 2000));
});

test('control: the orders list itself', async ({ page }) => {
  await page.goto(`${HOST}/orders/my-orders`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);
  console.log('final URL:', page.url());
  const body = (await page.locator('body').innerText()).replace(/\n{2,}/g, '\n');
  console.log('--- body ---');
  console.log(body.slice(0, 1200));
});
