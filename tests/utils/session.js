// tests/utils/session.js
const fs = require('fs');
const path = require('path');

const AUTH_PATH = path.join(__dirname, '..', '..', 'auth.json');
const SITE_DOMAIN = 'www.bytepe.com';

function sessionError(reason) {
  return (
    `Saved login session is unusable — ${reason}.\n` +
    'Refresh it with:  npm run auth   (headed; needs BYTEPE_MOBILE set and a human to type the OTP)'
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
    // NO auth.json AT ALL — a fresh clone.
    //
    // This used to return silently, which was right when the config forced
    // storageState: 'auth.json' and Playwright refused to start without it. The
    // config now treats the file as optional so public specs can run on a clone,
    // which means a login-gated spec reaching this point would otherwise go on
    // and fail 60s later on a button that only renders for a signed-in user.
    //
    // Distinct from the empty-session case below: a MISSING file means nobody
    // has logged in yet, and saying so with the command to fix it is the whole
    // job of this helper.
    throw new Error(sessionError('there is no auth.json on disk, so nobody has signed in yet'));
  }

  const cookies = state.cookies || [];
  // CI's empty session: the workflow writes {"cookies":[],"origins":[]} and runs
  // only the public specs. Staying inert here is what keeps that pipeline green,
  // so this branch must NOT be turned into a throw.
  if (cookies.length === 0) return;

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
