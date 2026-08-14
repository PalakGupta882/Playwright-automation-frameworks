const { test } = require('@playwright/test');
const { HomePage } = require('./pages/homepage');
const { TIMEOUTS } = require('./data/constants');

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
// `minRemainingSec` guards against saving a token that is valid at this instant
// and useless by the time a spec runs. The access_token lasts FIFTEEN MINUTES.
// Measured 14 Aug 2026: a refresh run that started ~5 seconds before expiry
// found the old token still nominally valid, reported "session still valid,
// saving as-is", and wrote an auth.json that assertFreshSession() rejected on
// the very next command. Requiring a real window forces the refresh instead.
async function waitForAccessToken(context, timeoutMs = 20000, minRemainingSec = 0) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const token = (await context.cookies(SITE)).find(c => c.name === 'access_token');
    // expires <= 0 means a session cookie, which carries no expiry to check.
    if (token && (token.expires <= 0 || token.expires > Date.now() / 1000 + minRemainingSec)) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  return false;
}

// Enough of the 15-minute lifetime left to actually run something. A spec that
// starts with four minutes on the clock and takes five is a confusing failure.
const USABLE_WINDOW_SEC = 300;

test('one-time login and save session', async ({ page }) => {
  // Derived, not a literal. This used to be a flat 180s while the OTP wait was a
  // flat 120s, so widening the human's window past ~150s silently did nothing —
  // the test timeout killed the run first. The 60s on top covers the navigation,
  // the Login click and the post-login access_token poll.
  test.setTimeout(TIMEOUTS.otp + 60000);

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

  // The access_token lasts 15 minutes, but the refresh_token lasts 7 days, and
  // the app will exchange one for the other by itself:
  //
  //   POST 200 https://www.bytepe.com/api/auth/refresh-tokens
  //
  // Measured: that call fires when an AUTHENTICATED route is loaded. Loading
  // only the homepage — which is what this used to do — often did not trigger
  // it, so the run concluded the session was unusable and demanded an OTP that
  // was never actually needed. Visiting /my-profile gives the app the chance,
  // and turns a week's worth of logins into one.
  async function letTheAppRefresh() {
    // Short-circuit only on a token with real life left in it, not merely an
    // unexpired one — see USABLE_WINDOW_SEC above.
    if (await waitForAccessToken(page.context(), 3000, USABLE_WINDOW_SEC)) return true;
    await page.goto(`${SITE}/my-profile`, { waitUntil: 'domcontentloaded' });
    return waitForAccessToken(page.context(), 25000, USABLE_WINDOW_SEC);
  }

  let useSavedSession = await letTheAppRefresh();

  if (!useSavedSession) {
    // No usable token even after giving the app a chance to refresh. Clear the
    // session outright before logging in.
    //
    // Cookies, not the Logout button. While any stale session lingers, clicking
    // Login navigates to /my-profile instead of opening the dialog, and the
    // login then dies waiting for a mobile-number field that never renders. The
    // UI Logout control was the first fix for that and proved unreliable — it
    // times out when the shell is half-authenticated, which is exactly the
    // state we are in here. clearCookies always works and needs no control to
    // be present.
    console.log('No access_token after a refresh attempt — clearing the session and logging in.');
    await page.context().clearCookies();
    await home.goto();
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