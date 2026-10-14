// tests/utils/harCapture.js
//
// HAR capture for rebuilding storefront journeys in JMeter. Used by
// tests/scripts/har-pdp.spec.js and tests/scripts/har-payment-summary.spec.js.
//
// The raw .har is gitignored: it carries the phone number, the OTP and live
// access/refresh tokens in bodies and cookies. The .md summary written beside
// it is masked and is the part meant to be shared.
//
// Auth on this site is the `access_token` COOKIE, not an Authorization header,
// so the summary reports both. In JMeter that means an HTTP Cookie Manager, not
// a Header Manager.
//
// Also runnable on its own, to re-summarise a HAR without re-running a journey:
//   node tests/utils/harCapture.js tests/data/har/<name>.har

const fs = require('fs');
const path = require('path');

const HAR_DIR = path.join(__dirname, '..', 'data', 'har');
const ENV_FILE = path.join(__dirname, '..', '..', '.env.har');

// Real environment variables win: process.loadEnvFile() never overwrites a
// variable that is already set.
function loadHarEnv() {
  if (fs.existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);
}

function harPathFor(name) {
  fs.mkdirSync(HAR_DIR, { recursive: true });
  return path.join(HAR_DIR, `${name}.har`);
}

const isApi = (url) => {
  try {
    const u = new URL(url);
    return /(^|\.)bytepe\.com$/.test(u.hostname) && u.pathname.startsWith('/api/');
  } catch {
    return false;
  }
};

// Resolves once no /api/ request has been in flight for `quietMs`, or after
// `maxMs` regardless. networkidle is no use here: analytics beacons keep the
// page busy indefinitely, so this watches the storefront API only.
async function waitForApiQuiet(page, { quietMs = 4000, maxMs = 45000 } = {}) {
  const inFlight = new Set();
  let lastChange = Date.now();
  const onStart = (req) => {
    if (isApi(req.url())) {
      inFlight.add(req);
      lastChange = Date.now();
    }
  };
  const onEnd = (req) => {
    if (inFlight.delete(req)) lastChange = Date.now();
  };
  page.on('request', onStart);
  page.on('requestfinished', onEnd);
  page.on('requestfailed', onEnd);

  const deadline = Date.now() + maxMs;
  try {
    while (Date.now() < deadline) {
      if (inFlight.size === 0 && Date.now() - lastChange >= quietMs) return true;
      await page.waitForTimeout(250);
    }
    return false;
  } finally {
    page.off('request', onStart);
    page.off('requestfinished', onEnd);
    page.off('requestfailed', onEnd);
  }
}

// ---- masking ---------------------------------------------------------------

const SENSITIVE_KEY = /token|otp|user_?id|mobile|phone|password|secret/i;
const JWT = /eyJ[\w-]+\.[\w-]+\.[\w-]+/g;

function maskJsonValues(value) {
  if (Array.isArray(value)) return value.map(maskJsonValues);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        SENSITIVE_KEY.test(k) && v !== null && typeof v !== 'object' ? '***' : maskJsonValues(v),
      ])
    );
  }
  return value;
}

function makeMasker(literals) {
  // Longest first, so a token that contains the phone number is replaced whole.
  const secrets = [...new Set(literals.filter((s) => s && String(s).length >= 4))]
    .map(String)
    .sort((a, b) => b.length - a.length);
  return (text) => {
    if (text == null) return text;
    let out = String(text);
    for (const s of secrets) out = out.split(s).join('***');
    return out.replace(JWT, '<jwt>');
  };
}

// Every token-shaped cookie value seen anywhere in the HAR, so it is masked
// wherever else it turns up (a URL, a body, a header).
function tokenValuesIn(har) {
  const values = [];
  for (const e of har.log.entries) {
    for (const c of [...(e.request.cookies || []), ...(e.response.cookies || [])]) {
      if (/token|session/i.test(c.name)) values.push(c.value);
    }
  }
  return values;
}

// ---- summary ---------------------------------------------------------------

const header = (headers, name) =>
  (headers || []).find((h) => h.name.toLowerCase() === name.toLowerCase());

