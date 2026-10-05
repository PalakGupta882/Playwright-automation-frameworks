// tests/pages/basePage.js
const { BASE_URL } = require('../data/env');

class BasePage {
  constructor(page) {
    this.page = page;
  }

  async goto(path) {
    await this.page.goto(`${BASE_URL}${path}`);
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
