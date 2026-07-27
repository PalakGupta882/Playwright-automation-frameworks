const { test, expect } = require('../fixtures/pageFixtures');
const { BASE_URL } = require('../data/constants');

test('valid pincode does not show the "not available" error', async ({ page, productPage }) => {
  test.setTimeout(60000);

  await page.goto(`${BASE_URL}/pd/phone-4b/NOTSMMOBK25WT5`, { waitUntil: 'domcontentloaded' });
  await page.keyboard.press('Escape').catch(() => {});

  await productPage.checkPincode('201309'); // a serviceable pincode

  // Valid pincode → the "not available" error must NOT be shown
  await expect(page.getByText(/Delivery is not available on this pincode/i))
    .toBeHidden({ timeout: 15000 });
});