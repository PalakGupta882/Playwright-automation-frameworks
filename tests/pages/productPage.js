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

    // "Lowest Effective Price" banner — the PDP surface for the pricing API's
    // `best_price` object. Note the names differ: the field is best_price, the
    // copy on screen is "Lowest Effective Price". Searching the page for "best
    // price" finds nothing.
    this.lowestEffectivePriceLabel = page.getByText(/lowest effective price/i).first();

    // The amount, matched together with its caption in one expression:
    //   "₹1,84,999 with Discount & Coupon"
    //
    // Chosen over three alternatives that all measured worse:
    //   - the MUI class on the container (mui-1ll6jj1) is build-hashed and
    //     changes on every deploy;
    //   - `getByText(/^₹[\d,]+$/).first()` is already taken by the headline
    //     price — the PDP renders 14 rupee nodes (see priceText above);
    //   - anchoring on the caption alone and walking up with xpath=.. couples
    //     the locator to the DOM nesting, which is what the banner's own
    //     re-render changes.
    //
    // Binding the amount and the caption into one regex means the locator fails
    // loudly if either half disappears, rather than silently matching a
    // different rupee figure. Measured count=1 on a live PDP.
    this.lowestEffectivePriceRow = page
      .getByText(/^₹[\d,]+\s*with Discount & Coupon$/i)
      .first();
  }

  // Reads the banner amount as a number: "₹1,84,999 with Discount & Coupon" ->
  // 184999. Throws rather than returning NaN, for the same reason getPrice()
  // does — a helper that quietly returns 0 makes two broken pages compare equal.
  async getLowestEffectivePrice() {
    await this.lowestEffectivePriceRow.waitFor({ state: 'visible', timeout: TIMEOUTS.nav });

    const raw = (await this.lowestEffectivePriceRow.innerText()).trim();
    const digits = raw.match(/₹\s?([\d,]+)/);
    const value = digits ? Number(digits[1].replace(/,/g, '')) : NaN;

    if (!Number.isFinite(value) || value <= 0) {
      throw new Error(
        `expected a banner like "₹1,84,999 with Discount & Coupon" but read ${JSON.stringify(raw)}`
      );
    }
    return value;
  }

  // Picks a variant attribute chip (a storage or RAM value such as "512GB").
  // Selecting one navigates to that variant's bpid, so the caller should expect
  // the URL to change.
  //
  // The Escape-then-force retry is not defensive padding: measured on this PDP,
  // a plain click on the 1TB chip failed for the full 30s with
  // "<div class=MuiBox-root …> intercepts pointer events" and
  // "<div …> from <header …> subtree intercepts pointer events" — the sticky
  // header and a promo overlay both sit over the chip row after a re-render.
  async selectVariantOption(value) {
    const chip = this.page.getByText(value, { exact: true }).filter({ visible: true }).first();

    await chip.scrollIntoViewIfNeeded();
    await chip.click({ timeout: TIMEOUTS.action }).catch(async () => {
      await this.page.keyboard.press('Escape').catch(() => {});
      await chip.scrollIntoViewIfNeeded();
      await chip.click({ force: true, timeout: TIMEOUTS.action });
    });
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
  //
  // Key-by-key entry is required: fill() sets the value without the keystroke
  // events the widget listens for, so Check never enables.
  //
  // But pressSequentially() is not enough on its own. It resolves the element
  // ONCE and types into that handle, and this widget re-renders while you type
  // — measured on 10 Aug 2026, a run sent all six digits of "110001" and left
  // the box holding "11", because React replaced the input node partway through
  // and the remaining keystrokes landed on a node no longer in the document.
  //
  // That surfaced as a 30s timeout on `Check` being disabled, which points at
  // the button when the input is the thing that is wrong. So: press() per
  // digit, which re-resolves the locator on every keystroke and therefore
  // survives a re-mount, then verify what actually landed before touching Check.
  async checkPincode(pincode) {
    const ATTEMPTS = 3;

    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      await this.pincodeInput.scrollIntoViewIfNeeded();
      await this.pincodeInput.click();
      await this.pincodeInput.fill(''); // reliably clear the pre-filled pincode

      for (const digit of pincode) {
        await this.pincodeInput.press(digit);
      }

      const typed = await this.pincodeInput.inputValue();
      if (typed === pincode) break;

      // A re-mount can still eat the keystroke that races it. Retrying the whole
      // entry is cheap; guessing which digit was lost is not.
      if (attempt === ATTEMPTS) {
        throw new Error(
          `Could not enter the pincode: wanted ${JSON.stringify(pincode)} but the field ` +
          `holds ${JSON.stringify(typed)} after ${ATTEMPTS} attempts. The widget is ` +
          'dropping keystrokes faster than a re-type recovers them.'
        );
      }
    }

    // Only now is Check expected to be enabled. If it is not, the field is
    // complete and the button is genuinely stuck — a site bug, and worth the
    // timeout it will produce.
    await this.checkPincodeButton.click();
  }
}

module.exports = { ProductPage };