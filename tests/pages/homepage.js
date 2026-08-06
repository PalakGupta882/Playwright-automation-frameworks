const { BasePage } = require('./basePage');
const { BASE_URL, TIMEOUTS } = require('../data/constants');

class HomePage extends BasePage {
  constructor(page) {
    super(page);
    // All filtered to visible. The header is rendered twice — desktop and
    // mobile — so .first() alone could resolve to the hidden copy, and clicking
    // that never completes. The `force: true` on every nav method below was
    // compensating for exactly this; force skips the actionability checks that
    // would otherwise have made the problem obvious years ago.
    const visibleLink = (name, opts = {}) =>
      page.getByRole('link', { name, ...opts }).filter({ visible: true }).first();

    this.homeLink = visibleLink('Home');
    this.subscriptionLink = visibleLink('Subscription');
    this.emiStoreLink = visibleLink('EMI Store');
    this.productsLink = visibleLink('Products');
    this.aboutUsLink = visibleLink('About Us');
    this.cartLink = visibleLink('Cart', { exact: true });
    this.loginLink = page.getByText('Login').filter({ visible: true }).first();
    // The positive logged-in signal. auth-setup.spec.js established this is the
    // only reliable one: the header paints its logged-out state first and swaps
    // once the app resolves the session, so "Login is gone" is not equivalent.
    this.profileLink = page.getByRole('link', { name: 'My Profile' }).first();
    this.mobileCategory = page.getByText('mobile', { exact: true }).first();
    this.laptopCategory = page.getByText('laptop', { exact: true }).first();
    this.tabletsCategory = page.getByText('tablets', { exact: true }).first();
    this.smartwatchCategory = page.getByText('smartwatch', { exact: true }).first();
    this.privacyPolicyLink = page.getByRole('link', { name: 'Privacy Policy' });
    this.termsOfUseLink = page.getByRole('link', { name: 'Terms of Use' });
    this.faqsLink = page.getByRole('link', { name: 'FAQs' });
    this.contactUsLink = page.getByRole('link', { name: 'Contact Us' });
  }

  async goto() {
    await this.page.goto('https://www.bytepe.com/', { waitUntil: 'domcontentloaded' });
  }

  async goToSubscription() {
    await this.page.keyboard.press('Escape').catch(() => {});
    await this.subscriptionLink.click({ force: true });
  }

  async goToEmiStore() {
    await this.page.keyboard.press('Escape').catch(() => {});
    await this.emiStoreLink.click({ force: true });
  }

  async goToProducts() {
    await this.page.keyboard.press('Escape').catch(() => {});
    await this.productsLink.click({ force: true });
  }

  async goToAboutUs() {
    await this.page.keyboard.press('Escape').catch(() => {});
    await this.aboutUsLink.click({ force: true });
  }

  async goToCart() {
    await this.page.goto('https://www.bytepe.com/cart');
  }

  async goToLogin() {
    await this.page.keyboard.press('Escape').catch(() => {});
    await this.loginLink.click({ force: true });
  }

  async selectCategory(categoryName) {
    await this.page.getByText(categoryName, { exact: true }).first().click();
  }

  async isLoaded() {
    return this.page.title();
  }

  // Pass an otp to log in unattended; omit it to type the code in the browser.
  //
  // Composed from the four steps below so the login probe script can drive the
  // first two and stop at the OTP screen. A standalone script cannot get that
  // far on its own: the Login button is routinely covered by a promo overlay,
  // and openLoginDialog() is where that is handled.
  async login(mobileNumber, otp) {
    await this.openLoginDialog();
    await this.submitMobile(mobileNumber);

    if (otp) {
      await this.enterOtp(otp);
    } else {
      console.log(`OTP sent. Type it in the browser — waiting up to ${TIMEOUTS.otp / 1000}s.`);
    }

    // An unattended run should not sit on the human budget: if the code was
    // supplied and did not work, that is a fault to report in seconds.
    await this.waitForLoggedIn({ timeout: otp ? TIMEOUTS.otpAuto : TIMEOUTS.otp });
    console.log('Logged in. Current URL:', this.page.url());
  }

