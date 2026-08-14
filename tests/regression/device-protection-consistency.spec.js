// tests/regression/device-protection-consistency.spec.js
//
// Does Device Protection cost the same on Payment Summary as it did on Review
// Order?
//
// THE BUG THIS EXISTS TO CATCH:
//
//     Review Order      Device Protection = ₹1
//            | Continue
//     Payment Summary   Device Protection = ₹2,001      <- +₹2,000
//
// Why a total-only check will not find it. Both pages are internally
// consistent: Payment Summary's own arithmetic balances perfectly against
// ₹2,001, so "does this page add up" passes on both. The defect only exists
// BETWEEN the pages, in one named component. So this file captures each charge
// separately — product amount, discount, device protection, shipping, other —
// and compares them component by component, then reports which one moved.
// A generic "total mismatch" would be a worse bug report for the same failure.
//
// NOTHING HERE TOUCHES best_price. That field is intentionally disabled because
// the offer behind it ended; it is not read, not asserted, and cannot fail this
// suite. See the note in tests/api/pricing-api.spec.js.
//
// NOTHING HERE ADDS TO THE CART. It uses whatever the account's cart already
// holds. There is no `getByRole('button', {name:'Add to Cart'})` in this file —
// that locator reaches the recommended-products carousel and once put a
// ₹1,24,999 phone into a live basket (see pricing-checkout-consistency.spec.js).
//
// WRITE GATE. Reaching Payment Summary presses Continue on Review Order, and
// that mints a real order id before any payment step. Everything up to and
// including Review Order runs freely; the Payment Summary case skips unless
// BYTEPE_ALLOW_WRITES=1, and says so rather than reporting a pricing pass.

const { test, expect } = require('../fixtures/pageFixtures');
const { BASE_URL, URLS, TIMEOUTS } = require('../data/constants');
const { assertFreshSession } = require('../utils/session');
const { writesAllowed, writeSkipReason } = require('../utils/writes');
const { openCart, dismissExchangeDialog } = require('../utils/cartNav');
const {
  parsePricingBreakdown,
  expectedTotalOf,
  formatBreakdown,
} = require('../utils/priceText');

test.beforeAll(() => assertFreshSession());

const FLOW_TIMEOUT = 300000;

// ---- Evidence ----------------------------------------------------------
//
// A pricing mismatch is a money bug, and the person reading the report will not
// be able to reproduce it by re-running: pressing Continue again mints another
// order. So everything needed to argue the case is captured at the moment it
// happens.
function makeRecorder(page) {
  const apiCalls = [];

  page.on('response', async (res) => {
    const url = res.url();
    if (!/\/api\/.*(cart|order|payment|checkout|vas)/i.test(url)) return;
    let body = '';
    try {
      body = (await res.text()).slice(0, 800);
    } catch {
      body = '(body unavailable)';
    }
    apiCalls.push({
      method: res.request().method(),
      status: res.status(),
      url,
      body,
      at: new Date().toISOString(),
    });
  });

  return apiCalls;
}

async function captureEvidence(page, testInfo, name) {
  const file = testInfo.outputPath(`${name}.png`);
  await page.screenshot({ path: file, fullPage: true }).catch(() => {});
  await testInfo.attach(name, { path: file, contentType: 'image/png' }).catch(() => {});
  return file;
}

// Everything a reader needs that is not in the pricing figures themselves.
async function environmentOf(page) {
  const viewport = page.viewportSize();
  return {
    url: page.url(),
    timestamp: new Date().toISOString(),
    viewport: viewport ? `${viewport.width}x${viewport.height}` : 'unknown',
    userAgent: await page.evaluate(() => navigator.userAgent).catch(() => 'unknown'),
  };
}

