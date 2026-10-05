// tests/scripts/har-payment-summary.spec.js
//
// HAR capture, Journey 2: phone + OTP login -> PDP -> add to cart -> cart ->
// Review Order -> Continue -> Payment Summary. Stops there; never pays.
// Output: tests/data/har/payment-summary-logged-in.har (gitignored) and .md
// (masked summary).
//
// MINTS ONE REAL ORDER PER RUN. Continue on Review Order calls
// POST /customer-order/v2/create-order before Payment Summary loads. Gated on
// BYTEPE_ALLOW_WRITES=1, retries pinned to 0 so a failure is never retried into
// a second order.
//
// Logs in from a fresh context, so Send OTP / Verify OTP / the token cookies
// are in the capture. auth.json is neither read nor written.
//
// Credentials come from .env.har (gitignored; see .env.har.example) or the
// environment: BYTEPE_MOBILE, BYTEPE_OTP.
//
//   BYTEPE_ALLOW_WRITES=1 npx playwright test scripts/har-payment-summary.spec.js --project=chromium

const { request } = require('@playwright/test');
const { test, expect } = require('../fixtures/pageFixtures');
const { BASE_URL, BASE_API_URL, TIMEOUTS, URLS } = require('../data/constants');
const { HomePage } = require('../pages/homepage');
const { buyNowControl, clickAddToCart } = require('../utils/buyRow');
const { openCart, dismissExchangeDialog } = require('../utils/cartNav');
const { installExchangeDialogHandler } = require('../utils/exchangeDialog');
const { watchCreateOrder, readCreateOrder } = require('../utils/createOrder');
const { identitiesFromCart, formatIdentities } = require('../utils/surfaceIdentity');
const { writesAllowed, writeSkipReason } = require('../utils/writes');
const { loadHarEnv, harPathFor, waitForApiQuiet, summarizeHar } = require('../utils/harCapture');

loadHarEnv();

// Cheap-ish UPFRONT, non-pre-booking, has the cart icon. Same product as Journey 1.
const PRODUCT = { slug: 'galaxy-m47-5g', bpid: 'SAMSAMOBW4IQZM' };
const HAR_NAME = 'payment-summary-logged-in';

test.describe.configure({ retries: 0 });

// The upfront basket as the server holds it, read OUTSIDE the recorded context
// so the check does not show up in the HAR as a call the journey makes.
async function upfrontBasket(context) {
  const api = await request.newContext({ storageState: await context.storageState() });
  try {
    const res = await api.get(`${BASE_API_URL}/cart?payment_type=UPFRONT`);
    expect(res.ok(), `GET /cart?payment_type=UPFRONT -> ${res.status()}`).toBe(true);
    return identitiesFromCart((await res.json()).data || {});
  } finally {
    await api.dispose();
  }
}

// Any line that is not the target product would be ordered too. Refuse rather
// than mint an order for something nobody chose.
function assertOnlyTarget(items, when) {
  const others = items.filter((i) => i.bpid !== PRODUCT.bpid);
  expect(
    others,
    `${when}: the upfront basket holds items other than ${PRODUCT.bpid}, and Continue ` +
      `would order them too. Empty the cart on this account first.\n${formatIdentities(items)}`
  ).toEqual([]);
}

// Exactly one visible Continue-shaped control, or refuse: this click mints an
// order, so an ambiguous match is not resolved by DOM order.
async function reviewContinueButton(page) {
  const candidates = page
    .getByRole('button', { name: /^(continue|proceed to payment|proceed)$/i })
    .filter({ visible: true });
  const labels = await candidates.allInnerTexts();
  expect(labels, 'Review Order must show exactly one Continue control').toHaveLength(1);
  return candidates.first();
}

