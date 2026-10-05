const { test, expect } = require('../fixtures/pageFixtures');
const { fetchListingRows, isPreBooking, pdpUrl } = require('../utils/catalogue');

// Product configuration, and in the CI list — logged out explicitly. An expired
// auth.json opens the modal login Drawer by itself on some loads (CLAUDE.md, Login).
test.use({ storageState: { cookies: [], origins: [] } });

// Turn "₹32,299" into 32299 so we can compare numbers
function toNumber(text) {
  return Number(text.replace(/[^0-9]/g, ''));
}

// A discounted product from the live listing, not a hardcoded /pd/ URL. The old
// phone-4b/NOTSMMOBK25WT5 was not the master variant, and both slug and bpid
// drift (CLAUDE.md). Pre-booking excluded: its buy row quotes ₹99, not a price.
async function pickDiscounted(request) {
  const rows = await fetchListingRows(request);
  return rows.find((r) => !isPreBooking(r) && r.price && r.price.mop > 0 && r.price.mrp > r.price.mop) || null;
}

test('product discounted price is lower than original price', async ({ page, request }) => {
  test.setTimeout(60000);

  const product = await pickDiscounted(request);
  expect(product, 'no discounted, non-pre-booking product in the listing').toBeTruthy();
  console.log(`product: ${product.name} (${product.slug}/${product.variant.bpid}), ` +
    `listing mop ₹${product.price.mop} mrp ₹${product.price.mrp}`);

  await page.goto(pdpUrl(product), { waitUntil: 'domcontentloaded' });
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