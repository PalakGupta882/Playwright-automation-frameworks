const { test } = require('@playwright/test');
const { HomePage } = require('./pages/homepage');

const SITE = 'https://www.bytepe.com';

// The app renders its logged-in header off refresh_token, which outlives
// access_token by days. So "the page says I am logged in" does NOT mean an
// access_token cookie exists yet — and access_token is the one every gated spec
// checks via assertFreshSession(). Saving in that window writes an auth.json
// that looks fine and fails every login-gated spec with "no access_token
// cookie". Poll for it instead of assuming.
// Presence is not enough: an expired access_token is still a cookie, so
// checking only the name lets this report success while saving a session that
// assertFreshSession() will reject. Require it to be unexpired too — the same
// test session.js applies.
async function waitForAccessToken(context, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const token = (await context.cookies(SITE)).find(c => c.name === 'access_token');
    // expires <= 0 means a session cookie, which carries no expiry to check.
    if (token && (token.expires <= 0 || token.expires > Date.now() / 1000)) return true;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  return false;
}

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

  // Reloading prods the app into exchanging refresh_token for a new
  // access_token. If it still has not appeared, the fast path is not usable and
  // we fall through to a real login rather than saving a session the guard
  // will reject.
  let useSavedSession = isAlreadyLoggedIn;
  if (useSavedSession) {
    if (!(await waitForAccessToken(page.context(), 5000))) {
      await page.reload({ waitUntil: 'domcontentloaded' });
      useSavedSession = await waitForAccessToken(page.context(), 20000);
      if (!useSavedSession) {
        console.log('Logged-in UI but no access_token cookie — falling back to a full login.');
        // Sign out first. The app keeps rendering a logged-in header off
        // refresh_token, and in that state clicking Login navigates to
        // /my-profile rather than opening the dialog — the full login then dies
        // waiting 30s for a mobile-number field that never renders.
        const signedOut = await home.logout();
        console.log(signedOut ? 'Signed out so the login form is reachable.' : 'No Logout control found.');
      }
    }
  }

  if (useSavedSession) {
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

  // Last line of defence: never write an auth.json that assertFreshSession()
  // would reject. Failing here is far cheaper than every gated spec failing
  // later with what looks like a broken selector.
  if (!(await waitForAccessToken(page.context(), 20000))) {
    throw new Error(
      'Refusing to save: the browser has no access_token cookie for www.bytepe.com,\n' +
      'so every login-gated spec would fail with "no access_token cookie".\n' +
      'Re-run npm run auth and complete the OTP login.'
    );
  }

  await page.context().storageState({ path: 'auth.json' });
  console.log('Login session saved to auth.json');
});