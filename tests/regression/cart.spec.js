const { test, expect } = require('../fixtures/pageFixtures');
const { CartPage } = require('../pages/cartPage');
const { assertFreshSession } = require('../utils/session');
const { readBasketIdentities } = require('../utils/catalogue');

// Adding to cart is login-gated — fail fast if the saved session has expired
test.beforeAll(() => assertFreshSession());

// Adds one real line to the live cart per run. A retry would add a second.
test.describe.configure({ retries: 0 });

// Identity, not just arrival. Reaching /cart proves routing; only the bpid in
// the basket proves THIS variant was added (CLAUDE.md: a /pd/ URL names one
// variant, and "a line appeared" is never proof the right thing was added).
test('adds an in-stock upfront product and the cart holds its bpid', async ({ page }) => {
  test.setTimeout(90000);
  const cart = new CartPage(page);

  // Re-adding an item already in the basket is a 200 no-op, so the bpid would
  // be present whether or not the add worked. Exclude everything already there.
  const before = await readBasketIdentities(page.request, 'UPFRONT');
  const held = new Set(before.map((i) => i.bpid).filter(Boolean));

  const added = await cart.addFirstProductToCart({ exclude: held });
  console.log(`added ${added.name} (${added.slug}/${added.bpid}), POST /api/cart -> ${added.postStatus}`);

  expect(added.postStatus, 'POST /api/cart did not succeed').toBe(200);
  await expect(page).toHaveURL(/\/cart/, { timeout: 15000 });

  const after = await readBasketIdentities(page.request, 'UPFRONT');
  expect(
    after.map((i) => i.bpid),
    `the UPFRONT basket does not hold the bpid that was added (${added.bpid}). ` +
      'A different bpid here means a different variant was added than the one picked.'
  ).toContain(added.bpid);
  expect(after, 'the basket did not grow by the added line').toHaveLength(before.length + 1);
});
