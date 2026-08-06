// tests/regression/address-management.spec.js
//
// Saved addresses: /my-profile -> Saved Addresses -> Add New Address.
//
// LOGIN-GATED. Addresses belong to an account, so this needs a live session.
// There is no in-test login: every spec inherits storageState from
// playwright.config.js and guards it with assertFreshSession().
//
// WHAT THE UI ACTUALLY OFFERS, measured before these tests were written:
//
//   /my-profile/address   lists saved addresses, each showing name, address,
//                         pincode, phone, and a Default / Home & Office marker
//                         plus an "Add New Address" control (text, not a button)
//
//   the add form          fullName, email, mobile, flatNo, areaStreet,
//                         landmark, pincode, city, state, an address-type radio
//                         (Home / Office / Other), a "Set as Default" checkbox,
//                         and a SAVE & PROCEED button
//
// TWO THINGS THIS SPEC CANNOT DO, because the UI has no such control:
//
//   Edit    — getByRole('button', { name: /edit/i })     -> 0 matches
//   Delete  — getByRole('button', { name: /delete|remove/i }) -> 0 matches
//             and the text equivalents are 0 as well
//
// So there are no edit or delete tests, and no "delete every address" negative
// case. That is not an omission; there is nothing to drive. It also means an
// address created here is PERMANENT, which is why creation goes through
// addAddressIfMissing() and runs at most once per account.
//
// The spec also never sets "Set as Default". The account's default address is
// wired into subscription-e2e, emi-store-flow and checkout-flow, and changing
// it would break them in ways that would look unrelated to addresses.

const { test, expect } = require('../fixtures/pageFixtures');
const { AccountPage } = require('../pages/accountPage');
const { TEST_ADDRESS, TIMEOUTS } = require('../data/constants');
const { assertFreshSession } = require('../utils/session');

test.beforeAll(() => assertFreshSession());

// The form requires a mobile number. Prefer an explicit test number; fall back
// to the login number so the spec still runs on a machine that has only that.
const MOBILE = process.env.TEST_PHONE || process.env.BYTEPE_MOBILE;

// What identifies our address in the list.
const MARKER = TEST_ADDRESS.areaStreet;

test.describe('Address management', () => {
  // PRESENCE — the account has addresses, and they render with real content.
  test('saved addresses page lists at least one address', async ({ page }) => {
    test.setTimeout(120000);
    const account = new AccountPage(page);

    await account.gotoAddresses();

    // Non-vacuous: prove the page rendered its own control before reading text
    // off it, so this cannot pass against a blank document.
    await expect(account.addNewAddress).toBeVisible({ timeout: TIMEOUTS.nav });

    const listed = await account.addressListText();
    expect(listed.length, 'the address page rendered no text').toBeGreaterThan(50);

    // An address card is only meaningful if it carries a deliverable address:
    // a 6-digit pincode and a phone number. Asserting "some text exists" would
    // pass on an empty-state page saying "no addresses yet".
    expect(listed, 'no 6-digit pincode in the address list').toMatch(/\b\d{6}\b/);
    expect(listed, 'no phone number shown against an address').toMatch(/Phone:\s*\d/i);
  });

  // PRESENCE — the add form exists and offers every field an address needs.
  test('the add address form exposes all required fields', async ({ page }) => {
    test.setTimeout(120000);
    const account = new AccountPage(page);

    await account.gotoAddresses();
    await account.openAddForm();

    for (const [name, locator] of Object.entries(account.form)) {
      await expect(locator, `the ${name} field is missing from the add form`)
        .toBeVisible({ timeout: TIMEOUTS.nav });
    }
    await expect(account.saveButton, 'no SAVE & PROCEED button').toBeVisible();
  });

  // CORRECTNESS + BEHAVIOUR — an address can be added, it is stored with the
  // data entered, and it coexists with the addresses already there.
  test('an added address is saved with the data entered', async ({ page }) => {
    test.setTimeout(180000);
    test.skip(!MOBILE, 'Neither TEST_PHONE nor BYTEPE_MOBILE is set — the form requires a mobile number.');

    const account = new AccountPage(page);

    const before = await (async () => {
      await account.gotoAddresses();
      return account.addressListText();
    })();

    const outcome = await account.addAddressIfMissing(TEST_ADDRESS, { mobile: MOBILE, marker: MARKER });
    console.log(`test address: ${outcome}`);

    const after = await account.addressListText();

    // Correctness: the fields that were entered come back. Checking the street
    // alone would pass if the form silently dropped everything else.
    expect(after, 'the saved address is missing its street').toContain(TEST_ADDRESS.areaStreet);
    expect(after, 'the saved address is missing its flat number').toContain(TEST_ADDRESS.flatNo);
    expect(after, 'the saved address is missing its pincode').toContain(TEST_ADDRESS.pincode);
    expect(after, 'the saved address is missing its city').toContain(TEST_ADDRESS.city);

    // Behaviour: adding did not replace what was already there. Only meaningful
    // on the run that actually creates it.
    if (outcome === 'created') {
      expect(after.length, 'the address list shrank after adding an address')
        .toBeGreaterThan(before.length);
    }

    // The pre-existing default must survive. This is the guard that stops this
    // spec quietly breaking every checkout spec.
    expect(after, 'the original saved address is gone').toMatch(/Default/i);
  });

  // NEGATIVE — an empty form must not create an address.
  //
  // Chosen over "delete every address", which the requested design asked for:
  // there is no delete control, and even if there were, removing the account's
  // real addresses would break the checkout specs and destroy account data.
  // Submitting an empty form exercises the same thing — server or client side
  // validation refusing to store rubbish — and creates nothing.
  test('submitting an empty address form does not create an address', async ({ page }) => {
    test.setTimeout(120000);
    const account = new AccountPage(page);

    await account.gotoAddresses();
    const before = await account.addressListText();

    await account.openAddForm();
    await account.submitAddress();
    await page.waitForTimeout(3000);

    // Either the form stays open with a validation error, or it refuses to
    // navigate. Both are acceptable; silently saving a blank address is not.
    const stillOnForm = await account.form.flatNo.isVisible().catch(() => false);
    const after = await account.addressListText();

    expect(
      stillOnForm || after.length <= before.length,
      'an empty form was accepted — the address list grew after submitting nothing'
    ).toBe(true);
  });
});
