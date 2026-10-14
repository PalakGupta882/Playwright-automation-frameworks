// DECISIVE TEST for the refresh-token 401.
//
// Run this within a minute or two of `npm run auth`, while auth.json is fresh.
//
// It drops ONLY the access_token from a freshly-saved session, keeps the
// refresh_token, and loads an authenticated route. That is exactly the state a
// shopper is in 15 minutes after logging in.
//
//   refresh-tokens 200  -> the exchange works; the earlier 401 was a STALE
//                          (already-rotated) token in auth.json, i.e. a
//                          storageState limitation, not a site bug.
//   refresh-tokens 401  -> the server rejects a valid, unexpired refresh_token.
//                          Real defect: every logged-in shopper is silently
//                          logged out 15 minutes after login.
const { test, expect } = require('@playwright/test');
const fs = require('fs');

test.setTimeout(180000);
const SITE = 'https://www.bytepe.com';

test('a fresh refresh_token without an access_token', async ({ browser }) => {
  const saved = JSON.parse(fs.readFileSync('auth.json', 'utf8'));
  const access = (saved.cookies || []).find((c) => c.name === 'access_token');
  const refresh = (saved.cookies || []).find((c) => c.name === 'refresh_token');
  const now = Date.now() / 1000;

  console.log(`auth.json access_token : ${access ? `${Math.round((access.expires - now) / 60)} min left` : 'ABSENT'}`);
  console.log(`auth.json refresh_token: ${refresh ? `${Math.round((refresh.expires - now) / 60)} min left` : 'ABSENT'}`);
  expect(access, 'auth.json has no access_token — re-run npm run auth first').toBeTruthy();
  expect(
    access.expires - now,
    'auth.json is already stale; re-run npm run auth and run this immediately'
  ).toBeGreaterThan(60);

  // Same session, minus the access_token.
  const state = { ...saved, cookies: saved.cookies.filter((c) => c.name !== 'access_token') };
  const context = await browser.newContext({ storageState: state });
  const page = await context.newPage();

  const calls = [];
  page.on('response', (r) => {
    if (/auth|refresh|token/i.test(r.url()) && !/\.(js|css|png|svg|woff)/i.test(r.url())) {
      calls.push(`${r.status()} ${r.request().method()} ${r.url()}`);
    }
  });

  await page.goto(`${SITE}/my-profile`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(12000);

  console.log('--- auth calls ---');
  calls.forEach((c) => console.log('  ' + c));
  if (!calls.length) console.log('  (none)');

  const after = (await context.cookies(SITE)).find((c) => c.name === 'access_token');
  console.log(`access_token after: ${after ? `RESTORED, ${Math.round((after.expires - Date.now() / 1000) / 60)} min left` : 'STILL ABSENT'}`);
  console.log('final URL:', page.url());

  const refreshCall = calls.find((c) => /refresh-tokens/.test(c));
  console.log('\nVERDICT:');
  if (!refreshCall) console.log('  the client never attempted a refresh — inconclusive');
  else if (/^200/.test(refreshCall)) console.log('  WORKS — the earlier 401 was a stale/rotated token in auth.json');
  else console.log(`  BROKEN — a fresh, unexpired refresh_token was rejected (${refreshCall})`);

  await context.close();
});
