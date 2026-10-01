// tests/scripts/probe-site-changes.spec.js
//
// DIAGNOSTIC. Snapshot of what the live site serves right now, so a diff
// against what the suite reads shows new features and drift. Logged out,
// read-only — GETs and page loads only, nothing is clicked that writes.
//
// Writes PROBE_OUT (default test-results/site-changes.json):
//   listing    row count, key paths, tag / rating / mode counts
//   payloads   key paths of the PDP, variant-pricing and product-vas payloads
//              over a sample spanning payment modes and tags
//   pages      per route: button names, headings, nav links, API paths called
const fs = require('fs');
const path = require('path');
const { test } = require('@playwright/test');

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ mode: 'serial', retries: 0 });

const HOST = 'https://www.bytepe.com';
const OUT = process.env.PROBE_OUT || path.join('test-results', 'site-changes.json');
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

// Every key path in a value, arrays collapsed to [] so 200 rows give one shape.
function keyPaths(value, prefix = '', acc = new Set()) {
  if (Array.isArray(value)) {
    value.forEach((v) => keyPaths(v, `${prefix}[]`, acc));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      const p = prefix ? `${prefix}.${k}` : k;
      acc.add(p);
      keyPaths(v, p, acc);
    }
  }
  return acc;
}

const report = { at: new Date().toISOString(), listing: {}, payloads: {}, pages: {} };
let rows = [];

test('listing: rows, shape, tags, modes', async ({ request }) => {
  test.setTimeout(120000);
  for (let page = 1; page <= 10; page++) {
    const res = await request.get(`${HOST}/api/product-service/apps/products?page=${page}&limit=100`);
    if (!res.ok()) {
      report.listing[`page${page}Status`] = res.status();
      break;
    }
    const items = (await res.json()).data?.items || [];
    rows.push(...items);
    if (items.length < 100) break;
    await pause(1000);
  }
  const count = (fn) => rows.reduce((m, r) => {
    for (const k of [].concat(fn(r) ?? [])) m[k] = (m[k] || 0) + 1;
    return m;
  }, {});
  Object.assign(report.listing, {
    rows: rows.length,
    uniqueBpids: new Set(rows.map((r) => r.variant?.bpid)).size,
    keys: [...keyPaths(rows)].sort(),
    tags: count((r) => (r.variant?.tags || []).map((t) => t.name)),
    paymentModes: count((r) => r.prodPaymentMode ?? r.product?.prodPaymentMode ?? 'unknown'),
    rated: rows.filter((r) => r.rating != null).length,
    withVas: rows.filter((r) => (r.vas || []).length).length,
    brands: Object.keys(count((r) => r.brand?.name || r.brand?.slug || '?')).length,
  });
  console.log(JSON.stringify({ ...report.listing, keys: report.listing.keys.length }, null, 1));
});

test('payloads: PDP, variant-pricing, product-vas shapes', async ({ request }) => {
  test.setTimeout(300000);
  // One of each mode and each tag, then pad from across the listing.
  const pick = new Map();
  const add = (r) => r && pick.size < 16 && pick.set(r.variant?.bpid, r);
  const modeOf = (r) => r.prodPaymentMode ?? r.product?.prodPaymentMode;
  for (const mode of new Set(rows.map(modeOf))) add(rows.find((r) => modeOf(r) === mode));
  for (const tag of new Set(rows.flatMap((r) => (r.variant?.tags || []).map((t) => t.name)))) {
    add(rows.find((r) => (r.variant?.tags || []).some((t) => t.name === tag)));
  }
  add(rows.find((r) => r.rating != null));
  add(rows.find((r) => (r.vas || []).length));
  for (let i = 0; i < rows.length && pick.size < 16; i += Math.ceil(rows.length / 10)) add(rows[i]);

  const shapes = { pdp: new Set(), pricing: new Set(), vas: new Set() };
  const samples = [];
  for (const r of pick.values()) {
    const slug = r.slug;
    const bpid = r.variant?.bpid;
    const pdpRes = await request.get(`${HOST}/api/product-service/apps/products/by-slug/${slug}/${bpid}`);
    const pdp = pdpRes.ok() ? (await pdpRes.json()).data : null;
    keyPaths(pdp, '', shapes.pdp);
    await pause(1000);
    const variantId = pdp?.variant?._id || pdp?.variant?.id;
    let pricingStatus = null;
    if (variantId) {
      const pr = await request.get(`${HOST}/api/apps/variant-pricing/${slug}/${variantId}`);
      pricingStatus = pr.status();
      if (pr.ok()) keyPaths((await pr.json()).data, '', shapes.pricing);
      await pause(1000);
    }
    const vr = await request.get(`${HOST}/api/apps/product-vas/${slug}/${bpid}`);
    if (vr.ok()) keyPaths((await vr.json()).data, '', shapes.vas);
    await pause(1000);
    samples.push({
      name: r.name, slug, bpid, mode: modeOf(r),
      tags: (r.variant?.tags || []).map((t) => t.name),
      pdpStatus: pdpRes.status(), pricingStatus, vasStatus: vr.status(),
      stock: pdp?.variant?.stock, available: pdp?.variant?.available,
    });
  }
  report.payloads = {
    samples,
    pdpKeys: [...shapes.pdp].sort(),
    pricingKeys: [...shapes.pricing].sort(),
    vasKeys: [...shapes.vas].sort(),
  };
  console.table(samples);
});

