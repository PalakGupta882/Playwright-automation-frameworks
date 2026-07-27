const { test, expect } = require('../fixtures/pageFixtures');
const { BASE_URL } = require('../data/constants');

test('invalid pincode shows "delivery not available" error', async ({ page, productPage }) => {
  test.setTimeout(60000);

  await page.goto(`${BASE_URL}/pd/phone-4b/NOTSMMOBK25WT5`, { waitUntil: 'domcontentloaded' });
  await page.keyboard.press('Escape').catch(() => {});

  await productPage.checkPincode('206588'); // un-serviceable pincode

  await expect(page.getByText(/Delivery is not available on this pincode/i))
    .toBeVisible({ timeout: 15000 });
});