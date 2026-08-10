// tests/api/auth-api.spec.js
//
// Authentication and authorization at the HTTP layer.
//
// Read this before touching the OTP cases: **POST /auth/login sends a real SMS
// to a real phone.** The full login round trip therefore lives behind
// BYTEPE_API_OTP_LOGIN=1 and skips by default. The unauthenticated cases below
// send no SMS and mutate nothing, so they run on every pass — they are the ones
// that actually guard the protected routes.
//
// Note the shape of this API: there is no Bearer token anywhere. Authentication
// is the `access_token` cookie for www.bytepe.com. "Accessing an endpoint
// without a token" therefore means a context with no cookie jar, which is what
// getApiContext() gives you by default.

const { test, expect } = require('@playwright/test');
const {
  getApiContext,
  loginAndGetToken,
  hasSavedSession,
} = require('./apiHelper');
const { ENDPOINTS, ENVELOPE } = require('../data/apiEndpoints');
const { getWithRetry } = require('../utils/apiRetry');

const OTP_LOGIN_ENABLED = process.env.BYTEPE_API_OTP_LOGIN === '1';

test.describe('Auth API — protected routes reject anonymous callers', () => {
  let anon;

  test.beforeAll(async () => {
    // No storageState: this context has no cookies at all.
    anon = await getApiContext();
  });

  test.afterAll(async () => {
    await anon.dispose();
  });

  // ---- Negative: the core of this file --------------------------------

  test('negative: GET /users/get-user-details without a session returns 401', async () => {
    const res = await getWithRetry(anon, ENDPOINTS.userDetails);

    expect(res.status()).toBe(401);

    const body = await res.json();
    expect(body.status).toBe(false);
    expect(body.code).toBe(401);
    expect(body.message).toBe(ENVELOPE.unauthorizedMessage);
  });

  test('negative: GET /cart without a session returns 401', async () => {
    const res = await getWithRetry(anon, ENDPOINTS.cart());

    // A cart endpoint that answered anonymously would be leaking one shopper's
    // basket to anyone who asked, so this is worth its own case rather than
    // being folded into the user-details one.
    expect(res.status()).toBe(401);

    const body = await res.json();
    expect(body.status).toBe(false);
    expect(body.code).toBe(401);
  });

  test('negative: a garbage access_token is rejected, not merely ignored', async () => {
    // The failure this guards against: a route that treats an unparseable token
    // as "no token" and then falls through to some anonymous-but-permitted
    // path. It must be a 401, the same as sending nothing.
    const forged = await getApiContext({
      extraHeaders: { cookie: 'access_token=not-a-real-token' },
    });

    try {
      const res = await getWithRetry(forged, ENDPOINTS.userDetails);
      expect(res.status()).toBe(401);
      const body = await res.json();
      expect(body.status).toBe(false);
    } finally {
      await forged.dispose();
    }
  });

  // ---- Presence: the login endpoint exists and validates its input -----

  test('negative: verify-otp with a bogus user_id and code does not mint a session', async () => {
    // Safe to call: no such user, so there is no OTP to consume and no SMS is
    // sent. This is the "wrong OTP" case, reachable without burning a real one.
    const res = await anon.post(ENDPOINTS.verifyOtp, {
      data: { user_id: '00000000-0000-0000-0000-000000000000', otp: '000000' },
    });

    expect(
      res.status(),
      `verify-otp accepted a bogus user_id/otp pair with ${res.status()}`
    ).toBeGreaterThanOrEqual(400);

    const body = await res.json().catch(() => ({}));
    expect(body.status).toBe(false);
  });

  test('negative: login with a malformed phone number is rejected', async () => {
    // "not-a-phone" cannot resolve to an account, so no SMS is dispatched. The
    // endpoint must say so rather than 500.
    const res = await anon.post(ENDPOINTS.login, {
      data: { emailOrPhone: 'not-a-phone', loginType: 'OTP', role_type: 'customer' },
    });

    expect(res.status()).toBeGreaterThanOrEqual(400);
    expect(res.status()).toBeLessThan(500);

    const body = await res.json().catch(() => ({}));
    expect(body.status).toBe(false);
  });
});

test.describe('Auth API — the saved session is a working credential', () => {
  test.skip(
    !hasSavedSession(),
    'auth.json holds no unexpired access_token. Refresh it with: npm run auth'
  );

  test('presence: loginAndGetToken returns a token from the saved session', async () => {
    const { token, source } = await loginAndGetToken();

    expect(source).toBe('auth.json');
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
  });

  test('behavior: that token authenticates a protected endpoint', async () => {
    // The pairing that matters. A token that exists but does not authenticate
    // is worse than no token — it makes every downstream 401 look like an
    // endpoint bug instead of a stale session.
    const authed = await getApiContext({ authenticated: true });

    try {
      const res = await getWithRetry(authed, ENDPOINTS.userDetails);

      expect(
        res.status(),
        'The saved session did not authenticate. Almost always a stale auth.json — ' +
        'refresh with: npm run auth'
      ).toBe(200);

      const body = await res.json();
      expect(body.status).toBe(true);
      expect(body).toHaveProperty('data');
    } finally {
      await authed.dispose();
    }
  });
});

test.describe('Auth API — full OTP login over HTTP', () => {
  // Sends a real SMS to a real phone every run. Opt-in only, and it needs a test
  // account with a fixed OTP because nothing here can read an inbox.
  test.skip(
    !OTP_LOGIN_ENABLED,
    'Set BYTEPE_API_OTP_LOGIN=1 with TEST_PHONE and TEST_OTP to run the live OTP login. ' +
    'It sends a real SMS.'
  );

  test('behavior: login -> verify-otp returns a usable access token', async () => {
    const { token, source } = await loginAndGetToken({ forceOtpLogin: true });

    expect(source).toBe('otp-login');
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);

    const authed = await getApiContext({ extraHeaders: { cookie: `access_token=${token}` } });
    try {
      const res = await getWithRetry(authed, ENDPOINTS.userDetails);
      expect(res.status()).toBe(200);
      const body = await res.json();
      expect(body.status).toBe(true);
    } finally {
      await authed.dispose();
    }
  });

  test('negative: the right phone with the wrong OTP is rejected', async () => {
    const phone = process.env.TEST_PHONE || process.env.BYTEPE_MOBILE;
    test.skip(!phone, 'TEST_PHONE / BYTEPE_MOBILE is not set.');

    const api = await getApiContext();
    try {
      // Consumes an SMS: this is the first leg of a real login.
      const loginRes = await api.post(ENDPOINTS.login, {
        data: { emailOrPhone: phone, loginType: 'OTP', role_type: 'customer' },
      });
      expect(loginRes.ok()).toBe(true);

      const loginBody = await loginRes.json();
      const userId = loginBody?.data?.user_id || loginBody?.data?.id || loginBody?.user_id;
      expect(userId, `No user_id in the login response: ${JSON.stringify(loginBody).slice(0, 300)}`)
        .toBeTruthy();

      const res = await api.post(ENDPOINTS.verifyOtp, {
        data: { user_id: userId, otp: '999999' },
      });

      expect(
        res.status(),
        'A deliberately wrong OTP was accepted.'
      ).toBeGreaterThanOrEqual(400);

      const body = await res.json().catch(() => ({}));
      expect(body.status).toBe(false);
    } finally {
      await api.dispose();
    }
  });
});
