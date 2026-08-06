// tests/regression/emi-store-flow.spec.js
//
// EMI Store entry point -> category listing -> product page -> Review Order.
//
// STOPS AT REVIEW ORDER, ON PURPOSE. Continue on that page is what mints the
// order (see subscription-e2e.spec.js); nothing here clicks it, so this spec
// creates no order and moves no money. It does load real pages on a real
// logged-in account.
//
// LOGIN-GATED. The purchase control diverts to an OTP screen without a live
// session, so this must never be added to .github/workflows/playwright.yml —
// CI writes an empty auth.json and runs only the public specs.
//
// What this spec deliberately does NOT assert: anything about cardless EMI
// eligibility. The Cardless EMI row has four legitimate states and can differ
// between two loads of the same page for the same user (CLAUDE.md, and
// docs/cardless-emi.md which recorded X300 Ultra flipping verdict inside eight
// minutes). Everything asserted below is product CONFIGURATION — which plans
// the box offers and that they are priced — which is stable. The plan-level
// pricing behind that box is guarded separately, and logged out, by
// regression/emi-plan-config.spec.js.
//
// Rewritten from a version that walked this same flow with no assertion at all
// (eslint: "Test has no assertions") and a conditional OTP branch that could
// only ever run under --headed with the Inspector attached.

const { test, expect } = require('../fixtures/pageFixtures');
const { URLS, TIMEOUTS } = require('../data/constants');
const { assertFreshSession } = require('../utils/session');

test.beforeAll(() => assertFreshSession());

// "mobile" over the "grooming" the old spec used: every smartphone in the
// catalogue baseline carries the full six-tenure NCEMI/LCEMI ladder, whereas
// personal-care products bottom out at two tenures and a ₹999 price, which is
// a thin thing to hang an EMI flow on.
const CATEGORY = 'mobile';

test.describe('EMI Store flow (stops before payment)', () => {
  test('EMI Store through to Review Order', async ({ page, emiStorePage, reviewOrderPage }, testInfo) => {
    // Four real page loads plus the variant-pricing round trip behind the plan
    // box; the default timeout is not enough.
    test.setTimeout(180000);

    const shot = async (name) => {
      const file = testInfo.outputPath(`${name}.png`);
      await page.screenshot({ path: file, fullPage: true });
      await testInfo.attach(name, { path: file, contentType: 'image/png' });
    };

    await test.step('1. EMI Store landing page offers a route into the catalogue', async () => {
      await emiStorePage.goto();
      await expect(page).toHaveURL(new RegExp(URLS.emiStore), { timeout: TIMEOUTS.nav });

      // Non-vacuous: prove the control the next step clicks actually rendered,
      // rather than discovering it missing as a click timeout.
      await expect(emiStorePage.categoryTile(CATEGORY)).toBeVisible({ timeout: TIMEOUTS.nav });

      // A store that renders but links nowhere is broken. The tile above proves
      // one specific route; this proves the page is populated rather than a
      // shell that happens to have a category strip.
      expect(
        await emiStorePage.catalogueLinks.count(),
        'the EMI Store rendered no links into the catalogue'
      ).toBeGreaterThan(0);

      await shot('01-emi-store');
    });

    await test.step(`2. "${CATEGORY}" opens a listing with products on it`, async () => {
      await emiStorePage.openCategory(CATEGORY);
      await expect(page).toHaveURL(/all-products\?category=/, { timeout: TIMEOUTS.nav });
      await expect(emiStorePage.productLinks.first()).toBeVisible({ timeout: TIMEOUTS.nav });
      await shot('02-category-listing');
    });

    await test.step('3. the first product opens a product page that can be bought', async () => {
      await emiStorePage.openFirstProduct();
      await expect(page).toHaveURL(/\/pd\//, { timeout: TIMEOUTS.nav });

      // A URL is not a page. Assert the control that only a rendered PDP has.
      await expect(emiStorePage.purchaseControl).toBeVisible({ timeout: TIMEOUTS.nav });
      await shot('03-product-page');
    });

    await test.step('4. the plan box offers a priced EMI plan and a pay-in-full plan', async () => {
      // Configuration, not eligibility. Every one of the 186 products in
      // tests/data/cardless-emi.json exposes at least two card EMI tenures, and
      // CLAUDE.md puts Pay in Full / Buy Upfront on every product, so both of
      // these must hold whichever product the listing happened to link.
      await expect(emiStorePage.planBoxHeading).toBeVisible({ timeout: TIMEOUTS.nav });
      await expect(emiStorePage.emiPlan).toBeVisible({ timeout: TIMEOUTS.nav });
      await expect(emiStorePage.payInFullPlan).toBeVisible({ timeout: TIMEOUTS.nav });

      // The box arrives before /api/apps/variant-pricing answers, so plan names
      // alone would pass against an unpriced shell.
      await expect(emiStorePage.rupeeAmount).toBeVisible({ timeout: TIMEOUTS.nav });

      await shot('04-plan-box');
    });

    await test.step('5. the purchase control leads to Review Order, and stops there', async () => {
      await emiStorePage.clickPurchaseControl();
      await page.waitForURL(new RegExp(URLS.review), { timeout: 60000 });

      // Again: the route resolves before the order content paints. Continue is
      // the control that mints the order — it must be present (its absence
      // means the flow is broken, not that we stopped safely) and it must not
      // be clicked. Nothing below this line touches it.
      await expect(reviewOrderPage.continueButton.first()).toBeVisible({ timeout: TIMEOUTS.nav });
      await expect(page.getByText(/₹\s?[\d,]+/).first()).toBeVisible({ timeout: TIMEOUTS.nav });

      await shot('05-review-order');
      console.log('Stopped at Review Order without pressing Continue:', page.url());
    });
  });
});