  // Signs out, so the login form becomes reachable again.
  //
  // Needed because the app keeps rendering a logged-in header off refresh_token
  // after access_token has gone. In that state clicking Login navigates to
  // /my-profile instead of opening the dialog, and the whole login path dies
  // waiting for a mobile-number field that will never render.
  async logout() {
    await this.page.goto(`${BASE_URL}/my-profile`, { waitUntil: 'domcontentloaded' });

    const logout = this.page.getByText(/^logout$/i).filter({ visible: true }).first();
    const found = await logout
      .waitFor({ state: 'visible', timeout: TIMEOUTS.nav })
      .then(() => true)
      .catch(() => false);

    if (!found) return false;

    // Same Escape-then-force retry the nav methods use. Logout is a <p> inside
    // a clickable row and never settles as "visible, enabled and stable" while
    // one of this site's overlays is up, so a plain click times out on an
    // element that is plainly on screen.
    await logout.click({ timeout: TIMEOUTS.action }).catch(async () => {
      await this.page.keyboard.press('Escape').catch(() => {});
      await logout.click({ force: true, timeout: TIMEOUTS.action });
    });
    await this.page.waitForTimeout(2000);

    // Confirm from the homepage rather than wherever logout happened to land —
    // the post-logout page is not necessarily one that renders the header's
    // Login control.
    await this.goto();
    return this.loginLink
      .waitFor({ state: 'visible', timeout: TIMEOUTS.login })
      .then(() => true)
      .catch(() => false);
  }

  async openLoginDialog() {
    await this.goto();
    await this.loginLink.waitFor({ state: 'visible', timeout: TIMEOUTS.login });

    // A first click can land while an overlay is still closing, which resolves
    // the button but never delivers the click. Retry once before giving up.
    await this.loginLink.click({ timeout: TIMEOUTS.action }).catch(async () => {
      await this.page.keyboard.press('Escape').catch(() => {});
      await this.loginLink.click({ force: true, timeout: TIMEOUTS.action });
    });
    await this.page.waitForTimeout(1000);
  }

  async submitMobile(mobileNumber) {
    const mobileInput = this.page.getByRole('textbox', { name: 'Mobile Number*' });
    await mobileInput.fill(mobileNumber);

    // Explicit timeout: this used to be a bare click, which under the config's
    // former actionTimeout of 0 would wait out the whole test budget if the
    // button never enabled.
    await this.page
      .getByRole('button', { name: 'Continue' })
      .click({ timeout: TIMEOUTS.action });
  }

  // Positive signal. The old code waited for the header "Login" to become
  // hidden, which a re-render satisfies without anyone being logged in.
  //
  // Races the success signal against an on-screen rejection, so a wrong or
  // rotated OTP reports itself as exactly that instead of as a timeout that
  // looks identical to a broken selector.
  async waitForLoggedIn({ timeout }) {
    const rejected = this.page.getByText(/invalid|incorrect|expired|wrong.*otp/i).first();
    const pending = () => new Promise(() => {});

    const outcome = await Promise.race([
      this.profileLink
        .waitFor({ state: 'visible', timeout })
        .then(() => ({ ok: true }))
        .catch(pending),
      rejected
        .waitFor({ state: 'visible', timeout })
        .then(async () => ({ ok: false, text: (await rejected.innerText()).trim() }))
        .catch(pending),
      new Promise(resolve => setTimeout(() => resolve({ ok: false, timedOut: true }), timeout + 500)),
    ]);

    if (outcome.ok) return;

    if (outcome.timedOut) {
      throw new Error(
        `Login did not complete within ${timeout / 1000}s — no "My Profile" link and no ` +
        'error on screen.\nEither the OTP was never submitted or the site did not respond.'
      );
    }

    throw new Error(
      `The site rejected the login: ${JSON.stringify(outcome.text)}\n` +
      'If BYTEPE_OTP is set, the fixed OTP may have been rotated — confirm the current one.'
    );
  }

