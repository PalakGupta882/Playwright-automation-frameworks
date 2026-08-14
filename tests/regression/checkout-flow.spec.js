// tests/regression/checkout-flow.spec.js
//
// Revenue path: product -> Add to Cart -> Cart -> Continue -> Review Order.
//
// STOPS AT REVIEW ORDER. Continue on that page is what mints the order
// (subscription-e2e.spec.js documents the same boundary). Nothing here clicks
// it, so this spec creates no order and moves no money. It does add one item to
// the real cart on the real account each run.
//
// LOGIN-GATED. The cart belongs to an account, so this needs a live session.
// There is no in-test login on purpose: every spec here inherits storageState
// from playwright.config.js and guards it with assertFreshSession(), which
// fails fast with the real reason instead of timing out on a control that only
// renders for a logged-in user.
//
// WHAT THIS PAGE ACTUALLY SHOWS, measured before the assertions were written:
//
//   Delivering to: <name> <address> <phone>   [Change Address]
//   <product> ₹<price> <was> <n>% off  Qty: 1   Free Delivery by <date>
//   Add Coupon [Apply]  BYTE500 / SF5000
//   Order Summary: Price (N Items) ₹X | Discount -₹Y | Total Amount ₹Z
//   Continue
//
// Two consequences for the assertions below:
//
// 1. There is NO shipping cost line. Delivery is expressed per item as "Free
//    Delivery by <date>" — a /shipping/i search returns zero matches. So this
//    asserts the delivery promise that exists, not a shipping figure that does
//    not.
// 2. There is NO payment gateway on this page: no Razorpay iframe, no Razorpay
//    text. The gateway lives on /payment-summary, which is only reachable by
//    pressing Continue and minting a real order. Verifying it is therefore not
//    free, and is deliberately out of scope here — see the note at the end.

const { test, expect } = require('../fixtures/pageFixtures');
const { CartPage } = require('../pages/cartPage');
const { BASE_URL, URLS, TIMEOUTS } = require('../data/constants');
const { assertFreshSession } = require('../utils/session');

test.beforeAll(() => assertFreshSession());

// "₹3,39,898" -> 339898. Throws rather than returning NaN: a helper that
// returned 0 would let `expect(total).toBe(price - discount)` pass as 0 === 0
// on a page that rendered no figures at all.
function toRupees(text) {
  const match = (text || '').match(/₹\s?([\d,]+)/);
  const value = match ? Number(match[1].replace(/,/g, '')) : NaN;
  if (!Number.isFinite(value)) {
    throw new Error(`expected a rupee amount, read ${JSON.stringify(text)}`);
  }
  return value;
}

// Reads the Order Summary figures.
//
// Parsed out of the page text rather than per-element: the label and the amount
// are separate nodes, so getByText(/Price \(N Items\)/) resolves to the label
// alone and yields no number at all.
//
// THE SUMMARY IS NOT JUST PRICE, DISCOUNT AND TOTAL. Measured 10 Aug 2026:
//
//     Price (18 Items)     ₹9,30,391
//     Discount            -₹1,89,404
//     Device Protection          ₹1     <- add-on line, easy to miss
//     Total Amount         ₹7,40,988
//
// This spec previously asserted `total === price - discount` and failed by
// exactly ₹1. That was read as a rounding defect; it was not. The cart API
// carries the same figure as `total_vas_amount`, and
// `total_MOP (740987) + total_vas_amount (1) === total_amount (740988)` exactly.
// The site's arithmetic was right and the assertion's model was incomplete.
//
// So rather than name the add-on, everything charged between the Discount line
// and Total Amount is summed. The site currently offers one value-added service
// ("12 mo Device Protection", ₹1, mandatory on some items), but a second one —
// a fee, a warranty, a delivery charge — must not silently reintroduce the same
// false failure. Summing the region generalises; matching /Device Protection/
// would not.
function readOrderSummary(bodyText) {
  const flat = bodyText.replace(/\s+/g, ' ');
  const grab = (pattern, label) => {
    const found = flat.match(pattern);
    if (!found) throw new Error(`could not find ${label} in the order summary`);
    return toRupees(found[0]);
  };

  const priceMatch = flat.match(/Price\s*\(\d+\s*Items?\)\s*₹\s?[\d,]+/i);
  if (!priceMatch) throw new Error('could not find the price line in the order summary');

  const price = toRupees(priceMatch[0]);
  const total = grab(/Total Amount\s*₹\s?[\d,]+/i, 'the total amount');
  const discountMatch = flat.match(/Discount\s*-\s*₹\s?[\d,]+/i);
  const discount = discountMatch ? toRupees(discountMatch[0]) : 0;

  // Everything between the last of (price line, discount line) and Total Amount.
  // Anchored on indices rather than a lookahead regex so the region is also
  // reportable in the failure message below — a mismatch is far easier to
  // diagnose when you can see the lines that were actually charged.
  const lastKnown = discountMatch
    ? flat.indexOf(discountMatch[0]) + discountMatch[0].length
    : priceMatch.index + priceMatch[0].length;
  const totalAt = flat.search(/Total Amount\s*₹/i);

  const extrasRegion = totalAt > lastKnown ? flat.slice(lastKnown, totalAt) : '';
  const extras = (extrasRegion.match(/₹\s?[\d,]+/g) || []).reduce(
    (sum, amount) => sum + toRupees(amount),
    0
  );

  return { price, total, discount, extras, extrasRegion: extrasRegion.trim() };
}

