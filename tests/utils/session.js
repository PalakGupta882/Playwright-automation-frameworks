// tests/utils/session.js
const fs = require('fs');
const path = require('path');

const AUTH_PATH = path.join(__dirname, '..', '..', 'auth.json');
const SITE_DOMAIN = 'www.bytepe.com';

function sessionError(reason) {
  return (
    `Saved login session is unusable — ${reason}.\n` +
    'Refresh it with:  npx playwright test tests/auth-setup.spec.js --headed'
  );
}

// Fail login-gated specs immediately, with the real reason, instead of letting
// them time out deep inside a page object waiting for a button that only ever
// renders for a logged-in user. Pure file read — no network.
//
// Inert when auth.json is absent or holds no cookies: CI writes an empty
// session and runs only the public specs, and must not start failing.
function assertFreshSession() {
  let state;
  try {
    state = JSON.parse(fs.readFileSync(AUTH_PATH, 'utf8'));
  } catch {
    return; // no saved session on disk — not this helper's call to make
  }

  const cookies = state.cookies || [];
  if (cookies.length === 0) return; // CI's empty session

  const token = cookies.find(c => c.name === 'access_token' && c.domain === SITE_DOMAIN);
  if (!token) {
    throw new Error(sessionError(`no access_token cookie for ${SITE_DOMAIN}`));
  }

  // expires <= 0 means a session cookie, which carries no expiry to check
  if (token.expires > 0 && token.expires < Date.now() / 1000) {
    const when = new Date(token.expires * 1000).toISOString().replace('T', ' ').slice(0, 19);
    throw new Error(sessionError(`access_token expired ${when}Z`));
  }
}

module.exports = { assertFreshSession };