function accessTokenSent(req) {
  if ((req.cookies || []).some((c) => c.name === 'access_token')) return true;
  const cookie = header(req.headers, 'cookie');
  return !!cookie && /(^|;\s*)access_token=/.test(cookie.value);
}

function cookiesSetBy(res) {
  const names = (res.cookies || []).map((c) => c.name);
  for (const h of (res.headers || []).filter((x) => x.name.toLowerCase() === 'set-cookie')) {
    for (const line of h.value.split('\n')) {
      const name = line.split('=')[0].trim();
      if (name) names.push(name);
    }
  }
  return [...new Set(names)];
}

function requestBody(req, mask) {
  if (req.method === 'GET' || !req.postData || req.postData.text == null) return '';
  const raw = req.postData.text;
  try {
    return mask(JSON.stringify(maskJsonValues(JSON.parse(raw))));
  } catch {
    return mask(raw);
  }
}

const cell = (s) => (s === '' || s == null ? '—' : String(s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' '));
const code = (s) => (s === '' || s == null ? '—' : '`' + cell(s).replace(/`/g, "'") + '`');

function summarizeHar(harFile, { title, notes = [], secrets = [], complete = true } = {}) {
  const har = JSON.parse(fs.readFileSync(harFile, 'utf8'));
  const mask = makeMasker([...secrets, ...tokenValuesIn(har)]);
  const entries = har.log.entries.filter((e) => isApi(e.request.url));

  const rows = entries.map((e, i) => {
    const req = e.request;
    const auth = header(req.headers, 'authorization');
    return [
      i + 1,
      req.method,
      code(mask(req.url)),
      e.response.status || 'failed',
      code(requestBody(req, mask)),
      auth ? `Yes (${auth.value.split(' ')[0]})` : 'No',
      accessTokenSent(req) ? 'Yes' : 'No',
      code(cookiesSetBy(e.response).join(', ')),
      code((header(e.response.headers, 'cache-control') || {}).value || ''),
    ];
  });

  const withCookie = rows.filter((r) => r[6] === 'Yes').length;
  const withAuth = rows.filter((r) => r[5] !== 'No').length;
  const setters = entries.filter((e) => cookiesSetBy(e.response).some((n) => /token/i.test(n)));

  const md = [
    `# ${title}`,
    '',
    complete ? '' : '> **INCOMPLETE** — the journey failed before the end. This is a partial capture.\n',
    `- Captured: ${new Date().toISOString()}`,
    `- HAR: \`tests/data/har/${path.basename(harFile)}\` (gitignored, unmasked)`,
    `- \`/api/\` calls: ${rows.length} of ${har.log.entries.length} requests in the HAR`,
    `- \`access_token\` cookie sent on ${withCookie} of ${rows.length} calls; Authorization header on ${withAuth}`,
    setters.length
      ? `- Token cookies are set by: ${setters.map((e) => `\`${e.request.method} ${new URL(e.request.url).pathname}\``).join(', ')}`
      : '- No call set a token cookie.',
    ...notes.map((n) => `- ${n}`),
    '- Masked: phone number, OTP, token values, JWTs, and any JSON field named like token/otp/user_id/mobile/phone.',
    '',
    '| # | Method | URL | Status | Request body | Authorization header | `access_token` cookie sent | Sets cookies | Response cache-control |',
    '|---|---|---|---|---|---|---|---|---|',
    ...rows.map((r) => `| ${r.join(' | ')} |`),
    '',
  ]
    .filter((line, i, all) => !(line === '' && all[i - 1] === ''))
    .join('\n');

  const mdFile = harFile.replace(/\.har$/, '.md');
  fs.writeFileSync(mdFile, md);
  return { mdFile, calls: rows.length };
}

if (require.main === module) {
  loadHarEnv();
  const file = process.argv[2];
  if (!file) throw new Error('usage: node tests/utils/harCapture.js <file.har>');
  const { mdFile, calls } = summarizeHar(path.resolve(file), {
    title: path.basename(file, '.har'),
    secrets: [process.env.BYTEPE_MOBILE, process.env.BYTEPE_OTP],
  });
  console.log(`${calls} /api/ calls -> ${mdFile}`);
}

module.exports = { loadHarEnv, harPathFor, waitForApiQuiet, summarizeHar, isApi };