// Clears the "Exchange is now available!" promo dialog, which otherwise
// intercepts pointer events and times out a click on a visible control.
//
// Moved to tests/utils/cartNav.js when pricing-checkout-consistency.spec.js
// needed the same behaviour. openCart() moved with it — this file defined one
// and never called it, reaching the cart through CartPage.addFirstProductToCart
// instead. The note at the end of this file about openCart() absorbing the
// nitro crash was describing a function that did not run here.
const { dismissExchangeDialog } = require('../utils/cartNav');

test.describe('Checkout flow (stops before payment)', () => {
  test('cart through to review order', async ({ page }, testInfo) => {
    // Four real page loads plus the pricing round trip behind the cart.
    test.setTimeout(180000);

    const cart = new CartPage(page);

    const shot = async (name) => {
      const file = testInfo.outputPath(`${name}.png`);
      await page.screenshot({ path: file, fullPage: true });
      await testInfo.attach(name, { path: file, contentType: 'image/png' });
    };

    await test.step('1. add a product to the cart', async () => {
      // Reuses the page object rather than reimplementing it: this already
      // handles subscription-first products, which lead with "Subscribe" and
      // only expose Add to Cart once a plan is picked.
      await cart.addFirstProductToCart();
      await expect(page).toHaveURL(new RegExp(URLS.cart), { timeout: TIMEOUTS.nav });
      await shot('01-cart');
    });

    // PRESENCE — the cart is not empty, and says what it will deliver where.
    await test.step('2. the cart shows items and a delivery address', async () => {
      await expect(page.getByText(/delivering to/i).first()).toBeVisible({ timeout: TIMEOUTS.nav });
      await expect(page.getByText(/order summary/i).first()).toBeVisible();
      await expect(page.getByText(/total amount/i).first()).toBeVisible();

      // Non-empty, proven by the summary naming a count rather than by the
      // absence of an "empty cart" message.
      const priceLine = await page.getByText(/price\s*\(\d+\s*items?\)/i).first().innerText();
      const itemCount = Number(priceLine.match(/\((\d+)/)[1]);
      expect(itemCount, 'the cart reported zero items').toBeGreaterThan(0);
      console.log(`cart holds ${itemCount} item(s)`);
    });

    await test.step('3. Continue moves from cart to Review Order', async () => {
      await dismissExchangeDialog(page);
      await page
        .getByRole('button', { name: /^continue$/i })
        .first()
        .click({ timeout: TIMEOUTS.action });

      await page.waitForURL(new RegExp(URLS.review), { timeout: 60000 });
      await dismissExchangeDialog(page);
      await shot('02-review-order');
    });

    // PRESENCE — everything the shopper needs to decide, on one page.
    await test.step('4. review order shows address, items and totals', async () => {
      await expect(page.getByText(/delivering to/i).first()).toBeVisible({ timeout: TIMEOUTS.nav });
      await expect(page.getByText(/order summary/i).first()).toBeVisible();
      await expect(page.getByText(/total amount/i).first()).toBeVisible();

      // Product detail: a line item with a quantity, and a price on the page.
      await expect(page.getByText(/qty:\s*\d+/i).first()).toBeVisible();
      await expect(page.getByText(/₹\s?[\d,]+/).first()).toBeVisible();

      // The delivery promise, which is what this site shows instead of a
      // shipping cost line.
      await expect(page.getByText(/free delivery/i).first()).toBeVisible();
    });

    // CORRECTNESS — the arithmetic the shopper is asked to trust.
    await test.step('5. total amount equals price minus discount plus add-ons', async () => {
      const { price, discount, extras, extrasRegion, total } = readOrderSummary(
        await page.locator('body').innerText()
      );

      console.log(
        `price ₹${price} - discount ₹${discount} + add-ons ₹${extras} = total ₹${total}` +
          (extras ? `   [add-on lines: ${extrasRegion}]` : '')
      );

      expect(
        total,
        'the order total does not follow from the line items — the shopper is being shown ' +
          'a figure that price, discount and the charged add-ons do not add up to.\n' +
          `  price     ₹${price}\n` +
          `  discount -₹${discount}\n` +
          `  add-ons  +₹${extras}  ${extrasRegion ? `(${extrasRegion})` : '(none on the page)'}\n` +
          `  expected  ₹${price - discount + extras}\n` +
          `  shown     ₹${total}\n` +
          'If the difference matches an add-on line that is not listed above, the summary ' +
          'grew a charge this parser does not read yet.'
      ).toBe(price - discount + extras);
    });

    // BEHAVIOUR + the stop line. Continue is what mints the order: it must be
    // present, because its absence means the flow is broken rather than that we
    // stopped safely — and it must not be pressed. Nothing below touches it.
    await test.step('6. stopped at review order, before any order is created', async () => {
      await expect(
        page.getByRole('button', { name: /^continue$/i }).first()
      ).toBeVisible({ timeout: TIMEOUTS.nav });

      await expect(page).toHaveURL(new RegExp(URLS.review));
      expect(page.url()).not.toMatch(/payment-summary|razorpay|payment_id/i);

      console.log('Stopped at Review Order without pressing Continue:', page.url());
    });
  });

  // NEGATIVE — a logged-out visitor must not reach a populated checkout.
  //
  // Chosen over two alternatives that looked obvious and were not:
  //
  //   "what if the cart is empty" — emptying the real cart destroys state the
  //   other specs here depend on, and there is no fixture to rebuild it.
  //
  //   "apply an invalid coupon" — reviewOrderPage.applyCoupon() resolves Apply
  //   with getByText('Apply', { exact: true }).first(), and the review page
  //   lists BYTE500 and SF5000 each with their own Apply control. That risks
  //   applying a real discount to a real cart instead of testing a rejection.
  //
  // This creates nothing and guards something that matters: another person's
  // cart and home address must not render for an unauthenticated visitor.
  test('a logged-out visitor gets no cart contents or checkout control', async ({ browser }) => {
    test.setTimeout(120000);

    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage();

    try {
      await page.goto(`${BASE_URL}${URLS.cart}?flow=shopping`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(5000);

      // Non-vacuous, twice over: prove the page rendered before asserting
      // things are absent from it, and prove we are actually logged out — the
      // header Login control is the site's own signal for that, and it is what
      // the header shows instead of My Profile.
      await expect(page.getByText('Login').first()).toBeVisible({ timeout: 30000 });

      const text = await page.locator('body').innerText();
      expect(text.length, 'the logged-out cart rendered an empty document').toBeGreaterThan(50);

      expect(text, 'a logged-out visitor was shown an order total').not.toMatch(/total amount/i);
      expect(text, 'a logged-out visitor was shown a delivery address').not.toMatch(/delivering to/i);
    } finally {
      await context.close();
    }
  });

  // There is deliberately no test asserting the cart loads without a
  // client-side exception.
  //
  // /cart?flow=shopping intermittently throws
  // `window?.nitro?.updatecart is not a function` and Next.js swaps the page
  // for "Application error: a client-side exception has occurred" — measured 7
  // of 9 loads with a populated cart, 0 of 6 with an empty one. That was raised
  // and is accepted as expected behaviour, so the suite does not fail on it.
  //
  // openCart() in tests/utils/cartNav.js absorbs it by reloading, and
  // pricing-checkout-consistency.spec.js reaches the cart that way. That is a
  // deliberate choice to ignore a known condition, not an oversight — if the
  // accepted status ever changes, the guard belongs here.
  //
  // Full analysis, with timings and proof: docs/BUG-01-cart-nitro-crash.pdf
});
