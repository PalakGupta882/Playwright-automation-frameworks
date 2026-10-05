// scripts/har-to-jmeter.js
//
// Turns a recorded journey HAR into the API list a JMeter plan is rebuilt from:
// the calls in order, the values each response hands to a later request, and the
// non-browser headers the calls carry.
//
//   node scripts/har-to-jmeter.js [in.har[=label] ...] [out.md]
//
// Several HARs are numbered as one journey, in the order given. `label` names
// the page for calls made from the homepage in that HAR. Defaults: the login
// part of Journey 2, then Journey 3 from the homepage to Payment Summary ->
// har/api-summary.md
//
// Only fetch/XHR to *.bytepe.com is kept — Chromium's own _resourceType, so
// documents, scripts, styles, fonts and images drop out without guessing from
// extensions. Analytics hosts are dropped by name.
//
// Masked: the mobile number, the OTP and every JWT become ${MOBILE}, ${OTP} and
// ${ACCESS_TOKEN} — the JMeter variables they will be in the plan. IDs are kept
// whole: they are the correlation targets.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const outArg = args.find((a) => a.endsWith('.md'));
const inArgs = args.filter((a) => a !== outArg);
const inputs = (inArgs.length
  ? inArgs
  : ['tests/data/har/payment-summary-logged-in.har=Login', 'tests/data/har/subscription-payment-summary.har=Home']
).map((a) => {
  const [file, label = 'Login'] = a.split('=');
  return { file: path.resolve(ROOT, file), label };
});
const outFile = path.resolve(ROOT, outArg || 'har/api-summary.md');

const hars = inputs.map((i) => ({ ...i, har: JSON.parse(fs.readFileSync(i.file, 'utf8')) }));
const MOBILE = process.env.BYTEPE_MOBILE || '';

const ANALYTICS = /(analytics|gtm|gtag|clarity|hotjar|mixpanel|segment|sentry|facebook|pixel|collect|moengage|webengage|clevertap)/i;
const isBytepe = (host) => /(^|\.)bytepe\.com$/.test(host);

const byTime = (a, b) => new Date(a.startedDateTime) - new Date(b.startedDateTime);
const entries = hars
  .flatMap(({ har, label }) => har.log.entries.sort(byTime).map((e) => Object.assign(e, { _label: label })))
  .filter((e) => ['fetch', 'xhr'].includes(e._resourceType))
  .filter((e) => {
    const u = new URL(e.request.url);
    return isBytepe(u.hostname) && !ANALYTICS.test(u.hostname + u.pathname);
  })
  // Next.js prefetches every link in view. They are the router warming its
  // cache, not the journey, and would put five unrelated pages in the plan.
  .filter((e) => !e.request.headers.some((h) => h.name.toLowerCase() === 'next-router-prefetch'));

// ---- masking ----------------------------------------------------------------

const JWT = /eyJ[\w-]+\.[\w-]+\.[\w-]+/g;
let otpValue = null;

function bodyText(req) {
  return req.postData ? req.postData.text || '' : '';
}

// The OTP is whatever the verify call sent under an otp-shaped key. Found from
// the HAR itself, because a typed OTP never reaches the environment.
for (const e of entries) {
  if (!/otp/i.test(e.request.url)) continue;
  try {
    const body = JSON.parse(bodyText(e.request));
    for (const [k, v] of Object.entries(body)) {
      if (/^otp$/i.test(k) && v) otpValue = String(v);
    }
  } catch {
    /* not JSON */
  }
}

function mask(text) {
  if (text == null) return text;
  let out = String(text).replace(JWT, '${ACCESS_TOKEN}');
  if (MOBILE.length >= 4) out = out.split(MOBILE).join('${MOBILE}');
  return out;
}

// OTP is short enough to collide with prices, so it is masked by key, not by value.
function maskBody(raw) {
  if (!raw) return '';
  try {
    const walk = (v) => {
      if (Array.isArray(v)) return v.map(walk);
      if (v && typeof v === 'object') {
        return Object.fromEntries(
          Object.entries(v).map(([k, x]) => [k, /^otp$/i.test(k) && x != null ? '${OTP}' : walk(x)])
        );
      }
      return v;
    };
    return mask(JSON.stringify(walk(JSON.parse(raw))));
  } catch {
    return mask(raw);
  }
}

// ---- page and name ----------------------------------------------------------

function pageOf(e) {
  const ref = (e.request.headers.find((h) => h.name.toLowerCase() === 'referer') || {}).value || '';
  let p = '';
  try {
    p = new URL(ref).pathname;
  } catch {
    /* no referer */
  }
  if (/otp|login|auth/i.test(e.request.url)) return 'Login';
  if (p.startsWith('/payment-summary')) return 'Payment Summary';
  if (p.startsWith('/review')) return 'Review Order';
  if (p.startsWith('/cart')) return 'Cart';
  if (p.startsWith('/pd/')) return 'PDP';
  if (p.startsWith('/home/subscription')) return 'Subscription';
  return e._label;
}

