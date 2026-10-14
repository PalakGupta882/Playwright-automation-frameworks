// tests/scripts/probe-stage-wallet.spec.js
//
// One-off measurement of the ByteCoins wallet on STAGE, taken before any
// assertion was written. It answers: does apply HOLD coins or DEDUCT them, what
// does each wallet call return, and does variant-pricing / the cart change when
// coins are applied. Writes a small apply + remove on the stage account.
//
//   BASE_URL=https://stage-web.bytepe.com npx playwright test scripts/probe-stage-wallet.spec.js --project=chromium --retries=0
//
// Refuses to run against any host but stage.

const { test, expect, request } = require('@playwright/test');
const { BASE_API_URL, SITE_HOST, AUTH_PATH } = require('../data/env');
const { pdpApiPath, variantPricingPath } = require('../data/emiApi');

const PINCODE = process.env.BYTEPE_PINCODE || '560005';
const clip = (v, n = 1500) => JSON.stringify(v).slice(0, n);

test('measure stage wallet behaviour', async () => {
  test.setTimeout(240000);
  expect(SITE_HOST, 'this probe writes to a wallet — stage only').toBe('stage-web.bytepe.com');

  const api = await request.newContext({ baseURL: `${BASE_API_URL}/`, storageState: AUTH_PATH });
  const call = async (method, path, body, headers) => {
    const res = await api.fetch(path, { method, data: body, headers });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = text.slice(0, 300); }
    console.log(`\n${method} ${path} -> ${res.status()}\n${clip(json)}`);
    return json;
  };

  await call('GET', 'wallet-service/wallet');

  // The coins endpoint needs the shopper's price bucket, which the client takes
  // from the pincode lookup (data.bucket_name) and sends as x-bucket-name.
  const listing = await (await api.get('product-service/apps/products?page=1&limit=40')).json();
  let found;
  for (const r of listing.data.items.filter((x) => !((x.variant && x.variant.tags) || []).length)) {
    const pdp = await (await api.get(pdpApiPath(r.slug, r.variant.bpid))).json();
    const v = pdp.data && pdp.data.variant;
    if (!v || v.available === false) continue;
    const pin = await (await api.get(`pincodes/info/${PINCODE}?product_id=${r.id}&variant_id=${v.id}`)).json();
    const bucket = pin.data && pin.data.bucket_name;
    if (!bucket) {
      console.log('no bucket for', r.slug, clip(pin, 300));
      continue;
    }
    const c = await (await api.get(`wallet-service/product/${v.id}/coins`, { headers: { 'x-bucket-name': bucket } })).json();
    console.log('coins', r.slug, r.prodPaymentMode, 'bucket', bucket, clip(c, 400));
    // Raw field names — the client renames them. Prefer a product whose cap is
    // below the shopper's balance, so apply-max does not drain the wallet.
    const cap = c.data ? Number(c.data.maxRedeemableCoins) : 0;
    const forUser = c.data ? Number(c.data.redeemableCoinsForUser) : 0;
    if (cap > 0 && forUser === cap) {
      found = { row: r, variant: v, bucket, max: forUser };
      break;
    }
  }
  expect(found, 'no product in the first 40 offers redeemable coins').toBeTruthy();

  const { row, variant, bucket, max } = found;
  const H = { 'x-bucket-name': bucket };
  const coinsPath = `wallet-service/product/${variant.id}/coins`;
  console.log(`\nPRODUCT ${row.slug}/${row.variant.bpid} variantId=${variant.id} bucket=${bucket} max=${max}`);

  await call('GET', variantPricingPath(row.slug, variant.id));
  await call('GET', variantPricingPath(row.slug, variant.id), undefined, H);

  const partial = Math.max(1, Math.floor(max / 2));
  await call('POST', `wallet-service/product/${variant.id}/apply`, { coins: partial }, H);
  await call('GET', 'wallet-service/wallet');
  await call('GET', coinsPath, undefined, H);
  await call('GET', variantPricingPath(row.slug, variant.id), undefined, H);
  await call('GET', 'cart?payment_type=UPFRONT');
  // Idempotency: the same apply twice must not hold twice.
  await call('POST', `wallet-service/product/${variant.id}/apply`, { coins: partial }, H);
  await call('GET', 'wallet-service/wallet');
  await call('POST', `wallet-service/product/${variant.id}/remove`, undefined, H);
  await call('GET', 'wallet-service/wallet');
  await call('GET', coinsPath, undefined, H);
  await api.dispose();
});

