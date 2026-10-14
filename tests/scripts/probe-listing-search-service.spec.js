// tests/scripts/probe-listing-search-service.spec.js
//
// DIAGNOSTIC. /all-products moved from product-service to search-service. Records
// the client's own listing calls, scrolls to the end, and compares rendered
// tiles with the product-service catalogue by slug and by slug/bpid. Logged out.
const { test } = require('@playwright/test');

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ retries: 0 });
const HOST = 'https://www.bytepe.com';

test('listing: search-service calls vs product-service catalogue', async ({ page, request }) => {
  test.setTimeout(300000);
  const cat = [];
  for (let p = 1; p <= 5; p++) {
    const items = (await (await request.get(`${HOST}/api/product-service/apps/products?page=${p}&limit=100`)).json()).data?.items || [];
    cat.push(...items);
    if (items.length < 100) break;
  }
  const calls = [];
  page.on('response', async (res) => {
    if (!res.url().includes('/search-service/products')) return;
    let n = '?';
    try { const b = await res.json(); n = JSON.stringify(Object.keys(b.data || {})) + ' items=' + (b.data?.items || b.data?.products || []).length + ' total=' + (b.data?.total ?? b.data?.pagination?.total ?? b.total); } catch {}
    calls.push(`${res.status()} ${res.url().replace(HOST, '')} -> ${n}`);
  });
  await page.goto(`${HOST}/all-products`, { waitUntil: 'domcontentloaded' });
  await page.locator('a[href*="/pd/"]').first().waitFor({ timeout: 30000 });
  let last = 0, stable = 0;
  for (let i = 0; i < 150 && stable < 10; i++) {
    const n = await page.locator('a[href*="/pd/"]').count();
    stable = n === last ? stable + 1 : 0; last = n;
    await page.mouse.wheel(0, 4000);
    await page.waitForTimeout(900);
  }
  const hrefs = await page.locator('a[href*="/pd/"]').evaluateAll((els) => els.map((e) => e.getAttribute('href')));
  const tiles = new Map();
  for (const h of hrefs) { const m = /\/pd\/([^/?]+)\/([^/?]+)/.exec(h || ''); if (m) tiles.set(m[1], m[2]); }
  console.log(calls.slice(0, 4).join('\n') + `\n... ${calls.length} search-service calls, statuses ${[...new Set(calls.map((c) => c.slice(0, 3)))]}`);
  const missingSlug = cat.filter((r) => !tiles.has(r.slug));
  const diffBpid = cat.filter((r) => tiles.has(r.slug) && tiles.get(r.slug) !== r.variant.bpid);
  const extra = [...tiles.keys()].filter((s) => !cat.some((r) => r.slug === s));
  console.log(`catalogue ${cat.length}, tiles ${tiles.size} unique slugs; missing by slug ${missingSlug.length}; same slug different bpid ${diffBpid.length}; tiles not in catalogue ${extra.length}`);
  missingSlug.slice(0, 10).forEach((r) => console.log(`  MISSING ${r.name} /pd/${r.slug}/${r.variant.bpid}`));
  diffBpid.slice(0, 8).forEach((r) => console.log(`  BPID ${r.name}: catalogue ${r.variant.bpid} (master=${r.variant.isMaster}) tile ${tiles.get(r.slug)}`));
  extra.slice(0, 5).forEach((s) => console.log(`  EXTRA ${s}`));
});

