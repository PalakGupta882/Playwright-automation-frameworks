// tests/api/cart-api.spec.js
//
// Cart API. **This is a real shopper's real cart on production.**
//
// Read before extending:
//
//   1. There is no add-to-cart endpoint. The client ships exactly five cart
//      routes — GET /cart, POST /cart, PUT /cart/:cartId, PUT /cart/remove/:id,
//      DELETE /cart/vas/:id — and none of them is named add. The brief asked for
//      POST /cart/add; it does not exist. Nothing here pretends otherwise.
//
//   2. Because there is no add, this suite cannot seed its own fixture. The
//      write cases operate on whatever is already in the account's cart and skip
//      when it is empty. That is the honest ceiling without an add endpoint or a
//      staging environment.
//
//   3. Every non-GET is gated on BYTEPE_ALLOW_WRITES=1 and skips by default, so
//      a plain run can never mutate the cart.
//
//   4. GET /cart REQUIRES a payment_type of UPFRONT or SUBSCRIPTION, uppercase.
//      Added 14 Aug 2026 after the presence test began failing: it called the
//      route bare and asserted 200, and the route had started answering 400.
//      Auth is still checked BEFORE validation — a request with no session
//      returns 401 whatever the parameters say, bare or not — so the anonymous
//      cases below deliberately keep calling it bare.
//
//   5. The anonymous cases only became anonymous on 14 Aug 2026. getApiContext()
//      omitted storageState instead of setting it empty, and inherited
//      auth.json from playwright.config.js — so they ran logged in and saw 400
//      and 200 where they asserted 401. Fixed in apiHelper.js; the note is here
//      because the failure looked like an auth-bypass defect and was not.
//
// The read-only and unauthenticated cases run on every pass.

const { test, expect } = require('@playwright/test');
const {
  getApiContext,
  hasSavedSession,
  writesAllowed,
  safeJson,
  readSavedUserId,
} = require('./apiHelper');
const { ENDPOINTS, ENVELOPE } = require('../data/apiEndpoints');
const { getWithRetry } = require('../utils/apiRetry');
const { identitiesFromCart, keyOf } = require('../utils/surfaceIdentity');

// GET /cart REQUIRES payment_type, and the value is case-sensitive.
//
//   no parameter        400 {"message":"payment_type is required"}
//   payment_type=upfront 400 {"message":"payment_type must be UPFRONT or SUBSCRIPTION"}
//   payment_type=UPFRONT 200
//
// Easy to get wrong from the address bar: the Review Order page's own URL
// carries ?payment_type=upfront in lowercase, which the API rejects.
//
// The two values are not two views of one cart — they are two separate baskets.
// The same product can sit in both under different bpids (MacBook Air M5 as
// APPLALAPO1IYU3 with no VAS, and as APPLALAPO55QSK with Device Protection), and
// the SUBSCRIPTION basket holds exactly one line: subscribing to a product
// silently replaces whatever was in it. See CLAUDE.md.
const PAYMENT_TYPES = ['UPFRONT', 'SUBSCRIPTION'];

// The cart payload nests its line items differently depending on the caller, so
// resolve rather than assume — and return [] rather than throwing, so an empty
// cart reads as "nothing to work with" instead of a shape failure.
function cartItemsFrom(body) {
  const data = (body && body.data) || {};
  const candidates = [data.items, data.cart_items, data.cartItems, data.cart, data.products];
  return candidates.find(Array.isArray) || [];
}

test.describe('Cart API — anonymous access', () => {
  let anon;

  test.beforeAll(async () => {
    anon = await getApiContext();
  });

  test.afterAll(async () => {
    await anon.dispose();
  });

  // ---- Negative --------------------------------------------------------

  test('negative: GET /cart without a session returns a structured 401', async () => {
    const res = await getWithRetry(anon, ENDPOINTS.cart());

    expect(res.status()).toBe(401);

    const body = await safeJson(res);
    expect(body.status).toBe(false);
    expect(body.code).toBe(401);
    expect(body.message).toBe(ENVELOPE.unauthorizedMessage);
  });

  test('negative: cart query parameters do not bypass the auth check', async () => {
    // A guard against a filter path that reads the cart before authenticating —
    // the sort of thing that turns a query string into an IDOR.
    const res = await getWithRetry(
      anon,
      ENDPOINTS.cart({ payment_type: 'UPFRONT', is_review: true })
    );

    expect(res.status()).toBe(401);
    const body = await safeJson(res);
    expect(body.status).toBe(false);
  });
});

