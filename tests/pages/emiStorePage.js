class EmiStorePage {
  constructor(page) {
    this.page = page;
  }

  async goto() {
    await this.page.goto('https://www.bytepe.com/home/emi-store', { waitUntil: 'domcontentloaded' });
    await this.handleLoginInterruptionIfPresent();
  }

  async handleLoginInterruptionIfPresent() {
    const isLoginPromptVisible = await this.page.getByText('Enter mobile number to continue')
      .isVisible({ timeout: 3000 })
      .catch(() => false);
    if (isLoginPromptVisible) {
      console.log('Login prompt detected — log in, then click Resume.');
      await this.page.pause();
    }
  }

  async selectFirstAvailableProduct() {
    // Clicking a category navigates to a product listing. An auto-rotating banner
    // sometimes re-renders the page and swallows the click, so retry until we navigate.
    for (let attempt = 0; attempt < 3; attempt++) {
      await this.page.getByRole('img', { name: 'grooming' }).first().click();
      const navigated = await this.page
        .waitForURL(/all-products\?category=/, { timeout: 8000 })
        .then(() => true)
        .catch(() => false);
      if (navigated) break;
    }
    // On the listing now — click the first product link
    const firstProduct = this.page.locator('a[href*="/pd/"]').first();
    await firstProduct.waitFor({ state: 'visible', timeout: 15000 });
    await firstProduct.click();
  }

  async clickBuyNow() {
    await this.page.getByRole('button', { name: 'Buy Now' }).first().click({ timeout: 15000 });
    await this.handleLoginInterruptionIfPresent();
  }

  async enterMobileNumberAndSendOtp(mobileNumber) {
    const mobileInput = this.page.getByRole('textbox', { name: 'Mobile Number*' });
    await mobileInput.fill(mobileNumber);
    await mobileInput.press('Enter');
  }

  async waitForManualOtpEntry() {
    console.log('OTP sent. Enter it manually, then click Resume.');
    await this.page.pause();
  }
}

module.exports = { EmiStorePage };