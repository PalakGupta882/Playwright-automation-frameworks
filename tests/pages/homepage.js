const { BasePage } = require('./basePage');
const { TIMEOUTS } = require('../data/constants');

class HomePage extends BasePage {
  constructor(page) {
    super(page);
    this.homeLink = page.getByRole('link', { name: 'Home' }).first();
    this.subscriptionLink = page.getByRole('link', { name: 'Subscription' }).first();
    this.emiStoreLink = page.getByRole('link', { name: 'EMI Store' }).first();
    this.productsLink = page.getByRole('link', { name: 'Products' }).first();
    this.aboutUsLink = page.getByRole('link', { name: 'About Us' }).first();
    this.cartLink = page.getByRole('link', { name: 'Cart', exact: true }).first();
    this.loginLink = page.getByText('Login').first();
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
  async login(mobileNumber, otp) {
    await this.goto();                                                  // ensure the homepage is loaded
    await this.loginLink.waitFor({ state: 'visible', timeout: 20000 }); // wait for the Login button to render

    // A first click can land while an overlay is still closing, which resolves
    // the button but never delivers the click. Retry once before giving up.
    await this.loginLink.click({ timeout: 15000 }).catch(async () => {
      await this.page.keyboard.press('Escape').catch(() => {});
      await this.loginLink.click({ force: true, timeout: 15000 });
    });

    await this.page.waitForTimeout(1000);
    const mobileInput = this.page.getByRole('textbox', { name: 'Mobile Number*' });
    await mobileInput.fill(mobileNumber);
    await this.page.getByRole('button', { name: 'Continue' }).click();

    if (otp) {
      await this.enterOtp(otp);
    } else {
      // The header "Login" control disappearing is the signal that login took,
      // so a plain --headed run is enough — no Inspector pause needed.
      console.log(`OTP sent. Type it in the browser — waiting up to ${TIMEOUTS.otp / 1000}s.`);
    }

    await this.loginLink.waitFor({ state: 'hidden', timeout: TIMEOUTS.otp });
    console.log('Logged in. Current URL:', this.page.url());
  }

  // OTP screens are either one field or one box per digit. Focusing the first
  // field and typing covers both, since per-digit UIs auto-advance.
  async enterOtp(otp) {
    const candidates = [
      ['role=textbox[name=/otp/i]', this.page.getByRole('textbox', { name: /otp/i })],
      ['placeholder=/otp/i', this.page.getByPlaceholder(/otp/i)],
      ['one-time-code', this.page.locator('input[autocomplete="one-time-code"]')],
      ['input[type=tel]', this.page.locator('input[type="tel"]')],
    ];

    for (const [label, locator] of candidates) {
      const field = locator.first();
      // waitFor, not isVisible — isVisible() returns immediately and does not
      // wait, so it would miss an OTP field that renders a moment later.
      const visible = await field
        .waitFor({ state: 'visible', timeout: 8000 })
        .then(() => true)
        .catch(() => false);
      if (!visible) continue;

      console.log(`Entering OTP via ${label}`);
      await field.click();
      await this.page.keyboard.type(otp, { delay: 120 });

      const submit = this.page
        .getByRole('button', { name: /verify|submit|confirm|continue/i })
        .first();
      if (await submit.isVisible().catch(() => false)) {
        await submit.click().catch(() => {});
      }
      return;
    }

    console.log('No OTP field matched — type the code in the browser instead.');
  }
}

module.exports = { HomePage };