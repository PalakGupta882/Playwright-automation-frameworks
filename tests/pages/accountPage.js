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
// THE UI DOES HAVE EDIT AND DELETE — corrected 11 Aug 2026.
//
// This file previously stated the opposite: "probed for buttons and text
// matching /edit/i and /delete|remove/i on the address list: zero matches".
// Those counts were accurate and the conclusion was wrong. Every address card
// carries two MUI IconButtons with **no text, no aria-label and no title**, so
// no name-based locator can ever see them. Re-probed:
//
//   button:has(svg) on the list = 16, of which 12 are visible and 30x30,
//   alternating strictly down the page:
//
//     y=183 data-testid="EditIcon"     y=221 data-testid="DeleteIcon"   card 1
//     y=361 data-testid="EditIcon"     y=399 data-testid="DeleteIcon"   card 2
//     ...                                                              6 cards
//
// So the icon's data-testid is the only handle. It is chosen over the
// alternatives deliberately:
//
//   - getByRole('button', { name: ... })  -> 0, there is no accessible name
//   - nth(index)                          -> depends on card order, which is
//                                            server-ordered and moves
//   - position (every one is at x=1209)   -> breaks on any layout change
//   - the MUI class (mui-1k33q06)         -> a build-hashed emotion class
//
// data-testid on the icon is set by MUI itself from the icon component name, so
// it survives restyling and reordering. It is not a test id the app team added,
// which means it could change if they swap icon libraries — that is the one
// risk, and it fails loudly rather than silently matching the wrong control.
//
// Because delete exists, an address created here is NO LONGER permanent.
// addAddressIfMissing() is still used for the shared TEST_ADDRESS, but
// throwaway addresses can now create and remove their own state.

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

    // Per-card controls. See the header note for why these key off the icon's
    // data-testid rather than an accessible name.
    this.editIcons = page.locator('button:has([data-testid="EditIcon"])');
    this.deleteIcons = page.locator('button:has([data-testid="DeleteIcon"])');

    // Exactly one address carries this. Exact match on purpose: the add form
    // renders "Set as Default", which a loose /default/i would also match.
    this.defaultMarkers = page.getByText('Default', { exact: true });
  }

  // A single address card, located by text it contains.
  //
  // Cards have no test id and only build-hashed emotion classes, so the card is
  // the innermost element that both contains the marker text and holds an edit
  // control. Ancestors match too — the page body contains every marker — and
  // they precede their descendants in document order, so .last() is the
  // innermost, i.e. the card itself. Requiring the EditIcon keeps it from
  // resolving to a bare text node wrapper that cannot be acted on.
  cardFor(marker) {
    return this.page
      .locator('div')
      .filter({ has: this.page.locator('[data-testid="EditIcon"]') })
      .filter({ hasText: marker })
      .last();
  }

  async gotoProfile() {
    await this.page.goto(`${BASE_URL}/my-profile`, { waitUntil: 'domcontentloaded' });
    await this.page.keyboard.press('Escape').catch(() => {});
  }

  // --- My Orders ---------------------------------------------------------
  //
  // Order cards are <button>s, not links: a[href*="order"] matches 0 on the
  // list. Each card's text is "<product> <variant> ₹<price> <status>", so the
  // price is what identifies a card and ties it to its detail page.
  get orderCards() {
    return this.page.getByRole('button').filter({ hasText: /₹\s?[\d,]+/ });
  }

  // Opens My Orders from the profile page and returns how many orders are
  // listed. Returning the count lets a test skip meaningfully on an account
  // with no history rather than asserting against nothing.
  async navigateToMyOrders() {
    await this.gotoProfile();
    await this.page.getByText('My Orders', { exact: true }).first().click({ timeout: TIMEOUTS.action });
    await this.page.waitForURL(/\/orders\/my-orders/, { timeout: 30000 });
    await this.page
      .getByRole('heading', { name: /my orders/i })
      .first()
      .waitFor({ state: 'visible', timeout: TIMEOUTS.nav });
    return this.orderCards.count();
  }

  async clickOrderDetail(orderIndex = 0) {
    const card = this.orderCards.nth(orderIndex);
    const summary = (await card.innerText()).replace(/\s+/g, ' ').trim();

    await card.click({ timeout: TIMEOUTS.action }).catch(async () => {
      await this.page.keyboard.press('Escape').catch(() => {});
      await card.click({ force: true, timeout: TIMEOUTS.action });
    });

    // The detail route carries the order's own id, so waiting for it is proof
    // a specific order opened rather than the list having re-rendered.
    await this.page.waitForURL(/\/orders\/my-orders\/[0-9a-f-]{8,}/i, { timeout: 30000 });
    await this.page
      .getByText(/order\s*id/i)
      .first()
      .waitFor({ state: 'visible', timeout: TIMEOUTS.nav });

    return summary; // the list text, for comparing against the detail page
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

  // How many address cards are rendered. Counted from the edit controls —
  // exactly one per card, and unlike the card <div> they are unambiguous.
  async addressCount() {
    return this.editIcons.count();
  }

  async openEditFor(marker) {
    await this.cardFor(marker)
      .locator('button:has([data-testid="EditIcon"])')
      .first()
      .click({ timeout: TIMEOUTS.action });
    await this.form.flatNo.waitFor({ state: 'visible', timeout: TIMEOUTS.nav });
  }

  // Every field's current value. Proves the edit form opened populated rather
  // than blank — a blank edit form would mean "edit" silently creates.
  async readFormValues() {
    const values = {};
    for (const [name, locator] of Object.entries(this.form)) {
      values[name] = await locator.inputValue();
    }
    return values;
  }

  // Creates an address unconditionally. Separate from addAddressIfMissing()
  // because a throwaway address wants to be created every run and removed
  // again; the shared TEST_ADDRESS wants the opposite.
  async createAddress(data, { mobile }) {
    await this.gotoAddresses();
    await this.openAddForm();
    await this.fillAddressForm(data, { mobile });
    await this.submitAddress();

    await this.addNewAddress.waitFor({ state: 'visible', timeout: 30000 });
    // The list can return still showing its previous contents, so wait for the
    // new row itself — the same reason addAddressIfMissing() does.
    await this.page
      .getByText(data.areaStreet, { exact: false })
      .first()
      .waitFor({ state: 'visible', timeout: 30000 });
  }

  // Deletes the card matching `marker` and reports whether the UI asked for
  // confirmation first.
  //
  // The branching lives here, not in the test, for two reasons: a conditional
  // in a spec is a lint warning in this repo, and whether a confirm step exists
  // was genuinely unknown before running — finding out means clicking delete on
  // a real address, which no probe would do. The test asserts on the returned
  // value instead.
  async deleteAddressReportingConfirmation(marker) {
    await this.gotoAddresses();

    // Never delete on an ambiguous match. Picking the wrong card here destroys
    // real account data and there is no undo.
    const occurrences = (await this.addressListText()).split(marker).length - 1;
    if (occurrences !== 1) {
      throw new Error(
        `Refusing to delete: "${marker}" matches ${occurrences} addresses on the ` +
        'account, expected exactly 1. Delete only ever targets an address this ' +
        'suite created.'
      );
    }

    const before = await this.addressCount();

    await this.cardFor(marker)
      .locator('button:has([data-testid="DeleteIcon"])')
      .first()
      .click({ timeout: TIMEOUTS.action });

    // A confirm step may be a role=dialog, or just text in a mounted panel.
    // Check both before concluding there is none.
    const dialog = this.page.getByRole('dialog').first();
    const seenDialog = await dialog
      .waitFor({ state: 'visible', timeout: 5000 })
      .then(() => true)
      .catch(() => false);

    const prompt = this.page.getByText(/are you sure|confirm|do you want to delete/i).first();
    const seenPrompt =
      seenDialog ||
      (await prompt
        .waitFor({ state: 'visible', timeout: 2000 })
        .then(() => true)
        .catch(() => false));

    let dialogText = '';
    if (seenPrompt) {
      const scope = seenDialog ? dialog : this.page;
      dialogText = seenDialog
        ? (await dialog.innerText()).replace(/\s+/g, ' ').trim()
        : (await prompt.innerText()).replace(/\s+/g, ' ').trim();

      // Confirm regardless, so the throwaway address is always cleaned up even
      // when the assertion about confirmation goes on to fail.
      await scope
        .getByRole('button', { name: /^(yes|confirm|delete|ok|remove)\b/i })
        .first()
        .click({ timeout: TIMEOUTS.action })
        .catch(() => {});
    }

    await this.gotoAddresses();
    const after = await this.addressCount();

    return {
      confirmationSeen: seenPrompt,
      dialogText,
      before,
      after,
      removed: !(await this.hasAddressMatching(marker)),
    };
  }

  // Cleanup for a negative test whose whole point is that nothing was created.
  //
  // If validation turns out to be broken and a row did appear, remove it rather
  // than leaving junk on a real account. Returns whether anything was deleted,
  // so the test can report "validation failed AND it created a row" rather than
  // quietly tidying up behind a bug.
  async removeIfPresent(marker) {
    await this.gotoAddresses();
    if (!(await this.hasAddressMatching(marker))) return false;
    await this.deleteAddressReportingConfirmation(marker);
    return true;
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
