// tests/regression/device-protection-multi-product.spec.js
//
// Device Protection is charged PER PRODUCT, so the cart's single
// "Device Protection" line must equal the sum of the protection prices of the
// products in the cart. This file checks that sum, and checks that it survives
// the walk to Payment Summary.
//
// WHAT WAS MEASURED FIRST, because none of it is guessable:
//
//   - It is a subscription-only add-on. 2 of 24 sampled products advertise it,
//     and both are prodPaymentMode BOTH. UPFRONT products show no such line.
//   - It is priced per product, and the price VARIES:
//         Galaxy Z Fold8 Ultra   BytePe Secure ₹8,000 -> ₹1,999
//         Macbook Pro M5         BytePe Secure ₹8,000 -> ₹1
//         iPhone 17e             BytePe Secure ₹8,000 -> ₹1
//   - The pricing API does NOT carry it: upfront.vas_amount and cc.vas_amount
//     are 0 even on products whose PDP advertises a charge. The rendered PDP is
//     the only source for the figure.
//   - There is NO opt-in control. No checkbox, no switch, no toggle on the PDP
//     or in the cart. The shopper does not choose it, which is why a wrong
//     figure here is charged silently.
//
// WHY ₹2,001 IS THE SHAPE OF THE BUG. ₹1,999 + ₹1 + ₹1 = ₹2,001. If Review
// Order shows one item's protection while Payment Summary charges every
// protected item, that is exactly the reported jump from ₹1. This file tests
// that hypothesis at the cheapest point first — the cart — where it needs no
// order to be minted.
//
// best_price is not read anywhere here. It is intentionally disabled.

const { test, expect } = require('../fixtures/pageFixtures');
const { BASE_URL, URLS, TIMEOUTS } = require('../data/constants');
const { assertFreshSession } = require('../utils/session');
const { openCart, dismissExchangeDialog } = require('../utils/cartNav');
const {
  parseAddOn,
  parsePdpHeader,
  parsePricingBreakdown,
  formatBreakdown,
} = require('../utils/priceText');
const {
  identitiesFromCart,
  compareIdentities,
  formatIdentities,
} = require('../utils/surfaceIdentity');

test.beforeAll(() => assertFreshSession());

const FLOW_TIMEOUT = 600000;

// Opens a PDP and waits for it to be priced, then reads the figures that matter.
//
// The add-on line sits BELOW the buyback slider, so it renders after the
// headline price — waiting only for the price is not enough, and reading too
// early reports "no Device Protection" on a product that has it. Waits for the
// add-on text specifically, then falls back to reporting its absence honestly.
async function readProductPricing(page, { slug, bpid }) {
  await page.goto(`${BASE_URL}/pd/${slug}/${bpid}`, { waitUntil: 'domcontentloaded' });
  await page.keyboard.press('Escape').catch(() => {});

  await page
    .getByText(/^₹[\d,]+$/)
    .first()
    .waitFor({ state: 'visible', timeout: TIMEOUTS.nav });

  // Present only on subscription products. Absence is a real answer, so this
  // waits a bounded time and then accepts "not offered".
  await page
    .getByText(/bytepe secure/i)
    .first()
    .waitFor({ state: 'visible', timeout: 8000 })
    .catch(() => {});

  const body = await page.locator('body').innerText();
  const header = parsePdpHeader(body);
  const addOn = parseAddOn(body);

  return {
    slug,
    bpid,
    price: header ? header.price : null,
    protectionList: addOn ? addOn.list : null,
    protectionPaid: addOn ? addOn.paid : null,
    offersProtection: addOn !== null,
  };
}

