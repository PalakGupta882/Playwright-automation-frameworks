// tests/pages/accountPage.js
//
// The account area: /my-profile and its Saved Addresses page.
//
// A separate page object rather than a method bolted onto productPage: nothing
// here concerns a product, and productPage is constructed by the fixture for
// every spec that takes it.
//
// FIELD LOCATORS ARE BY PLACEHOLDER, NOT ROLE. Measured on the live form: none
// of the address inputs carry a label, aria-label or accessible name, so
// getByRole('textbox', { name: ... }) resolves nothing. The only stable
// handles are the placeholder text and the `name` attribute. Placeholder is
// preferred here because it is what a shopper actually reads.
//
// THE UI HAS NO EDIT AND NO DELETE. Probed for buttons and text matching
// /edit/i and /delete|remove/i on the address list: zero matches. Anything
// created here is permanent, which is why addAddressIfMissing() exists.

const { BASE_URL, TIMEOUTS } = require('../data/constants');

class AccountPage {
  constructor(page) {
    this.page = page;

    this.savedAddressesEntry = page.getByText(/saved addresses/i).first();

    // "Add New Address" is rendered as text, not a button — getByRole('button')
    // returns 0 for it.
    this.addNewAddress = page.getByText(/add new address/i).first();

    this.form = {
      fullName: page.getByPlaceholder('Your Full Name'),
      email: page.getByPlaceholder('Your email id'),
      mobile: page.getByPlaceholder('Your mobile number'),
      flatNo: page.getByPlaceholder('Flat No. / House no.'),
      areaStreet: page.getByPlaceholder('Area, Street, Sector'),
      landmark: page.getByPlaceholder('Landmark (optional)'),
      pincode: page.getByPlaceholder('Pincode'),
      city: page.getByPlaceholder('Area/City'),
      state: page.getByPlaceholder('State'),
    };

    this.saveButton = page.getByRole('button', { name: /save\s*&\s*proceed/i }).first();
  }

  async gotoProfile() {
    await this.page.goto(`${BASE_URL}/my-profile`, { waitUntil: 'domcontentloaded' });
    await this.page.keyboard.press('Escape').catch(() => {});
  }

  async gotoAddresses() {
    await this.page.goto(`${BASE_URL}/my-profile/address`, { waitUntil: 'domcontentloaded' });
    await this.page.keyboard.press('Escape').catch(() => {});
    await this.addNewAddress.waitFor({ state: 'visible', timeout: TIMEOUTS.nav });
  }

  // The rendered address list as one string. The cards have no per-address test
  // id, so membership is checked by matching text within the list rather than
  // by locating a card.
  async addressListText() {
    return (await this.page.locator('body').innerText()).replace(/\s+/g, ' ');
  }

  async hasAddressMatching(marker) {
    return (await this.addressListText()).includes(marker);
  }

  async openAddForm() {
    await this.addNewAddress.click({ timeout: TIMEOUTS.action });
    await this.form.flatNo.waitFor({ state: 'visible', timeout: TIMEOUTS.nav });
  }

  // Fills and submits the add-address form.
  //
  // Deliberately never touches "Set as Default": the account's default address
  // is wired into the checkout specs (subscription-e2e, emi-store-flow,
  // checkout-flow all resolve the same address_id), and changing it would break
  // them for reasons that would look unrelated.
  async fillAddressForm(data, { mobile }) {
    await this.form.fullName.fill(data.fullName);
    await this.form.mobile.fill(mobile);
    await this.form.flatNo.fill(data.flatNo);
    await this.form.areaStreet.fill(data.areaStreet);
    if (data.landmark) await this.form.landmark.fill(data.landmark);

    // Pincode drives the city/state lookup on this form, so it goes in before
    // them and is typed key-by-key — the same reason productPage.checkPincode
    // uses pressSequentially.
    await this.form.pincode.pressSequentially(data.pincode, { delay: 100 });
    await this.page.waitForTimeout(1500);

    // Only fill city/state if the pincode lookup did not populate them.
    if (!(await this.form.city.inputValue())) await this.form.city.fill(data.city);
    if (!(await this.form.state.inputValue())) await this.form.state.fill(data.state);

    if (data.addressType) {
      const type = this.page.getByText(new RegExp(`^${data.addressType}$`, 'i')).first();
      await type.click({ timeout: TIMEOUTS.action }).catch(() => {});
    }
  }

  async submitAddress() {
    await this.saveButton.click({ timeout: TIMEOUTS.action });
  }

  // Creates the address only when it is not already there.
  //
  // The UI offers no way to delete an address, so a spec that created one on
  // every run would pile up junk on a real account with no way to clear it.
  // Returns 'created' or 'already-present' so a test can assert on either.
  async addAddressIfMissing(data, { mobile, marker }) {
    await this.gotoAddresses();

    if (await this.hasAddressMatching(marker)) return 'already-present';

    await this.openAddForm();
    await this.fillAddressForm(data, { mobile });
    await this.submitAddress();

    await this.page.waitForURL(/\/my-profile\/address/, { timeout: 30000 }).catch(() => {});
    await this.addNewAddress.waitFor({ state: 'visible', timeout: 30000 });

    // Returning to the list is not the same as the list having re-rendered.
    // Asserting straight after the form closed failed against a list that was
    // still showing its previous contents, even though the address had saved
    // correctly. Wait for the new address itself to appear.
    await this.page
      .getByText(marker, { exact: false })
      .first()
      .waitFor({ state: 'visible', timeout: 30000 });

    return 'created';
  }
}

module.exports = { AccountPage };