test('Payment Summary logged in: record every API call to a HAR', async ({ browser }) => {
  test.skip(
    !writesAllowed(),
    writeSkipReason('Reaching Payment Summary presses Continue on Review Order, which mints a real order')
  );
  const { BYTEPE_MOBILE: mobile, BYTEPE_OTP: otp } = process.env;
  expect(mobile, 'BYTEPE_MOBILE is not set — fill in .env.har').toBeTruthy();
  // No BYTEPE_OTP: login() waits for the code to be typed in a headed browser.
  // Production OTPs arrive by SMS per login, so this is the normal case there.
  if (!otp) test.skip(!!process.env.CI, 'BYTEPE_OTP is not set and no one can type it in CI');
  test.setTimeout(300000);

  const harFile = harPathFor(HAR_NAME);
  const context = await browser.newContext({
    storageState: undefined,
    recordHar: { path: harFile, content: 'embed' },
  });
  const page = await context.newPage();
  await installExchangeDialogHandler(page);
  const home = new HomePage(page);
  const notes = [];
  let complete = false;

  try {
    // 1. Login — Send OTP, Verify OTP, token cookies.
    await home.login(mobile, otp);

    assertOnlyTarget(await upfrontBasket(context), 'before adding');

    // 2. PDP.
    await page.goto(`${BASE_URL}/pd/${PRODUCT.slug}/${PRODUCT.bpid}`, { waitUntil: 'load' });
    await expect(buyNowControl(page)).toBeVisible({ timeout: TIMEOUTS.nav * 2 });
    // The button renders before its handler binds; an early click is inert.
    await waitForApiQuiet(page, { quietMs: 3000 });

    // 3. Add to cart. Confirmed by POST /api/cart, not by the button.
    // clickAddToCart takes the cart icon BEFORE Buy Now in DOM order, so it can
    // never reach a recommended-products tile (see utils/buyRow.js).
    const added = page.waitForResponse(
      (r) => /\/api\/cart(\?|$)/.test(r.url()) && r.request().method() === 'POST',
      { timeout: TIMEOUTS.nav * 2 }
    );
    expect(await clickAddToCart(page), 'no cart icon before Buy Now on this PDP').toBe(true);
    const addRes = await added;
    expect(addRes.ok(), `POST /api/cart -> ${addRes.status()}`).toBe(true);

    const basket = await upfrontBasket(context);
    assertOnlyTarget(basket, 'after adding');
    expect(basket.map((i) => i.bpid)).toContain(PRODUCT.bpid);

    // 4. Cart -> Review Order.
    await openCart(page);
    await dismissExchangeDialog(page);
    await waitForApiQuiet(page, { quietMs: 3000 });
    await page
      .getByRole('button', { name: /^continue$/i })
      .filter({ visible: true })
      .first()
      .click({ timeout: TIMEOUTS.action });
    await page.waitForURL(new RegExp(URLS.review), { timeout: 60000 });
    await dismissExchangeDialog(page);
    await waitForApiQuiet(page, { quietMs: 3000 });

    // 5. The irreversible click.
    const proceed = await reviewContinueButton(page);
    const created = watchCreateOrder(page);
    await proceed.click({ timeout: TIMEOUTS.action });
    const verdict = await readCreateOrder(created);
    notes.push(`create-order: ${verdict.sent ? `${verdict.status} — ${verdict.message}` : 'never sent'}`);
    expect(verdict.ok, `create-order did not succeed: ${notes.at(-1)}`).toBe(true);

    // 6. Payment Summary, fully loaded.
    await page.waitForURL(new RegExp(URLS.orderSummary), { timeout: 90000 });
    await waitForApiQuiet(page);
    notes.push(`Stopped on \`${new URL(page.url()).pathname}\` — no payment step taken.`);
    complete = true;
  } finally {
    await context.close();
    const { mdFile, calls } = summarizeHar(harFile, {
      title: `Journey 2 — Payment Summary, logged in (${PRODUCT.slug}/${PRODUCT.bpid})`,
      notes: [
        'Flow: homepage → Login drawer → Send OTP → Verify OTP → PDP → Add to cart → /cart → /review → Continue → /payment-summary.',
        'Basket checks (GET /cart) made outside the browser are not in the HAR.',
        ...notes,
      ],
      secrets: [mobile, otp],
      complete,
    });
    console.log(`${calls} /api/ calls -> ${mdFile}`);
  }
});
