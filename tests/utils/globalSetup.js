// tests/utils/globalSetup.js
//
// Runs once before any worker starts. Refreshes the saved session when its
// 15-minute access_token is about to lapse, so no test hands an expired
// session to the site — which revokes the single-use refresh_token (see
// refreshSavedSession in tests/utils/session.js).
//
// Inert in CI and on a fresh clone: no auth.json, or no refresh_token in it,
// means 'no-session' and nothing is launched. Never throws: a failed refresh
// is reported, public specs still run (logged out, via the storageState guard
// in fixtures/pageFixtures.js), and gated specs fail at assertFreshSession()
// with the real reason.

const { refreshSavedSession } = require('./session');
const { BASE_URL, AUTH_FILENAME } = require('../data/env');

module.exports = async function globalSetup(config) {
  const channel = config.projects?.[0]?.use?.channel;
  let outcome;
  try {
    outcome = await refreshSavedSession({ site: BASE_URL, channel });
  } catch (err) {
    outcome = `failed: ${err.message.split('\n')[0]}`;
  }
  if (outcome === 'refreshed') console.log(`[session] refreshed ${AUTH_FILENAME} — 15 minutes of access_token`);
  if (outcome.startsWith('failed')) {
    console.log(`[session] could not refresh ${AUTH_FILENAME} (${outcome.slice(8)}). Login-gated specs need: npm run auth`);
  }
};
