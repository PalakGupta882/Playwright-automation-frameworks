// tests/scripts/probe-prod-wallet-health.spec.js
//
// ByteCoins wallet went live on PRODUCTION on 2 Oct 2026. Did it break anything
// the shopper already relied on? Logged in, READ-ONLY.
//
// Walks Home -> listing -> PDP (upfront + subscription) -> cart -> Review Order
// -> My Profile -> My Orders -> wallet page (if the profile links one), and
// records every /api/ response the pages make, plus pageerror and console
// errors. A wallet regression shows up as a non-2xx on an endpoint that used to
// answer, so the report names the ENDPOINT and the page, not just the page.
//
// Then reads the wallet and cart APIs directly (GET only) and reports the new
// coin fields against the figures they sit beside.
//
// READ-ONLY, enforced, not just intended: every non-GET to create-order, the
// cart, or wallet apply/remove is aborted and listed under `blocked`, so a
// page that tries to write is visible rather than silently allowed. Never
// presses Continue on Review Order.
//
//   npx playwright test scripts/probe-prod-wallet-health.spec.js --project=chromium --retries=0
//
// Output: console report + test-results/prod-wallet-health.json

const fs = require('fs');
const path = require('path');
const { test } = require('../fixtures/pageFixtures');
const { BASE_URL, BASE_API_URL, TIMEOUTS } = require('../data/constants');
const { SITE_HOST } = require('../data/env');
const { assertFreshSession } = require('../utils/session');
const { pdpApiPath, variantPricingPath } = require('../data/emiApi');
const { rowOffersAddToCart, buyNowControl } = require('../utils/buyRow');
const { openCart, dismissExchangeDialog } = require('../utils/cartNav');
const { waitForApiQuiet } = require('../utils/harCapture');

const OUT = path.join(__dirname, '..', '..', 'test-results', 'prod-wallet-health.json');

// Writes this probe must never let through.
const WRITE = /create-order|wallet-service\/.*\/(apply|remove)|\/api\/cart(\/|\?|$)/;

test.describe.configure({ retries: 0 });
test.beforeAll(() => assertFreshSession());

