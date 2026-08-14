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
const {
  identitiesFromCart,
  identitiesFromCreateOrder,
  compareIdentities,
  formatIdentities,
} = require('../utils/surfaceIdentity');
const {
  explainDisplayedField,
  fieldsAreIndistinguishable,
  diagnosticHeader,
} = require('../utils/pricingDiagnosis');

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

  // ---- THE BUG, CAUGHT WITHOUT MINTING ANYTHING ------------------------
  //
  // Root cause, read off a screen recording of the failure (14 Aug 2026):
  // Review Order renders the VAS record's `vas_price` — the PER-UNIT figure —
  // where it should render `vas_amount`, the total actually charged. Both live
  // in the same object in the same response:
  //
  //     vas: [{ vas_name: "12 mo Device Protection",
  //             vas_price: 1,        <- Review Order shows this
  //             vas_amount: 2001 }]  <- Payment Summary charges this
  //
  // Measured on a 3-item upfront order:
  //     Review Order     Device Protection ₹1      Total ₹3,85,800
  //     Payment Summary  Device Protection ₹2,001  Total ₹3,87,800
  //
  // The shopper approves one figure and is charged ₹2,000 more. ₹1,999 + ₹1 + ₹1
  // across the three items is the ₹2,001 — so it is a sum, exposed as a second
  // field rather than as extra lines, which is why looking for multiple
  // protected rows found nothing.
  //
  // Because both numbers arrive together, the mismatch is provable on Review
  // Order alone. No Continue, no order, no money. This is the test to run.
  test('Review Order shows the Device Protection that will actually be charged', async ({
    page,
  }, testInfo) => {
    test.setTimeout(FLOW_TIMEOUT);

    const apiCalls = makeRecorder(page);

    await openCart(page);
    await dismissExchangeDialog(page);

    await page
      .getByRole('button', { name: /^continue$/i })
      .filter({ visible: true })
      .first()
      .click({ timeout: TIMEOUTS.action });
    await page.waitForURL(new RegExp(URLS.review), { timeout: 60000 });
    await dismissExchangeDialog(page);

    const review = await readPricing(page, 'review order');
    console.log('REVIEW ORDER\n' + formatBreakdown(review));
    await captureEvidence(page, testInfo, 'review-order-vas');

    // The VAS records, read from the cart API rather than sniffed off the wire.
    //
    // Sniffing was tried first and skipped: the payload in the bug recording
    // carries order_ids, so it is the post-create-order response — the Review
    // Order page itself may never be sent a vas_amount. The cart API carries
    // both figures per line before anything is created, which is what makes
    // this check free.
    const paymentType = ((page.url().match(/payment_type=([^&]+)/) || [])[1] || 'UPFRONT')
      .toUpperCase();
    const cartRes = await page.request.get(`${BASE_URL}/api/cart?payment_type=${paymentType}`, {
      headers: { accept: 'application/json' },
    });
    expect(cartRes.ok(), `GET /api/cart?payment_type=${paymentType} → ${cartRes.status()}`).toBe(
      true
    );

    const cartData = (await cartRes.json()).data || {};
    const vasRecords = [];
    for (const item of cartData.items || []) {
      const lineTotal = Number(item.vas_amount) || 0;
      for (const vas of item.vas_items || []) {
        vasRecords.push({
          product: item.product?.product_name,
          name: vas.vas_name,
          vasPrice: Number(vas.vas_price) || 0,
          // The line's vas_amount is what that line contributes to the charge.
          vasAmount: lineTotal,
          from: `cart line ${item.variant?.bpid}`,
        });
      }
    }

    // Recorded so a run can be read back later; the sniffed calls stay in the
    // report as corroboration.
    await testInfo.attach('api-calls', {
      body: JSON.stringify(apiCalls.map((c) => `${c.method} ${c.status} ${c.url}`), null, 1),
      contentType: 'text/plain',
    });

    console.log(
      vasRecords.length
        ? 'VAS records seen:\n' +
            vasRecords
              .map((v) => `  ${v.name}: vas_price ₹${v.vasPrice}, vas_amount ₹${v.vasAmount}`)
              .join('\n')
        : 'no VAS record appeared in any response this page made'
    );

    await testInfo.attach('vas-records', {
      body: JSON.stringify(vasRecords, null, 1),
      contentType: 'text/plain',
    });

    // Non-vacuous: with nothing to compare against, say so rather than pass.
    test.skip(
      vasRecords.length === 0,
      'No line in this basket carries a Device Protection record, so the displayed figure ' +
        'cannot be checked against the amount that will be charged. Add a subscription ' +
        'product with Device Protection attached first.'
    );

    // Steps 3-5 of the diagnostic order: what did the API return, which of its
    // fields is the page showing, and what does that field mean.
    console.log(diagnosticHeader('Device Protection'));

    const charged = vasRecords.reduce((sum, v) => sum + v.vasAmount, 0);
    const perUnit = vasRecords.reduce((sum, v) => sum + v.vasPrice, 0);
    const candidates = { vas_amount: charged, vas_price: perUnit };

    // When the two fields hold the same number, the assertion below cannot fail
    // however the page behaves. Saying so is the difference between a result and
    // a coincidence.
    const indistinguishable = fieldsAreIndistinguishable(candidates, 'vas_amount', 'vas_price');
    console.log(
      indistinguishable
        ? `vas_price == vas_amount == ₹${charged}, so this check cannot tell the two apart on ` +
            'this basket — it proves nothing until a cart holds a record where they differ'
        : `vas_price ₹${perUnit} != vas_amount ₹${charged} — this basket CAN expose the defect`
    );

    expect(
      review.deviceProtection,
      'REVIEW ORDER IS SHOWING THE WRONG DEVICE PROTECTION FIGURE\n\n' +
        // Step 4 names the field rather than reporting a bare difference: "the
        // page renders vas_price" and "Device Protection is wrong" are different
        // bugs, fixed by different people.
        explainDisplayedField({
          uiValue: review.deviceProtection,
          expectedField: 'vas_amount',
          candidates,
          label: 'Review Order',
        }) +
        '\n\n' +
        `  the shopper will be charged ₹${charged - (review.deviceProtection ?? 0)} more than ` +
        'this page states\n\n' +
        vasRecords
          .map((v) => `    ${v.name}: vas_price ₹${v.vasPrice}, vas_amount ₹${v.vasAmount}`)
          .join('\n') +
        '\n\nBoth figures arrive in the same vas record. Review Order renders vas_price, the ' +
        'per-unit figure; Payment Summary charges vas_amount, the total. Where a cart holds ' +
        'more than one protected item the two diverge, and the shopper approves the smaller ' +
        'one.\n\n' +
        formatBreakdown(review)
    ).toBe(charged);

    // Stopped before anything is created.
    expect(page.url()).not.toMatch(/payment-summary|razorpay|payment_id/i);
  });

  // ---- The subscription review page, before any order ------------------
  //
  // The reported defect starts here: "Device Protection is shown as ₹1
  // initially". This captures that starting state and proves the page can be
  // read at all, so the write-gated test below is not the first thing to
  // discover a parsing problem — at that point a re-run costs another order.
  //
  // Clicking Subscribe places the line in the subscription basket, which is a
  // cart write. It is NOT an order: the order id is minted by Continue on this
  // page, and Continue is not pressed here.
  test('subscription Review Order shows Device Protection and its own total adds up', async ({
    page,
  }, testInfo) => {
    test.setTimeout(FLOW_TIMEOUT);

    const target = { slug: 'phone-4b', bpid: 'NOTSMMOBK25WT5' };

    await page.goto(`${BASE_URL}/pd/${target.slug}/${target.bpid}`, {
      waitUntil: 'domcontentloaded',
    });
    await page.keyboard.press('Escape').catch(() => {});
    await page
      .getByText(/^₹[\d,]+$/)
      .first()
      .waitFor({ state: 'visible', timeout: TIMEOUTS.nav });

    const subscribe = page.getByRole('button', { name: /^subscribe$/i }).filter({ visible: true });
    expect(
      await subscribe.count(),
      `${target.slug}: expected exactly one visible Subscribe control`
    ).toBe(1);

    await subscribe.first().click({ timeout: TIMEOUTS.action });
    await page.waitForURL(/\/review\//, { timeout: 60000 });
    await dismissExchangeDialog(page);

    const review = await readPricing(page, 'review order (subscription)');
    console.log('SUBSCRIPTION REVIEW ORDER\n' + formatBreakdown(review));
    await captureEvidence(page, testInfo, 'subscription-review-order');
    assertAddsUp(review, testInfo);

    // The same basket as the server holds it. A page that agrees with the API
    // here makes any later divergence squarely a Payment Summary problem.
    const addressId = (page.url().match(/address_id=([^&]+)/) || [])[1];
    test.skip(!addressId, 'the review URL carried no address_id to query the cart API with');

    // payment_type + address_id, no is_review — that is the exact call the Review
    // Order page makes (recorded off the live page, 14 Aug 2026). is_review is a
    // filter on each line's own is_review flag, not "the review view": it happens
    // to return the subscription line, which is flagged, and returns nothing at
    // all for an upfront basket. Asking the page's own question keeps this from
    // depending on a flag the page never sets.
    const res = await page.request.get(
      `${BASE_URL}/api/cart?payment_type=SUBSCRIPTION&address_id=${addressId}`,
      { headers: { accept: 'application/json' } }
    );
    expect(res.ok(), `review cart API returned ${res.status()}`).toBe(true);

    const data = (await res.json()).data || {};
    const summedVas = (data.items || []).reduce((s, i) => s + (Number(i.vas_amount) || 0), 0);

    console.log(
      `review API: ${(data.items || []).length} item(s) · total_vas_amount ₹${data.total_vas_amount} ` +
        `· sum of line vas ₹${summedVas} · total ₹${data.total_amount}`
    );

    expect(
      review.deviceProtection,
      'THE SUBSCRIPTION REVIEW PAGE AND ITS OWN API DISAGREE ABOUT DEVICE PROTECTION\n\n' +
        `  review page:            ₹${review.deviceProtection}\n` +
        `  API total_vas_amount:   ₹${data.total_vas_amount}\n` +
        `  API sum of line vas:    ₹${summedVas}\n\n` +
        formatBreakdown(review)
    ).toBe(data.total_vas_amount);

    expect(
      review.total,
      `review page total ₹${review.total} vs API total_amount ₹${data.total_amount}`
    ).toBe(data.total_amount);

    // Stopped before the order is minted.
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

    // ---- The reported state: the SUBSCRIPTION flow ---------------------
    //
    // Reported as ₹1 on Review Order becoming ₹2,001 on Payment Summary for a
    // SINGLE line — not a cart that accumulated several protected items. That
    // rules out the sum-of-many theory and points at the subscription path,
    // where Device Protection is attached by default
    // (vas_items[].is_default_subscription = true).
    //
    // This drives that path directly: Subscribe on the PDP goes straight to
    // /review/subscribe, which is a different review page from the upfront one
    // the test above uses (payment_type=subscribe, pay_via=SUBSCRIPTION_CC).
    //
    // Cheaper to run, too. The subscription basket holds exactly ONE item —
    // subscribing to a product replaces whatever was there — so the order this
    // mints covers a single product rather than the whole shopping cart.
    //
    // NOTE: this test and the one above EACH mint their own order. Run one at a
    // time with -g rather than letting the file run whole.
    test('subscription flow: Device Protection holds from Review Order to Payment Summary', async ({
      page,
    }, testInfo) => {
      test.setTimeout(FLOW_TIMEOUT);
      const apiCalls = makeRecorder(page);

      // Overridable, because which product is used decides whether the defect
      // can appear at all and re-running costs a real order:
      //
      //   BYTEPE_DP_PRODUCT=galaxy-z-fold8-ultra/SAMSAMOB10ZXEG
      //
      // Default is the cheapest known product carrying Device Protection, so an
      // unconfigured run mints the smallest order it can. Measured on it
      // (order CM14082644F25B): Device Protection held at ₹1 from Review Order
      // through to Payment Summary — the defect did NOT reproduce there. Its
      // protection is priced at ₹1 on both sides, so it has little room to move;
      // a product whose PDP quotes a larger figure is the better probe.
      const configured = process.env.BYTEPE_DP_PRODUCT;
      const target = configured
        ? { slug: configured.split('/')[0], bpid: configured.split('/')[1] }
        : { slug: 'phone-4b', bpid: 'NOTSMMOBK25WT5' };

      expect(
        target.slug && target.bpid,
        'BYTEPE_DP_PRODUCT must be "<slug>/<bpid>"'
      ).toBeTruthy();
      console.log(`subscribing to ${target.slug}/${target.bpid}`);

      await page.goto(`${BASE_URL}/pd/${target.slug}/${target.bpid}`, {
        waitUntil: 'domcontentloaded',
      });
      await page.keyboard.press('Escape').catch(() => {});
      await page
        .getByText(/^₹[\d,]+$/)
        .first()
        .waitFor({ state: 'visible', timeout: TIMEOUTS.nav });

      // Scoped and unambiguous. Subscribe is the control that both places the
      // line in the subscription basket and navigates to its review page.
      const subscribe = page.getByRole('button', { name: /^subscribe$/i }).filter({ visible: true });
      const subscribeCount = await subscribe.count();
      expect(
        subscribeCount,
        `${target.slug}: expected exactly one visible Subscribe control, found ${subscribeCount}`
      ).toBe(1);

      await subscribe.first().click({ timeout: TIMEOUTS.action });
      await page.waitForURL(/\/review\//, { timeout: 60000 });
      await dismissExchangeDialog(page);

      const review = await readPricing(page, 'review order (subscription)');
      console.log('REVIEW ORDER (subscription)\n' + formatBreakdown(review));
      await captureEvidence(page, testInfo, '01-review-subscription');
      assertAddsUp(review, testInfo);

      // The server's own view of the same basket, read with the exact query the
      // review page uses: payment_type + address_id. NOT is_review — recorded off
      // the live page on 14 Aug 2026, the page never sends it. is_review filters
      // on each line's own is_review flag, so it returns the subscription line
      // (which is flagged) and nothing at all for an upfront basket.
      const addressId = (page.url().match(/address_id=([^&]+)/) || [])[1];
      let apiVas = null;
      let reviewIdentities = [];
      if (addressId) {
        const res = await page.request.get(
          `${BASE_URL}/api/cart?payment_type=SUBSCRIPTION&address_id=${addressId}`,
          { headers: { accept: 'application/json' } }
        );
        if (res.ok()) {
          const d = (await res.json()).data || {};
          apiVas = d.total_vas_amount;
          // WHAT is being reviewed, not just what it costs.
          reviewIdentities = identitiesFromCart(d);
          console.log(
            `review API: ${(d.items || []).length} item(s), total_vas_amount ₹${apiVas}, ` +
              `total ₹${d.total_amount}\n` + formatIdentities(reviewIdentities, 'review basket')
          );
        }
      }

      // The product the shopper actually asked for must be the one under review.
      // The subscription basket holds a single line and subscribing REPLACES it,
      // so reviewing one product while the basket holds another is a real
      // reachable state — and it is invisible to every amount-based check.
      if (reviewIdentities.length) {
        const reviewed = reviewIdentities.map((i) => i.bpid).filter(Boolean);
        expect(
          reviewed,
          'REVIEW ORDER IS SHOWING A DIFFERENT PRODUCT THAN THE ONE SUBSCRIBED TO\n\n' +
            `  subscribed to: ${target.slug}/${target.bpid}\n` +
            formatIdentities(reviewIdentities, 'review basket') +
            '\n\nThe subscription basket holds one line and subscribing replaces it, so the ' +
            'page can be reviewing an item the shopper did not choose.'
        ).toContain(target.bpid);
      }

      const reviewEnv = await environmentOf(page);

      // Step 5 — the irreversible click.
      const proceed = await checkoutContinueButton(page);
      console.log(
        `review shows Device Protection ₹${review.deviceProtection}, total ₹${review.total} — ` +
          'pressing Continue now MINTS A REAL ORDER'
      );
      await proceed.click({ timeout: TIMEOUTS.action });

      await page.waitForURL(new RegExp(URLS.orderSummary), { timeout: 90000 });
      const payment = await readPricing(page, 'payment summary (subscription)');
      console.log('PAYMENT SUMMARY (subscription)\n' + formatBreakdown(payment));
      await captureEvidence(page, testInfo, '02-payment-summary-subscription');

      const paymentEnv = await environmentOf(page);
      const orderRef =
        (page.url().match(/(?:order[_-]?id|orderId)=([^&]+)/i) || [])[1] ||
        apiCalls
          .map((c) => (c.body.match(/"order_?(?:id|number)"\s*:\s*"([^"]+)"/i) || [])[1])
          .find(Boolean) ||
        '(not found)';

      const dossier =
        `product: ${target.slug}/${target.bpid}\n` +
        `order reference: ${orderRef}\n` +
        `review:  ${reviewEnv.url}\n  at ${reviewEnv.timestamp}\n` +
        `payment: ${paymentEnv.url}\n  at ${paymentEnv.timestamp}\n` +
        `viewport: ${paymentEnv.viewport}\nuser agent: ${paymentEnv.userAgent}\n` +
        `cart API total_vas_amount at review: ₹${apiVas}\n\n` +
        'REVIEW ORDER\n' + formatBreakdown(review) + '\n\n' +
        'PAYMENT SUMMARY\n' + formatBreakdown(payment) + '\n\n' +
        'API\n' + JSON.stringify(apiCalls, null, 1);
      await testInfo.attach('subscription-checkout-dossier', {
        body: dossier,
        contentType: 'text/plain',
      });

      // ---- IDENTITY BEFORE ARITHMETIC ---------------------------------
      //
      // What did create-order actually create? This is the one authoritative
      // record in the flow — everything before it is a rendering. If the order
      // is for a different item than the one reviewed, every price difference
      // downstream is explained by that, and reporting a "Device Protection
      // mismatch" would name the wrong culprit entirely.
      //
      // This is the check whose absence let a ₹1 -> ₹2,001 jump be investigated
      // as an arithmetic fault for far too long: the real answer was that the
      // cart was not showing the same product.
      const createOrderCall = apiCalls.find((c) => /create-order/i.test(c.url));
      let orderedIdentities = [];
      if (createOrderCall) {
        try {
          orderedIdentities = identitiesFromCreateOrder(JSON.parse(createOrderCall.body));
        } catch {
          orderedIdentities = [];
        }
      }

      if (orderedIdentities.length) {
        console.log(formatIdentities(orderedIdentities, 'order created'));

        const orderedBpids = orderedIdentities.map((i) => i.bpid).filter(Boolean);
        expect(
          orderedBpids,
          'THE ORDER WAS CREATED FOR A DIFFERENT PRODUCT THAN THE ONE REVIEWED\n\n' +
            `  subscribed to: ${target.slug}/${target.bpid}\n` +
            formatIdentities(orderedIdentities, 'order created') +
            '\n' +
            formatIdentities(reviewIdentities, 'review basket') +
            '\n\nEvery pricing difference between Review Order and Payment Summary follows from ' +
            'this, and none of it is an arithmetic fault. Check identity before blaming a ' +
            'charge.\n\n' +
            dossier
        ).toContain(target.bpid);

        if (reviewIdentities.length) {
          const drift = compareIdentities(reviewIdentities, orderedIdentities, {
            beforeLabel: 'review basket',
            afterLabel: 'order created',
          });
          expect(
            drift,
            'THE BASKET CHANGED BETWEEN REVIEW ORDER AND ORDER CREATION\n\n' +
              formatIdentities(reviewIdentities, 'review basket') +
              '\n' +
              formatIdentities(orderedIdentities, 'order created') +
              '\n\n' +
              dossier
          ).toEqual([]);
        }
      }

      // THE ASSERTION THIS WHOLE FILE EXISTS FOR.
      expect(
        payment.deviceProtection,
        'DEVICE PROTECTION PRICING MISMATCH (subscription flow)\n\n' +
          `  Product: ${target.slug}/${target.bpid}\n` +
          `  Review Order Device Protection:    ₹${review.deviceProtection}\n` +
          `  Payment Summary Device Protection: ₹${payment.deviceProtection}\n` +
          `  Difference:                        ₹${(payment.deviceProtection ?? 0) - (review.deviceProtection ?? 0)}\n\n` +
          `  Review Order Total:    ₹${review.total}\n` +
          `  Payment Summary Total: ₹${payment.total}\n` +
          `  cart API total_vas_amount at review: ₹${apiVas}\n\n` +
          'Expected:\n  Device Protection should remain unchanged between Review Order and ' +
          'Payment Summary.\nActual:\n  Device Protection changed from ' +
          `₹${review.deviceProtection} to ₹${payment.deviceProtection}.\n\n` +
          dossier
      ).toBe(review.deviceProtection);

      assertAddsUp(payment, testInfo);

      // THE TWO PAGES QUOTE DIFFERENT BASES, so a bare total comparison would
      // fail on correct behaviour. Measured on order CM14082644F25B:
      //
      //   Review Order    product ₹54,999 - discount ₹23,000 + DP ₹1 = ₹32,000
      //   Payment Summary product ₹31,999 - EMI disc ₹1,442 + DP ₹1 = ₹30,558
      //
      // Review states MRP and the product discount; Payment Summary states the
      // already-discounted price and then applies the chosen plan's own
      // discount. Both are internally right. So the cross-page check is that
      // each figure follows from the other, and that the change is fully
      // explained by a NAMED payment-stage line — never assumed valid.
      const netAtReview = (review.productAmount ?? 0) - (review.discount ?? 0);
      expect(
        payment.productAmount,
        'THE PRODUCT AMOUNT CHANGED BETWEEN REVIEW ORDER AND PAYMENT SUMMARY\n\n' +
          `  review: ₹${review.productAmount} - ₹${review.discount} = ₹${netAtReview}\n` +
          `  payment summary price line: ₹${payment.productAmount}\n\n` +
          dossier
      ).toBe(netAtReview);

      const paymentStageDiscount = payment.discount ?? 0;
      expect(
        payment.total,
        'THE TOTAL PAYABLE CHANGED BY MORE THAN THE NAMED CHECKOUT LINES EXPLAIN\n\n' +
          `  Review Order Total:        ₹${review.total}\n` +
          `  payment-stage discount:   -₹${paymentStageDiscount}` +
          `${payment.discount ? ' (a named line on Payment Summary)' : ' (none named)'}\n` +
          `  expected Payment Total:    ₹${review.total - paymentStageDiscount}\n` +
          `  actual Payment Total:      ₹${payment.total}\n` +
          `  unexplained difference:    ₹${(payment.total ?? 0) - (review.total - paymentStageDiscount)}\n\n` +
          `  bank interest (charged on top, not part of the order): ₹${payment.interest}\n` +
          `  total cost of the plan: ₹${payment.totalCost}\n\n` +
          `  components that moved: ${JSON.stringify(diffComponents(review, payment), null, 1)}\n\n` +
          dossier
      ).toBe(review.total - paymentStageDiscount);
    });
  });
});
