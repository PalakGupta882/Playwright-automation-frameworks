const { TIMEOUTS } = require('../data/constants');

class ProductPage {
  constructor(page) {
    this.page = page;

    // The PDP renders 14 nodes matching /^₹[\d,]+$/ — the struck-through MRP,
    // EMI instalments, total discount, assured buyback and exchange values are
    // all in there. The one a shopper reads as "the price" is the first in DOM
    // order: 20px, weight 600, no line-through. Verified against the API — it
    // equals data.upfront.price from /api/apps/variant-pricing for the same
    // variant, while the next match is the strike-through MRP.
    //
    // .first() is DOM-order dependent, which is not ideal, but the PDP offers
    // no heading, test id or stable class to anchor to (the plan boxes are MUI
    // with hashed class names). If the layout reorders, this is where it breaks
    // — and getPrice() throws with the text it actually found, rather than
    // returning a wrong number quietly.
    this.priceText = page.getByText(/^₹[\d,]+$/).first();

    this.subscribeButton = page.getByRole('button', { name: 'Subscribe' });
    this.mobileNumberInput = page.getByRole('textbox', { name: 'Mobile Number*' });
    // Filtered to visible, for the same reason as the header search box: this
    // page renders desktop and mobile variants of the pincode widget, and
    // .first() could resolve to a hidden one. Clicking that never succeeds —
    // with the config's former actionTimeout of 0 it hung for the whole test
    // budget, and with a timeout it fails at 30s on a control that looks
    // perfectly fine in the screenshot.
    this.pincodeInput = page
      .getByRole('textbox', { name: 'Enter Pincode' })
      .filter({ visible: true })
      .first();
    this.checkPincodeButton = page
      .getByRole('button', { name: 'Check' })
      .filter({ visible: true })
      .first();
  }

  // Filtered to visible: listing tiles are rendered twice, for the desktop and
  // mobile layouts, and .first() could resolve to the hidden copy. Clicking
  // that never completes — it surfaced as a 30s timeout on a tile that is
  // plainly there in the screenshot.
  async selectProductByImageName(productName) {
    await this.page
      .getByRole('img', { name: productName })
      .filter({ visible: true })
      .first()
      .click();
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

  // Reads the displayed price as a number: "₹32,299" -> 32299.
  //
  // Throws rather than returning NaN or 0 on a page that never rendered a
  // price. A helper that quietly returns 0 would make a comparison like
  // `expect(a).toBe(b)` pass with 0 === 0 on two broken pages.
  async getPrice() {
    await this.priceText.waitFor({ state: 'visible', timeout: TIMEOUTS.nav });

    const raw = (await this.priceText.innerText()).trim();
    const value = Number(raw.replace(/[₹,\s]/g, ''));

    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(`expected a price like "₹32,299" but read ${JSON.stringify(raw)}`);
    }
    return value;
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