const { test, expect } = require('../fixtures/pageFixtures');

test('EMI Store: select product through to checkout (stops before payment)', async ({ page, emiStorePage }) => {
  test.setTimeout(180000);

  await emiStorePage.goto();
  console.log('On EMI Store page:', page.url());

  await emiStorePage.selectFirstAvailableProduct();
  console.log('Landed on product page:', page.url());

  await emiStorePage.clickBuyNow();
  console.log('Clicked Buy Now.');

  const isMobilePromptVisible = await page.getByRole('textbox', { name: 'Mobile Number*' })
    .isVisible({ timeout: 5000 })
    .catch(() => false);

  if (isMobilePromptVisible) {
    await emiStorePage.enterMobileNumberAndSendOtp('YOUR_NUMBER_HERE');
    await emiStorePage.waitForManualOtpEntry();
  } else {
    console.log('Already logged in — skipping OTP.');
  }

  console.log('Reached checkout — stopping before card details. URL:', page.url());
});