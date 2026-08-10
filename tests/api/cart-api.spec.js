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
// The read-only and unauthenticated cases run on every pass.

const { test, expect } = require('@playwright/test');
const { getApiContext, hasSavedSession, writesAllowed, safeJson } = require('./apiHelper');
const { ENDPOINTS, ENVELOPE } = require('../data/apiEndpoints');
const { getWithRetry } = require('../utils/apiRetry');

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

  test('presence: GET /cart responds 200 with the standard envelope', async () => {
    const res = await getWithRetry(api, ENDPOINTS.cart());

    expect(
      res.status(),
      'A 401 here means the saved session is stale, not that the cart is broken — ' +
      'refresh with: npm run auth'
    ).toBe(200);

    const body = await safeJson(res);
    expect(body.status).toBe(true);
    expect(body).toHaveProperty('data');
  });

  // ---- Correctness -----------------------------------------------------

  test('correctness: any line item carries an id, a quantity and a price', async () => {
    const res = await getWithRetry(api, ENDPOINTS.cart());
    expect(res.status()).toBe(200);

    const body = await safeJson(res);
    const items = cartItemsFrom(body);

    test.skip(
      items.length === 0,
      'The account cart is empty, so there is no line item to assert on. ' +
      'There is no add-to-cart endpoint to seed one — add an item through the UI first.'
    );

    const item = items[0];

    // Field names come from whatever the payload actually uses; the assertion
    // is that a line item is identifiable, countable and priced. An item
    // missing any of the three cannot be rendered or charged for.
    const id = item.id ?? item.cart_id ?? item.cart_item_id;
    const quantity = item.quantity ?? item.qty;
    const price = item.price ?? item.selling_price ?? item.sub_total ?? item.total;

    expect(id, `Line item has no identifiable id: ${JSON.stringify(item).slice(0, 300)}`)
      .toBeTruthy();
    expect(Number(quantity)).toBeGreaterThan(0);
    expect(Number(price)).toBeGreaterThan(0);
  });

  test('correctness: the review view of the cart is consistent with the plain view', async () => {
    // Same cart, two callers. is_review is what the Review Order page passes;
    // it must not invent or drop line items.
    const [plain, review] = await Promise.all([
      getWithRetry(api, ENDPOINTS.cart()),
      getWithRetry(api, ENDPOINTS.cart({ is_review: true })),
    ]);

    expect(plain.status()).toBe(200);
    expect(review.status()).toBe(200);

    const plainItems = cartItemsFrom(await safeJson(plain));
    const reviewItems = cartItemsFrom(await safeJson(review));

    test.skip(plainItems.length === 0, 'The account cart is empty — nothing to compare.');

    expect(reviewItems).toHaveLength(plainItems.length);
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
    const before = await getWithRetry(api, ENDPOINTS.cart());
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
      const after = await getWithRetry(api, ENDPOINTS.cart());
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
    const before = await getWithRetry(api, ENDPOINTS.cart());
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