// ---- Reading a page's pricing -----------------------------------------
//
// WAITS FOR HYDRATION. domcontentloaded is not enough and this is not
// theoretical: reading the review page the instant its URL resolved returned a
// document with no summary on it at all, and the failure read as "Review Order
// has no Order Summary" — a site defect — when the page had simply not rendered.
// Payment Summary is client-priced the same way, and its figures are the whole
// point of this file, so it gets the same treatment.
async function readPricing(page, label) {
  await page
    .getByText(/total amount|amount payable|to pay|grand total/i)
    .first()
    .waitFor({ state: 'visible', timeout: TIMEOUTS.nav })
    .catch(() => {});

  // The amount itself, not just its label — the label can render a beat before
  // the figure it introduces.
  await page
    .getByText(/₹\s?[\d,]+/)
    .first()
    .waitFor({ state: 'visible', timeout: TIMEOUTS.nav })
    .catch(() => {});

  const text = await page.locator('body').innerText();
  const breakdown = parsePricingBreakdown(text, { label });

  if (!breakdown) {
    throw new Error(
      `${label}: no pricing summary could be read from this page.\n` +
        `  url: ${page.url()}\n` +
        `  text: ${text.replace(/\s+/g, ' ').slice(0, 800)}`
    );
  }
  return breakdown;
}

// The page's total must follow from the page's own components.
function assertAddsUp(breakdown, testInfo) {
  const expected = expectedTotalOf(breakdown);

  expect(
    breakdown.total,
    `${breakdown.label}: the displayed total does not follow from its own line items.\n` +
      formatBreakdown(breakdown) +
      `\n  difference         ₹${(breakdown.total ?? 0) - expected}\n` +
      (breakdown.unclassified.length
        ? `  NOTE: ${breakdown.unclassified.length} charge(s) on this page were not recognised ` +
          `by name and were counted as "other": ` +
          `${breakdown.unclassified.map((r) => `${r.label} ₹${r.amount}`).join(', ')}. ` +
          'If one of those is legitimate, name it in COMPONENT_PATTERNS in utils/priceText.js.\n'
        : '') +
      `  raw summary text: ${breakdown.region.slice(0, 400)}`
  ).toBe(expected);

  testInfo.attach(`${breakdown.label}-breakdown`, {
    body: formatBreakdown(breakdown),
    contentType: 'text/plain',
  });
}

// Names the component that moved, rather than reporting a bare total mismatch.
function diffComponents(before, after) {
  const keys = ['productAmount', 'discount', 'deviceProtection', 'shipping', 'otherCharges', 'total'];
  return keys
    .filter((k) => (before[k] ?? 0) !== (after[k] ?? 0))
    .map((k) => ({
      component: k,
      before: before[k],
      after: after[k],
      difference: (after[k] ?? 0) - (before[k] ?? 0),
    }));
}

// Scoped to the checkout summary, and refuses to guess.
//
// The requirement is explicit that this must not click a recommended product, a
// navigation element or a duplicate CTA. Rather than picking .first() and hoping,
// this asserts there is exactly one visible Continue-shaped control and fails
// loudly if the page offers several — on a page that mints a real order, an
// ambiguous click is not something to resolve by ordering.
async function checkoutContinueButton(page) {
  const candidates = page
    .getByRole('button', { name: /^(continue|proceed to payment|proceed)$/i })
    .filter({ visible: true });

  const count = await candidates.count();
  if (count === 0) {
    throw new Error('Review Order shows no Continue control, so the flow cannot proceed.');
  }
  if (count > 1) {
    const labels = await candidates.allInnerTexts();
    throw new Error(
      `Review Order shows ${count} visible Continue-shaped buttons (${labels.join(' | ')}). ` +
        'Refusing to guess which one mints the order — scope the locator before running this.'
    );
  }
  return candidates.first();
}