test.describe('Cart API — authenticated reads', () => {
  test.skip(
    !hasSavedSession(),
    'auth.json holds no unexpired access_token. Refresh it with: npm run auth'
  );

  let api;

  test.beforeAll(async () => {
    api = await getApiContext({ authenticated: true });
  });

  test.afterAll(async () => {
    await api.dispose();
  });

  // ---- Presence --------------------------------------------------------

  test('presence: GET /cart responds 200 for each payment type', async () => {
    for (const paymentType of PAYMENT_TYPES) {
      const res = await getWithRetry(api, ENDPOINTS.cart({ payment_type: paymentType }));

      expect(
        res.status(),
        `${paymentType}: a 401 here means the saved session is stale, not that the cart is ` +
        'broken — refresh with: npm run auth'
      ).toBe(200);

      const body = await safeJson(res);
      expect(body.status).toBe(true);
      expect(body).toHaveProperty('data');
    }
  });

  // ---- Negative: the parameter's own contract --------------------------
  //
  // Pinned because getting these wrong is silent: the suite asserted 200 on a
  // call that had started returning 400, and nothing said which parameter was
  // missing until someone read the body.

  test('negative: GET /cart without payment_type is rejected', async () => {
    const res = await getWithRetry(api, ENDPOINTS.cart());

    expect(res.status(), 'payment_type is required and its absence must be an error').toBe(400);

    const body = await safeJson(res);
    expect(body.status).toBe(false);
    expect(body.message).toMatch(/payment_type is required/i);
  });

  test('negative: payment_type is case-sensitive and rejects unknown values', async () => {
    // Lowercase is what the review page's own URL carries
    // (?payment_type=upfront), which makes this an easy mistake to copy from
    // the address bar into a test.
    for (const value of ['upfront', 'subscription', 'BOGUS']) {
      const res = await getWithRetry(api, ENDPOINTS.cart({ payment_type: value }));

      expect(res.status(), `payment_type=${value} should be rejected`).toBe(400);

      const body = await safeJson(res);
      expect(body.status).toBe(false);
      expect(body.message).toMatch(/payment_type must be UPFRONT or SUBSCRIPTION/i);
    }
  });

  // ---- Correctness -----------------------------------------------------

  test('correctness: any line item carries an id, a quantity and a price', async () => {
    const res = await getWithRetry(api, ENDPOINTS.cart({ payment_type: 'UPFRONT' }));
    expect(res.status()).toBe(200);

    const body = await safeJson(res);
    const items = cartItemsFrom(body);

    test.skip(
      items.length === 0,
      'The account cart is empty, so there is no line item to assert on. ' +
      'There is no add-to-cart endpoint to seed one — add an item through the UI first.'
    );

    const item = items[0];

    // A cart line names its selling price MOP, not `price`. Measured keys
    // (14 Aug 2026): MOP, MRP, total_amount, vas_amount, discount, coupon_discount.
    //
    //   MOP          31999   the selling price of the line — what the shopper pays
    //   MRP          54999   the struck-through figure; the "Price (N Items)" line
    //                        on the cart is a sum of THESE, not of MOP (see CLAUDE.md)
    //   total_amount 31999   MOP plus this line's VAS (80900 -> 80901 with Device
    //                        Protection at vas_amount 1)
    //
    // MOP first, total_amount as the fallback. There is no `price`, `selling_price`,
    // `sub_total` or `total` on this payload — the previous chain resolved to
    // undefined and failed as NaN, which reads as a pricing defect and is not one.
    // MRP is deliberately NOT a fallback: it is the pre-discount figure, so falling
    // back to it would let a line with no selling price at all pass.
    const id = item.id ?? item.cart_id ?? item.cart_item_id;
    const quantity = item.quantity ?? item.qty;
    const price = item.MOP ?? item.total_amount;

    expect(id, `Line item has no identifiable id: ${JSON.stringify(item).slice(0, 300)}`)
      .toBeTruthy();
    expect(Number(quantity)).toBeGreaterThan(0);
    expect(
      Number(price),
      'No MOP or total_amount on the cart line. If the payload renamed its price ' +
      `field, name the new one here rather than widening the chain: ${
        JSON.stringify(Object.keys(item)).slice(0, 300)}`
    ).toBeGreaterThan(0);
  });

  test('correctness: is_review returns a subset of the basket, and only flagged lines', async () => {
    // is_review IS A FILTER OVER THE BASKET'S OWN LINES, NOT A SECOND VIEW OF IT.
    // Each cart line carries its own `is_review` boolean, and the parameter
    // returns exactly the lines where it is true. Measured 14 Aug 2026:
    //
    //   UPFRONT       5 lines, every one is_review=false -> is_review=true gives 0
    //   SUBSCRIPTION  1 line,  is_review=true            -> is_review=true gives 1
    //
    // So the two responses legitimately hold different numbers of lines, and the
    // previous assertion (equal length) could never have been right. It is also
    // not about the address: the same UPFRONT basket came back empty against both
    // of the account's saved addresses, and the SUBSCRIPTION basket came back
    // populated against both.
    //
    // When nothing is flagged the response is `data: []` — an ARRAY, not the usual
    // basket object — so an assertion that reaches for data.items sees undefined
    // rather than an empty basket.
    //
    // What must hold, per payment type:
    //   1. every line the filter returns is present in the unfiltered basket
    //      (identity, not count — a filter must never invent a line)
    //   2. every line it returns is actually flagged is_review
    const userId = readSavedUserId();

    // The address is not what makes the filter non-empty, but the Review Order
    // page does send one, so keep it in the request when the account has one and
    // note it in the failure message rather than dropping it silently.
    let addressId = null;
    if (userId) {
      const addressRes = await getWithRetry(api, ENDPOINTS.customerAddressesByUser(userId));
      expect(addressRes.status(), 'could not read the account addresses').toBe(200);
      const addresses = (await safeJson(addressRes)).data || [];
      addressId = (Array.isArray(addresses) ? addresses : addresses.rows || [])
        .map((a) => a.id)
        .find(Boolean) || null;
    }

    const checked = [];

    for (const paymentType of PAYMENT_TYPES) {
      const [plain, review] = await Promise.all([
        getWithRetry(api, ENDPOINTS.cart({ payment_type: paymentType })),
        getWithRetry(
          api,
          ENDPOINTS.cart({
            payment_type: paymentType,
            ...(addressId ? { address_id: addressId } : {}),
            is_review: true,
          })
        ),
      ]);

      expect(plain.status(), `${paymentType}: plain basket`).toBe(200);
      expect(review.status(), `${paymentType}: is_review basket`).toBe(200);

      const plainItems = cartItemsFrom(await safeJson(plain));
      const reviewItems = cartItemsFrom(await safeJson(review));
      if (reviewItems.length === 0) continue;

      // Identity before arithmetic: compare WHICH lines came back, by bpid —
      // "the same number of lines" would pass on a swapped product. See CLAUDE.md.
      const plainKeys = identitiesFromCart({ items: plainItems }).map(keyOf);
      const reviewIdentities = identitiesFromCart({ items: reviewItems });

      const invented = reviewIdentities.map(keyOf).filter((k) => !plainKeys.includes(k));
      expect(
        invented,
        `${paymentType}: is_review returned line(s) that are not in the basket at all.\n` +
          `  basket:    ${plainKeys.join(', ') || '(empty)'}\n` +
          `  is_review: ${reviewIdentities.map(keyOf).join(', ')}\n` +
          'A filter that adds a line is showing the shopper something they did not put ' +
          'in their cart.'
      ).toEqual([]);

      const notFlagged = reviewItems.filter((i) => i.is_review !== true);
      expect(
        notFlagged.map((i) => i.id ?? i.cart_id ?? i.cart_item_id),
        `${paymentType}: is_review=true returned line(s) whose own is_review flag is not true`
      ).toEqual([]);

      checked.push(`${paymentType}: ${reviewItems.length} of ${plainItems.length} line(s) flagged`);
    }

    // Vacuity guard. Both baskets returning nothing means the filter was never
    // exercised — report that instead of passing on two empty comparisons.
    test.skip(
      checked.length === 0,
      'No line in either basket is flagged is_review, so the filter returned nothing to ' +
      'check. Reach Review Order for a product in the UI to set the flag' +
      (addressId ? '' : ', and note the account has no saved address') + '.'
    );

    console.log(`  is_review checked — ${checked.join('; ')}`);
  });
});