const ID_SEGMENT = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{24}|\d{4,}|[A-Z0-9]{12,})$/i;

function nameOf(e, page) {
  const u = new URL(e.request.url);
  const m = e.request.method;
  // Send OTP is POST /api/auth/login with loginType OTP.
  if (/send.?otp|otp\/send|generate.?otp|\/auth\/login$/i.test(u.pathname)) return `${page} - send OTP`;
  if (/verify.?otp|otp\/verify|validate.?otp/i.test(u.pathname)) return `${page} - verify OTP`;
  if (/create-order/i.test(u.pathname)) return `${page} - create order`;
  const segs = u.pathname
    .split('/')
    .filter(Boolean)
    .filter((s) => !['api', 'apps', 'v1', 'v2'].includes(s))
    .map((s) => (ID_SEGMENT.test(s) ? '{id}' : s));
  const tail = segs.filter((s) => s !== '{id}').slice(-2).join(' ');
  const qs = u.searchParams.get('payment_type');
  return `${page} - ${m} ${tail || u.pathname}${qs ? ` (${qs})` : ''}`;
}

// ---- rows -------------------------------------------------------------------

const rows = entries.map((e, i) => {
  const u = new URL(e.request.url);
  const page = pageOf(e);
  return {
    n: i + 1,
    e,
    page,
    name: nameOf(e, page),
    method: e.request.method,
    pathQuery: mask(u.pathname + u.search),
    body: maskBody(bodyText(e.request)),
    status: e.response.status,
    time: Math.round(e.time),
  };
});

// ---- chained values ---------------------------------------------------------

// Leaves of a response that are worth correlating: UUIDs, long hex/alnum ids,
// and numbers under an id-shaped key. Plain prices and flags are not.
function* idLeaves(v, p = '$') {
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) yield* idLeaves(v[i], `${p}[${i}]`);
  } else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      const kp = /^[A-Za-z_$][\w$]*$/.test(k) ? `${p}.${k}` : `${p}['${k}']`;
      if (typeof x === 'string' && /^[\w-]{8,}$/.test(x) && /\d/.test(x) && !JWT.test(x)) yield [kp, x];
      else if (typeof x === 'number' && Number.isInteger(x) && x >= 1000 && /id$/i.test(k)) yield [kp, String(x)];
      else yield* idLeaves(x, kp);
      JWT.lastIndex = 0;
    }
  }
}

function* bodyLeaves(v, p = '') {
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) yield* bodyLeaves(v[i], `${p}[${i}]`);
  } else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) yield* bodyLeaves(x, p ? `${p}.${k}` : k);
  } else if (v != null) {
    yield [p, String(v)];
  }
}

// Where in a request a value is used: path, a query param, or a body field.
function usesOf(row, value) {
  const u = new URL(row.e.request.url);
  const found = [];
  if (u.pathname.split('/').includes(value)) found.push('path');
  for (const [k, v] of u.searchParams) if (v === value) found.push(`query \`${k}\``);
  try {
    for (const [p, v] of bodyLeaves(JSON.parse(bodyText(row.e.request)))) if (v === value) found.push(`body \`${p}\``);
  } catch {
    /* no JSON body */
  }
  return found;
}

const chains = [];
const claimed = new Set();
for (const src of rows) {
  let json;
  try {
    json = JSON.parse(src.e.response.content.text || '');
  } catch {
    continue;
  }
  const seen = new Set();
  for (const [jsonPath, value] of idLeaves(json)) {
    // First response to produce a value is the source; later echoes are not.
    if (claimed.has(value) || seen.has(value)) continue;
    // A value the client already sent before this response came back did not
    // come from this response (e.g. the bpid from the page URL).
    const sentEarlier = rows.slice(0, src.n).some((r) => usesOf(r, value).length);
    if (sentEarlier) continue;
    const uses = rows
      .slice(src.n)
      .map((r) => ({ n: r.n, where: usesOf(r, value) }))
      .filter((u) => u.where.length);
    if (!uses.length) continue;
    seen.add(value);
    claimed.add(value);
    chains.push({ src: src.n, jsonPath, value, uses });
  }
}

// Session cookies set by a response and sent on later requests.
const cookieChains = [];
for (const src of rows) {
  for (const c of src.e.response.cookies || []) {
    const later = rows.slice(src.n).filter((r) => (r.e.request.cookies || []).some((x) => x.name === c.name));
    if (later.length) cookieChains.push({ src: src.n, name: c.name, first: later[0].n, count: later.length });
  }
}

// ---- headers ----------------------------------------------------------------

