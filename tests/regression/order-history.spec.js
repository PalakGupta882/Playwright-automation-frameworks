// tests/regression/order-history.spec.js
//
// My Orders: /my-profile -> My Orders -> an order's detail page.
//
// LOGIN-GATED. Order history belongs to an account. No in-test login: specs
// inherit storageState and guard it with assertFreshSession().
//
// WHAT EACH PAGE ACTUALLY SHOWS, measured before these assertions were written.
//
//   list    /orders/my-orders
//           heading "My Orders", then one card per order reading
//           "<product> <variant> ₹<price> <status>".
//           NO order id and NO date — /[A-Z]{1,2}\d{6,}/ matches 0 on the list.
//           Cards are <button>s, not links: a[href*="order"] matches 0.
//
//   detail  /orders/my-orders/<uuid>?orderStatus=...
//           status, product, "Order Id:<id>", Shipping To,
//           Payment Information (Payment Plan, Payment Type, Total Amount),
//           Device Information, and an Order History timeline of
//           "<status> <date>" rows.
//
//           Track Order was listed here originally. Re-measured 10 Aug 2026 on a
//           PENDING order, it is absent — the controls are "Contact Support" and
//           "Continue", and /tracking/i matches 0. That is consistent with an
//           unpaid order having nothing to track, so it is recorded rather than
//           asserted: a Pending order is the only kind this account can offer
//           today, and pinning either presence or absence would encode a state
//           that is not the same for every order.
//
// Consequences for what is asserted:
//
//   - Order number and date are checked on the DETAIL page only, because that
//     is the only place they exist. Asserting them on the list would fail
//     against a page that is working correctly.
//   - There is no quantity anywhere (/qty|quantity/i matches 0), and no
//     subtotal / shipping / tax breakdown — only "Total Amount". So those are
//     not asserted; there is nothing to assert.
//
// Nothing here cancels, returns or reorders. Those act on real orders.

const { test, expect } = require('../fixtures/pageFixtures');
const { AccountPage } = require('../pages/accountPage');
const { BASE_URL, TIMEOUTS } = require('../data/constants');
const { assertFreshSession } = require('../utils/session');

test.beforeAll(() => assertFreshSession());

// "₹3,599" -> 3599. Throws rather than returning NaN: a helper returning 0
// would let a total comparison pass as 0 === 0 on two unrendered pages.
function toRupees(text) {
  const found = (text || '').match(/₹\s?([\d,]+)/);
  const value = found ? Number(found[1].replace(/,/g, '')) : NaN;
  if (!Number.isFinite(value)) {
    throw new Error(`expected a rupee amount, read ${JSON.stringify(text)}`);
  }
  return value;
}

