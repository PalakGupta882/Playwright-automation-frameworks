// tests/scripts/har-pdp.spec.js
//
// HAR capture, Journey 1: a product page, logged out, fully loaded.
// Output: tests/data/har/pdp-logged-out.har (gitignored) and .md (masked summary).
//
// Read-only. Nothing is clicked.
//
//   npx playwright test scripts/har-pdp.spec.js --project=chromium --retries=0

const { test, expect } = require('../fixtures/pageFixtures');
const { BASE_URL, TIMEOUTS } = require('../data/constants');
const { buyNowControl } = require('../utils/buyRow');
const { harPathFor, waitForApiQuiet, summarizeHar } = require('../utils/harCapture');

// From tests/data/product-slugs.csv: UPFRONT, not pre-booking.
const PRODUCT = { slug: 'galaxy-m47-5g', bpid: 'SAMSAMOBW4IQZM' };
const HAR_NAME = 'pdp-logged-out';

test.describe.configure({ retries: 0 });

test('PDP logged out: record every API call to a HAR', async ({ browser }) => {
  test.setTimeout(120000);
  const harFile = harPathFor(HAR_NAME);

  // A context of our own rather than the `page` fixture: recordHar is a
  // context option and the HAR is only written when the context closes. No
  // storageState, so this is logged out whatever auth.json holds.
  const context = await browser.newContext({
    storageState: undefined,
    recordHar: { path: harFile, content: 'embed' },
  });
  const page = await context.newPage();
  const url = `${BASE_URL}/pd/${PRODUCT.slug}/${PRODUCT.bpid}`;
  let complete = false;

  try {
    const priced = page
      .waitForResponse((r) => r.url().includes(`/variant-pricing/${PRODUCT.slug}/`), {
        timeout: TIMEOUTS.nav * 2,
      })
      .catch(() => null);

    await page.goto(url, { waitUntil: 'load' });

    // Buy Now, not the cart icon: it is the product's own CTA and carousel
    // tiles have none, so its presence means THIS product's buy row rendered.
    await expect(buyNowControl(page)).toBeVisible({ timeout: TIMEOUTS.nav * 2 });
    expect(await priced, 'variant-pricing never answered').not.toBeNull();

    // "Fully loaded": nothing in flight on /api/ for 4s after the page is priced.
    await waitForApiQuiet(page);
    complete = true;
  } finally {
    await context.close();
    const { mdFile, calls } = summarizeHar(harFile, {
      title: `Journey 1 — PDP, logged out (${PRODUCT.slug}/${PRODUCT.bpid})`,
      notes: [`Page: \`${url}\``, 'Page loaded and left until /api/ was quiet for 4s. No scrolling or clicks.'],
      complete,
    });
    console.log(`${calls} /api/ calls -> ${mdFile}`);
  }
});