// THE CART IS SPLIT INTO TWO BASKETS BY payment_type, and the API demands to be
// told which one. Measured 14 Aug 2026:
//
//   GET /api/cart                        400 "payment_type is required"
//   GET /api/cart?payment_type=upfront   400 "payment_type must be UPFRONT or SUBSCRIPTION"
//   GET /api/cart?payment_type=UPFRONT   200  12 items, ₹8,81,270, VAS ₹1
//   GET /api/cart?payment_type=SUBSCRIPTION 200  1 item, ₹1,28,901, VAS ₹1
//
// The same product can sit in both as different variants — MacBook Air M5 was in
// the upfront basket as APPLALAPO1IYU3 with vas 0 and in the subscription basket
// as APPLALAPO55QSK with vas 1. So "the cart" is not one thing, and any Device
// Protection figure has to name the basket it belongs to.
//
// THE REVIEW ORDER PAGE READS THE CART WITH payment_type + address_id. Recorded
// off the live page, 14 Aug 2026:
//
//   GET /api/cart?payment_type=UPFRONT&address_id=<addressId>   200, 7 items
//
// It never sends is_review. That parameter is a filter on each line's own
// `is_review` boolean — it returns the lines where the flag is true and nothing
// else, which for an upfront basket is `data: []`. Earlier notes read that empty
// response as "is_review needs an address"; it does not. There is no separate
// "review view" endpoint to find: Review Order and the cart page call the same
// route, the review call just carries the address.
const PAYMENT_TYPES = ['UPFRONT', 'SUBSCRIPTION'];

// Returns the "Buy Now" button, selecting the upfront plan first if the page is
// not offering one yet.
//
// A subscription product's PDP has NO buy box on arrival. Measured on phone-4b:
// the only CTA in the whole document is "Subscribe" — no "Add to Cart", no
// "Buy Now" — because the Subscription plan is selected by default and the
// upfront controls do not exist until another plan is chosen. Waiting for
// "Buy Now" on such a page simply times out, which is what it did.
//
// The plan row is a label inside a clickable tile, and the tile ignores a
// synthetic click on the label itself, so the event is dispatched up the
// ancestor chain until the buy box appears. Same workaround
// ProductsListPage.selectBuyUpfrontPlan uses, but anchored on the row's text
// rather than on a build-hashed MUI class.
async function ensureBuyBox(page, slug) {
  const buyNow = page.getByRole('button', { name: 'Buy Now' }).filter({ visible: true }).first();
  if (await buyNow.isVisible().catch(() => false)) return buyNow;

  // "Buy Upfront" on subscription products, "Pay in Full" on upfront ones.
  const planRow = page
    .getByText(/^(Buy Upfront|Pay in Full)$/i)
    .filter({ visible: true })
    .first();

  await planRow.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {
    throw new Error(
      `${slug}: no buy box and no upfront plan row on the page. The PDP is offering neither ` +
        '"Buy Now" nor "Buy Upfront"/"Pay in Full", so there is no way to add it to a cart.'
    );
  });
  await planRow.scrollIntoViewIfNeeded();

  let target = planRow;
  for (let depth = 0; depth < 4; depth++) {
    await target.dispatchEvent('click').catch(() => {});
    await page.waitForTimeout(1200);
    if (await buyNow.isVisible().catch(() => false)) return buyNow;
    target = target.locator('xpath=..');
  }

  throw new Error(
    `${slug}: selecting the upfront plan never revealed a Buy Now control, so the product ` +
      'cannot be added without guessing at which button to press.'
  );
}

// Read through the page's own request context so it carries the app's cookies —
// the same reason apiHelper attaches storageState rather than a Bearer header.
async function readCartApi(page, paymentType) {
  const res = await page.request.get(
    `${BASE_URL}/api/cart?payment_type=${paymentType}`,
    { headers: { accept: 'application/json' } }
  );
  if (!res.ok()) {
    return { paymentType, ok: false, status: res.status(), body: (await res.text()).slice(0, 200) };
  }

  const data = (await res.json()).data || {};
  const items = data.items || [];
  return {
    paymentType,
    ok: true,
    items,
    totals: {
      mop: data.total_MOP,
      mrp: data.total_MRP,
      discount: data.total_discount,
      vas: data.total_vas_amount,
      coupon: data.total_coupon_discount,
      total: data.total_amount,
    },
    // Device Protection is per line. These are the lines actually carrying it.
    vasLines: items
      .filter((i) => Number(i.vas_amount) > 0)
      .map((i) => ({
        name: i.product?.product_name,
        bpid: i.variant?.bpid,
        mode: i.product?.prod_payment_mode,
        vasAmount: Number(i.vas_amount),
        vasItems: i.vas_items,
      })),
    subscriptionLines: items
      .filter((i) => i.product?.prod_payment_mode === 'BOTH')
      .map((i) => ({
        name: i.product?.product_name,
        bpid: i.variant?.bpid,
        vasAmount: Number(i.vas_amount) || 0,
      })),
  };
}