test('tile variant vs master: stock and price', async ({ request }) => {
  test.setTimeout(300000);
  const cat = [];
  for (let p = 1; p <= 5; p++) {
    const items = (await (await request.get(`${HOST}/api/product-service/apps/products?page=${p}&limit=100`)).json()).data?.items || [];
    cat.push(...items);
    if (items.length < 100) break;
  }
  const tiles = new Map();
  for (let p = 1; p <= 40; p++) {
    const items = (await (await request.get(`${HOST}/api/search-service/products?page=${p}&limit=12`)).json()).data?.items || [];
    items.forEach((r) => tiles.set(r.slug, r));
    if (items.length < 12) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const tally = {};
  for (const r of cat) {
    const t = tiles.get(r.slug);
    const tb = t?.variant?.bpid;
    if (!t || tb === r.variant.bpid) continue;
    const av = (await (await request.get(`${HOST}/api/product-service/apps/products/${r.slug}/available`)).json()).data?.variants || [];
    const m = av.find((v) => v.bpid === r.variant.bpid);
    const tv = av.find((v) => v.bpid === tb);
    const key = `master available=${m?.available} / tile available=${tv?.available} tileIsMaster=${tv?.isMaster}`;
    tally[key] = (tally[key] || 0) + 1;
    console.log(`${r.name}: master ${r.variant.bpid} avail=${m?.available} mop=${r.price?.mop} | tile ${tb} avail=${tv?.available} mop=${t.price?.mop}`);
    await new Promise((res) => setTimeout(res, 700));
  }
  console.log(JSON.stringify(tally, null, 1));
});

test('the unpriced tile: what tile and PDP show', async ({ page, request }) => {
  test.setTimeout(120000);
  const slug = 'mens-lace-ups-sneakers-shoes';
  const bpid = 'CLXFWMFXR5HKE3';
  const pdp = (await (await request.get(`${HOST}/api/product-service/apps/products/by-slug/${slug}/${bpid}`)).json()).data;
  const pr = await request.get(`${HOST}/api/apps/variant-pricing/${slug}/${pdp.variant.id}`);
  const pj = await pr.json().catch(() => ({}));
  console.log(`variant stock=${pdp.variant.stock} available=${pdp.variant.available} isMaster=${pdp.variant.isMaster}`);
  console.log(`variant-pricing ${pr.status()} upfront=${JSON.stringify(pj.data?.upfront)?.slice(0, 200)} msg=${pj.message}`);
  await page.goto(`${HOST}/all-products`, { waitUntil: 'domcontentloaded' });
  const tile = page.locator(`a[href*="/pd/${slug}/"]`).first();
  for (let i = 0; i < 60 && !(await tile.count()); i++) {
    await page.mouse.wheel(0, 4000);
    await page.waitForTimeout(800);
  }
  await tile.scrollIntoViewIfNeeded();
  console.log(`TILE TEXT: ${(await tile.innerText()).replace(/\s+/g, ' ')}`);
  await tile.screenshot({ path: 'test-results/unpriced-tile.png' });
  await page.goto(`${HOST}/pd/${slug}/${bpid}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Buy Now', exact: true }).waitFor({ timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(3000);
  const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  console.log(`PDP: ${body.slice(body.indexOf('Lace'), body.indexOf('Lace') + 400)}`);
  for (const n of ['Buy Now', 'Add to cart', 'Sold Out']) {
    const b = page.getByRole('button', { name: n, exact: true });
    console.log(`${n}: ${await b.count()} enabled=${(await b.count()) ? await b.first().isEnabled() : '-'}`);
  }
});

test('tile text: how many parse, and how fast the listing fills', async ({ page }) => {
  test.setTimeout(300000);
  const { parsePlpTile } = require('../utils/priceText');
  await page.goto(`${HOST}/all-products`, { waitUntil: 'domcontentloaded' });
  await page.locator('a[href*="/pd/"]').first().waitFor({ timeout: 30000 });
  const t0 = Date.now();
  let last = 0, longestStall = 0, stallStart = Date.now();
  for (let i = 0; i < 200; i++) {
    const n = await page.locator('a[href*="/pd/"]').count();
    if (n !== last) { longestStall = Math.max(longestStall, Date.now() - stallStart); stallStart = Date.now(); last = n; }
    if (n >= 302 || Date.now() - stallStart > 20000) break;
    await page.mouse.wheel(0, 4000);
    await page.waitForTimeout(1200);
  }
  console.log(`reached ${last} tiles in ${Date.now() - t0}ms, longest stall between growth ${longestStall}ms`);
  const texts = await page.locator('a[href*="/pd/"]').evaluateAll((els) => els.map((e) => e.innerText));
  const bad = texts.filter((t) => !parsePlpTile(t));
  console.log(`unparsed ${bad.length}/${texts.length}`);
  bad.slice(0, 5).forEach((t) => console.log(`  ${JSON.stringify(t.replace(/\s+/g, ' ').slice(0, 120))}`));
});

test('PDP with variant-pricing blocked: what renders now', async ({ page }) => {
  test.setTimeout(120000);
  await page.route('**/api/apps/variant-pricing/**', (r) => r.fulfill({ status: 500, body: '{}' }));
  for (const url of ['/pd/the-urban-knits-sneaker-for-men', '/pd/jbl-flip-7/JBLAUAUD10QE32']) {
    await page.goto(HOST + url, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Buy Now', exact: true }).waitFor({ timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(4000);
    const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    const i = body.search(/₹/);
    console.log(`${page.url().replace(HOST, '')}\n  ${body.slice(Math.max(0, i - 80), i + 260)}`);
    console.log(`  undefinedmo: ${/undefinedmo/.test(body)}  "₹0 x": ${/₹0 x/.test(body)}  See Plans: ${/See Plans/.test(body)}`);
  }
});
