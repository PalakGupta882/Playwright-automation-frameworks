// tests/scripts/probe-review-continue.spec.js
//
// WHY CONTINUE ON REVIEW ORDER DOES NOTHING ON THE UPFRONT BASKET.
//
// Measured 1 Sep 2026. With BYTEPE_ALLOW_WRITES=1, both upfront Payment Summary
// tests pressed Continue on Review Order and then sat on Review Order until
// their 90s waitForURL expired:
//
//   device-protection-consistency  "...survive Review Order -> Payment Summary"
//   pricing-checkout-consistency   "payment summary asks for exactly what Review
//                                   Order quoted"
//
// The click itself succeeded — neither failed with a click timeout — and the
// screenshot shows the page still on Review Order with the progress bar reading
// Cart done, Review done, Payment not reached. No order was minted and no error
// was rendered anywhere a shopper could see one.
//
// The SUBSCRIPTION leg of the same run pressed Continue and minted an order
// normally, so whatever this is, it is specific to the upfront flow.
//
// This probe answers one question and asserts nothing: when Continue is pressed
// on the upfront Review Order, what does the client actually send, and what
// comes back? A silent no-op has three candidate explanations and they are told
// apart entirely by the network:
//
//   no request at all      -> the control is inert (no handler, or a guard in
//                             the client that renders no message)
//   create-order 4xx/5xx   -> the server refused and the page swallowed it
//   create-order 200       -> the order WAS minted and only the navigation failed,
//                             which would make the two failures above far more
//                             serious than they look
//
// WRITES-GATED, because the third outcome mints a real order. It is the same
// click the two failing tests already make, so this creates nothing they do not.

// From the fixtures, NOT @playwright/test. The first version of this probe took
// the bare `test` and its Continue click then timed out with the exchange dialog
// sitting open over the button — the dialog opens by itself once the address is
// resolved, which is after the one dismissECall this probe made. The `page`
// fixture registers installExchangeDialogHandler(), which is the repo's standing
// answer to exactly that, and the two failing tests already have it.
const { test } = require('../fixtures/pageFixtures');
const { BASE_URL, TIMEOUTS } = require('../data/constants');
const { assertFreshSession } = require('../utils/session');
const { writesAllowed, writeSkipReason } = require('../utils/writes');
const { openCart, dismissExchangeDialog } = require('../utils/cartNav');

test.describe.configure({ retries: 0 });

test.beforeAll(() => assertFreshSession());

test('what Continue on the upfront Review Order actually sends', async ({ page }) => {
  test.skip(
    !writesAllowed(),
    writeSkipReason('Pressing Continue on Review Order can mint a real order')
  );
  test.setTimeout(300000);

  const seen = [];
  page.on('response', async (res) => {
    const url = res.url();
    if (!/\/api\//.test(url)) return;
    if (res.status() < 400 && !/order|payment|checkout/i.test(url)) return;
    let body = '';
    try {
      body = (await res.text()).slice(0, 500);
    } catch {
      body = '(body unavailable)';
    }
    seen.push(`${res.status()} ${res.request().method()} ${url}\n        ${body}`);
  });
  page.on('console', (msg) => {
    if (msg.type() === 'error') seen.push(`CONSOLE ERROR: ${msg.text().slice(0, 300)}`);
  });

  await openCart(page);
  await dismissExchangeDialog(page);

  await page
    .getByRole('button', { name: /^continue$/i })
    .filter({ visible: true })
    .first()
    .click({ timeout: TIMEOUTS.action });
  await page.waitForURL(/\/review/, { timeout: 60000 });
  await dismissExchangeDialog(page);
  console.log(`on Review Order: ${page.url()}`);

  // Everything before the click is setup noise.
  seen.length = 0;

  const before = page.url();
  await page
    .getByRole('button', { name: /^continue$/i })
    .filter({ visible: true })
    .first()
    .click({ timeout: TIMEOUTS.action });

  // Long enough that a slow create-order would have answered.
  await page.waitForTimeout(25000);

  console.log(`URL before click : ${before}`);
  console.log(`URL 25s after    : ${page.url()}`);
  console.log(`navigated        : ${before !== page.url()}`);
  console.log(
    'REQUESTS SINCE THE CLICK (errors, and anything order/payment/checkout):\n' +
      (seen.map((s) => `  ${s}`).join('\n') || '  (nothing — the control sent no request at all)')
  );

  const body = (await page.locator('body').innerText()).replace(/\n{2,}/g, '\n');
  console.log(`VISIBLE TEXT (first 800):\n${body.slice(0, 800)}`);
});
