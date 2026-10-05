// tests/utils/session.js
const fs = require('fs');
const path = require('path');

const { AUTH_PATH, SITE_HOST } = require('../data/env');
const SITE_DOMAIN = SITE_HOST;

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

// The refresh_token is SINGLE-USE. Measured 5 Oct 2026: every
// POST /api/auth/refresh-tokens returns a new refresh_token, and replaying the
// old one afterwards gets a 401.
//
// So any browser that loads auth.json after the 15-minute access_token has
// expired lets the app refresh by itself, consumes the refresh_token on disk,
// and — unless the new one is written back — leaves auth.json holding a revoked
// token. The next `npm run auth` then cannot refresh and demands an OTP. That is
// what made three logins in one day need a human.
//
// Called from the page fixture's teardown. Writes only when the context holds a
// DIFFERENT refresh_token from the file AND an unexpired access_token, so:
//   - logged-out specs (empty storageState) and CI (empty auth.json) never write;
//   - a context whose own refresh lost a race (401, no access_token) never
//     overwrites the winner's token with nothing.
// Temp file + rename, so a worker reading auth.json never sees half a file.
async function saveRotatedSession(context) {
  let onDisk;
  try {
    onDisk = JSON.parse(fs.readFileSync(AUTH_PATH, 'utf8'));
  } catch {
    return; // no auth.json — nothing to keep current
  }
  const fileRefresh = (onDisk.cookies || []).find(c => c.name === 'refresh_token' && c.domain === SITE_DOMAIN);
  if (!fileRefresh) return;

  let live;
  try {
    live = await context.cookies();
  } catch {
    return; // context already closed
  }
  const refresh = live.find(c => c.name === 'refresh_token' && c.domain === SITE_DOMAIN);
  const access = live.find(c => c.name === 'access_token' && c.domain === SITE_DOMAIN);
  if (!refresh || refresh.value === fileRefresh.value) return;
  if (!access || (access.expires > 0 && access.expires < Date.now() / 1000)) return;

  const tmp = `${AUTH_PATH}.${process.pid}.tmp`;
  await context.storageState({ path: tmp });
  fs.renameSync(tmp, AUTH_PATH);
  console.log(`[session] the app rotated the refresh_token — saved the new session to ${path.basename(AUTH_PATH)}`);
}

// --- Never send an expired session to the site ----------------------------
//
// Measured 5 Oct 2026: the listing, PDP and cart pages CONSUME the refresh_token
// when they are loaded with an expired access_token, yet no refresh-tokens call
// is seen from the browser and no new token reaches its cookies — most likely
// refreshed server-side, with the replacement never returned. One page load
// with a stale session is enough to revoke it. So the only safe rule is to
// refresh deliberately, on the one path proven to hand the new token back, and
// to keep an expired session away from every other page.

const ACCESS_USABLE_SEC = 300; // same 5-minute floor auth-setup uses

function readSaved() {
  try {
    return JSON.parse(fs.readFileSync(AUTH_PATH, 'utf8'));
  } catch {
    return null;
  }
}

const siteCookie = (cookies, name) => (cookies || []).find(c => c.name === name && c.domain === SITE_DOMAIN);
const hasLife = (cookie, sec) => Boolean(cookie) && (cookie.expires <= 0 || cookie.expires > Date.now() / 1000 + sec);

// Refreshes auth.json headless, without an OTP, when its access_token is about
// to lapse. The ONLY path measured to work: straight to /my-profile, with the
// expired access_token removed first — loading the homepage first (which
// auth-setup used to do) let a server-rendered page spend the token before
// /my-profile could. Returns one of:
//   'no-session'  no auth.json or no refresh_token (CI, fresh clone) — inert
//   'fresh'       access_token already has ACCESS_USABLE_SEC left
//   'refreshed'   new tokens saved to auth.json
//   'failed: …'   refresh token rejected or never exchanged — needs an OTP
async function refreshSavedSession({ site, channel } = {}) {
  const saved = readSaved();
  if (!saved || !siteCookie(saved.cookies, 'refresh_token')) return 'no-session';
  if (hasLife(siteCookie(saved.cookies, 'access_token'), ACCESS_USABLE_SEC)) return 'fresh';

  const { chromium } = require('@playwright/test');
  const browser = await chromium.launch({ channel });
  try {
    const context = await browser.newContext({
      storageState: { ...saved, cookies: saved.cookies.filter(c => c.name !== 'access_token') },
    });
    const page = await context.newPage();
    const exchange = page
      .waitForResponse(r => /\/auth\/refresh-tokens/.test(r.url()), { timeout: 20000 })
      .catch(() => null);
    await page.goto(`${site}/my-profile`, { waitUntil: 'domcontentloaded' });
    const res = await exchange;
    if (!res) return 'failed: the app never called refresh-tokens';
    if (!res.ok()) return `failed: refresh-tokens returned ${res.status()} (refresh_token already used or expired)`;

    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if (hasLife(siteCookie(await context.cookies(), 'access_token'), ACCESS_USABLE_SEC)) {
        const tmp = `${AUTH_PATH}.${process.pid}.tmp`;
        await context.storageState({ path: tmp });
        fs.renameSync(tmp, AUTH_PATH);
        return 'refreshed';
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    return 'failed: refresh-tokens returned 200 but no access_token cookie arrived';
  } finally {
    await browser.close();
  }
}

// For the storageState fixture: the saved session only while its access_token
// is unexpired, otherwise a logged-out context. A test that starts after expiry
// (a run longer than 15 minutes) then runs logged out instead of handing the
// stale session to a page that would revoke it. Gated specs fail first at
// assertFreshSession() anyway.
let warnedExpired = false;
function usableStorageState(configured) {
  if (typeof configured !== 'string' || path.resolve(configured) !== path.resolve(AUTH_PATH)) return configured;
  const saved = readSaved();
  if (!saved || !siteCookie(saved.cookies, 'refresh_token')) return configured; // CI's empty session, untouched
  if (hasLife(siteCookie(saved.cookies, 'access_token'), 0)) return configured;
  if (!warnedExpired) {
    warnedExpired = true;
    console.log(
      `[session] ${path.basename(AUTH_PATH)} access_token has expired — running logged out rather than ` +
        'letting a page spend the refresh_token. Re-run the suite (global setup refreshes it) or npm run auth.'
    );
  }
  return { cookies: [], origins: [] };
}

module.exports = { assertFreshSession, saveRotatedSession, refreshSavedSession, usableStorageState };