test.describe('Cart API — writes', () => {
  // Two gates, deliberately. The session gate stops a 401 masquerading as a
  // contract failure; the writes gate stops a routine run from touching a real
  // shopper's basket.
  test.skip(
    !hasSavedSession(),
    'auth.json holds no unexpired access_token. Refresh it with: npm run auth'
  );
  test.skip(
    !writesAllowed(),
    'Cart writes mutate a real cart on a real production account. ' +
    'Set BYTEPE_ALLOW_WRITES=1 to run them.'
  );

  let api;

  test.beforeAll(async () => {
    api = await getApiContext({ authenticated: true });
  });

  test.afterAll(async () => {
    await api.dispose();
  });

  // ---- Behavior (chained) ----------------------------------------------

  test('behavior: updating a quantity is reflected on the next read', async () => {
    const before = await getWithRetry(api, ENDPOINTS.cart({ payment_type: 'UPFRONT' }));
    expect(before.status()).toBe(200);

    const items = cartItemsFrom(await safeJson(before));
    test.skip(
      items.length === 0,
      'The account cart is empty. There is no add-to-cart endpoint to seed one — ' +
      'add an item through the UI first.'
    );

    const item = items[0];
    const cartId = item.id ?? item.cart_id ?? item.cart_item_id;
    const originalQuantity = Number(item.quantity ?? item.qty ?? 1);
    const target = originalQuantity + 1;

    // WRITE — changes the quantity of a line already in the real cart. Restored
    // to its original value in the finally block below.
    const res = await api.put(ENDPOINTS.updateCartItem(cartId), {
      data: { quantity: target },
    });

    try {
      expect(res.status(), `PUT /cart/${cartId} returned ${res.status()}`).toBeLessThan(300);
      const body = await safeJson(res);
      expect(body.status).toBe(true);

      // The chained half: a write that reports success but does not persist is
      // exactly what a status-only assertion misses.
      const after = await getWithRetry(api, ENDPOINTS.cart({ payment_type: 'UPFRONT' }));
      const updated = cartItemsFrom(await safeJson(after)).find(
        i => (i.id ?? i.cart_id ?? i.cart_item_id) === cartId
      );

      expect(updated, 'The line item vanished after a quantity update.').toBeTruthy();
      expect(Number(updated.quantity ?? updated.qty)).toBe(target);
    } finally {
      // Put the shopper's cart back the way it was, pass or fail.
      await api
        .put(ENDPOINTS.updateCartItem(cartId), { data: { quantity: originalQuantity } })
        .catch(() => {});
    }
  });

  // ---- Negative --------------------------------------------------------

  test('negative: updating a non-existent cart line is rejected', async () => {
    // No cleanup needed — the id does not exist, so nothing can be mutated.
    const res = await api.put(
      ENDPOINTS.updateCartItem('00000000-0000-0000-0000-000000000000'),
      { data: { quantity: 1 } }
    );

    expect(
      res.status(),
      `Updating a non-existent cart line returned ${res.status()}`
    ).toBeGreaterThanOrEqual(400);

    const body = await safeJson(res);
    expect(body.status).toBe(false);
  });

  test('negative: removing a non-existent cart line is rejected', async () => {
    // DESTRUCTIVE ROUTE, SAFE CALL. PUT /cart/remove/:id deletes a line item
    // from the real cart. This invokes it with an id that cannot exist, so it
    // exercises the error path without removing anything the shopper owns.
    // Do not point this at a live cart id.
    const res = await api.put(
      ENDPOINTS.removeCartItem('00000000-0000-0000-0000-000000000000'),
      { data: { product_id: 'does-not-exist', variant_id: 'does-not-exist' } }
    );

    expect(res.status()).toBeGreaterThanOrEqual(400);

    const body = await safeJson(res);
    expect(body.status).toBe(false);
  });

  test('negative: a nonsensical quantity is rejected', async () => {
    const before = await getWithRetry(api, ENDPOINTS.cart({ payment_type: 'UPFRONT' }));
    const items = cartItemsFrom(await safeJson(before));
    test.skip(items.length === 0, 'The account cart is empty — nothing to attempt an update on.');

    const item = items[0];
    const cartId = item.id ?? item.cart_id ?? item.cart_item_id;
    const originalQuantity = Number(item.quantity ?? item.qty ?? 1);

    // WRITE ATTEMPT — a negative quantity must be refused. If it is instead
    // accepted, that is a real defect and this test is meant to fail; the
    // finally block restores the cart either way.
    const res = await api.put(ENDPOINTS.updateCartItem(cartId), { data: { quantity: -5 } });

    try {
      expect(
        res.status(),
        `A quantity of -5 was accepted with ${res.status()}. That is a defect, not a test bug.`
      ).toBeGreaterThanOrEqual(400);
    } finally {
      await api
        .put(ENDPOINTS.updateCartItem(cartId), { data: { quantity: originalQuantity } })
        .catch(() => {});
    }
  });
});
