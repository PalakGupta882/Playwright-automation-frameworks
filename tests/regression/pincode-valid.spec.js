const { test, expect } = require('../fixtures/pageFixtures');
const { pickProduct, pdpUrl } = require('../utils/catalogue');

// Runs logged out, like pincode-based-pricing and cardless-emi. Serviceability
// is product configuration — the same for everyone — so the session adds
// nothing except a way to fail.
//
// It was failing in exactly that way: with a stale auth.json the PDP renders NO
// pincode widget at all (measured: 0 "Enter Pincode" textboxes, 0 "Check"
// buttons), while a clean logged-out context renders both. So this spec's
// result depended on how long ago someone last ran npm run auth.
test.use({ storageState: { cookies: [], origins: [] } });

const PINCODE = '201309'; // serviceable — Noida, 5-7 day delivery on 5 Oct 2026

test('valid pincode does not show the "not available" error', async ({ page, productPage }) => {
  test.setTimeout(60000);

  // An in-stock upfront product from the live listing, not the old hardcoded
  // /pd/phone-4b/NOTSMMOBK25WT5 — slug and bpid both drift (CLAUDE.md).
  const product = await pickProduct(page.request, { mode: 'UPFRONT' });
  expect(product, 'no in-stock, non-pre-booking UPFRONT product in the listing').toBeTruthy();

  await page.goto(pdpUrl(product), { waitUntil: 'domcontentloaded' });
  await page.keyboard.press('Escape').catch(() => {});

  // The serviceability answer, for THIS pincode on THIS product. Measured:
  //   GET /api/pincodes/info/201309?product_id=<slug>&variant_id=<id> -> 200
  // Without waiting on it, toBeHidden() below passes the instant it is called —
  // before Check has even been answered — so it proved nothing.
  const answer = page.waitForResponse(
    (r) => r.url().includes(`/pincodes/info/${PINCODE}`) && r.url().includes(`product_id=${product.slug}`),
    { timeout: 15000 }
  );
  await productPage.checkPincode(PINCODE);
  const res = await answer;
  expect(res.status(), `${PINCODE} is no longer serviceable for ${product.slug}`).toBe(200);
  expect((await res.json()).status).toBe(true);

  // Valid pincode → the "not available" error must NOT be shown
  await expect(page.getByText(/Delivery is not available on this pincode/i))
    .toBeHidden({ timeout: 15000 });
});
