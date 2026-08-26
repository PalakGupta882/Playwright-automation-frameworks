const { BasePage } = require('./basePage');
const { BASE_URL, TIMEOUTS, URLS } = require('../data/constants');

class HomePage extends BasePage {
  constructor(page) {
    super(page);
    // .last(), not .first(). The homepage renders its header TWICE, and that is
    // CONFIRMED EXPECTED (20 Aug 2026) -- it is not a defect to be fixed, so
    // this is the permanent locator, not a workaround waiting on a bug.
    //
    // Re-measured 20 Aug 2026 on / and /home/subscription:
    //
    //   <header> elements: 2
    //     header[0] 1280x77 @0,0 pos=fixed z=1100 vis=visible
    //     header[1] 1280x77 @0,0 pos=fixed z=1100 vis=visible
    //     a[href="/home/subscription"]: 2, both 86x18 @805,29
    //
    // Two identical, both visible, stacked exactly. Not a responsive pair --
    // /all-products renders one, and a different one (1280x85). At equal
    // z-index the later element paints on top, so .last() is the copy a real
    // mouse click reaches and .first() is permanently covered:
    //
    //   first() copy: blocked: locator.click: Timeout 6000ms exceeded
    //   last()  copy: clicked -> https://www.bytepe.com/home/subscription
    //
    // Do NOT "simplify" this back to .first(): that is what took down three
    // smoke tests on 19 Aug. A real shopper always hits the top copy, which is
    // why the duplication is invisible in the product and fatal to DOM-order
    // selection.
    const visibleLink = (name, opts = {}) =>
      page.getByRole('link', { name, ...opts }).filter({ visible: true }).last();

    // The same links unresolved, so clickHeaderLink() can walk both copies.
    // .last() is right most of the time but not every time: which of the two
    // identical headers paints on top is decided per render, and "Products"
    // failed twice in a row on 19 Aug while Subscription and About Us passed in
    // the same run.
    const headerLinks = (name, opts = {}) =>
      page.getByRole('link', { name, ...opts }).filter({ visible: true });

    this.homeLink = visibleLink('Home');
    this.subscriptionLink = visibleLink('Subscription');
    this.emiStoreLink = visibleLink('EMI Store');
    this.productsLink = visibleLink('Products');
    this.aboutUsLink = visibleLink('About Us');
    this.cartLink = visibleLink('Cart', { exact: true });

    this.headerCopies = {
      subscription: headerLinks('Subscription'),
      emiStore: headerLinks('EMI Store'),
      products: headerLinks('Products'),
      aboutUs: headerLinks('About Us'),
    };
    this.loginLink = page.getByText('Login').filter({ visible: true }).first();
    // The positive logged-in signal. auth-setup.spec.js established this is the
    // only reliable one: the header paints its logged-out state first and swaps
    // once the app resolves the session, so "Login is gone" is not equivalent.
    this.profileLink = page.getByRole('link', { name: 'My Profile' }).first();
    // The old lower-case category strip is gone — it is now the Sub Home Page
    // tab bar: role=tab, Title Case, eight CMS-driven tabs. The locators that
    // used to sit here (mobileCategory, laptopCategory, tabletsCategory,
    // smartwatchCategory) could not match any longer and nothing referenced
    // them. Use tests/pages/subHomeTabsPage.js instead.
    this.privacyPolicyLink = page.getByRole('link', { name: 'Privacy Policy' });
    this.termsOfUseLink = page.getByRole('link', { name: 'Terms of Use' });
    this.faqsLink = page.getByRole('link', { name: 'FAQs' });
    this.contactUsLink = page.getByRole('link', { name: 'Contact Us' });
  }

  async goto() {
    await this.page.goto('https://www.bytepe.com/', { waitUntil: 'domcontentloaded' });
  }