const BROWSER = new Set([
  'accept', 'accept-encoding', 'accept-language', 'connection', 'host', 'origin', 'referer',
  'user-agent', 'content-length', 'cache-control', 'pragma', 'priority', 'dnt', 'cookie',
  'if-none-match', 'if-modified-since', 'upgrade-insecure-requests', 'te',
]);
const headers = new Map();
for (const r of rows) {
  for (const h of r.e.request.headers) {
    const k = h.name.toLowerCase();
    if (k.startsWith(':') || k.startsWith('sec-') || BROWSER.has(k)) continue;
    if (!headers.has(k)) headers.set(k, { values: new Set(), calls: [] });
    headers.get(k).values.add(mask(h.value));
    headers.get(k).calls.push(r.n);
  }
}

// ---- write ------------------------------------------------------------------

const cell = (s) => (s === '' || s == null ? '—' : `\`${String(s).replace(/\|/g, '\\|').replace(/\n/g, ' ')}\``);
const ranges = (ns) => {
  const out = [];
  for (const n of ns) {
    const last = out[out.length - 1];
    if (last && n === last[1] + 1) last[1] = n;
    else out.push([n, n]);
  }
  return out.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(', ');
};

const L = [];
L.push('# BytePe — Login → Payment Summary: API list for JMeter', '');
L.push('Recorded on https://www.bytepe.com from:', '');
for (const h of hars) {
  L.push(`- \`${path.relative(ROOT, h.file).replace(/\\/g, '/')}\` — ${h.har.log.entries[0]?.startedDateTime || ''}`);
}
L.push('');
L.push('Journey: homepage → Login drawer → send OTP → verify OTP, then (logged in) homepage → /home/subscription → PDP → Subscribe → /review → Continue (create-order) → /payment-summary. Stopped once Payment Summary loaded; Pay Now was never clicked.', '');
L.push('The two parts are separate browser sessions, so the login tokens are not chained into the second part: in JMeter, the cookies set by verify OTP carry over through the Cookie Manager.', '');
L.push('Masked: `${MOBILE}`, `${OTP}`, `${ACCESS_TOKEN}`. Everything else is verbatim.', '');
L.push('Page is taken from the `Referer` of each call. PDP, Cart and Review Order calls are listed because JMeter has to make them to reach Payment Summary.', '');

L.push('## 1. API calls, in order', '');
L.push('| # | Page | JMeter name | Method | Path + query | Request body | Status | Time (ms) |');
L.push('|---|---|---|---|---|---|---|---|');
for (const r of rows) {
  L.push(`| ${r.n} | ${r.page} | ${r.name} | ${r.method} | ${cell(r.pathQuery)} | ${cell(r.body)} | ${r.status} | ${r.time} |`);
}
L.push('', `${rows.length} calls.`, '');

L.push('## 2. Chained values', '');
if (chains.length) {
  L.push('| Value | Source # | JSON path in source response | Used by # → where |');
  L.push('|---|---|---|---|');
  for (const c of chains) {
    const used = c.uses.map((u) => `#${u.n} ${u.where.join(', ')}`).join('<br>');
    L.push(`| ${cell(c.value)} | ${c.src} | ${cell(c.jsonPath)} | ${used} |`);
  }
} else {
  L.push('No response value was found reused in a later request.');
}
L.push('');
L.push(
  'IDs sent before any API response carried them — the product and variant UUIDs on the PDP calls — come from the server-rendered `/pd/<slug>/<bpid>` HTML, not from an API. In JMeter, request that page and extract them with a Regular Expression Extractor, or hold them as test data.',
  ''
);
if (cookieChains.length) {
  L.push('Session cookies (set by a response, then sent on later calls — HTTP Cookie Manager handles these):', '');
  L.push('| Cookie | Set by # | First sent on # | Sent on N later calls |');
  L.push('|---|---|---|---|');
  for (const c of cookieChains) L.push(`| \`${c.name}\` | ${c.src} | ${c.first} | ${c.count} |`);
  L.push('');
}

L.push('## 3. Extra request headers', '');
L.push('Standard browser headers (`accept*`, `user-agent`, `referer`, `origin`, `sec-*`, `priority`, HTTP/2 pseudo-headers) are omitted.', '');
L.push('Auth is the `access_token` **cookie**, not an `Authorization` header — use an HTTP Cookie Manager.', '');
if (headers.size) {
  L.push('| Header | Value(s) | Sent on # |');
  L.push('|---|---|---|');
  for (const [k, h] of headers) L.push(`| \`${k}\` | ${[...h.values].map(cell).join('<br>')} | ${ranges(h.calls)} |`);
} else {
  L.push('None — every call carries only standard browser headers plus cookies.');
}
L.push('');

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, L.join('\n'));
console.log(`${rows.length} calls, ${chains.length} chained values, ${headers.size} extra headers -> ${outFile}`);
if (!otpValue && rows.some((r) => /otp/i.test(r.name))) console.log('note: no otp field found in any OTP request body');
