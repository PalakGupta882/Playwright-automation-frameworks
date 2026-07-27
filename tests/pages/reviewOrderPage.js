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

  async getCouponErrorMessage() {
    const errorText = this.page.getByText('Invalid or inactive coupon');
    const isVisible = await errorText.isVisible({ timeout: 5000 }).catch(() => false);
    return isVisible;
  }

  async clickContinue() {
    await this.continueButton.click({ timeout: 10000 });
  }
}

module.exports = { ReviewOrderPage };