  // Clicks a header nav link and does not return until the URL has moved.
  //
  // The header is rendered twice, identically and in the same place (see the
  // note in the constructor). Only the copy painted on top receives the click,
  // and which one that is varies per render — so this tries the copies from
  // last to first and stops at the one that actually navigates. Without it a
  // delivered-but-swallowed click looks exactly like a broken link: the click
  // succeeds, the URL never changes, and the assertion times out 15s later
  // pointing at the wrong thing.
  //
  // The duplicate header is CONFIRMED EXPECTED (20 Aug 2026), so this is the
  // permanent way to activate a header link, not a workaround awaiting a fix.
  //
  // Two activation routes, in order, because a click alone is not reliable
  // here. Measured: the DOM-first copy is permanently covered and its click
  // times out, and on 19 and 20 Aug even the top copy swallowed the click for
  // "Products" and "Subscription" while keyboard activation on the same locator
  // navigated every time. Which of the two identical headers paints on top is
  // decided per render, so neither copy can be trusted to take a mouse click.
  async clickHeaderLink(key, urlPattern) {
    const links = this.headerCopies[key];

    // count() does NOT auto-wait -- it answers immediately with whatever is in
    // the DOM at that instant. The header hydrates after first paint, so calling
    // count() straight away can legitimately return 0 and report "no visible
    // header link" for a link that is simply not painted yet. Measured 20 Aug
    // 2026: About Us failed exactly that way, while a probe moments later found
    // two visible copies and GET /about-us returning 200.
    //
    // Waiting for the first copy is what makes the count meaningful. A genuine
    // "the link is gone" still fails here, with the timeout naming the link.
    await links
      .first()
      .waitFor({ state: 'visible', timeout: TIMEOUTS.nav })
      .catch(() => {});

    const copies = await links.count();
    if (copies === 0) throw new Error(`no visible header link for "${key}"`);

    // PER-ATTEMPT BUDGET, deliberately short.
    //
    // This loop can make up to 2 copies x 2 activation routes = 4 attempts. At
    // the ambient timeouts (actionTimeout 30s, TIMEOUTS.nav 15s) a single copy
    // could consume 75s of a 60s test budget, so the test would time out MID-LOOP
    // and report "both routes failed on every copy" when most attempts had never
    // run. Measured: that is exactly what happened to all four header tests once
    // the keyboard fallback was added.
    //
    // 8s each bounds the worst case to ~48s, inside the 60s test timeout, so the
    // loop always finishes and its error message is true when it is raised.
    // Nothing legitimate needs longer: a header link that works navigates in
    // well under a second.
    const ATTEMPT_MS = 8000;

    for (let i = copies - 1; i >= 0; i--) {
      await this.page.keyboard.press('Escape').catch(() => {});
      const clicked = await links
        .nth(i)
        .click({ timeout: ATTEMPT_MS })
        .then(() => true)
        .catch(() => false);
      if (clicked) {
        const moved = await this.page
          .waitForURL(urlPattern, { timeout: ATTEMPT_MS })
          .then(() => true)
          .catch(() => false);
        if (moved) return;
      }

      // Keyboard activation. It reaches the anchor directly rather than through
      // hit-testing, which is the step the stacked copies interfere with.
      const pressed = await links
        .nth(i)
        .press('Enter', { timeout: ATTEMPT_MS })
        .then(() => true)
        .catch(() => false);
      if (!pressed) continue;

      const movedByKey = await this.page
        .waitForURL(urlPattern, { timeout: ATTEMPT_MS })
        .then(() => true)
        .catch(() => false);
      if (movedByKey) return;
    }

    throw new Error(
      `the header "${key}" link did not navigate to ${urlPattern}. ` +
        `${copies} visible copies were tried, by click AND by Enter; the page is still at ` +
        `${this.page.url()}. The header renders twice by design; if BOTH activation routes ` +
        'fail on every copy, the link itself is broken rather than merely covered.'
    );
  }

  async goToSubscription() {
    await this.clickHeaderLink('subscription', new RegExp(URLS.subscription));
  }

  async goToEmiStore() {
    await this.clickHeaderLink('emiStore', new RegExp(URLS.emiStore));
  }

  async goToProducts() {
    await this.clickHeaderLink('products', new RegExp(URLS.products));
  }

  async goToAboutUs() {
    await this.clickHeaderLink('aboutUs', new RegExp(URLS.aboutUs));
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
  //
  // THE COOKIE IS THE SIGNAL, added 14 Aug 2026. This used to wait on the
  // "My Profile" header link alone, and that cost a real login: the OTP was
  // accepted, the site was visibly logged in, and this sat waiting for a link
  // that never matched until the window closed and Playwright discarded the
  // context — throwing away the session it had just been handed.
  //
  // The header is only ever a proxy. What every gated spec actually checks is an
  // unexpired `access_token` cookie for www.bytepe.com (utils/session.js), and
  // that is also the only thing storageState saves that matters. So wait on the
  // cookie directly and treat the header link as a second, equally sufficient
  // signal. A header redesign can no longer waste an OTP.
  async waitForLoggedIn({ timeout }) {
    const rejected = this.page.getByText(/invalid|incorrect|expired|wrong.*otp/i).first();
    const pending = () => new Promise(() => {});

    // Polled rather than awaited: there is no event for a cookie being set.
    const cookieArrives = async () => {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        const token = (await this.page.context().cookies(BASE_URL)).find(
          c => c.name === 'access_token'
        );
        // expires <= 0 is a session cookie, which carries no expiry to check.
        if (token && (token.expires <= 0 || token.expires > Date.now() / 1000)) {
          return { ok: true, via: 'access_token cookie' };
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      return pending();
    };

    const outcome = await Promise.race([
      cookieArrives(),
      this.profileLink
        .waitFor({ state: 'visible', timeout })
        .then(() => ({ ok: true, via: 'My Profile header link' }))
        .catch(pending),
      rejected
        .waitFor({ state: 'visible', timeout })
        .then(async () => ({ ok: false, text: (await rejected.innerText()).trim() }))
        .catch(pending),
      new Promise(resolve => setTimeout(() => resolve({ ok: false, timedOut: true }), timeout + 500)),
    ]);

    if (outcome.ok) {
      console.log(`Logged-in signal: ${outcome.via}`);
      return;
    }

    if (outcome.timedOut) {
      // Report what was actually on the page and in the jar. The previous
      // message named only the missing link, which sent the diagnosis toward
      // "the OTP was never submitted" when the real answer was visible in the
      // cookie jar all along.
      const names = (await this.page.context().cookies(BASE_URL).catch(() => []))
        .map(c => c.name)
        .join(', ');
      throw new Error(
        `Login did not complete within ${timeout / 1000}s — no access_token cookie, no ` +
        '"My Profile" link, and no error on screen.\n' +
        `  cookies for ${BASE_URL}: ${names || '(none)'}\n` +
        `  url: ${this.page.url()}\n` +
        'Either the OTP was never submitted or the site did not respond.'
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