// Part 2 — where coins surface in the CART. Adds GO4 through the real PDP
// control (the add-to-cart body is not recorded anywhere, so it is captured
// rather than guessed), then reads the cart API and the rendered cart around
// apply / quantity change / remove.
test('measure how applied coins surface in the cart', async ({ page }) => {
  test.setTimeout(240000);
  expect(SITE_HOST, 'stage only').toBe('stage-web.bytepe.com');
  const { clickAddToCart } = require('../utils/buyRow');
  const { BASE_URL } = require('../data/env');

  const SLUG = 'go-4-wireless-ultra-portable-bluetooth-speaker';
  const BPID = 'JBLAUAUDWHFY5Z';
  const VARIANT = '2f3949c7-9ca3-4655-b80d-7ad4e1bf5cf9';
  const H = { 'x-bucket-name': 'GOLD' };
  const api = page.request;
  const A = (p) => `${BASE_API_URL}/${p}`;
  const pick = (o) => {
    // Every key anywhere in the payload that mentions coin / payable, with its value.
    const out = {};
    const walk = (v, path) => {
      if (v && typeof v === 'object') for (const k of Object.keys(v)) walk(v[k], path ? `${path}.${k}` : k);
      else if (/coin|payable|total_amount|total_MRP|total_discount|quantity/i.test(path)) out[path] = v;
    };
    walk(o, '');
    return out;
  };
  const cart = async (label) => {
    const j = await (await api.get(A('cart?payment_type=UPFRONT'))).json();
    console.log(`\nCART ${label}\n${JSON.stringify(pick(j), null, 0).slice(0, 2500)}`);
    return j;
  };

  const adds = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/api\/cart(\?|$)/.test(r.url())) adds.push({ url: r.url(), body: r.postData() });
  });
  await page.goto(`${BASE_URL}/pd/${SLUG}/${BPID}`, { waitUntil: 'domcontentloaded' });
  await page.getByText(/^buy now$/i).first().waitFor({ state: 'visible', timeout: 60000 });
  const add = page.waitForResponse((r) => r.request().method() === 'POST' && /\/api\/cart(\?|$)/.test(r.url()), { timeout: 30000 });
  // An early click is inert on this site — retry until the POST actually fires.
  for (let i = 0; i < 5 && adds.length === 0; i++) {
    await clickAddToCart(page);
    await page.waitForTimeout(2000);
  }
  const addRes = await add;
  console.log('\nADD', addRes.status(), JSON.stringify(adds), (await addRes.text()).slice(0, 400));

  const before = await cart('after add, no coins');
  const line = before.data.items.find((i) => i.variant_id === VARIANT);
  console.log('\nLINE keys', Object.keys(line || {}).join(','));

  await api.post(A(`wallet-service/product/${VARIANT}/apply`), { data: { coins: 500 }, headers: H });
  await cart('after apply 500');
  await api.put(A(`cart/${line.id}`), { data: { quantity: 2 } });
  await cart('after quantity 2');
  console.log('\nCOINS after qty 2', JSON.stringify((await (await api.get(A(`wallet-service/product/${VARIANT}/coins`), { headers: H })).json()).data));

  await page.goto(`${BASE_URL}/cart`, { waitUntil: 'domcontentloaded' });
  await page.getByText(/bytecoin/i).first().waitFor({ state: 'visible', timeout: 45000 }).catch(() => {});
  const text = await page.locator('body').innerText();
  console.log('\nCART PAGE bytecoin lines:\n' + text.split('\n').filter((l, i, a) => /coin|payable|total|save/i.test(l) || /coin/i.test(a[i - 1] || '')).slice(0, 40).join('\n'));

  await api.put(A(`cart/${line.id}`), { data: { quantity: 1 } });
  await api.post(A(`wallet-service/product/${VARIANT}/remove`), { headers: H });
  await cart('after remove + qty 1');
});

