// tests/data/env.js
//
// Which BytePe environment this run targets. The ONE place the host is decided.
//
//   (unset)                                   -> https://www.bytepe.com   (production)
//   BASE_URL=https://stage-web.bytepe.com/    -> stage
//   BASE_URL=https://dev-web.bytepe.com/      -> dev
//
// Every environment serves its API same-origin under /api, so the API origin is
// derived from the host rather than configured separately. BYTEPE_API_BASE still
// overrides it, for the api/ suite's existing contract.
//
// Each environment gets its OWN saved session file, named from the host, so a
// production token can never be sent to stage or a stage token to production:
//
//   www.bytepe.com        -> auth.json        (unchanged)
//   stage-web.bytepe.com  -> auth.stage.json
//   dev-web.bytepe.com    -> auth.dev.json    (the name .gitignore already reserved)
//
// Default stays production so nothing that runs today changes behaviour.

const path = require('path');

const PRODUCTION_URL = 'https://www.bytepe.com';

const BASE_URL = (process.env.BASE_URL || PRODUCTION_URL).trim().replace(/\/+$/, '');

let SITE_HOST;
try {
  SITE_HOST = new URL(BASE_URL).hostname;
} catch {
  throw new Error(`BASE_URL is not a valid URL: "${process.env.BASE_URL}"`);
}

if (!/(^|\.)bytepe\.com$/.test(SITE_HOST)) {
  throw new Error(`BASE_URL must be a bytepe.com host, got "${SITE_HOST}"`);
}

const IS_PRODUCTION = SITE_HOST === 'www.bytepe.com' || SITE_HOST === 'bytepe.com';

// 'production' | 'stage' | 'dev' | whatever the first label is, minus "-web".
const ENV_NAME = IS_PRODUCTION ? 'production' : SITE_HOST.split('.')[0].replace(/-web$/, '');

const AUTH_FILENAME = IS_PRODUCTION ? 'auth.json' : `auth.${ENV_NAME}.json`;
const AUTH_PATH = path.join(__dirname, '..', '..', AUTH_FILENAME);

const BASE_API_URL = (process.env.BYTEPE_API_BASE || `${BASE_URL}/api`).replace(/\/+$/, '');

module.exports = {
  BASE_URL,
  BASE_API_URL,
  SITE_HOST,
  ENV_NAME,
  IS_PRODUCTION,
  AUTH_FILENAME,
  AUTH_PATH,
  PRODUCTION_URL,
};
