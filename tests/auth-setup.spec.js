const { test } = require('@playwright/test');
const { HomePage } = require('./pages/homepage');

test('one-time login and save session', async ({ page }) => {
  test.setTimeout(180000);

  const home = new HomePage(page);
  await home.goto();

  const isAlreadyLoggedIn = await page.getByRole('link', { name: 'My Profile' })
    .isVisible({ timeout: 5000 })
    .catch(() => false);

  if (isAlreadyLoggedIn) {
    console.log('Already logged in — session still valid, saving as-is.');
  } else {
    // Kept out of the repo on purpose — this file is tracked and public
    const myMobileNumber = process.env.BYTEPE_MOBILE;
    if (!myMobileNumber) {
      throw new Error(
        'BYTEPE_MOBILE is not set, so there is no number to log in with.\n' +
        'Set it once:  setx BYTEPE_MOBILE "<your number>"   (then open a new terminal)'
      );
    }
    await home.login(myMobileNumber);
  }

  await page.context().storageState({ path: 'auth.json' });
  console.log('Login session saved to auth.json');
});