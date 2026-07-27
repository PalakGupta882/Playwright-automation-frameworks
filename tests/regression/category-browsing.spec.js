const { test, expect } = require('../fixtures/pageFixtures');
const { BASE_URL } = require('../data/constants');

const categories = [
  'mobile', 'laptop', 'accessories', 'grooming',
  'wireless', 'audio', 'appliances', 'tablets', 'smartwatch',
];

for (const category of categories) {
  test(`category shows products: ${category}`, async ({ page }) => {
    test.setTimeout(45000);
    await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });

    for (let attempt = 0; attempt < 3; attempt++) {
      await page.keyboard.press('Escape').catch(() => {}); // close any modal/drawer first
      await page.getByRole('img', { name: category, exact: true }).first().click();
      const navigated = await page
        .waitForURL(/all-products\?category=/, { timeout: 8000 })
        .then(() => true)
        .catch(() => false);
      if (navigated) break;
    }

    await expect(page.locator('a[href*="/pd/"]').first()).toBeVisible({ timeout: 15000 });
  });
}