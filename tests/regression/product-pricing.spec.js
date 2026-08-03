const { test, expect } = require('../fixtures/pageFixtures');
const { BASE_URL } = require('../data/constants');

// Turn "₹32,299" into 32299 so we can compare numbers
function toNumber(text) {
  return Number(text.replace(/[^0-9]/g, ''));
}

test('product discounted price is lower than original price', async ({ page }) => {
  test.setTimeout(60000);

  await page.goto(`${BASE_URL}/pd/phone-4b/NOTSMMOBK25WT5`, { waitUntil: 'domcontentloaded' });
  await page.keyboard.press('Escape').catch(() => {});

  // Match "price-shaped" text like ₹32,299 — NOT the "/mo" plan prices
  const prices = page.getByText(/^₹[\d,]+$/);

  const discounted = toNumber(await prices.nth(0).innerText()); // first price = current
  const original   = toNumber(await prices.nth(1).innerText()); // second = original (struck-through)

  console.log('Discounted:', discounted, ' Original:', original);

  // The functional checks:
  expect(discounted).toBeLessThan(original);                 // discount actually reduces the price
  expect(discounted).toBeGreaterThan(0);                     // price isn't zero/broken
  await expect(page.getByText(/% off/i).first()).toBeVisible(); // discount badge is shown
});