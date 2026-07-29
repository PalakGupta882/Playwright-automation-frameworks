const { BasePage } = require('./basePage');

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

  async login(mobileNumber) {
    await this.goto();                                                  // ensure the homepage is loaded
    await this.loginLink.waitFor({ state: 'visible', timeout: 20000 }); // wait for the Login button to render
    await this.loginLink.click();
    await this.page.waitForTimeout(1000);
    const mobileInput = this.page.getByRole('textbox', { name: 'Mobile Number*' });
    await mobileInput.fill(mobileNumber);
    await this.page.getByRole('button', { name: 'Continue' }).click();
    console.log('OTP sent. Enter it manually in the browser, then click Resume.');
    await this.page.pause();
    console.log('Resumed after login. Current URL:', this.page.url());
  }
}

module.exports = { HomePage };