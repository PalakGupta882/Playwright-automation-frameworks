// tests/utils/otpHelper.js

// Pauses the test so YOU can type the real OTP in the browser,
// then click "Resume" ▶ in the Playwright Inspector to continue.
async function waitForManualOtp(page, message = 'Type the OTP in the browser, then click Resume ▶') {
  console.log('\n⏸  ' + message + '\n');
  await page.pause();
}

// Detect whether an OTP screen is currently on the page
// (useful for your "unexpected OTP mid-flow" problem)
async function isOtpScreenVisible(page) {
  const otpField = page.getByPlaceholder(/otp/i).first();
  return await otpField.isVisible().catch(() => false);
}

module.exports = { waitForManualOtp, isOtpScreenVisible };