  // Measured on the live OTP screen (scripts/probe-login-screens.spec.js):
  //
  //   6 x <input autocomplete="one-time-code" inputmode="numeric" maxlength="6">
  //   candidate counts: one-time-code=6 | inputmode=numeric=6
  //                     role=textbox[name=/otp/i]=0 | placeholder=/otp/i=0
  //                     input[type=tel]=0 | input[maxlength=1]=0
  //
  // Two things that matter and were previously assumed wrong:
  //
  // 1. maxlength is 6 on EVERY box, not 1. So filling the first box with the
  //    whole code puts all six digits in box one. Each box gets one digit.
  // 2. The old order tried two locators that match nothing, burning 8s each
  //    before reaching the one that works — which is why an unattended run
  //    looked like it had no OTP field at all.
  //
  // Throws rather than logging and returning. The old version returned quietly,
  // so the real failure surfaced 120s later as a timeout on the header and read
  // like a session problem.
  async enterOtp(otp) {
    const candidates = [
      ['autocomplete=one-time-code', this.page.locator('input[autocomplete="one-time-code"]')],
      ['inputmode=numeric', this.page.locator('input[inputmode="numeric"][maxlength]')],
      ['role=textbox[name=/otp/i]', this.page.getByRole('textbox', { name: /otp/i })],
      ['placeholder=/otp/i', this.page.getByPlaceholder(/otp/i)],
    ];

    // Wait once for the screen itself, then resolve the field cheaply. Waiting
    // per-candidate is what made a miss cost 32s.
    await candidates[0][1]
      .first()
      .waitFor({ state: 'visible', timeout: TIMEOUTS.otpScreen })
      .catch(() => {});

    let field = null;
    let label = null;
    for (const [name, locator] of candidates) {
      const visible = await locator
        .first()
        .waitFor({ state: 'visible', timeout: 1000 })
        .then(() => true)
        .catch(() => false);
      if (visible) {
        field = locator;
        label = name;
        break;
      }
    }

    if (!field) {
      throw new Error(await this.describeOtpFailure(candidates));
    }

    const boxes = await field.count();
    console.log(`Entering OTP via ${label} (${boxes} field${boxes === 1 ? '' : 's'})`);

    if (boxes === otp.length) {
      // One box per digit. fill() each rather than typing into the first and
      // trusting the component to auto-advance.
      for (let i = 0; i < boxes; i++) {
        await field.nth(i).fill(otp[i]);
      }
    } else {
      await field.first().fill(otp);
    }

    // This screen submits itself the moment the last digit lands — measured:
    // after the sixth box is filled the inputs are removed from the DOM before
    // anything can click a button. So this is normally a no-op, kept only for
    // the case where the screen ever stops auto-submitting.
    //
    // Entry itself is faithful, also measured: filling each box, typing into
    // the first, and pressSequentially all place one digit per box in order.
    // If the site rejects the code, it is rejecting the code — not mis-reading
    // how it was entered.
    const submit = this.page
      .getByRole('button', { name: /^(verify|submit|confirm|continue)$/i })
      .first();
    if (await submit.isVisible().catch(() => false)) {
      await submit.click({ timeout: TIMEOUTS.action }).catch(() => {});
    }
  }

  // Builds the error enterOtp throws, using the same dump the probe prints, so
  // the message carries the answer instead of pointing at more work.
  async describeOtpFailure(candidates) {
    const { describeInputs, formatInputs, countCandidates, describeFrames } =
      require('../utils/domProbe');

    const [counts, frames, inputs] = await Promise.all([
      countCandidates(candidates),
      describeFrames(this.page),
      describeInputs(this.page),
    ]);

    return (
      `No OTP field matched after ${TIMEOUTS.otpScreen / 1000}s.\n` +
      `url: ${this.page.url()}\n` +
      `${frames}\n` +
      `candidate counts: ${counts}\n` +
      'inputs on screen (values never shown):\n' +
      `${formatInputs(inputs.filter(i => i.visible))}\n` +
      'Re-run the probe to see the full dialog:\n' +
      '  npx playwright test scripts/probe-login-screens.spec.js --project=chromium --headed'
    );
  }
}

module.exports = { HomePage };