test.describe('Device Protection pricing consistency through checkout', () => {
  // ---- Steps 1-4: Cart -> Review Order, no writes ----------------------
  test('cart and Review Order agree on Device Protection and every other charge', async ({
    page,
  }, testInfo) => {
    test.setTimeout(FLOW_TIMEOUT);
    const apiCalls = makeRecorder(page);

    // Step 1 — Cart.
    await openCart(page);
    await dismissExchangeDialog(page);

    const cart = await readPricing(page, 'cart');
    console.log('CART\n' + formatBreakdown(cart));
    await captureEvidence(page, testInfo, '01-cart');

    expect(
      cart.itemCount,
      'the cart is empty, so there is no pricing to carry through checkout'
    ).toBeGreaterThan(0);
    expect(cart.productAmount, 'the cart shows no product amount').toBeTruthy();
    expect(cart.total, 'the cart shows no total').toBeTruthy();

    assertAddsUp(cart, testInfo);

    // Step 2 — Review Order.
    const continueFromCart = page.getByRole('button', { name: /^continue$/i }).filter({ visible: true });
    await continueFromCart.first().click({ timeout: TIMEOUTS.action });
    await page.waitForURL(new RegExp(URLS.review), { timeout: 60000 });
    await dismissExchangeDialog(page);

    const review = await readPricing(page, 'review order');
    console.log('REVIEW ORDER\n' + formatBreakdown(review));
    await captureEvidence(page, testInfo, '02-review-order');

    // Step 3 — the page's own arithmetic.
    assertAddsUp(review, testInfo);

    // Cart -> Review Order. Device Protection named explicitly, because it is
    // the charge under investigation and a total-level check would not say so.
    const moved = diffComponents(cart, review);
    expect(
      review.deviceProtection,
      'DEVICE PROTECTION CHANGED BETWEEN CART AND REVIEW ORDER\n\n' +
        `  cart          ₹${cart.deviceProtection}\n` +
        `  review order  ₹${review.deviceProtection}\n` +
        `  difference    ₹${(review.deviceProtection ?? 0) - (cart.deviceProtection ?? 0)}\n\n` +
        'CART\n' + formatBreakdown(cart) + '\n\nREVIEW ORDER\n' + formatBreakdown(review) + '\n\n' +
        `components that moved: ${JSON.stringify(moved, null, 1)}\n` +
        `url: ${page.url()}\n` +
        `api: ${JSON.stringify(apiCalls.slice(-4), null, 1)}`
    ).toBe(cart.deviceProtection);

    expect(
      review.total,
      'THE ORDER TOTAL CHANGED BETWEEN CART AND REVIEW ORDER\n\n' +
        `  cart          ₹${cart.total}\n` +
        `  review order  ₹${review.total}\n` +
        `  difference    ₹${(review.total ?? 0) - (cart.total ?? 0)}\n\n` +
        `components that moved: ${JSON.stringify(moved, null, 1)}`
    ).toBe(cart.total);

    // Step 4 — the snapshot the Payment Summary case would compare against,
    // recorded here so a failure downstream can be read against a known-good
    // starting point.
    console.log(
      'REVIEW ORDER SNAPSHOT ' +
        JSON.stringify(
          {
            reviewProductAmount: review.productAmount,
            reviewDeviceProtection: review.deviceProtection,
            reviewDiscount: review.discount,
            reviewShipping: review.shipping,
            reviewOtherCharges: review.otherCharges,
            reviewTotal: review.total,
          },
          null,
          1
        )
    );

    // Deliberately stopped here. Continue is what mints the order.
    expect(page.url()).not.toMatch(/payment-summary|razorpay|payment_id/i);
  });

  // ---- Steps 5-7 and the cross-page assertions -------------------------
  //
  // ONE TEST, not four. Each arrival at Payment Summary mints a real order, so
  // the refresh check and the back/forward check are folded into this single
  // journey rather than being separate cases that would mint one order each.
  test.describe('Payment Summary', () => {
    // RETRIES OFF, DELIBERATELY. playwright.config.js sets retries to 1 locally
    // and 2 in CI, which is right for a flaky UI assertion and catastrophic
    // here: this test mints a real order, so a single failure would be retried
    // into a second order, and a CI run into a third. The pricing mismatch this
    // file hunts is not flaky — if it fails, it fails for a reason worth reading
    // rather than re-rolling.
    //
    // Set on the describe rather than left to a --retries=0 flag on the command
    // line, because the flag has to be remembered every time and the cost of
    // forgetting it is a real order.
    test.describe.configure({ retries: 0 });

    test.skip(
      !writesAllowed(),
      writeSkipReason(
        'Payment Summary requires an explicit checkout write permission — reaching it presses ' +
          'Continue on Review Order, which mints a real order id'
      )
    );

    test('Device Protection and the total survive Review Order -> Payment Summary', async ({
      page,
    }, testInfo) => {
      test.setTimeout(FLOW_TIMEOUT);
      const apiCalls = makeRecorder(page);

      // Step 1-2 — reach Review Order.
      await openCart(page);
      await dismissExchangeDialog(page);
      const cart = await readPricing(page, 'cart');
      expect(cart.itemCount, 'the cart is empty — nothing to check out').toBeGreaterThan(0);

      await page
        .getByRole('button', { name: /^continue$/i })
        .filter({ visible: true })
        .first()
        .click({ timeout: TIMEOUTS.action });
      await page.waitForURL(new RegExp(URLS.review), { timeout: 60000 });
      await dismissExchangeDialog(page);

      const review = await readPricing(page, 'review order');
      console.log('REVIEW ORDER\n' + formatBreakdown(review));
      await captureEvidence(page, testInfo, '01-review-order');
      assertAddsUp(review, testInfo);

      const reviewEnv = await environmentOf(page);

      // Step 5 — the irreversible click.
      const proceed = await checkoutContinueButton(page);
      console.log(`review total ₹${review.total}, DP ₹${review.deviceProtection} — ` +
        'pressing Continue now MINTS A REAL ORDER');
      await proceed.click({ timeout: TIMEOUTS.action });

      // Step 6 — wait for Payment Summary to be priced, not merely loaded.
      await page.waitForURL(new RegExp(URLS.orderSummary), { timeout: 90000 });
      const payment = await readPricing(page, 'payment summary');
      console.log('PAYMENT SUMMARY\n' + formatBreakdown(payment));
      await captureEvidence(page, testInfo, '02-payment-summary');

      const paymentEnv = await environmentOf(page);
      const orderRef =
        (page.url().match(/(?:order[_-]?id|orderId)=([^&]+)/i) || [])[1] ||
        (apiCalls.map((c) => (c.body.match(/"order_?(?:id|number)"\s*:\s*"([^"]+)"/i) || [])[1]).find(Boolean)) ||
        '(not found in url or api responses)';

      // Everything a reader needs, attached whether or not this passes.
      const dossier =
        `order reference: ${orderRef}\n` +
        `review order:   ${reviewEnv.url}\n  at ${reviewEnv.timestamp}\n` +
        `payment summary:${paymentEnv.url}\n  at ${paymentEnv.timestamp}\n` +
        `viewport: ${paymentEnv.viewport}\nuser agent: ${paymentEnv.userAgent}\n\n` +
        'REVIEW ORDER\n' + formatBreakdown(review) + '\n\n' +
        'PAYMENT SUMMARY\n' + formatBreakdown(payment) + '\n\n' +
        'API\n' + JSON.stringify(apiCalls, null, 1);
      await testInfo.attach('checkout-dossier', { body: dossier, contentType: 'text/plain' });

      const moved = diffComponents(review, payment);

      // ---- CRITICAL ASSERTION: Device Protection ----------------------
      //
      // Named first and on its own, so the report says which charge changed
      // rather than only that the total did. Numeric comparison — "₹2,001" and
      // "₹2001" are the same money and must not be told apart by formatting,
      // and ₹1 vs ₹2,001 must never be normalised away.
      expect(
        payment.deviceProtection,
        'DEVICE PROTECTION PRICING MISMATCH\n\n' +
          `  Review Order Device Protection:    ₹${review.deviceProtection}\n` +
          `  Payment Summary Device Protection: ₹${payment.deviceProtection}\n` +
          `  Difference:                        ₹${(payment.deviceProtection ?? 0) - (review.deviceProtection ?? 0)}\n\n` +
          `  Review Order Total:    ₹${review.total}\n` +
          `  Payment Summary Total: ₹${payment.total}\n\n` +
          'Expected:\n  Device Protection should remain unchanged between Review Order and ' +
          'Payment Summary.\nActual:\n  Device Protection changed from ' +
          `₹${review.deviceProtection} to ₹${payment.deviceProtection}.\n\n` +
          dossier
      ).toBe(review.deviceProtection);

      // ---- CRITICAL ASSERTION: Payment Summary's own arithmetic --------
      assertAddsUp(payment, testInfo);

      // ---- CROSS-PAGE: the total -------------------------------------
      //
      // Asserted after the component check on purpose. If a charge moved, the
      // failure above has already named it; this catches a total that drifted
      // without any component this parser recognises moving — which means an
      // unnamed charge appeared, and `unclassified` will say what it was.
      expect(
        payment.total,
        'THE TOTAL PAYABLE CHANGED BETWEEN REVIEW ORDER AND PAYMENT SUMMARY\n\n' +
          `  Review Order Total:    ₹${review.total}\n` +
          `  Payment Summary Total: ₹${payment.total}\n` +
          `  Difference:            ₹${(payment.total ?? 0) - (review.total ?? 0)}\n\n` +
          `  components that moved: ${JSON.stringify(moved, null, 1)}\n\n` +
          'A changed total is not assumed valid. If a checkout charge legitimately explains ' +
          'this, it must appear as its own named line — add it to COMPONENT_PATTERNS in ' +
          'utils/priceText.js so it is recorded separately rather than absorbed.\n\n' +
          dossier
      ).toBe(review.total);

      // ---- Refresh: is the figure stable, or a hydration artefact? -----
      //
      // Folded in here rather than made its own test, because a separate test
      // would mint a second real order to reach this page.
      const beforeRefresh = payment.deviceProtection;
      await page.reload({ waitUntil: 'domcontentloaded' });
      const afterRefreshBreakdown = await readPricing(page, 'payment summary (after refresh)');
      await captureEvidence(page, testInfo, '03-payment-summary-refreshed');

      expect(
        afterRefreshBreakdown.deviceProtection,
        'DEVICE PROTECTION CHANGED ON REFRESH\n\n' +
          `  before refresh: ₹${beforeRefresh}\n` +
          `  after refresh:  ₹${afterRefreshBreakdown.deviceProtection}\n` +
          `  difference:     ₹${(afterRefreshBreakdown.deviceProtection ?? 0) - (beforeRefresh ?? 0)}\n\n` +
          'The figure depends on client-side hydration state rather than on the order, which ' +
          'means the shopper sees a different price depending on whether they reloaded.\n\n' +
          'AFTER REFRESH\n' + formatBreakdown(afterRefreshBreakdown)
      ).toBe(beforeRefresh);

      assertAddsUp(afterRefreshBreakdown, testInfo);

      // ---- Back and forward -------------------------------------------
      //
      // Review Order -> Payment Summary -> Back -> Payment Summary, using
      // history rather than a second Continue press, so no further order is
      // minted.
      await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
      await dismissExchangeDialog(page);
      const reviewAgain = await readPricing(page, 'review order (after back)').catch(() => null);

      await page.goForward({ waitUntil: 'domcontentloaded' }).catch(() => {});
      const paymentAgain = await readPricing(page, 'payment summary (after back/forward)').catch(
        () => null
      );
      await captureEvidence(page, testInfo, '04-payment-summary-after-navigation');

      // Navigating back out of a minted order may legitimately land somewhere
      // else entirely, so this only asserts when the pages were actually
      // readable — a null here is "the journey did not return", not a price bug.
      if (reviewAgain) {
        expect(
          reviewAgain.deviceProtection,
          'DEVICE PROTECTION CHANGED AFTER NAVIGATING BACK TO REVIEW ORDER\n\n' +
            `  first visit: ₹${review.deviceProtection}\n` +
            `  after back:  ₹${reviewAgain.deviceProtection}\n\n` +
            formatBreakdown(reviewAgain)
        ).toBe(review.deviceProtection);
      }

      if (paymentAgain) {
        expect(
          paymentAgain.deviceProtection,
          'DEVICE PROTECTION CHANGED AFTER BACK AND FORWARD\n\n' +
            `  first arrival: ₹${payment.deviceProtection}\n` +
            `  after back/forward: ₹${paymentAgain.deviceProtection}\n\n` +
            formatBreakdown(paymentAgain)
        ).toBe(payment.deviceProtection);
      }

      console.log(
        `Device Protection held at ₹${payment.deviceProtection} across ` +
          'review -> payment -> refresh -> back -> forward. ' +
          `Order reference: ${orderRef}`
      );
    });
  });
});
