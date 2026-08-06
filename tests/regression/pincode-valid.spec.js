const { test, expect } = require('../fixtures/pageFixtures');
const { BASE_URL } = require('../data/constants');

// Runs logged out, like pincode-based-pricing and cardless-emi. Serviceability
// is product configuration — the same for everyone — so the session adds
// nothing except a way to fail.
//
// It was failing in exactly that way: with a stale auth.json the PDP renders NO
// pincode widget at all (measured: 0 "Enter Pincode" textboxes, 0 "Check"
// buttons), while a clean logged-out context renders both. So this spec's
// result depended on how long ago someone last ran npm run auth.
test.use({ storageState: { cookies: [], origins: [] } });

test('valid pincode does not show the "not available" error', async ({ page, productPage }) => {
  test.setTimeout(60000);

  await page.goto(`${BASE_URL}/pd/phone-4b/NOTSMMOBK25WT5`, { waitUntil: 'domcontentloaded' });
  await page.keyboard.press('Escape').catch(() => {});

  await productPage.checkPincode('201309'); // a serviceable pincode

  // Valid pincode → the "not available" error must NOT be shown
  await expect(page.getByText(/Delivery is not available on this pincode/i))
    .toBeHidden({ timeout: 15000 });
});