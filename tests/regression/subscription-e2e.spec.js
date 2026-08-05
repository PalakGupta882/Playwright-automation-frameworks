// tests/regression/subscription-e2e.spec.js
//
// End-to-end subscription purchase: homepage -> Subscription -> product ->
// Subscribe -> Review Order -> Continue -> Order Summary.
//
// STOPS AT ORDER SUMMARY, ON PURPOSE. That page is the last one before the
// payment gateway. Nothing here clicks Pay, so no money moves — but reaching
// it DOES create a real order on the real account, because the order id is
// minted when Continue is pressed, not when payment completes. Every run
// leaves an order behind.
//
// Each stage is a test.step, so a failure names the stage that broke rather
// than a bare locator timeout, and each stage attaches a screenshot to the HTML
// report whether it passes or fails.

const { test, expect } = require('../fixtures/pageFixtures');
const { BASE_URL, URLS, TIMEOUTS } = require('../data/constants');
const { assertFreshSession } = require('../utils/session');

// Subscribe only goes straight to Review Order while logged in; logged out it
// diverts to an OTP screen and every assertion below would fail for the wrong
// reason.
test.beforeAll(() => assertFreshSession());

// The subscription listing tiles carry the product name as image alt text.
const PRODUCT = 'apple iPhone 17 pro max';

// Hosts BytePe hands off to for payment. Landing on one means the flow went a
// step further than this test is allowed to go.
const PAYMENT_GATEWAY_HOSTS = /razorpay|payu|billdesk|ccavenue|cashfree|paytm|phonepe/i;

// The hand-off control on Order Summary. By role and anchored name, not a bare
// /pay/i text match — the page is dense with "Pay full Amount", "Payment" and
// "Pay Now" strings, and a loose match would resolve to whichever came first.
const payNowButton = (page) =>
  page.getByRole('button', { name: /^pay now$/i }).first();

test.describe('Subscription end-to-end (stops before payment)', () => {
  test('homepage through to order summary', async ({
    page,
    homePage,
    productPage,
    reviewOrderPage,
  }, testInfo) => {
    // Five real page loads plus two API round trips; the default is not enough.
    test.setTimeout(180000);

    // Attach to the HTML report AND write a stable file, so a failure can be
    // opened directly from test-results/ without unpacking the report.
    const shot = async (name) => {
      const file = testInfo.outputPath(`${name}.png`);
      await page.screenshot({ path: file, fullPage: true });
      await testInfo.attach(name, { path: file, contentType: 'image/png' });
    };

    await test.step('1. homepage loads', async () => {
      await homePage.goto();
      // Non-vacuous: prove the header rendered before trusting any nav click.
      await expect(homePage.subscriptionLink).toBeVisible({ timeout: TIMEOUTS.nav });
      await shot('01-homepage');
    });

    await test.step('2. navigate to Subscription', async () => {
      await homePage.goToSubscription();
      await expect(page).toHaveURL(new RegExp(URLS.subscription), { timeout: TIMEOUTS.nav });
      await shot('02-subscription-listing');
    });

    await test.step(`3. open ${PRODUCT}`, async () => {
      const tile = page.getByRole('img', { name: PRODUCT }).first();
      // Wait for the tile rather than networkidle — this page keeps analytics
      // requests going, so networkidle only ever ends by timing out.
      await tile.waitFor({ state: 'visible', timeout: TIMEOUTS.nav });
      await productPage.selectProductByImageName(PRODUCT);

      await expect(page).toHaveURL(/\/pd\//, { timeout: TIMEOUTS.nav });
      await expect(productPage.subscribeButton.first()).toBeVisible({ timeout: TIMEOUTS.nav });
      await shot('03-product-page');
    });

    await test.step('4. Subscribe leads to Review Order', async () => {
      await productPage.clickSubscribe();
      await reviewOrderPage.isLoaded();
      await expect(page).toHaveURL(/\/review\//, { timeout: TIMEOUTS.nav });

      // Prove the page has actual order content, not just the right URL.
      await expect(reviewOrderPage.continueButton.first()).toBeVisible({
        timeout: TIMEOUTS.nav,
      });
      await shot('04-review-order');
    });

    await test.step('5. Continue lands on Order Summary', async () => {
      await reviewOrderPage.clickContinue();
      await page.waitForURL(new RegExp(URLS.orderSummary), { timeout: 60000 });

      // The route resolves before any order content paints. Asserting or
      // screenshotting straight after waitForURL proves only that routing
      // happened — the first version of this test passed against a page that
      // was still blank apart from the header and the Cart/Review/Payment
      // stepper. Wait for content that only a loaded summary has.
      await expect(payNowButton(page)).toBeVisible({ timeout: TIMEOUTS.nav });
      await expect(page.getByText(/order total/i).first()).toBeVisible({
        timeout: TIMEOUTS.nav,
      });
      await expect(page.getByText(/₹\s?[\d,]+/).first()).toBeVisible();

      await shot('05-order-summary');

      const orderId = new URL(page.url()).searchParams.get('master_order_id');
      expect(orderId, 'order summary carries no master_order_id').toBeTruthy();
      console.log('Order summary reached. master_order_id:', orderId);
    });

    await test.step('6. stopped before the payment gateway', async () => {
      // Non-vacuous: step 5 proved a fully rendered summary, so this asserts
      // against a live page rather than one that never loaded.
      //
      // Pay Now is the control that hands off to the gateway. It must be
      // present — its absence would mean the flow is broken, not that we
      // stopped safely — and it must not have been pressed.
      await expect(payNowButton(page)).toBeVisible();
      expect(page.url()).not.toMatch(PAYMENT_GATEWAY_HOSTS);
      await expect(page).toHaveURL(new RegExp(URLS.orderSummary));
    });
  });
});