test('production: no API breaks with the wallet live (read-only)', async ({ page }) => {
  test.setTimeout(300000);

  const calls = [];
  const pageErrors = [];
  const consoleErrors = [];
  const blocked = [];
  const orderBodies = [];
  let step = 'start';

  await page.context().route('**/api/**', (route) => {
    const req = route.request();
    if (req.method() !== 'GET' && WRITE.test(req.url())) {
      blocked.push({ step, method: req.method(), url: req.url() });
      return route.abort();
    }
    return route.continue();
  });

  page.on('response', async (res) => {
    const url = res.url();
    if (!url.includes(`${SITE_HOST}/api/`)) return;
    const u = new URL(url);
    calls.push({ step, method: res.request().method(), path: u.pathname, status: res.status() });
    if (/order/i.test(u.pathname) && res.request().method() === 'GET' && res.ok()) {
      const body = await res.json().catch(() => null);
      if (body) orderBodies.push({ path: u.pathname + u.search, body });
    }
  });
  page.on('pageerror', (e) => pageErrors.push({ step, message: e.message.slice(0, 300) }));
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push({ step, text: m.text().slice(0, 300) });
  });

  async function visit(label, url) {
    step = label;
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await waitForApiQuiet(page, { quietMs: 3000, maxMs: 20000 });
  }

  // Products: one UPFRONT (cart icon path) and one BOTH (subscription path).
  // Paged: BOTH products can sit past the first page.
  const rows = [];
  for (let n = 1; n <= 10; n++) {
    const res = await page.request.get(`${BASE_API_URL}/product-service/apps/products?page=${n}&limit=50`);
    if (!res.ok()) break;
    const items = (await res.json()).data.items || [];
    rows.push(...items);
    if (items.length < 50) break;
  }
  const upfront = rows.find(rowOffersAddToCart);
  const both = rows.find((r) => r.prodPaymentMode === 'BOTH');

  await visit('home', `${BASE_URL}/`);
  await visit('listing', `${BASE_URL}/all-products`);

  const pdps = [];
  for (const [mode, row] of [['UPFRONT', upfront], ['BOTH', both]]) {
    if (!row) continue;
    await visit(`pdp ${mode}`, `${BASE_URL}/pd/${row.slug}/${row.variant.bpid}`);
    const buyNow = await buyNowControl(page).first().isVisible({ timeout: TIMEOUTS.nav }).catch(() => false);
    const bucket = await page.evaluate(() => localStorage.getItem('priceBucket'));
    const text = await page.locator('body').innerText();
    pdps.push({
      mode,
      slug: row.slug,
      bpid: row.variant.bpid,
      buyNowVisible: buyNow,
      bucket,
      coinCopyOnPage: (text.match(/[^\n]*(byte ?coins?|wallet)[^\n]*/gi) || []).slice(0, 5),
    });
  }

  step = 'cart';
  await openCart(page);
  await waitForApiQuiet(page, { quietMs: 3000, maxMs: 20000 });
  await dismissExchangeDialog(page);
  const cartText = await page.locator('body').innerText();
  const cartHasItems = /price\s*\(\d+\s*items?\)/i.test(cartText);

  let reviewReached = false;
  if (cartHasItems) {
    step = 'review order';
    await page.getByRole('button', { name: /^continue$/i }).first().click({ timeout: TIMEOUTS.action });
    reviewReached = await page
      .waitForURL(/\/review/, { timeout: 60000 })
      .then(() => true)
      .catch(() => false);
    await waitForApiQuiet(page, { quietMs: 3000, maxMs: 20000 });
    await dismissExchangeDialog(page);
  }

  await visit('my profile', `${BASE_URL}/my-profile`);
  const walletLink = page.getByText(/byte ?coins?|wallet/i).filter({ visible: true }).first();
  const profileLinksWallet = await walletLink.isVisible().catch(() => false);

  step = 'my orders';
  await page.getByText('My Orders', { exact: true }).first().click({ timeout: TIMEOUTS.action }).catch(() => {});
  await page.waitForURL(/\/orders\/my-orders/, { timeout: 30000 }).catch(() => {});
  await waitForApiQuiet(page, { quietMs: 3000, maxMs: 20000 });

  let walletPageUrl = null;
  if (profileLinksWallet) {
    await visit('my profile', `${BASE_URL}/my-profile`);
    step = 'wallet page';
    await walletLink.click({ timeout: TIMEOUTS.action }).catch(() => {});
    await waitForApiQuiet(page, { quietMs: 3000, maxMs: 20000 });
    walletPageUrl = page.url();
  }

  // Direct reads, GET only.
  step = 'direct api';
  const direct = {};
  async function get(name, url, headers) {
    const res = await page.request.get(url, { headers });
    const body = await res.json().catch(() => null);
    direct[name] = { status: res.status(), body };
    return body;
  }
  await get('wallet', `${BASE_API_URL}/wallet-service/wallet`);
  await get('ledger', `${BASE_API_URL}/wallet-service/wallet/ledger?page=1&limit=10`);
  await get('cart UPFRONT', `${BASE_API_URL}/cart?payment_type=UPFRONT`);
  await get('cart SUBSCRIPTION', `${BASE_API_URL}/cart?payment_type=SUBSCRIPTION`);
  for (const p of pdps) {
    const pdp = await get(`pdp ${p.mode}`, pdpApiPath(p.slug, p.bpid));
    const variantId = pdp && pdp.data && pdp.data.variant && pdp.data.variant.id;
    if (!variantId) continue;
    const pricing = await get(`pricing ${p.mode}`, variantPricingPath(p.slug, variantId));
    p.pricingCoinKeys = Object.keys((pricing && pricing.data) || {}).filter((k) => /coin|wallet/i.test(k));
    p.upfrontPrice = pricing && pricing.data && pricing.data.upfront && pricing.data.upfront.price;
    if (p.bucket) {
      await get(`coins ${p.mode}`, `${BASE_API_URL}/wallet-service/product/${variantId}/coins`, {
        'x-bucket-name': p.bucket,
      });
    }
  }

  // Cart coin fields beside the figures they modify.
  const cartCoins = {};
  for (const type of ['UPFRONT', 'SUBSCRIPTION']) {
    const d = direct[`cart ${type}`].body && direct[`cart ${type}`].body.data;
    if (!d || Array.isArray(d)) {
      cartCoins[type] = d;
      continue;
    }
    const items = d.items || d.cart_items || [];
    cartCoins[type] = {
      topLevelKeys: Object.keys(d),
      total_bytecoin_coins: d.total_bytecoin_coins,
      total_bytecoin_discount: d.total_bytecoin_discount,
      payable_amount: d.payable_amount,
      lines: items.map((l) => ({
        bpid: l.bpid,
        name: l.product_name || l.name,
        MOP: l.MOP,
        bytecoin_applied: l.bytecoin_applied,
        bytecoin_coins: l.bytecoin_coins,
        bytecoin_discount: l.bytecoin_discount,
      })),
    };
  }

  const bad = calls.filter((c) => c.status >= 400);
  const report = {
    host: BASE_URL,
    when: new Date().toISOString(),
    products: { upfront: upfront && upfront.slug, both: both && both.slug },
    cartHasItems,
    reviewReached,
    profileLinksWallet,
    walletPageUrl,
    pdps,
    direct: Object.fromEntries(
      Object.entries(direct).map(([k, v]) => [k, { status: v.status, keys: Object.keys((v.body && v.body.data) || {}) }])
    ),
    wallet: direct.wallet.body && direct.wallet.body.data,
    ledgerSample: direct.ledger.body && direct.ledger.body.data,
    coins: Object.fromEntries(Object.entries(direct).filter(([k]) => k.startsWith('coins')).map(([k, v]) => [k, v.body])),
    cartCoins,
    callCount: calls.length,
    failingCalls: bad,
    blocked,
    pageErrors,
    consoleErrors,
    calls,
    orderBodies,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));

  console.log(`\n${calls.length} API calls across ${new Set(calls.map((c) => c.step)).size} steps`);
  console.log(`cart has items: ${cartHasItems} · review reached: ${reviewReached} · profile links wallet: ${profileLinksWallet} ${walletPageUrl || ''}`);
  console.log('\nnon-2xx/3xx calls:');
  for (const c of bad) console.log(`  [${c.step}] ${c.status} ${c.method} ${c.path}`);
  console.log('\ndirect reads:');
  for (const [k, v] of Object.entries(report.direct)) console.log(`  ${v.status} ${k}`);
  console.log(`\nblocked writes: ${blocked.length}`);
  for (const b of blocked) console.log(`  [${b.step}] ${b.method} ${b.url}`);
  console.log(`page errors: ${pageErrors.length}`);
  for (const e of pageErrors) console.log(`  [${e.step}] ${e.message}`);
  console.log(`console errors: ${consoleErrors.length}`);
  console.log(`\nfull report: ${OUT}`);
});
