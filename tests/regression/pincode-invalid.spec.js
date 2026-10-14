const { test, expect } = require('../fixtures/pageFixtures');
const { pickProduct, pdpUrl } = require('../utils/catalogue');

// Logged out on purpose — see the note in pincode-valid.spec.js. With a stale
// auth.json the PDP renders no pincode widget at all, so this spec's result
// depended on session freshness rather than on serviceability.
test.use({ storageState: { cookies: [], origins: [] } });

const PINCODE = '206588'; // un-serviceable

test('invalid pincode shows "delivery not available" error', async ({ page, productPage }) => {
  test.setTimeout(60000);

  // An in-stock upfront product from the live listing, not the old hardcoded
  // /pd/phone-4b/NOTSMMOBK25WT5 — slug and bpid both drift (CLAUDE.md).
  const product = await pickProduct(page.request, { mode: 'UPFRONT' });
  expect(product, 'no in-stock, non-pre-booking UPFRONT product in the listing').toBeTruthy();

  await page.goto(pdpUrl(product), { waitUntil: 'domcontentloaded' });
  await page.keyboard.press('Escape').catch(() => {});

  // The server's own verdict first, so a missing error message is told apart
  // from a pincode that became serviceable. Measured:
  //   GET /api/pincodes/info/206588?product_id=<slug>&variant_id=<id> -> 404
  const answer = page.waitForResponse(
    (r) => r.url().includes(`/pincodes/info/${PINCODE}`) && r.url().includes(`product_id=${product.slug}`),
    { timeout: 15000 }
  );
  await productPage.checkPincode(PINCODE);
  const res = await answer;
  expect(res.status(), `${PINCODE} is now serviceable for ${product.slug} — pick another un-serviceable pincode`).toBe(404);

  await expect(page.getByText(/Delivery is not available on this pincode/i))
    .toBeVisible({ timeout: 15000 });
});