test.describe('Order history', () => {
  // PRESENCE — the list renders orders, each with the three things it shows.
  test('My Orders lists orders with product, price and status', async ({ page }) => {
    test.setTimeout(120000);
    const account = new AccountPage(page);

    const count = await account.navigateToMyOrders();
    console.log(`orders listed: ${count}`);

    await expect(page).toHaveURL(/\/orders\/my-orders/, { timeout: TIMEOUTS.nav });
    await expect(page.getByRole('heading', { name: /my orders/i }).first()).toBeVisible();

    // An account with no history is a legitimate state, not a failure — but it
    // means everything below asserts nothing, so say so rather than pass.
    test.skip(count === 0, 'This account has no orders, so there is nothing to inspect.');

    const first = (await account.orderCards.first().innerText()).replace(/\s+/g, ' ').trim();

    // Each card must carry a price and a status word. Asserting only that a
    // card exists would pass against an empty shell.
    expect(first, 'an order card shows no price').toMatch(/₹\s?[\d,]+/);
    expect(first, 'an order card shows no status')
      .toMatch(/delivered|pending|cancelled|confirmed|processing|shipped|placed/i);
    expect(toRupees(first), 'an order is listed with a zero price').toBeGreaterThan(0);
  });

  // PRESENCE + CORRECTNESS — the detail page carries the order's identity, and
  // its total is the same number the list showed.
  test('an order detail page shows its id, address, total and history', async ({ page }) => {
    test.setTimeout(120000);
    const account = new AccountPage(page);

    const count = await account.navigateToMyOrders();
    test.skip(count === 0, 'This account has no orders, so there is nothing to open.');

    const listSummary = await account.clickOrderDetail(0);
    const detail = (await page.locator('body').innerText()).replace(/\s+/g, ' ');

    // Identity: an order id in the site's format, on the page that owns it.
    await expect(page.getByText(/order\s*id/i).first()).toBeVisible({ timeout: TIMEOUTS.nav });
    expect(detail, 'the detail page shows no order id').toMatch(/Order\s*Id\s*:?\s*[A-Z0-9]{6,}/i);

    // Where it is going, and what it cost.
    expect(detail, 'the detail page shows no shipping address').toMatch(/shipping to/i);
    expect(detail, 'the detail page shows no total').toMatch(/total amount/i);

    // A dated status history — this is where the order date lives.
    expect(detail, 'the detail page shows no dated order history')
      .toMatch(/\d{1,2}\s+\w{3,9}\s+\d{4}/);

    // CORRECTNESS: the money on the detail page is the money on the list.
    // Without this the test would pass on a detail page belonging to a
    // different order entirely.
    const listedTotal = toRupees(listSummary);
    const detailTotal = toRupees((detail.match(/Total Amount\s*₹\s?[\d,]+/i) || [''])[0]);

    console.log(`list ₹${listedTotal} vs detail ₹${detailTotal}`);
    expect(
      detailTotal,
      'the order total on the detail page differs from the price shown in the list'
    ).toBe(listedTotal);
  });

  // BEHAVIOUR — you can get into an order and back out again.
  test('going back from an order returns to the full list', async ({ page }) => {
    test.setTimeout(120000);
    const account = new AccountPage(page);

    const before = await account.navigateToMyOrders();
    test.skip(before === 0, 'This account has no orders, so there is nothing to navigate.');

    await account.clickOrderDetail(0);
    await expect(page).toHaveURL(/\/orders\/my-orders\/[0-9a-f-]{8,}/i);

    await page.goBack();
    await expect(page).toHaveURL(/\/orders\/my-orders\/?(\?.*)?$/, { timeout: TIMEOUTS.nav });
    await expect(page.getByRole('heading', { name: /my orders/i }).first())
      .toBeVisible({ timeout: TIMEOUTS.nav });

    // The list is whole again — not a truncated or empty render.
    await expect(account.orderCards.first()).toBeVisible({ timeout: TIMEOUTS.nav });
    expect(await account.orderCards.count(), 'orders went missing after going back')
      .toBe(before);
  });

  // NEGATIVE — an order id that does not exist must not render an order.
  //
  // Chosen over "what if the user has no orders": emptying the account is not
  // possible without being destructive. A fabricated id asks the same question
  // — does the page invent content when there is none — and touches nothing.
  //
  // The count this account carries is not stable and nothing here should assume
  // one. It read ten when these assertions were written; on 10 Aug 2026 it read
  // ONE (Order Id <order-D>, Pending, dated 14 Jul 2026). Every test above
  // derives the count at run time and skips meaningfully at zero, which is why
  // the drop changed nothing — but do not reintroduce a hardcoded expectation.
  //
  // Unexplained, and worth raising rather than encoding: the run of 10 Aug 2026
  // minted master_order_id <order-A> and <order-B>, and neither
  // appears in this list, while the older Pending order does. So "pending is
  // hidden" is not the explanation.
  test('an unknown order id does not render order details', async ({ page }) => {
    test.setTimeout(120000);

    await page.goto(`${BASE_URL}/orders/my-orders/00000000-0000-4000-8000-000000000000`, {
      waitUntil: 'domcontentloaded',
    });
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(5000);

    // Non-vacuous: prove something rendered before asserting what is absent.
    const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    expect(body.length, 'the page rendered nothing at all').toBeGreaterThan(50);

    // A real order always carries an id and a total. A fabricated one must show
    // neither — an error, an empty state or a redirect are all acceptable.
    const inventedOrder =
      /Order\s*Id\s*:?\s*[A-Z0-9]{6,}/i.test(body) && /total amount/i.test(body);
    expect(inventedOrder, 'a non-existent order id rendered a complete order').toBe(false);
  });
});
