const { test, expect } = require('../fixtures/pageFixtures');
const { BASE_URL } = require('../data/constants');
const { assertFreshSession } = require('../utils/session');

// The profile page only exists for a logged-in user
test.beforeAll(() => assertFreshSession());

test('My Profile page loads for a logged-in user', async ({ page }) => {
  test.setTimeout(60000);

  await page.goto(`${BASE_URL}/my-profile`, { waitUntil: 'domcontentloaded' });
  await page.keyboard.press('Escape').catch(() => {});

  await expect(page).toHaveURL(/\/my-profile/, { timeout: 15000 });
  await expect(page.getByRole('heading', { name: 'My Profile' })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText('Logout', { exact: true }).first()).toBeVisible();
});

test('My Orders opens from the profile page', async ({ page }) => {
  test.setTimeout(60000);

  await page.goto(`${BASE_URL}/my-profile`, { waitUntil: 'domcontentloaded' });
  await page.keyboard.press('Escape').catch(() => {});

  // Click the "My Orders" row on the profile page
  await page.getByText('My Orders', { exact: true }).first().click();

  // Should navigate to an orders page
  await expect(page).toHaveURL(/order/i, { timeout: 15000 });
});