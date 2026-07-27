class ProductPage {
  constructor(page) {
    this.page = page;
    this.subscribeButton = page.getByRole('button', { name: 'Subscribe' });
    this.mobileNumberInput = page.getByRole('textbox', { name: 'Mobile Number*' });
    this.pincodeInput = page.getByRole('textbox', { name: 'Enter Pincode' }).first();
    this.checkPincodeButton = page.getByRole('button', { name: 'Check' }).first();
  }

  async selectProductByImageName(productName) {
    await this.page.getByRole('img', { name: productName }).first().click();
  }

  async clickSubscribe() {
    await this.subscribeButton.click({ timeout: 15000 });
  }

  async enterMobileNumberAndSendOtp(mobileNumber) {
    await this.mobileNumberInput.fill(mobileNumber);
    await this.mobileNumberInput.press('Enter');
  }

  async waitForManualOtpEntry() {
    console.log('OTP sent. Enter it manually in the browser, then click Resume.');
    await this.page.pause();
    console.log('Resumed. Current URL:', this.page.url());
  }

  // Reusable: enter ANY pincode and click Check — recall it anywhere
  async checkPincode(pincode) {
    await this.pincodeInput.scrollIntoViewIfNeeded();
    await this.pincodeInput.click();
    await this.pincodeInput.fill('');                              // reliably clear the pre-filled pincode
    await this.pincodeInput.pressSequentially(pincode, { delay: 100 }); // type key-by-key so Check enables
    await this.checkPincodeButton.click();
  }
}

module.exports = { ProductPage };