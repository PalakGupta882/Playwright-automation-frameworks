const { test, expect } = require('../fixtures/pageFixtures');
const { BASE_URL } = require('../data/constants');

// Logged out on purpose — see the note in pincode-valid.spec.js. With a stale
// auth.json the PDP renders no pincode widget at all, so this spec's result
// depended on session freshness rather than on serviceability.
test.use({ storageState: { cookies: [], origins: [] } });

test('invalid pincode shows "delivery not available" error', async ({ page, productPage }) => {
  test.setTimeout(60000);

  await page.goto(`${BASE_URL}/pd/phone-4b/NOTSMMOBK25WT5`, { waitUntil: 'domcontentloaded' });
  await page.keyboard.press('Escape').catch(() => {});

  await productPage.checkPincode('206588'); // un-serviceable pincode

  await expect(page.getByText(/Delivery is not available on this pincode/i))
    .toBeVisible({ timeout: 15000 });
});