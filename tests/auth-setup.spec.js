const { test } = require('@playwright/test');
const { HomePage } = require('./pages/homepage');

test('one-time login and save session', async ({ page }) => {
  test.setTimeout(180000);

  const home = new HomePage(page);
  await home.goto();

  // isVisible() answers from the DOM as it stands at that instant and ignores
  // the timeout it is given — it does not wait. On this homepage the profile
  // link is count=0 immediately and count=1 after a waitFor, so the check below
  // always read "logged out" and ran the whole OTP login even when the saved
  // session was live. When that happened while the session HAD refreshed, the
  // Login click landed on /my-profile and the run sat waiting for a mobile
  // number field that was never going to render, until the 180s timeout.
  //
  // Racing the two states instead: whichever of "My Profile" (logged in) and
  // "Login" (logged out) renders first is the answer, and neither branch has to
  // guess how long hydration takes.
  // Racing "My Profile" against "Login" does not work either: the header paints
  // its logged-out state first and only swaps once the app has resolved the
  // saved session, so Login always wins the race and the answer is always
  // "logged out". Wait for the logged-in signal specifically, and treat only
  // its absence as logged out. Costs 15s on a genuinely logged-out run, which
  // is nothing in a script that otherwise waits on a human to read an SMS.
  const isAlreadyLoggedIn = await page
    .getByRole('link', { name: 'My Profile' })
    .first()
    .waitFor({ state: 'visible', timeout: 15000 })
    .then(() => true)
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

    // Test accounts have a fixed OTP. Set BYTEPE_OTP and this runs unattended;
    // leave it unset and the run waits for you to type the code in the browser.
    const otp = process.env.BYTEPE_OTP;
    console.log(otp ? 'Using BYTEPE_OTP — no manual entry needed.' : 'No BYTEPE_OTP set — manual OTP entry.');

    await home.login(myMobileNumber, otp);
  }

  await page.context().storageState({ path: 'auth.json' });
  console.log('Login session saved to auth.json');
});