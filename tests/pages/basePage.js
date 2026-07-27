// tests/pages/basePage.js
class BasePage {
  constructor(page) {
    this.page = page;
  }

  async goto(path) {
    await this.page.goto(`https://www.bytepe.com${path}`);
  }

  async clickText(text) {
    await this.page.getByText(text, { exact: true }).first().click();
  }

  async waitAndClick(locator) {
    await locator.scrollIntoViewIfNeeded();
    await locator.click();
  }
}
module.exports = { BasePage };
