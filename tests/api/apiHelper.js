// tests/api/apiHelper.js
//
// Shared plumbing for the API suite. Not a spec — excluded from collection by an
// explicit testIgnore entry in playwright.config.js.
//
// The one thing to understand before reading further: **this API authenticates
// with a cookie, not a header.** The storefront's client sets no Authorization
// header anywhere; requests carry the `access_token` cookie for www.bytepe.com.
// So an authenticated request context is built by handing Playwright the saved
// storageState, not by injecting a Bearer token. A 401 here is very nearly
// always a stale auth.json, and adding an Authorization header will not fix it.

const { request } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { BASE_API_URL, ENDPOINTS } = require('../data/apiEndpoints');

const AUTH_PATH = path.join(__dirname, '..', '..', 'auth.json');
const SITE_DOMAIN = 'www.bytepe.com';

// A browser UA on purpose. Some edges in front of this origin treat an obvious
// bot UA differently, and a test that only fails because it looked like a
// scraper is a test that reports the wrong thing.
const DEFAULT_HEADERS = {
  accept: 'application/json',
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
};

// Reads the saved session without asserting anything about it. Returns null when
// there is no usable token, so callers can skip rather than fail — CI writes an
// empty auth.json on purpose and must not start going red.
function readSavedAccessToken() {
  let state;
  try {
    state = JSON.parse(fs.readFileSync(AUTH_PATH, 'utf8'));
  } catch {
    return null; // no saved session on disk
  }

  const cookie = (state.cookies || []).find(
    c => c.name === 'access_token' && c.domain === SITE_DOMAIN
  );
  if (!cookie) return null;

  // expires <= 0 means a session cookie, which carries no expiry to check.
  if (cookie.expires > 0 && cookie.expires < Date.now() / 1000) return null;

  return cookie.value;
}

// True when auth.json holds a token that has not visibly expired. The API specs
// gate their logged-in cases on this so an unauthenticated checkout of the repo
// produces skips with a reason, not a wall of 401s.
function hasSavedSession() {
  return readSavedAccessToken() !== null;
}

// Builds a request context bound to the API base.
//
// `authenticated: true` attaches auth.json as a storageState, which is what
// actually carries the access_token cookie. It deliberately does NOT throw when
// the session is missing — callers decide whether that is a skip or a failure,
// and one of the negative tests genuinely wants an unauthenticated context.
async function getApiContext({ authenticated = false, extraHeaders = {} } = {}) {
  const useSession = authenticated && hasSavedSession();

  return request.newContext({
    // Trailing slash is load-bearing. Playwright joins with the URL
    // constructor, and without it `new URL('cart', '.../api')` resolves to
    // `.../cart` — the /api segment is treated as a filename and replaced.
    // Paired with the leading-slash stripping in apiEndpoints.js.
    baseURL: `${BASE_API_URL.replace(/\/+$/, '')}/`,
    extraHTTPHeaders: { ...DEFAULT_HEADERS, ...extraHeaders },
    ...(useSession ? { storageState: AUTH_PATH } : {}),
    // Statuses are the thing under test. Throwing on a 4xx would turn every
    // negative case into an exception before it could be asserted.
    ignoreHTTPSErrors: false,
  });
}

