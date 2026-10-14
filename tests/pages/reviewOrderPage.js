const { MESSAGES, TIMEOUTS } = require('../data/constants');
const { orderContinueButton } = require('../utils/orderContinue');

class ReviewOrderPage {
  constructor(page) {
    this.page = page;
    this.couponInput = page.getByPlaceholder('Have a Coupon Code?');
    this.continueButton = page.getByRole('button', { name: 'Continue' });
  }

  async isLoaded() {
    await this.page.waitForURL(/\/review\//, { timeout: 30000 });
  }

  async applyCoupon(couponCode) {
    await this.couponInput.click();
    await this.couponInput.fill(couponCode);
    await this.couponInput.press('Tab');

    const applyButton = this.page.getByText('Apply', { exact: true }).first();
    await applyButton.waitFor({ state: 'visible', timeout: 10000 });
    await applyButton.click({ force: true, timeout: 10000 });
    await this.page.waitForTimeout(2000);
  }

  // waitFor, not isVisible. isVisible() answers from the DOM as it stands at
  // that instant and ignores the timeout it is handed — it does not wait. The
  // coupon error arrives from a server round trip, so on a slower run it had
  // not rendered yet and this returned false, failing the test intermittently
  // with "expect(hasError).toBe(true)". Same trap as tests/auth-setup.spec.js.
  async getCouponErrorMessage() {
    return this.page
      .getByText(MESSAGES.invalidCoupon)
      .first()
      .waitFor({ state: 'visible', timeout: TIMEOUTS.nav })
      .then(() => true)
      .catch(() => false);
  }

  // MINTS A REAL ORDER. Not `this.continueButton`: its string name is a
  // case-insensitive substring match, so it also matches "Continue Shopping".
  // orderContinueButton() clicks only when exactly one visible Continue-shaped
  // control exists, and throws with the labels it found otherwise.
  async clickContinue() {
    const proceed = await orderContinueButton(this.page);
    await proceed.click({ timeout: 10000 });
  }
}

module.exports = { ReviewOrderPage };