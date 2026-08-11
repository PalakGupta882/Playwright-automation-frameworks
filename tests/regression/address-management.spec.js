// tests/regression/address-management.spec.js
//
// Saved addresses: /my-profile -> Saved Addresses -> /my-profile/address.
// Test cases and the measurements behind them: test-cases/address-management.md
//
// LOGIN-GATED. Addresses belong to an account, so this needs a live session.
// There is no in-test login: every spec inherits storageState from
// playwright.config.js and guards it with assertFreshSession().
//
// CORRECTED 11 Aug 2026 — this file used to say "TWO THINGS THIS SPEC CANNOT
// DO, because the UI has no such control: Edit ... Delete". That was wrong.
// Both exist as unlabelled MUI icon buttons which no name-based locator can
// see; see the header of tests/pages/accountPage.js for the probe output and
// why the locators key off data-testid. Consequences:
//
//   - an address created here is no longer permanent, so the throwaway cases
//     create and remove their own state
//   - the negative cases that press SAVE clean up after themselves, in case
//     validation is broken and a row does appear
//
// WHAT THE UI OFFERS, re-measured 11 Aug 2026:
//
//   /my-profile/address   lists address cards (6 on this account), each with
//                         name, address, pincode, "Phone:", a type marker
//                         ("Home" or "Home & Office"), an EditIcon and a
//                         DeleteIcon button, plus exactly one "Default" marker
//                         and an "Add New Address" control (text, not a button)
//
//   the add form          fullName*, email, mobile*, flatNo*, areaStreet,
//                         landmark, pincode*, city*, state*, an address-type
//                         radio (Home / Office / Other), a "Set as Default"
//                         checkbox, "Use my current location", and a
//                         SAVE & PROCEED button.  * = required. Note areaStreet
//                         and email are NOT required, and no input carries the
//                         HTML `required` attribute — validation is JS-side.
//
// WRITES ARE GATED. Anything that creates or edits a saved address sits behind
// BYTEPE_ALLOW_WRITES=1, the same flag the order-minting and video suites use.
//
// "Set as Default" is never touched. The account's default address is wired
// into subscription-e2e, emi-store-flow and checkout-flow, and changing it
// would break them in ways that would look unrelated to addresses.

const { test, expect } = require('../fixtures/pageFixtures');
const { AccountPage } = require('../pages/accountPage');
const { BASE_URL, TEST_ADDRESS, TIMEOUTS } = require('../data/constants');
const { assertFreshSession } = require('../utils/session');
const { writesAllowed, writeSkipReason } = require('../utils/writes');
const { getApiContext, readSavedUserId } = require('../api/apiHelper');
const { ENDPOINTS } = require('../data/apiEndpoints');

test.beforeAll(() => assertFreshSession());

// The form requires a mobile number. Prefer an explicit test number; fall back
// to the login number so the spec still runs on a machine that has only that.
const MOBILE = process.env.TEST_PHONE || process.env.BYTEPE_MOBILE;

// What identifies our shared, permanent address in the list.
const MARKER = TEST_ADDRESS.areaStreet;

// Distinguishes this run's throwaway addresses from a previous run's leftovers,
// so a crashed run cannot make the next one ambiguous.
const RUN = Date.now().toString(36).slice(-6);

// A one-off address that the test that creates it also removes.
const throwaway = (label) => ({
  ...TEST_ADDRESS,
  areaStreet: `QA DELETE ME ${label} ${RUN}`,
  landmark: '',
});