// Returns the access token for the test account.
//
// Two routes, because login here is OTP-through-the-browser and there is no
// unattended credential:
//
//   1. DEFAULT — lift the token out of auth.json, which `npm run auth` wrote.
//      No network, no SMS, no side effects. This is the honest answer to "how
//      does a test get a token" in this repo.
//
//   2. BYTEPE_API_OTP_LOGIN=1 — drive the real two-leg OTP login over HTTP.
//      **This sends a real SMS to a real phone.** It needs a test account whose
//      OTP is fixed (TEST_OTP), because nothing here can read an inbox. Gated
//      behind its own env var so it can never happen by accident.
//
// The env vars follow the names in the brief but fall back to the ones this repo
// already uses, so the same secret does not have to be set twice.
async function loginAndGetToken({ forceOtpLogin = false } = {}) {
  const wantOtpLogin = forceOtpLogin || process.env.BYTEPE_API_OTP_LOGIN === '1';

  if (!wantOtpLogin) {
    const token = readSavedAccessToken();
    if (!token) {
      throw new Error(
        'No usable access_token in auth.json, so there is no token to return.\n' +
        'Refresh it with:  npm run auth   (headed; needs BYTEPE_MOBILE and a human to type the OTP)\n' +
        'Or set BYTEPE_API_OTP_LOGIN=1 with TEST_PHONE/TEST_OTP to log in over HTTP instead ' +
        '(this sends a real SMS).'
      );
    }
    return { token, source: 'auth.json' };
  }

  const phone = process.env.TEST_PHONE || process.env.BYTEPE_MOBILE;
  const otp = process.env.TEST_OTP || process.env.BYTEPE_OTP;
  if (!phone || !otp) {
    throw new Error(
      'BYTEPE_API_OTP_LOGIN=1 needs both a phone and a fixed OTP.\n' +
      'Set TEST_PHONE (or BYTEPE_MOBILE) and TEST_OTP (or BYTEPE_OTP).'
    );
  }

  const api = await getApiContext();
  try {
    // Leg 1. Resolves the phone to a user_id AND DISPATCHES A REAL SMS.
    // Body shape taken verbatim from the client bundle.
    const loginRes = await api.post(ENDPOINTS.login, {
      data: { emailOrPhone: phone, loginType: 'OTP', role_type: 'customer' },
    });
    const loginBody = await safeJson(loginRes);
    if (!loginRes.ok()) {
      throw new Error(
        `POST ${ENDPOINTS.login} returned ${loginRes.status()}: ${JSON.stringify(loginBody)}`
      );
    }

    const userId = pick(loginBody, ['data.user_id', 'data.id', 'user_id', 'data.user.id']);
    if (!userId) {
      throw new Error(
        `Could not find a user_id in the ${ENDPOINTS.login} response. ` +
        `Body was: ${JSON.stringify(loginBody).slice(0, 400)}`
      );
    }

    // Leg 2. Exchanges the code for a session.
    const verifyRes = await api.post(ENDPOINTS.verifyOtp, {
      data: { user_id: userId, otp },
    });
    const verifyBody = await safeJson(verifyRes);
    if (!verifyRes.ok()) {
      throw new Error(
        `POST ${ENDPOINTS.verifyOtp} returned ${verifyRes.status()}: ${JSON.stringify(verifyBody)}`
      );
    }

    // The token field name is the one thing here NOT confirmed against a real
    // response — verifying an OTP could not be probed without consuming one. If
    // this throws, the message carries the actual keys so it is a one-line fix
    // rather than a guessing game.
    const token = pick(verifyBody, [
      'data.access_token',
      'data.accessToken',
      'data.token',
      'access_token',
      'token',
      'data.tokens.access_token',
    ]);
    if (!token) {
      throw new Error(
        'Verified the OTP but found no access token in the response.\n' +
        `Top-level keys: ${Object.keys(verifyBody || {})}\n` +
        `data keys: ${Object.keys((verifyBody || {}).data || {})}\n` +
        'Add the correct path to the candidate list in loginAndGetToken().'
      );
    }
    return { token, source: 'otp-login' };
  } finally {
    await api.dispose();
  }
}

// Walks dotted paths and returns the first that resolves to something truthy.
// Used only where the exact response field could not be confirmed by probing.
function pick(obj, paths) {
  for (const p of paths) {
    const value = p.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), obj);
    if (value) return value;
  }
  return undefined;
}

// Response bodies are asserted on, so a non-JSON body (an HTML error page from
// an edge, say) has to surface as readable text rather than a parse exception
// that hides what the server actually said.
async function safeJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { __nonJsonBody: text.slice(0, 500) };
  }
}

// Writes are opt-in twice over: this flag, and a per-spec skip that says so.
//
// Re-exported from tests/utils/writes.js rather than redefined, so the API suite
// and the order-minting UI specs cannot drift onto different flags.
const { writesAllowed } = require('../utils/writes');

module.exports = {
  getApiContext,
  loginAndGetToken,
  hasSavedSession,
  readSavedAccessToken,
  writesAllowed,
  safeJson,
  BASE_API_URL,
};