test('pages: controls, headings, API calls', async ({ page }) => {
  test.setTimeout(300000);
  const modeOf = (r) => r.prodPaymentMode ?? r.product?.prodPaymentMode;
  const pdpOf = (pred) => {
    const r = rows.find(pred);
    return r && `/pd/${r.slug}/${r.variant.bpid}`;
  };
  const routes = {
    home: '/',
    subscription: '/home/subscription',
    emiStore: '/home/emi-store',
    listing: '/all-products',
    pdpUpfront: pdpOf((r) => modeOf(r) === 'UPFRONT' && !(r.variant?.tags || []).length),
    pdpBoth: pdpOf((r) => modeOf(r) === 'BOTH'),
    pdpTagged: pdpOf((r) => (r.variant?.tags || []).length),
    cartLoggedOut: '/cart',
  };

  for (const [name, route] of Object.entries(routes)) {
    if (!route) continue;
    const apis = new Set();
    const onReq = (req) => {
      const u = new URL(req.url());
      if (u.hostname.endsWith('bytepe.com') && u.pathname.startsWith('/api/')) {
        apis.add(`${req.method()} ${u.pathname.replace(/[A-Z0-9]{14}|[0-9a-f]{24}|[0-9a-f-]{36}/g, ':id')}`);
      }
    };
    page.on('request', onReq);
    const res = await page.goto(HOST + route, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => {});
    await page.mouse.wheel(0, 4000);
    await pause(2500);
    page.off('request', onReq);

    report.pages[name] = {
      route,
      status: res?.status(),
      finalUrl: page.url().replace(HOST, ''),
      ...(await page.evaluate(() => {
        const visible = (el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden';
        };
        const name = (el) =>
          (el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || '')
            .replace(/\s+/g, ' ').trim().slice(0, 60);
        const uniq = (a) => [...new Set(a.filter(Boolean))];
        return {
          buttons: uniq([...document.querySelectorAll('button,[role=button]')].filter(visible).map(name)),
          unlabelledButtons: [...document.querySelectorAll('button')].filter(visible).filter((b) => !name(b)).length,
          headings: uniq([...document.querySelectorAll('h1,h2,h3')].filter(visible).map(name)),
          navLinks: uniq([...document.querySelectorAll('header a, nav a')].map((a) => a.getAttribute('href'))),
          dialogs: uniq([...document.querySelectorAll('[role=dialog],.MuiDrawer-paper,.MuiDialog-paper')].filter(visible).map(name)),
          headers: document.querySelectorAll('header').length,
          testIds: uniq([...document.querySelectorAll('[data-testid]')].map((e) => e.dataset.testid)),
        };
      })),
      apis: [...apis].sort(),
    };
    console.log(`${name} ${route} -> ${report.pages[name].status}, ${report.pages[name].buttons.length} buttons, ${apis.size} api paths`);
    await pause(1500);
  }

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 1));
  console.log(`wrote ${OUT}`);
});