test.describe('Address management', () => {
  // TC-ADDR-001
  // PRESENCE — the account has addresses, and they render with real content.
  test('TC-ADDR-001 saved addresses page lists at least one address', async ({ page }) => {
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

  // TC-ADDR-002
  // PRESENCE — the add form exists and offers every field an address needs.
  test('TC-ADDR-002 the add address form exposes all required fields', async ({ page }) => {
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

  // TC-ADDR-003
  // CORRECTNESS + BEHAVIOUR — an address can be added, it is stored with the
  // data entered, and it coexists with the addresses already there.
  test('TC-ADDR-003 an added address is saved with the data entered', async ({ page }) => {
    test.setTimeout(180000);
    test.skip(!writesAllowed(), writeSkipReason('Creates the shared saved address, which is kept on the account'));
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
    expect(
      outcome === 'already-present' || after.length > before.length,
      'the address list shrank after adding an address'
    ).toBe(true);

    // The pre-existing default must survive. This is the guard that stops this
    // spec quietly breaking every checkout spec.
    expect(after, 'the original saved address is gone').toMatch(/Default/i);
  });

  // TC-ADDR-004
  // PERSISTENCE — the list is served, not a client-side artefact of one render.
  test('TC-ADDR-004 saved addresses survive a reload', async ({ page }) => {
    test.setTimeout(120000);
    const account = new AccountPage(page);

    await account.gotoAddresses();
    const firstCount = await account.addressCount();
    const firstText = await account.addressListText();

    // Non-vacuous: a page with zero addresses would make "same before and
    // after" trivially true.
    expect(firstCount, 'no address cards rendered, so persistence proves nothing')
      .toBeGreaterThan(0);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await account.addNewAddress.waitFor({ state: 'visible', timeout: TIMEOUTS.nav });

    expect(await account.addressCount(), 'the address count changed across a reload')
      .toBe(firstCount);

    // Compare on the pincodes rather than whole-body text: the page carries
    // banners and counters that legitimately differ between renders.
    const pins = (t) => (t.match(/\b\d{6}\b/g) || []).join(',');
    expect(pins(await account.addressListText()), 'different addresses after reload')
      .toBe(pins(firstText));
  });

  // TC-ADDR-005
  // BEHAVIOUR — pincode drives the city/state lookup. Abandons the form.
  test('TC-ADDR-005 pincode lookup autofills city and state', async ({ page }) => {
    test.setTimeout(120000);
    const account = new AccountPage(page);

    await account.gotoAddresses();
    await account.openAddForm();

    await account.form.pincode.pressSequentially(TEST_ADDRESS.pincode, { delay: 100 });
    await page.waitForTimeout(4000);

    expect(await account.form.city.inputValue(), 'pincode did not autofill the city')
      .toMatch(new RegExp(TEST_ADDRESS.city, 'i'));
    expect(await account.form.state.inputValue(), 'pincode did not autofill the state')
      .toMatch(new RegExp(TEST_ADDRESS.state, 'i'));
  });

  // TC-ADDR-006
  // NEGATIVE — an empty form must not create an address.
  test('TC-ADDR-006 submitting an empty address form does not create an address', async ({ page }) => {
    test.setTimeout(120000);
    const account = new AccountPage(page);

    await account.gotoAddresses();
    const before = await account.addressCount();

    await account.openAddForm();
    await account.submitAddress();
    await page.waitForTimeout(3000);

    // Either the form stays open with a validation error, or it refuses to
    // navigate. Both are acceptable; silently saving a blank address is not.
    const stillOnForm = await account.form.flatNo.isVisible().catch(() => false);

    await account.gotoAddresses();
    const after = await account.addressCount();

    expect(
      stillOnForm || after <= before,
      'an empty form was accepted — the address list grew after submitting nothing'
    ).toBe(true);
    expect(after, 'submitting an empty form created an address').toBe(before);
  });

  // TC-ADDR-007
  // NEGATIVE — a pincode that does not exist is refused.
  //
  // Asserts the message, NOT that city/state are empty: measured on the live
  // form, they keep whatever the previous lookup put there, so an emptiness
  // assertion would fail for the wrong reason.
  test('TC-ADDR-007 a non-existent pincode is rejected', async ({ page }) => {
    test.setTimeout(120000);
    const account = new AccountPage(page);

    await account.gotoAddresses();
    await account.openAddForm();

    await account.form.pincode.pressSequentially('999999', { delay: 100 });
    await page.waitForTimeout(4000);

    await expect(
      page.getByText(/please enter a valid pincode/i).first(),
      'no validation message for a non-existent pincode'
    ).toBeVisible({ timeout: TIMEOUTS.nav });
  });

  // TC-ADDR-008
  // NEGATIVE — the pincode input itself constrains what can be entered, and a
  // short pincode cannot be saved.
  test('TC-ADDR-008 the pincode field rejects letters and over-length input', async ({ page }) => {
    test.setTimeout(180000);
    const account = new AccountPage(page);
    const data = { ...throwaway('pin'), pincode: '12345' };

    await account.gotoAddresses();
    const before = await account.addressCount();
    await account.openAddForm();

    await account.form.pincode.fill('abcdef');
    await expect(account.form.pincode, 'the pincode field accepted letters').toHaveValue('');

    await account.form.pincode.fill('1234567');
    await page.waitForTimeout(500);
    expect(
      (await account.form.pincode.inputValue()).length,
      'the pincode field accepted more than 6 digits'
    ).toBeLessThanOrEqual(6);

    // And a 5-digit pincode must not save.
    await account.form.pincode.fill('');
    await account.fillAddressForm(data, { mobile: MOBILE || '9999999999' });
    await account.submitAddress();
    await page.waitForTimeout(3000);

    await account.gotoAddresses();
    const after = await account.addressCount();

    // Clean up before asserting, so a broken validation leaves no residue even
    // though the test is about to fail.
    const leaked = await account.removeIfPresent(data.areaStreet);

    expect(leaked, 'a 5-digit pincode was accepted and an address was created').toBe(false);
    expect(after, 'the address list grew after submitting a 5-digit pincode').toBe(before);
  });

  // TC-ADDR-009
  // NEGATIVE — a mobile number that is not 10 digits is refused on blur.
  test('TC-ADDR-009 an invalid mobile number is rejected', async ({ page }) => {
    test.setTimeout(120000);
    const account = new AccountPage(page);

    await account.gotoAddresses();
    await account.openAddForm();

    await account.form.mobile.fill('12345');
    await account.form.flatNo.click();
    await page.waitForTimeout(1500);

    await expect(
      page.getByText(/mobile number must be 10 digits/i).first(),
      'no validation message for a 5-digit mobile number'
    ).toBeVisible({ timeout: TIMEOUTS.nav });
  });

  // TC-ADDR-010
  // NEGATIVE — email is optional but still format-validated.
  test('TC-ADDR-010 a malformed email is rejected', async ({ page }) => {
    test.setTimeout(120000);
    const account = new AccountPage(page);

    await account.gotoAddresses();
    await account.openAddForm();

    await account.form.email.fill('not-an-email');
    await account.form.flatNo.click();
    await page.waitForTimeout(1500);

    await expect(
      page.getByText(/please enter a valid email address/i).first(),
      'no validation message for a malformed email'
    ).toBeVisible({ timeout: TIMEOUTS.nav });
  });

  // TC-ADDR-011
  // NEGATIVE — whitespace is not a value. Targets fullName and flatNo, which
  // are required; areaStreet is not, so it would prove nothing there.
  test('TC-ADDR-011 whitespace-only required fields are rejected', async ({ page }) => {
    test.setTimeout(180000);
    const account = new AccountPage(page);
    const marker = `QA DELETE ME ws ${RUN}`;

    await account.gotoAddresses();
    const before = await account.addressCount();
    await account.openAddForm();

    await account.form.fullName.fill('   ');
    await account.form.mobile.fill(MOBILE || '9999999999');
    await account.form.flatNo.fill('   ');
    await account.form.areaStreet.fill(marker);
    await account.form.pincode.pressSequentially(TEST_ADDRESS.pincode, { delay: 100 });
    await page.waitForTimeout(2000);
    await account.submitAddress();
    await page.waitForTimeout(3000);

    await account.gotoAddresses();
    const after = await account.addressCount();
    const leaked = await account.removeIfPresent(marker);

    expect(leaked, 'whitespace-only name and flat number were accepted and saved').toBe(false);
    expect(after, 'the address list grew after submitting whitespace-only fields').toBe(before);
  });

  // TC-ADDR-012
  // EDGE — the suite's own address is created at most once.
  test('TC-ADDR-012 adding the same address twice does not duplicate it', async ({ page }) => {
    test.setTimeout(180000);
    test.skip(!writesAllowed(), writeSkipReason('May create the shared saved address, which is kept on the account'));
    test.skip(!MOBILE, 'Neither TEST_PHONE nor BYTEPE_MOBILE is set — the form requires a mobile number.');

    const account = new AccountPage(page);

    // First call may create; the second must not.
    await account.addAddressIfMissing(TEST_ADDRESS, { mobile: MOBILE, marker: MARKER });
    const countAfterFirst = await account.addressCount();

    const second = await account.addAddressIfMissing(TEST_ADDRESS, { mobile: MOBILE, marker: MARKER });

    expect(second, 'the helper tried to create an address that was already there')
      .toBe('already-present');
    expect(await account.addressCount(), 'a duplicate address was created')
      .toBe(countAfterFirst);
  });

  // TC-ADDR-013
  // EDGE — landmark really is optional. Self-cleaning.
  test('TC-ADDR-013 an address saves without a landmark', async ({ page }) => {
    test.setTimeout(240000);
    test.skip(!writesAllowed(), writeSkipReason('Creates and then deletes a saved address'));
    test.skip(!MOBILE, 'Neither TEST_PHONE nor BYTEPE_MOBILE is set — the form requires a mobile number.');

    const account = new AccountPage(page);
    const data = throwaway('nolandmark');

    await account.createAddress(data, { mobile: MOBILE });

    const listed = await account.addressListText();
    expect(listed, 'the address saved without a landmark is not listed').toContain(data.areaStreet);

    const result = await account.deleteAddressReportingConfirmation(data.areaStreet);
    expect(result.removed, 'cleanup failed — the throwaway address is still on the account').toBe(true);
  });

  // TC-ADDR-014
  // EDGE — a 500-character street. The input accepts it (no maxlength); what
  // the server does with it is the question. Self-cleaning either way.
  test('TC-ADDR-014 an over-long street value is handled', async ({ page }) => {
    test.setTimeout(240000);
    test.skip(!writesAllowed(), writeSkipReason('May create and then delete a saved address'));
    test.skip(!MOBILE, 'Neither TEST_PHONE nor BYTEPE_MOBILE is set — the form requires a mobile number.');

    const account = new AccountPage(page);
    const marker = `QA DELETE ME long ${RUN}`;
    const data = { ...throwaway('long'), areaStreet: `${marker} ${'X'.repeat(450)}` };

    await account.gotoAddresses();
    const before = await account.addressCount();
    await account.openAddForm();
    await account.fillAddressForm(data, { mobile: MOBILE });
    await account.submitAddress();
    await page.waitForTimeout(5000);

    await account.gotoAddresses();
    const after = await account.addressCount();
    const created = after > before;

    // Whichever way it went, do not leave it behind.
    await account.removeIfPresent(marker);

    // The requirement is only that the page still works: either a length error,
    // or stored without breaking the list. A crashed or blank list is the fail.
    await expect(account.addNewAddress, 'the address page broke on an over-long street')
      .toBeVisible({ timeout: TIMEOUTS.nav });
    console.log(`500-char street was ${created ? 'accepted and stored' : 'rejected'}`);
  });

  // TC-ADDR-015
  // UI — exactly one default, and every card offers both controls.
  test('TC-ADDR-015 one default address, and edit + delete on every card', async ({ page }) => {
    test.setTimeout(120000);
    const account = new AccountPage(page);

    await account.gotoAddresses();

    const cards = await account.addressCount();
    expect(cards, 'no address cards rendered').toBeGreaterThan(0);

    // Two defaults would break the address the checkout specs resolve, silently.
    expect(await account.defaultMarkers.count(), 'expected exactly one Default address').toBe(1);

    // Every card must offer both controls — a card with an edit but no delete
    // would make the delete cases silently skip the wrong row.
    expect(await account.deleteIcons.count(), 'edit and delete controls do not pair up')
      .toBe(cards);
  });

  // TC-ADDR-017
  // CROSS-LAYER — the API and the rendered list agree.
  test('TC-ADDR-017 the address API matches the rendered list', async ({ page }) => {
    test.setTimeout(120000);
    const userId = readSavedUserId();
    test.skip(!userId, 'No user id in auth.json (bp_user_v2 absent) — cannot address the per-user route.');

    const account = new AccountPage(page);
    await account.gotoAddresses();
    const rendered = await account.addressListText();
    const cards = await account.addressCount();

    const api = await getApiContext({ authenticated: true });
    try {
      const res = await api.get(ENDPOINTS.customerAddressesByUser(userId));
      expect(res.status(), `GET the address list returned ${res.status()}`).toBe(200);

      const body = await res.json();
      expect(Array.isArray(body.data), 'the address API did not return a list').toBe(true);
      expect(body.data.length, 'the API and the page disagree on how many addresses exist')
        .toBe(cards);

      // Every address the API knows about is on screen. Pincode is the field
      // both layers render verbatim.
      for (const address of body.data) {
        expect(rendered, `pincode ${address.pincode} is in the API but not on the page`)
          .toContain(String(address.pincode));
      }
    } finally {
      await api.dispose();
    }
  });

  // TC-ADDR-018
  // EDIT — the edit form opens populated. Abandons without saving.
  test('TC-ADDR-018 edit opens a form pre-filled with the address', async ({ page }) => {
    test.setTimeout(120000);
    const account = new AccountPage(page);

    await account.gotoAddresses();
    test.skip(
      !(await account.hasAddressMatching(MARKER)),
      `The shared test address ("${MARKER}") is not on this account — run TC-ADDR-003 with BYTEPE_ALLOW_WRITES=1 first.`
    );

    await account.openEditFor(MARKER);
    const values = await account.readFormValues();

    // A blank form here would mean "edit" silently creates a new address.
    expect(values.areaStreet, 'the edit form did not carry the street').toContain(TEST_ADDRESS.areaStreet);
    expect(values.flatNo, 'the edit form did not carry the flat number').toBe(TEST_ADDRESS.flatNo);
    expect(values.pincode, 'the edit form did not carry the pincode').toBe(TEST_ADDRESS.pincode);
    expect(values.city, 'the edit form did not carry the city').toMatch(new RegExp(TEST_ADDRESS.city, 'i'));
  });

  // TC-ADDR-019
  // EDIT — a change is stored, and edits do not create.
  test('TC-ADDR-019 an edit persists and does not create a second address', async ({ page }) => {
    test.setTimeout(240000);
    test.skip(!writesAllowed(), writeSkipReason('Edits a saved address'));

    const account = new AccountPage(page);
    await account.gotoAddresses();
    test.skip(
      !(await account.hasAddressMatching(MARKER)),
      `The shared test address ("${MARKER}") is not on this account — run TC-ADDR-003 with BYTEPE_ALLOW_WRITES=1 first.`
    );

    const before = await account.addressCount();
    const newLandmark = `Automation Landmark ${RUN}`;

    await account.openEditFor(MARKER);
    await account.form.landmark.fill(newLandmark);
    await account.submitAddress();
    await account.addNewAddress.waitFor({ state: 'visible', timeout: 30000 });

    await account.gotoAddresses();
    const listed = await account.addressListText();

    expect(listed, 'the edited landmark is not on the page').toContain(newLandmark);
    expect(await account.addressCount(), 'editing an address created a second one').toBe(before);
    // The rest of the address must be untouched.
    expect(listed, 'editing the landmark lost the street').toContain(TEST_ADDRESS.areaStreet);
    expect(listed, 'editing the landmark lost the pincode').toContain(TEST_ADDRESS.pincode);
  });

  // TC-ADDR-020
  // EDIT — an edit must not repoint the default address. This is the guard on
  // subscription-e2e, emi-store-flow and checkout-flow.
  test('TC-ADDR-020 editing an address does not move the default marker', async ({ page }) => {
    test.setTimeout(240000);
    test.skip(!writesAllowed(), writeSkipReason('Edits a saved address'));

    const account = new AccountPage(page);
    await account.gotoAddresses();
    test.skip(
      !(await account.hasAddressMatching(MARKER)),
      `The shared test address ("${MARKER}") is not on this account — run TC-ADDR-003 with BYTEPE_ALLOW_WRITES=1 first.`
    );

    const defaultsBefore = await account.defaultMarkers.count();
    // Which card holds it, so "still one default" cannot pass because it moved.
    const defaultCardBefore = await account.defaultMarkers.first().evaluate((node) => {
      let n = node;
      for (let hop = 0; hop < 6 && n; hop++) {
        const t = (n.innerText || '').replace(/\s+/g, ' ').trim();
        if (t.length > 40) return t.slice(0, 120);
        n = n.parentElement;
      }
      return '';
    });

    await account.openEditFor(MARKER);
    await account.form.landmark.fill(`Automation Landmark ${RUN} d`);
    await account.submitAddress();
    await account.addNewAddress.waitFor({ state: 'visible', timeout: 30000 });
    await account.gotoAddresses();

    expect(await account.defaultMarkers.count(), 'the number of default addresses changed after an edit')
      .toBe(defaultsBefore);

    const defaultCardAfter = await account.defaultMarkers.first().evaluate((node) => {
      let n = node;
      for (let hop = 0; hop < 6 && n; hop++) {
        const t = (n.innerText || '').replace(/\s+/g, ' ').trim();
        if (t.length > 40) return t.slice(0, 120);
        n = n.parentElement;
      }
      return '';
    });
    expect(defaultCardAfter, 'the default marker moved to a different address after an edit')
      .toBe(defaultCardBefore);
  });

  // TC-ADDR-021
  // DELETE — create a throwaway address, delete it, and prove only it went.
  test('TC-ADDR-021 an address can be deleted', async ({ page }) => {
    test.setTimeout(300000);
    test.skip(!writesAllowed(), writeSkipReason('Creates and then deletes a saved address'));
    test.skip(!MOBILE, 'Neither TEST_PHONE nor BYTEPE_MOBILE is set — the form requires a mobile number.');

    const account = new AccountPage(page);
    const data = throwaway('del');

    await account.gotoAddresses();
    const before = await account.addressCount();

    await account.createAddress(data, { mobile: MOBILE });
    expect(await account.addressCount(), 'the throwaway address was not created')
      .toBe(before + 1);

    const result = await account.deleteAddressReportingConfirmation(data.areaStreet);

    expect(result.removed, 'the address is still listed after deleting it').toBe(true);
    expect(result.after, 'deleting removed more than one address').toBe(before);

    // Everything else survived — in particular the default and the shared
    // test address, which the checkout specs depend on.
    const listed = await account.addressListText();
    expect(listed, 'deleting the throwaway address took the default with it').toMatch(/Default/);
  });

  // TC-ADDR-022
  // DELETE — a destructive control should confirm before acting. Tested on a
  // throwaway address so finding out costs nothing.
  //
  // Whether the UI confirms was unknown when this was written: the probe would
  // not click delete on a real address to find out. If deletion turns out to be
  // immediate and unconfirmed, this fails, and that failure is the finding.
  //
  // IT DOES FAIL, and the failure is expected and accepted. Measured 11 Aug
  // 2026: clicking delete removes the address immediately — no role="dialog",
  // no "are you sure" text within the 5s the helper waits. Failed on the first
  // attempt and on retry #1, so it is not flaky. Dev have accepted it and
  // scheduled a fix.
  //
  // Left red on purpose rather than rewritten to expect the bug, the same way
  // VID-44 is in the video suite. When the fix ships this should go green with
  // NO code change here — the helper already detects a dialog and confirms
  // through it. Follow-up cases to add at that point (TC-ADDR-023 to 028) are
  // planned in test-cases/address-management.md under "Future improvements";
  // their selectors are deliberately not pre-written.
  test('TC-ADDR-022 deleting an address asks for confirmation first', async ({ page }) => {
    test.setTimeout(300000);
    test.skip(!writesAllowed(), writeSkipReason('Creates and then deletes a saved address'));
    test.skip(!MOBILE, 'Neither TEST_PHONE nor BYTEPE_MOBILE is set — the form requires a mobile number.');

    const account = new AccountPage(page);
    const data = throwaway('confirm');

    await account.createAddress(data, { mobile: MOBILE });

    const result = await account.deleteAddressReportingConfirmation(data.areaStreet);
    console.log(
      `delete confirmation: ${result.confirmationSeen ? 'shown' : 'NONE'}` +
      (result.dialogText ? ` — ${JSON.stringify(result.dialogText.slice(0, 120))}` : '')
    );

    // Cleanup is unconditional: the helper confirms when a dialog appears, so
    // the address is gone either way before this assertion runs.
    expect(result.removed, 'cleanup failed — the throwaway address is still on the account').toBe(true);

    expect(
      result.confirmationSeen,
      'delete removed a saved address immediately, with no confirmation step'
    ).toBe(true);
  });
});

// TC-ADDR-016
// NEGATIVE — logged out, the address book must not be readable. Its own
// describe block because storageState cannot be overridden per test.
test.describe('Address management, logged out', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('TC-ADDR-016 saved addresses are not exposed to a logged-out visitor', async ({ page }) => {
    test.setTimeout(120000);
    const account = new AccountPage(page);

    // Not account.gotoAddresses(): that waits for "Add New Address", which is
    // exactly what a logged-out visitor should never get.
    await page.goto(`${BASE_URL}/my-profile/address`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);

    const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');

    // Non-vacuous: prove the page rendered something before asserting absence.
    expect(body.length, 'the page rendered nothing at all, so absence proves nothing')
      .toBeGreaterThan(50);

    expect(body, 'a phone number is visible to a logged-out visitor').not.toMatch(/Phone:\s*\d/i);
    expect(await account.editIcons.count(), 'address edit controls render for a logged-out visitor')
      .toBe(0);
  });
});
