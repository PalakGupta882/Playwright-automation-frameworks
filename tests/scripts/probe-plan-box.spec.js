// tests/scripts/probe-plan-box.spec.js
//
// DIAGNOSTIC. pricing-consistency reported pixel-11-pro-fold "offers no Buy
// Upfront price". CLAUDE.md records Pay in Full / Buy Upfront as present on
// every product, so either the plan is genuinely missing or the copy moved.
// Print the plan box as the shopper sees it, for a subscription product and an
// upfront one.
const { test } = require('@playwright/test');

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ mode: 'serial', retries: 0 });

const PRODUCTS = ['pixel-11-pro-fold', 'iphone-17', 'galaxy-z-fold8-5g'];

for (const slug of PRODUCTS) {
  test(`plan box copy on ${slug}`, async ({ page, request }) => {
    test.setTimeout(90000);

    // The listing is the only reliable source of a current bpid.
    const res = await request.get(
      `https://www.bytepe.com/api/product-service/apps/products?page=1&limit=100`
    );
    const items = (await res.json()).data.items;
    const hit = items.find((p) => p.slug === slug);
    if (!hit) {
      console.log(`${slug}: not on page 1 of the live listing`);
      return;
    }

    await page.goto(`https://www.bytepe.com/pd/${slug}/${hit.variant.bpid}`, {
      waitUntil: 'domcontentloaded',
    });
    await page.getByText(/choose your plan/i).first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(3000);

    const text = await page.locator('body').innerText();
    const start = text.search(/choose your plan/i);
    const box = text.slice(start, start + 900);
    console.log(`\n=== ${slug} (${hit.variant.bpid}) ===\n${box}\n--- end ---`);
    console.log(
      `contains "Buy Upfront": ${/buy upfront/i.test(text)} · "Pay in Full": ${/pay in full/i.test(text)}`
    );
  });
}
