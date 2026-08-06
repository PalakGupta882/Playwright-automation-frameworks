// tests/pages/emiStorePage.js
//
// The EMI Store entry point (/home/emi-store) and the hop from there into a
// product page.
//
// This file used to call page.pause() in two places. page.pause() only does
// anything under `--headed` with the Inspector open; in a normal `npm test`
// run it blocks until the test times out. Both call sites were reachable in a
// normal run — one from goto(), one from the OTP branch of the old spec — so
// the page object could hang the suite. They are gone. What replaced the first
// is whyStuck(): the same login-prompt check, used to turn a bare locator
// timeout into an error that names the cause. The second (manual OTP entry)
// belongs in auth-setup.spec.js, not in a regression page object, and its two
// helpers were deleted with it.

const { BASE_URL, URLS, TIMEOUTS } = require('../data/constants');

class EmiStorePage {
  constructor(page) {
    this.page = page;

    // Every route the store offers into the catalogue, product card or category
    // listing. An href selector rather than a role/text locator because the
    // store's tiles are images with no accessible name in common, and the one
    // thing that is invariant about a route into the catalogue is where it
    // points.
    this.catalogueLinks = page.locator('a[href*="/pd/"], a[href*="/all-products"]');

    // Product cards on a listing. Same reasoning; this is also what
    // smoke/core-pages.spec.js and category-browsing.spec.js already use, so a
    // markup change breaks one known selector instead of three different ones.
    this.productLinks = page.locator('a[href*="/pd/"]');

    // The purchase control on a PDP. By role and anchored to the whole name:
    // getByText(/buy now/i) also matches marketing copy and the plan box, and
    // an unanchored name would match "Buy Now, Pay Later" style strings.
    // Accepts either control because the listing links whichever variant is
    // featured — upfront products render "Buy Now", subscription products
    // render "Subscribe" (see commits 05f4a47 / 4723c89, which fixed the same
    // assumption in the PDP smoke check).
    this.purchaseControl = page
      .getByRole('button', { name: /^(buy now|subscribe)$/i })
      .first();

    // "Choose your plan" box. Text locators, not roles: the plan rows are MUI
    // boxes with hashed class names (see productsListPage.selectBuyUpfrontPlan,
    // which has to reach for `.MuiBox-root.mui-1eub90p` and dispatchEvent),
    // so there is no stable role or test id to anchor to. The wording below is
    // what docs/cardless-emi.md recorded off the live page on 4 Aug 2026.
    this.planBoxHeading = page.getByText(/choose your plan/i).first();

    // One alternation rather than three locators: which EMI plans a product
    // shows depends on its emi_option types (NCEMI / LCEMI / EMI), and every
    // product in the catalogue carries at least one of them. \b...\b keeps
    // "standard emi" from matching inside a longer word.
    this.emiPlan = page.getByText(/\b(no cost|low cost|standard)\s+emi\b/i).first();

    // Pay in Full is the one plan CLAUDE.md says appears on every product; the
    // site labels it either way, hence the alternation.
    this.payInFullPlan = page.getByText(/\b(pay in full|buy upfront)\b/i).first();

    // A rendered rupee figure. Proves the plan box is priced rather than an
    // empty shell waiting on /api/apps/variant-pricing.
    this.rupeeAmount = page.getByText(/₹\s?[\d,]+/).first();

    // Only ever read for diagnostics — never asserted on, never branched on in
    // a test.
    this.loginPrompt = page.getByText('Enter mobile number to continue').first();
  }

  // Category strip tiles are images whose alt text is the category name.
  // exact: true on purpose — a substring match on "mobile" also matches the
  // "mobile accessories" tile and would open the wrong listing.
  categoryTile(category) {
    return this.page.getByRole('img', { name: category, exact: true }).first();
  }

  async goto() {
    // domcontentloaded, not the default 'load': this site keeps analytics and
    // pixel requests going, so waiting for 'load' (and networkidle) only ever
    // ends by timing out.
    await this.page.goto(`${BASE_URL}${URLS.emiStore}`, { waitUntil: 'domcontentloaded' });
  }

  // Turns "locator timed out" into an error that names the cause. Called only
  // after something has already failed, so the 2s it costs is paid once, on a
  // run that is failing anyway.
  async whyStuck(what) {
    const loginPromptShowing = await this.loginPrompt
      .waitFor({ state: 'visible', timeout: 2000 })
      .then(() => true)
      .catch(() => false);

    return loginPromptShowing
      ? `${what} — the site is showing its login prompt, so the saved session was not accepted.\n` +
          'Refresh it with:  npm run auth   (headed; needs BYTEPE_MOBILE set)'
      : `${what} — no login prompt on screen, so this is not a session problem. ` +
          'Check the screenshot and video in test-results/.';
  }

  // An auto-rotating banner sometimes re-renders the strip and swallows the
  // click, so retry until the URL actually moves. Escape first, because a
  // promo modal can be sitting over the tile.
  async openCategory(category) {
    const tile = this.categoryTile(category);
    const onListing = () => /all-products\?category=/.test(this.page.url());

    for (let attempt = 0; attempt < 3; attempt++) {
      // Check before clicking. Under parallel load the navigation from a
      // previous attempt can land after that attempt's wait expired, and
      // clicking again from the listing page — where the tile no longer exists
      // — turned a successful navigation into a failure.
      if (onListing()) return;

      await this.page.keyboard.press('Escape').catch(() => {});
      const clicked = await tile
        .click({ timeout: TIMEOUTS.nav })
        .then(() => true)
        .catch(() => false);
      if (!clicked) continue;

      // Was 8s, which is under the observed navigation time when three workers
      // are hitting production at once.
      const navigated = await this.page
        .waitForURL(/all-products\?category=/, { timeout: TIMEOUTS.nav })
        .then(() => true)
        .catch(() => false);
      if (navigated) return;
    }

    if (onListing()) return;

    throw new Error(
      await this.whyStuck(`the "${category}" tile never opened a category listing`)
    );
  }

  async openFirstProduct() {
    const first = this.productLinks.first();
    // waitFor, not isVisible(): isVisible() answers from the DOM at that
    // instant and ignores its timeout, so it reads false on a listing that is
    // still hydrating.
    await first.waitFor({ state: 'visible', timeout: TIMEOUTS.nav });
    await first.click();
    await this.page.waitForURL(/\/pd\//, { timeout: TIMEOUTS.nav });
  }

  async clickPurchaseControl() {
    const clicked = await this.purchaseControl
      .click({ timeout: TIMEOUTS.nav })
      .then(() => true)
      .catch(() => false);
    if (!clicked) {
      throw new Error(await this.whyStuck('the Buy Now / Subscribe control never became clickable'));
    }
  }
}

module.exports = { EmiStorePage };
