// Does the app exchange a valid refresh_token for a new access_token when an
// authenticated route is loaded? auth-setup.spec.js assumes it does.
const { test } = require('@playwright/test');
test.setTimeout(180000);
const SITE = 'https://www.bytepe.com';

test('refresh_token exchange on /my-profile', async ({ page, context }) => {
  const before = (await context.cookies(SITE)).find((c) => c.name === 'access_token');
  const refresh = (await context.cookies(SITE)).find((c) => c.name === 'refresh_token');
  const now = Date.now() / 1000;
  console.log(`access_token  before: ${before ? `expires in ${Math.round((before.expires - now) / 60)} min` : 'ABSENT'}`);
  console.log(`refresh_token before: ${refresh ? `expires in ${Math.round((refresh.expires - now) / 60)} min` : 'ABSENT'}`);

  const calls = [];
  page.on('response', (r) => {
    if (/auth|token|refresh/i.test(r.url()) && !/\.(js|css|png|svg|woff)/i.test(r.url())) {
      calls.push(`${r.status()} ${r.request().method()} ${r.url()}`);
    }
  });

  await page.goto(`${SITE}/my-profile`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(12000);

  console.log('--- auth/token calls observed ---');
  calls.forEach((c) => console.log('  ' + c));
  if (!calls.length) console.log('  (none)');

  const after = (await context.cookies(SITE)).find((c) => c.name === 'access_token');
  console.log(`access_token  after : ${after ? `expires in ${Math.round((after.expires - Date.now() / 1000) / 60)} min` : 'ABSENT'}`);
  console.log('final URL:', page.url());
  const body = await page.locator('body').innerText();
  console.log('page shows My Profile content:', /profile|my orders|logout/i.test(body));
});
