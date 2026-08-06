const { test, expect } = require('../fixtures/pageFixtures');
const { BASE_URL, TIMEOUTS } = require('../data/constants');

const categories = [
  'mobile', 'laptop', 'accessories', 'grooming',
  'wireless', 'audio', 'appliances', 'tablets', 'smartwatch',
];

for (const category of categories) {
  test(`category shows products: ${category}`, async ({ page, emiStorePage }) => {
    test.setTimeout(45000);
    await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });

    // Was an inline copy of emiStorePage.openCategory's retry loop, with two
    // defects the original does not have. The click carried no timeout, so
    // under the config's former actionTimeout of 0 an overlay-covered tile ate
    // the whole 45s budget and attempts 2 and 3 never ran — that is the
    // "grooming" flake. And the loop exited silently when it gave up, so a
    // genuinely broken tile fell through to the assertion below instead of
    // reporting itself.
    //
    // The page object retries with a timeout and throws whyStuck() naming the
    // cause. It uses the identical locator and does not goto() itself, so it
    // works unchanged from the homepage.
    await emiStorePage.openCategory(category);

    // Assert the URL moved before asserting a product link is visible. The
    // homepage renders 0 /pd/ links when logged out (measured), so the link
    // check is not vacuous on its own — but this makes it impossible for a
    // silent no-navigation to look like a pass.
    await expect(page).toHaveURL(/all-products\?category=/, { timeout: TIMEOUTS.nav });
    await expect(page.locator('a[href*="/pd/"]').first()).toBeVisible({ timeout: TIMEOUTS.nav });
  });
}