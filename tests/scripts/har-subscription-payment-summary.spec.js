// tests/scripts/har-subscription-payment-summary.spec.js
//
// HAR capture, Journey 3: the subscription-e2e path, recorded. Uses the
// auth.json session (npm run auth), so no OTP here — the login calls come from
// Journey 2's capture, tests/data/har/payment-summary-logged-in.har.
//
//   homepage -> /home/subscription -> Phone 4a 5G PDP -> Buy Now (Subscription) ->
//   Review Order -> Continue -> Payment Summary. Stops there; never pays.
//
// Subscription rather than upfront because the subscription basket holds
// exactly one line and Subscribe replaces it: whatever the upfront cart holds
// is never ordered. Upfront Continue orders every upfront line.
//
// MINTS ONE REAL ORDER PER RUN (Continue calls create-order). Gated on
// BYTEPE_ALLOW_WRITES=1; retries pinned to 0 so a failure never mints a second.
//
// Output: tests/data/har/subscription-payment-summary.har (gitignored). Then:
//   node scripts/har-to-jmeter.js

const { test, expect } = require('../fixtures/pageFixtures');
const { BASE_URL, URLS, TIMEOUTS } = require('../data/constants');
const { assertFreshSession } = require('../utils/session');
const { writesAllowed, writeSkipReason } = require('../utils/writes');
const { harPathFor, waitForApiQuiet } = require('../utils/harCapture');
const { buyNowControl } = require('../utils/buyRow');

// BOTH, master variant, deep stock, not pre-booking — checked 28 Sep 2026.
// iPhone 17 Pro Max (the subscription-e2e product) was down to 4 units.
const PRODUCT = { name: 'Phone 4a 5G', slug: 'phone-4a-5g', bpid: 'NOTSMMOB755IM9' };

test.skip(!writesAllowed(), writeSkipReason('Reaching Payment Summary presses Continue on Review Order, which mints a real order'));
test.describe.configure({ retries: 0 });

test.beforeAll(() => assertFreshSession());

// The context fixture writes the HAR when it closes, after the test.
test.use({ contextOptions: { recordHar: { path: harPathFor('subscription-payment-summary'), content: 'embed' } } });

// Exact name: every bank, plan and payment-method row on this page is also a
// button, so a loose match would land on one of those. Never clicked — it
// moves to the payment step.
const selectPlanButton = (page) => page.getByRole('button', { name: 'Select Plan and Continue', exact: true }).first();

test('Subscription -> Payment Summary: record every API call to a HAR', async ({
  page,
  homePage,
  productPage,
  reviewOrderPage,
}) => {
  test.setTimeout(240000);

  await homePage.goto();
  await expect(homePage.subscriptionLink).toBeVisible({ timeout: TIMEOUTS.nav });
  await waitForApiQuiet(page, { quietMs: 3000 });

  await homePage.goToSubscription();
  await expect(page).toHaveURL(new RegExp(URLS.subscription), { timeout: TIMEOUTS.nav });
  await waitForApiQuiet(page, { quietMs: 3000 });

  // By URL, not by tile: the bpid pins the one variant checked for stock.
  await page.goto(`${BASE_URL}/pd/${PRODUCT.slug}/${PRODUCT.bpid}`, { waitUntil: 'load' });
  // A BOTH product's buy row is Buy Now alone since the 16 Sep redesign; there is
  // no "Subscribe" button. clickSubscribe() presses this same control.
  await expect(buyNowControl(page)).toBeVisible({ timeout: TIMEOUTS.nav });
  // The button renders before its handler binds; an early click is inert.
  await waitForApiQuiet(page, { quietMs: 3000 });

  await productPage.clickSubscribe();
  await reviewOrderPage.isLoaded();
  // Guard for the click below. Buy Now also leads to the UPFRONT review when the
  // selected plan is not Subscription, and Continue there orders every upfront
  // line on the account. Only the subscription review holds just this product.
  await expect(page, 'Buy Now did not open the SUBSCRIPTION review').toHaveURL(/\/review\/subscribe\b/, {
    timeout: TIMEOUTS.nav,
  });
  await expect(page.getByText(PRODUCT.name, { exact: false }).first()).toBeVisible({ timeout: TIMEOUTS.nav });
  await expect(reviewOrderPage.continueButton.first()).toBeVisible({ timeout: TIMEOUTS.nav });
  await waitForApiQuiet(page, { quietMs: 3000 });

  // The irreversible click: create-order.
  await reviewOrderPage.clickContinue();
  await page.waitForURL(new RegExp(URLS.orderSummary), { timeout: 60000 });

  // Fully loaded = content only a loaded summary has, then the API goes quiet.
  // The page was redesigned by 28 Sep 2026: no "Pay Now". Its primary control is
  // "Select Plan and Continue" inside the pre-expanded bank EMI plan list.
  await expect(selectPlanButton(page)).toBeVisible({ timeout: TIMEOUTS.nav });
  await expect(page.getByText(/order total/i).first()).toBeVisible({ timeout: TIMEOUTS.nav });
  await waitForApiQuiet(page);

  console.log('Stopped on Payment Summary, Pay Now not pressed:', page.url());
});