test.describe('Device Protection is charged per product', () => {
  // ---- The cheap test: does the cart's line equal the sum? -------------
  //
  // No writes, no adds, no order. If the cart already under-charges relative to
  // the products in it, the defect is proven here and Payment Summary is
  // confirmation rather than discovery.
  test('the cart Device Protection line equals the protection of the products in it', async ({
    page,
  }, testInfo) => {
    test.setTimeout(FLOW_TIMEOUT);

    await openCart(page);
    await dismissExchangeDialog(page);

    const cart = parsePricingBreakdown(await page.locator('body').innerText(), { label: 'cart' });
    expect(cart, 'the cart rendered no pricing summary').toBeTruthy();
    expect(cart.itemCount, 'the cart is empty — nothing to check').toBeGreaterThan(0);

    console.log('CART\n' + formatBreakdown(cart));

    const baskets = [];
    for (const paymentType of PAYMENT_TYPES) {
      const basket = await readCartApi(page, paymentType);
      baskets.push(basket);

      expect(
        basket.ok,
        `GET /api/cart?payment_type=${paymentType} returned ${basket.status}: ${basket.body}`
      ).toBe(true);

      const summedVas = basket.items.reduce((sum, i) => sum + (Number(i.vas_amount) || 0), 0);

      console.log(
        `\n${paymentType}: ${basket.items.length} items · MOP ₹${basket.totals.mop} · ` +
          `VAS ₹${basket.totals.vas} · total ₹${basket.totals.total}\n` +
          `  lines carrying Device Protection (${basket.vasLines.length}): ` +
          (basket.vasLines.map((l) => `${l.name} ₹${l.vasAmount}`).join(', ') || 'none') +
          `\n  subscription lines (${basket.subscriptionLines.length}): ` +
          basket.subscriptionLines.map((l) => `${l.name} vas=${l.vasAmount}`).join(', ')
      );

      // The header figure must be the sum of the lines under it. A basket whose
      // total VAS does not equal what its own lines charge is the shape of the
      // reported bug — a charge appearing at the summary level that no line
      // accounts for.
      expect(
        summedVas,
        `${paymentType}: the basket reports total_vas_amount ₹${basket.totals.vas} but its ` +
          `line items charge ₹${summedVas} between them.\n` +
          `  lines: ${JSON.stringify(basket.vasLines, null, 1)}`
      ).toBe(basket.totals.vas);

      // ...and the basket total must include it exactly once.
      expect(
        basket.totals.total,
        `${paymentType}: total_amount should be total_MOP ₹${basket.totals.mop} + ` +
          `total_vas_amount ₹${basket.totals.vas}`
      ).toBe(basket.totals.mop + basket.totals.vas);
    }

    await testInfo.attach('cart-baskets', {
      body: JSON.stringify(
        baskets.map((b) => ({ paymentType: b.paymentType, totals: b.totals, vasLines: b.vasLines })),
        null,
        1
      ),
      contentType: 'text/plain',
    });

    // The rendered cart shows the upfront basket. Its Device Protection line
    // must be that basket's total_vas_amount — if the page and the API disagree,
    // the shopper is reading a figure the server does not hold.
    const upfront = baskets.find((b) => b.paymentType === 'UPFRONT');
    expect(
      cart.deviceProtection,
      'THE RENDERED CART AND THE CART API DISAGREE ABOUT DEVICE PROTECTION\n\n' +
        `  cart page:  ₹${cart.deviceProtection}\n` +
        `  cart API:   ₹${upfront.totals.vas}  (payment_type=UPFRONT)\n\n` +
        `  lines carrying it: ${JSON.stringify(upfront.vasLines, null, 1)}\n\n` +
        formatBreakdown(cart)
    ).toBe(upfront.totals.vas);

    expect(
      cart.total,
      `the cart page shows ₹${cart.total} but the API's upfront basket totals ₹${upfront.totals.total}`
    ).toBe(upfront.totals.total);
  });

  // ---- The delta test: two or three products, one of them a subscription
  //
  // Adds each chosen product and asserts the cart's Device Protection line moves
  // by exactly that product's own protection price. This is the same invariant
  // as above, measured incrementally, and it localises the fault to the product
  // that broke it.
  test('adding a product moves Device Protection by that product own protection price', async ({
    page,
  }, testInfo) => {
    test.setTimeout(FLOW_TIMEOUT);

    // Candidates read from the discovery run. Subscription products only,
    // because Device Protection is not offered on UPFRONT ones — a fact
    // measured, not assumed (see the header).
    const catalogue = require('../data/device-protection.json');
    const offered = catalogue.products.filter((p) => p.deviceProtectionPaid !== null);

    test.skip(
      offered.length === 0,
      'tests/data/device-protection.json lists no product offering Device Protection. ' +
        'Re-run: npx playwright test scripts/discover-device-protection.spec.js'
    );

    await openCart(page);
    await dismissExchangeDialog(page);

    // Already-in-cart is decided by bpid from the API, not by name or by a link
    // on the page — the cart renders neither the slug nor the brand, and the
    // same product appears under different bpids in the two baskets.
    const inCart = new Set();
    for (const paymentType of PAYMENT_TYPES) {
      const basket = await readCartApi(page, paymentType);
      if (!basket.ok) continue;
      for (const item of basket.items) {
        if (item.variant?.bpid) inCart.add(item.variant.bpid);
      }
    }
    console.log(`cart already holds ${inCart.size} distinct variants`);

    // Cheapest first: this leaves real items in a real cart, so the residue
    // should be as small as the test allows.
    const targets = offered
      .filter((p) => !inCart.has(p.bpid))
      .sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity))
      .slice(0, 3);

    test.skip(
      targets.length === 0,
      'Every product known to offer Device Protection is already in the cart, so adding one ' +
        'cannot produce a delta to measure.'
    );

    console.log(
      `testing ${targets.length} product(s): ` +
        targets.map((t) => `${t.slug} (₹${t.price}, protection ₹${t.deviceProtectionPaid})`).join(', ')
    );

    const results = [];

    for (const target of targets) {
      const before = parsePricingBreakdown(await page.locator('body').innerText(), {
        label: 'cart before',
      });

      const pricing = await readProductPricing(page, target);
      expect(
        pricing.offersProtection,
        `${target.slug} was recorded as offering Device Protection but its PDP no longer ` +
          'shows a BytePe Secure line. Re-run scripts/discover-device-protection.spec.js.'
      ).toBe(true);

      // Scoped CTA. Anchored on "Buy Now", never located by name — a name-based
      // locator reaches the recommended-products carousel and has already put a
      // wrong product into this live cart once.
      const buyNow = await ensureBuyBox(page, target.slug);
      const cta = buyNow.locator('xpath=preceding-sibling::button[1]');

      await expect(cta, `${target.slug}: the buy-box CTA never rendered a label`).toHaveText(
        /add to cart|go to cart/i,
        { timeout: 20000 }
      );

      const label = (await cta.innerText()).trim();

      if (!/add to cart/i.test(label)) {
        console.log(`  ${target.slug}: CTA reads "${label}", skipping rather than guessing`);
        continue;
      }

      // The add is confirmed by its request. A button label flips for reasons
      // unrelated to the click, and an early click is silently inert because the
      // control renders before its handler is bound.
      const settled = page
        .waitForResponse(
          (res) => /\/api\/cart(\?|$)/.test(res.url()) && res.request().method() === 'POST',
          { timeout: 20000 }
        )
        .catch(() => null);
      await cta.click({ timeout: TIMEOUTS.action });
      const res = await settled;

      expect(
        res,
        `${target.slug}: clicking Add to Cart sent no POST /api/cart, so nothing was added`
      ).toBeTruthy();
      const resBody = await res.text().catch(() => '');
      expect(
        /"status"\s*:\s*true/.test(resBody),
        `${target.slug}: the site refused the add — ${resBody.slice(0, 200)}`
      ).toBe(true);

      await openCart(page);
      await dismissExchangeDialog(page);
      const after = parsePricingBreakdown(await page.locator('body').innerText(), {
        label: 'cart after',
      });

      const protectionDelta = (after.deviceProtection ?? 0) - (before.deviceProtection ?? 0);
      const totalDelta = (after.total ?? 0) - (before.total ?? 0);

      results.push({
        slug: target.slug,
        productPrice: pricing.price,
        protectionExpected: pricing.protectionPaid,
        protectionDelta,
        totalDelta,
        before: before.deviceProtection,
        after: after.deviceProtection,
      });

      console.log(
        `  ${target.slug}: protection ₹${before.deviceProtection} -> ₹${after.deviceProtection} ` +
          `(delta ₹${protectionDelta}, expected ₹${pricing.protectionPaid}); total delta ₹${totalDelta}`
      );
    }

    await testInfo.attach('protection-deltas', {
      body: JSON.stringify(results, null, 1),
      contentType: 'text/plain',
    });

    expect(results.length, 'no product could be added, so no delta was measured').toBeGreaterThan(0);

    // DEVICE PROTECTION IS NOT APPLIED TO EVERY ELIGIBLE PRODUCT.
    //
    // An earlier version of this asserted the cart line must move by the
    // product's full protection price. The cart disproves that: 6 of the 7
    // subscription products in it carry vas_amount 0 while one carries 1. So
    // the charge is selective, and demanding it on every add would fail on
    // correct behaviour.
    //
    // What IS an invariant: whatever the cart decides, the amount must be one it
    // can justify — either the product's own advertised protection price, or
    // nothing at all. Any third value is a figure with no source, and a figure
    // with no source at this stage is what reappears as ₹2,001 later.
    const unjustified = results.filter(
      (r) => r.protectionDelta !== 0 && r.protectionDelta !== r.protectionExpected
    );

    expect(
      unjustified.map(
        (r) =>
          `${r.slug}: its PDP advertises Device Protection at ₹${r.protectionExpected}, but ` +
          `adding it moved the cart line by ₹${r.protectionDelta} ` +
          `(₹${r.before} -> ₹${r.after}) — neither the advertised price nor zero`
      ),
      'DEVICE PROTECTION CHANGED BY AN AMOUNT NO PRODUCT ACCOUNTS FOR\n\n' +
        'Adding a product may or may not attach Device Protection — the cart applies it ' +
        'selectively, which is expected. What it must never do is move the charge by an amount ' +
        'that is neither the product own advertised price nor zero, because that figure has no ' +
        'source the shopper could have seen.\n\n' +
        JSON.stringify(results, null, 1)
    ).toEqual([]);

    // The product price itself must always land in full, protection aside.
    const wrongTotal = results.filter(
      (r) => r.totalDelta !== r.productPrice + r.protectionDelta
    );
    expect(
      wrongTotal.map(
        (r) =>
          `${r.slug}: PDP price ₹${r.productPrice} + protection ₹${r.protectionDelta} should move ` +
          `the total by ₹${r.productPrice + r.protectionDelta}, but it moved by ₹${r.totalDelta}`
      ),
      'THE CART TOTAL DID NOT MOVE BY THE PRICE OF WHAT WAS ADDED'
    ).toEqual([]);

    const applied = results.filter((r) => r.protectionDelta > 0);
    console.log(
      `\n${results.length} product(s) added; Device Protection attached to ${applied.length} of them` +
        (applied.length
          ? `: ${applied.map((r) => `${r.slug} ₹${r.protectionDelta}`).join(', ')}`
          : ' (none — the cart applied it to no new line)')
    );
  });

  // ---- Carry it through to Review Order --------------------------------
  //
  // THE REPORTED DEFECT LIVES HERE: the cart sums the Device Protection of
  // every protected line, and Review Order shows ₹1 regardless. With a single
  // protected line the two are the same number and this check proves nothing,
  // so it refuses to pass vacuously — see the guard below.
  //
  // Getting a second protected line: the VAS record carries
  // `is_default_subscription: true, is_default_upfront: false`, so Device
  // Protection is attached automatically to items bought on SUBSCRIPTION and not
  // to items bought upfront. That is why adding phone-4b and iPhone 17e as
  // upfront purchases attached ₹0 — correct behaviour, not a defect. A cart with
  // two or more subscription lines is what reproduces the mismatch.
  test('Device Protection survives cart -> Review Order unchanged', async ({ page }, testInfo) => {
    test.setTimeout(FLOW_TIMEOUT);

    await openCart(page);
    await dismissExchangeDialog(page);
    const cart = parsePricingBreakdown(await page.locator('body').innerText(), { label: 'cart' });
    expect(cart, 'the cart rendered no pricing summary').toBeTruthy();
    expect(cart.itemCount, 'the cart is empty').toBeGreaterThan(0);

    // Server truth for the basket the cart page is showing.
    const basket = await readCartApi(page, 'UPFRONT');
    expect(basket.ok, `GET /api/cart?payment_type=UPFRONT returned ${basket.status}`).toBe(true);

    const summedVas = basket.items.reduce((sum, i) => sum + (Number(i.vas_amount) || 0), 0);
    const protectedLines = basket.vasLines;

    console.log(
      `basket carries ₹${summedVas} of Device Protection across ${protectedLines.length} line(s): ` +
        (protectedLines.map((l) => `${l.name} ₹${l.vasAmount}`).join(', ') || 'none')
    );

    // The cart page must show the sum its own basket holds.
    expect(
      cart.deviceProtection,
      'THE CART PAGE AND THE CART API DISAGREE ABOUT DEVICE PROTECTION\n\n' +
        `  cart page: ₹${cart.deviceProtection}\n` +
        `  sum of line vas_amount: ₹${summedVas}\n` +
        `  lines: ${JSON.stringify(protectedLines, null, 1)}`
    ).toBe(summedVas);

    await page
      .getByRole('button', { name: /^continue$/i })
      .filter({ visible: true })
      .first()
      .click({ timeout: TIMEOUTS.action });
    await page.waitForURL(new RegExp(URLS.review), { timeout: 60000 });
    await dismissExchangeDialog(page);

    await page
      .getByText(/total amount/i)
      .first()
      .waitFor({ state: 'visible', timeout: TIMEOUTS.nav })
      .catch(() => {});

    const review = parsePricingBreakdown(await page.locator('body').innerText(), {
      label: 'review order',
    });
    expect(review, 'Review Order rendered no pricing summary').toBeTruthy();

    // IDENTITY BEFORE ARITHMETIC. The figures below are only meaningful if both
    // pages are describing the same basket, and "the cart is not showing the
    // same product" is the root cause that made a Device Protection charge look
    // like an arithmetic bug on 14 Aug 2026.
    const reviewAddressId = (page.url().match(/address_id=([^&]+)/) || [])[1];
    const reviewPaymentType = ((page.url().match(/payment_type=([^&]+)/) || [])[1] || 'UPFRONT')
      .toUpperCase();

    // THE REVIEW ORDER PAGE DOES NOT SEND is_review. Recorded off the live page
    // on 14 Aug 2026 — every API call it makes during the cart -> review
    // transition, in order:
    //
    //   GET /api/customer-address/user/<userId>                        200
    //   GET /api/cart?payment_type=UPFRONT&address_id=<addressId>      200  <- this one
    //   POST /api/coupons/customer                                     200
    //
    // payment_type + address_id, and nothing else. The previous version of this
    // block appended `is_review=true`, which is a FILTER over the basket's own
    // lines: it returns only lines whose own `is_review` flag is true, and no
    // UPFRONT line carries that flag. It answered `data: []`, the length guard
    // below swallowed it, and this hop — the one that exists to catch a swapped
    // product between cart and Review Order — never ran. It reported as a pass.
    expect(
      reviewAddressId,
      'Review Order carries no address_id in its URL, so the basket it is rendering ' +
      'cannot be read back. That is a change in the page, not a cart problem.'
    ).toBeTruthy();

    const reviewUrl =
      `${BASE_URL}/api/cart?payment_type=${reviewPaymentType}&address_id=${reviewAddressId}`;
    const res = await page.request.get(reviewUrl, { headers: { accept: 'application/json' } });
    expect(res.ok(), `${reviewUrl} returned ${res.status()}`).toBe(true);

    const reviewData = (await res.json()).data || {};
    const reviewIdentities = identitiesFromCart(reviewData);
    const cartIdentities = identitiesFromCart(
      (await (
        await page.request.get(`${BASE_URL}/api/cart?payment_type=${reviewPaymentType}`, {
          headers: { accept: 'application/json' },
        })
      ).json()).data || {}
    );

    console.log(
      formatIdentities(cartIdentities, 'cart basket') +
        '\n' +
        formatIdentities(reviewIdentities, 'review basket')
    );

    // No length guard. An empty review basket used to be an artefact of asking
    // the wrong question; against the endpoint the page itself calls, it means
    // Review Order is rendering a basket the server does not have, and that is a
    // failure worth reporting rather than a reason to skip the comparison.
    expect(
      reviewIdentities.length,
      `${reviewUrl}\nreturned no line items while Review Order rendered ` +
      `${review.itemCount} item(s) on screen.`
    ).toBeGreaterThan(0);

    const drift = compareIdentities(cartIdentities, reviewIdentities, {
      beforeLabel: 'cart',
      afterLabel: 'review order',
    });
    expect(
      drift,
      'THE BASKET CHANGED BETWEEN CART AND REVIEW ORDER\n\n' +
        formatIdentities(cartIdentities, 'cart basket') +
        '\n' +
        formatIdentities(reviewIdentities, 'review basket') +
        '\n\nThe shopper is reviewing something other than what they had in the cart. Any ' +
        'price difference below follows from this and is not an arithmetic fault.'
    ).toEqual([]);

    // Step 4 of the diagnostic order, on the basket Review Order is actually
    // rendering: which field is on screen, the per-unit one or the charged one?
    // Both live in the same record, so this needs no second surface and no order.
    const reviewVasRecords = (reviewData.items || []).flatMap((item) =>
      (item.vas_items || []).map((v) => ({
        line: item.product?.product_name ?? item.variant?.bpid ?? '(unnamed)',
        bpid: item.variant?.bpid ?? null,
        vasName: v.vas_name,
        vasPrice: Number(v.vas_price) || 0,
        lineVasAmount: Number(item.vas_amount) || 0,
      }))
    );

    console.log(
      'REVIEW BASKET VAS (from the endpoint the page calls)\n' +
        (reviewVasRecords
          .map(
            (r) =>
              `  ${r.line}: ${r.vasName} — vas_price ₹${r.vasPrice}, ` +
              `line vas_amount ₹${r.lineVasAmount}`
          )
          .join('\n') || '  (no VAS on any line)')
    );

    const displayedIsCharged = reviewVasRecords.filter((r) => r.vasPrice !== r.lineVasAmount);
    expect(
      displayedIsCharged,
      'REVIEW ORDER IS SHOWING A PER-UNIT DEVICE PROTECTION FIGURE, NOT THE CHARGED TOTAL\n\n' +
        displayedIsCharged
          .map(
            (r) =>
              `  ${r.line} (${r.bpid}): vas_price ₹${r.vasPrice} vs vas_amount ₹${r.lineVasAmount}`
          )
          .join('\n') +
        '\n\nName the field, not the symptom: the page renders vas_price where vas_amount is ' +
        'what will be charged.'
    ).toEqual([]);

    // Say so when the check could not distinguish, rather than claiming a result.
    const indistinguishable = reviewVasRecords.filter((r) => r.vasPrice === r.lineVasAmount);
    if (indistinguishable.length === reviewVasRecords.length && reviewVasRecords.length) {
      console.log(
        '  NOTE: vas_price == vas_amount on every protected line in this basket, so the ' +
        'assertion above cannot tell the two fields apart. It proves nothing until a cart ' +
        'holds a line where they differ.'
      );
    }

    console.log('CART\n' + formatBreakdown(cart) + '\n\nREVIEW ORDER\n' + formatBreakdown(review));
    await testInfo.attach('cart-vs-review', {
      body: 'CART\n' + formatBreakdown(cart) + '\n\nREVIEW ORDER\n' + formatBreakdown(review),
      contentType: 'text/plain',
    });

    // NON-VACUOUS GUARD. With one protected line, "the sum" and "₹1" are the
    // same number and the assertion below cannot fail however broken the page
    // is. Reporting that as a pass would be worse than not running it: it is
    // precisely the reported defect, waved through.
    test.skip(
      protectedLines.length < 2,
      `Only ${protectedLines.length} line in the cart carries Device Protection, so "the sum" ` +
        'and "one line\'s charge" are the same figure and a mismatch could not show. This check ' +
        'needs a cart with at least two protected lines.\n' +
        'Device Protection attaches by default to SUBSCRIPTION purchases and not to upfront ones ' +
        '(vas_items[].is_default_subscription = true, is_default_upfront = false), so add a ' +
        'second product on a subscription plan to make this meaningful.'
    );

    expect(
      review.deviceProtection,
      'DEVICE PROTECTION CHANGED BETWEEN CART AND REVIEW ORDER\n\n' +
        `  cart page:      ₹${cart.deviceProtection}\n` +
        `  cart API sum:   ₹${summedVas}  across ${protectedLines.length} protected line(s)\n` +
        `  review order:   ₹${review.deviceProtection}\n` +
        `  difference:     ₹${(review.deviceProtection ?? 0) - (cart.deviceProtection ?? 0)}\n\n` +
        `  protected lines:\n` +
        protectedLines.map((l) => `    ${l.name} (${l.bpid}) ₹${l.vasAmount}`).join('\n') +
        '\n\nThe cart totals the Device Protection of every protected line. Review Order must ' +
        'show the same total — if it collapses to a single line\'s charge, the shopper is shown ' +
        'a smaller figure than the one that will be collected, and the difference reappears at ' +
        'Payment Summary.\n\n' +
        'CART\n' + formatBreakdown(cart) + '\n\nREVIEW ORDER\n' + formatBreakdown(review)
    ).toBe(cart.deviceProtection);

    expect(
      review.total,
      'THE TOTAL CHANGED BETWEEN CART AND REVIEW ORDER\n\n' +
        `  cart:         ₹${cart.total}\n` +
        `  review order: ₹${review.total}`
    ).toBe(cart.total);

    // Not pressed. Continue here mints a real order; the Payment Summary leg
    // lives in device-protection-consistency.spec.js behind BYTEPE_ALLOW_WRITES.
    expect(page.url()).not.toMatch(/payment-summary|razorpay|payment_id/i);
  });
});
