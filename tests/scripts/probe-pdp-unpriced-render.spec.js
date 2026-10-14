// tests/scripts/probe-pdp-unpriced-render.spec.js
//
// Diagnostic probe, not a regression test.
//
// 27 Aug 2026, pricing-consistency.spec.js failed twice in one session with
// openPdp() timing out waiting for a headline price. The failure LOOKED like
// contention. The saved page snapshot said otherwise — the PDP had fully
// rendered, and rendered this:
//
//   heading   "mokobaraAstrid Tote"
//   paragraph (empty)              <- where the price goes
//   paragraph "EMI From /mo"       <- amount missing
//   paragraph "Low Cost EMI"
//   paragraph "Rs.0 x undefinedmo" <- literal `undefined` shown to the shopper
//   button    "Add to Cart"        (enabled)
//   button    "Buy Now"            (enabled)
//
// The same product priced correctly earlier in the same run (tile 5999 = PDP
// 5999 = API 5999), so this is an intermittent unpriced render, not a product
// that has no price.
//
// This measures how often it happens and whether the pricing call is what
// failed underneath, so the bug can be reported as a rate and a cause rather
// than as "a test timed out".
const { test } = require('@playwright/test');
const { BASE_URL } = require('../data/constants');

test.use({ storageState: { cookies: [], origins: [] } });

const SUBJECT = {
  slug: 'the-astrid-tote-bag-for-women-or-premium-vegan-leather-office-handbag',
  bpid: 'MOKLULUGJKYIK5',
};
const LOADS = 12;

test('how often does a PDP render without its price', async ({ page }) => {
  test.setTimeout(600000);

  // Watch the two calls the price comes from, so a bad render can be tied to a
  // failed request rather than guessed at.
  const calls = [];
  page.on('response', (res) => {
    const url = res.url();
    if (/variant-pricing|products\/by-slug/.test(url)) {
      calls.push({ status: res.status(), url: url.replace(BASE_URL, '') });
    }
  });

  let unpriced = 0;
  for (let i = 1; i <= LOADS; i++) {
    calls.length = 0;
    await page.goto(`${BASE_URL}/pd/${SUBJECT.slug}/${SUBJECT.bpid}`, {
      waitUntil: 'domcontentloaded',
    });
    await page.keyboard.press('Escape').catch(() => {});

    // Give the client its pricing round trip. Deliberately generous: the point
    // is what the page settles on, not how fast it gets there.
    const priced = await page
      .getByText(/^₹[\d,]+$/)
      .first()
      .waitFor({ state: 'visible', timeout: 20000 })
      .then(() => true)
      .catch(() => false);

    const body = await page.locator('body').innerText().catch(() => '');
    const hasUndefined = /undefined/i.test(body);
    const zeroTimesUndefined = /₹0\s*x\s*undefined/i.test(body);
    const buyEnabled = await page
      .getByRole('button', { name: /^buy now$/i })
      .first()
      .isEnabled()
      .catch(() => null);

    if (!priced) unpriced++;
    console.log(
      `load ${String(i).padStart(2)}: priced=${priced} undefinedInBody=${hasUndefined} ` +
        `"Rs.0 x undefined"=${zeroTimesUndefined} buyNowEnabled=${buyEnabled} ` +
        `pricingCalls=[${calls.map((c) => c.status).join(',')}]`
    );
    if (!priced) {
      console.log(`  non-200 pricing calls: ${
        calls.filter((c) => c.status !== 200).map((c) => `${c.status} ${c.url}`).join(' | ') || 'none — every call returned 200'
      }`);
    }
  }

  console.log(`\n${unpriced} of ${LOADS} loads rendered no headline price.`);
});

// The probe above shows 0 of 12 on a quiet origin, so the unpriced render is
// not spontaneous — it needs the pricing call to fail. These force that
// directly, which takes contention out of the picture entirely and answers the
// question the bug report actually turns on: when variant-pricing does not
// answer, what does the PDP show, and can the shopper still buy?
const FAILURES = [
  { name: '429 Too Many Requests', fulfil: { status: 429, body: '{"status":false,"message":"Too many requests"}' } },
  { name: '500 Internal Server Error', fulfil: { status: 500, body: '{"status":false,"message":"boom"}' } },
  { name: 'network abort', abort: true },
  { name: '200 with an empty data object', fulfil: { status: 200, body: '{"status":true,"message":"ok","data":{}}' } },
];

for (const failure of FAILURES) {
  test(`PDP with variant-pricing failing: ${failure.name}`, async ({ page }) => {
    test.setTimeout(120000);

    await page.route('**/apps/variant-pricing/**', async (route) => {
      if (failure.abort) return route.abort('failed');
      return route.fulfil
        ? route.fulfill({ ...failure.fulfil, contentType: 'application/json' })
        : route.fulfill({ ...failure.fulfil, contentType: 'application/json' });
    });

    await page.goto(`${BASE_URL}/pd/${SUBJECT.slug}/${SUBJECT.bpid}`, {
      waitUntil: 'domcontentloaded',
    });
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(6000);

    const body = await page.locator('body').innerText().catch(() => '');
    const priceShown = /₹[\d,]+/.test(body);
    const undefinedShown = /undefined/i.test(body);
    const nanShown = /NaN/.test(body);
    const buyNow = page.getByRole('button', { name: /^buy now$/i }).first();
    const addToCart = page.getByRole('button', { name: /^add to cart$/i }).first();

    console.log(
      `${failure.name}\n` +
        `  any Rs. figure rendered : ${priceShown}\n` +
        `  "undefined" in the page : ${undefinedShown}\n` +
        `  "NaN" in the page       : ${nanShown}\n` +
        `  Buy Now visible/enabled : ${await buyNow.isVisible().catch(() => false)}/${await buyNow.isEnabled().catch(() => null)}\n` +
        `  Add to Cart vis/enabled : ${await addToCart.isVisible().catch(() => false)}/${await addToCart.isEnabled().catch(() => null)}`
    );

    // Print the plan box copy verbatim — that is where the bad string appeared.
    const planLines = body
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => /undefined|NaN|EMI|Choose your plan|₹|Pay in Full/i.test(l))
      .slice(0, 16);
    console.log('  plan box copy:\n' + planLines.map((l) => `    ${l}`).join('\n'));
  });
}