// Part 3 — Buy Now with coins applied, to Review Order and (only with
// BYTEPE_ALLOW_WRITES=1) through create-order. Upfront CART checkout would order
// every line in the shared basket, so this goes through Buy Now and refuses to
// press Continue unless Review Order holds GO4 and nothing else.
test('measure coins through Buy Now -> Review Order -> create-order', async ({ page }) => {
  test.setTimeout(300000);
  expect(SITE_HOST, 'stage only').toBe('stage-web.bytepe.com');
  const { buyNowControl } = require('../utils/buyRow');
  const { BASE_URL } = require('../data/env');
  const { watchCreateOrder, readCreateOrder } = require('../utils/createOrder');

  const SLUG = 'go-4-wireless-ultra-portable-bluetooth-speaker';
  const BPID = 'JBLAUAUDWHFY5Z';
  const VARIANT = '2f3949c7-9ca3-4655-b80d-7ad4e1bf5cf9';
  const H = { 'x-bucket-name': 'GOLD' };
  const A = (p) => `${BASE_API_URL}/${p}`;
  const api = page.request;
  const wallet = async (label) => {
    const w = (await (await api.get(A('wallet-service/wallet'))).json()).data;
    const l = (await (await api.get(A('wallet-service/wallet/ledger?page=1&limit=5'))).json()).data.items;
    console.log(`\nWALLET ${label} available=${w.availableBalance} redeemable=${w.redeemableCoins}\n` +
      l.map((x) => `  ${x.createdAt} ${x.entryType} ${x.coinAmount} ${x.productName} ${x.orderId} ${x.status}`).join('\n'));
  };

  const api_calls = [];
  page.on('response', async (r) => {
    const u = r.url();
    if (/\/api\/(cart|customer-order|payments|wallet-service|orders?)/.test(u)) {
      let body = '';
      try { body = (await r.text()).slice(0, 1200); } catch { /* navigated */ }
      api_calls.push(`${r.request().method()} ${r.status()} ${u.replace(BASE_URL, '')}\n   req=${(r.request().postData() || '').slice(0, 300)}\n   res=${body}`);
    }
  });

  await wallet('before');
  const apply = await api.post(A(`wallet-service/product/${VARIANT}/apply`), { data: {}, headers: H });
  console.log('\nAPPLY (max)', apply.status(), await apply.text());

  await page.goto(`${BASE_URL}/pd/${SLUG}/${BPID}`, { waitUntil: 'domcontentloaded' });
  const buy = buyNowControl(page);
  await buy.waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForTimeout(3000); // handler binds after render on this site
  await buy.click();
  await page.waitForURL(/\/review/, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(8000);
  console.log('\nREVIEW URL', page.url());
  const text = await page.locator('body').innerText();
  console.log('\nREVIEW TEXT\n' + text.split('\n').filter((l) => l.trim()).slice(0, 90).join('\n'));
  console.log('\nAPI CALLS SO FAR\n' + api_calls.join('\n'));
  api_calls.length = 0;

  const onlyGo4 = /GO4|Wireless Ultra Portable/i.test(text) &&
    !/iPhone 17|Willen|Nord Buds|Go Essential|Phone \(4b\)/i.test(text);
  console.log('\nREVIEW HOLDS ONLY GO4:', onlyGo4);

  if (process.env.BYTEPE_ALLOW_WRITES === '1' && onlyGo4) {
    const watcher = watchCreateOrder(page);
    await page.getByRole('button', { name: 'Continue' }).click({ timeout: 15000 });
    const verdict = await readCreateOrder(watcher);
    console.log('\nCREATE-ORDER', JSON.stringify(verdict).slice(0, 2500));
    await page.waitForURL(/payment-summary/, { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(8000);
    console.log('\nPAYMENT URL', page.url());
    console.log('\nPAYMENT TEXT\n' + (await page.locator('body').innerText()).split('\n').filter((l) => l.trim()).slice(0, 70).join('\n'));
    console.log('\nAPI CALLS\n' + api_calls.join('\n'));
    const m = page.url().match(/payment-summary\/([^/?#]+)/);
    if (m) {
      const o = await api.get(A(`wallet-service/order/${m[1]}`));
      console.log('\nWALLET ORDER', o.status(), (await o.text()).slice(0, 1500));
    }
    await wallet('after create-order');
  }
  await api.post(A(`wallet-service/product/${VARIANT}/remove`), { headers: H });
  await wallet('after remove');
});

// Part 4 — control order WITHOUT coins, to tell a ByteCoins defect from a
// pre-existing one in Payment Summary pricing. Mints a stage order (writes).
test('control: Buy Now WITHOUT coins -> create-order', async ({ page }) => {
  test.skip(process.env.BYTEPE_ALLOW_WRITES !== '1', 'mints a stage order');
  test.setTimeout(240000);
  expect(SITE_HOST, 'stage only').toBe('stage-web.bytepe.com');
  const { buyNowControl } = require('../utils/buyRow');
  const { BASE_URL } = require('../data/env');
  const { watchCreateOrder, readCreateOrder } = require('../utils/createOrder');
  const VARIANT = '2f3949c7-9ca3-4655-b80d-7ad4e1bf5cf9';
  const A = (p) => `${BASE_API_URL}/${p}`;

  for (const b of ['PLATINUM', 'GOLD']) await page.request.post(A(`wallet-service/product/${VARIANT}/remove`), { headers: { 'x-bucket-name': b } });
  await page.goto(`${BASE_URL}/pd/go-4-wireless-ultra-portable-bluetooth-speaker/JBLAUAUDWHFY5Z`, { waitUntil: 'domcontentloaded' });
  const buy = buyNowControl(page);
  await buy.waitFor({ state: 'visible', timeout: 60000 });
  await expect(async () => {
    await buy.click({ timeout: 5000 });
    await page.waitForURL(/\/review/, { timeout: 5000 });
  }).toPass({ timeout: 60000 });
  await page.getByText(/^total amount$/i).first().waitFor({ state: 'visible', timeout: 45000 });
  const review = await page.locator('body').innerText();
  console.log('REVIEW\n' + review.split('\n').filter((l) => l.trim()).slice(10, 45).join('\n'));
  const reviewCart = (await (await page.request.get(A('cart?payment_type=UPFRONT&is_review=true'))).json()).data;
  const bpids = reviewCart.items.map((i) => i.variant.bpid);
  console.log('REVIEW BPIDS', bpids, 'total_bytecoin_coins', reviewCart.total_bytecoin_coins);
  expect(bpids, 'refusing Continue: review is not GO4 alone').toEqual(['JBLAUAUDWHFY5Z']);
  expect(/bytecoins redeemed/i.test(review), 'refusing Continue: review still redeems coins').toBe(false);

  const watcher = watchCreateOrder(page);
  await page.getByRole('button', { name: 'Continue' }).click({ timeout: 15000 });
  const verdict = await readCreateOrder(watcher);
  console.log('CREATE-ORDER', verdict.status, (verdict.body || '').slice(0, 800));
  await page.waitForURL(/payment-summary/, { timeout: 60000 });
  console.log('MASTER_ORDER_ID=' + new URL(page.url()).searchParams.get('master_order_id'));
  // Leave the basket as found: drop the is_review line Buy Now wrote.
  const cart = (await (await page.request.get(A('cart?payment_type=UPFRONT'))).json()).data;
  const line = (cart.items || []).find((i) => i.variant_id === VARIANT);
  if (line) await page.request.put(A(`cart/remove/${line.id}`), { data: { product_id: line.product_id, variant_id: line.variant_id } });
});
