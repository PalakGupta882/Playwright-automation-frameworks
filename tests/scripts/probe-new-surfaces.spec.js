// tests/scripts/probe-new-surfaces.spec.js
//
// DIAGNOSTIC. Follows up probe-site-changes: reads the response bodies of the
// endpoints the PDP now calls that no spec reads, and counts media players on
// the routes that showed "Play ..." controls. Logged out, GETs and page loads
// only — the wishlist control is located, never clicked.
const { test } = require('@playwright/test');

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ mode: 'serial', retries: 0 });

const HOST = 'https://www.bytepe.com';
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const brief = (v) => String(JSON.stringify(v)).slice(0, 700);

test('New Launch products: pre-booking flags and pricing gate', async ({ request }) => {
  test.setTimeout(240000);
  const rows = [];
  for (let page = 1; page <= 5; page++) {
    const items = (await (await request.get(`${HOST}/api/product-service/apps/products?page=${page}&limit=100`)).json()).data?.items || [];
    rows.push(...items);
    if (items.length < 100) break;
    await pause(1000);
  }
  const tagged = rows.filter((r) => (r.variant?.tags || []).length);
  console.log(`tagged ${tagged.length}/${rows.length}; tag shape: ${brief(tagged[0]?.variant.tags)}`);
  for (const r of tagged) {
    const pdp = (await (await request.get(`${HOST}/api/product-service/apps/products/by-slug/${r.slug}/${r.variant.bpid}`)).json()).data;
    await pause(800);
    const pr = (await (await request.get(`${HOST}/api/apps/variant-pricing/${r.slug}/${pdp.variant.id}`)).json()).data || {};
    await pause(800);
    console.log(
      `${r.name} | ${r.prodPaymentMode} | prebook=${pdp.product.isPrebookingAllow} launch=${pdp.product.launchDate} ` +
      `access=${pdp.product.normalOrderAccess} | pricing: can_place=${pr.can_place_normal_order} access=${pr.normal_order_access} prebooking=${brief(pr.prebooking)} | mop=${r.price?.mop}`
    );
  }
  const vasRows = rows.filter((r) => (r.vas || []).length);
  console.log(`rows with vas[]: ${vasRows.length} -> ${vasRows.map((r) => `${r.name}: ${r.vas.join(', ')}`).join(' ; ')}`);
  const avail = rows.reduce((m, r) => ((m[JSON.stringify(r.availableFor)] = (m[JSON.stringify(r.availableFor)] || 0) + 1), m), {});
  console.log(`availableFor values: ${JSON.stringify(avail)}`);
});

test('PDP side endpoints: bodies', async ({ page }) => {
  test.setTimeout(120000);
  const bodies = {};
  page.on('response', async (res) => {
    const u = new URL(res.url());
    if (!u.pathname.startsWith('/api/')) return;
    const key = u.pathname
      .replace(/\/pd\/.*/, '')
      .replace(/(variant-offers|variant-pricing|product-vas|by-slug)\/.*/, '$1')
      .replace(/approved_product_review\/.*/, 'approved_product_review')
      .replace(/products\/[^/]+\/(available|attributes)/, 'products/:slug/$1');
    if (bodies[key]) return;
    try {
      bodies[key] = `${res.request().method()} ${res.status()} ${u.search} :: ${brief(await res.json())}`;
    } catch {
      bodies[key] = `${res.status()} (non-json)`;
    }
  });
  await page.goto(`${HOST}/pd/watch-ultra-4/APPSMSMA5WNTNY`, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('load').catch(() => {});
  await page.mouse.wheel(0, 5000);
  await pause(3000);
  for (const k of ['best-price', 'variant-offers', 'approved_product_review', 'available', 'max-price', 'faq', 'pg-config']) {
    const hit = Object.entries(bodies).find(([p]) => p.includes(k));
    console.log(`\n[${k}] ${hit ? `${hit[0]}\n  ${hit[1]}` : 'not called'}`);
  }

  const wish = page.getByRole('button', { name: 'Add to wishlist' });
  console.log(`\nwishlist buttons: ${await wish.count()}`);
  const body = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  for (const re of [/Ratings?[^.]{0,80}/i, /Reviews?[^.]{0,80}/i, /Offers?[^.]{0,120}/i, /No Cost EMI discount[^.]{0,100}/i, /Exchange[^.]{0,100}/i, /New Launch[^.]{0,40}/i]) {
    console.log(`text ${re.source.slice(0, 20)} -> ${(body.match(re) || ['(none)'])[0]}`);
  }
  console.log(`<video> on PDP: ${await page.locator('video').count()}`);
});

test('home routes: video players behind the Play controls', async ({ page }) => {
  test.setTimeout(120000);
  for (const route of ['/', '/home/subscription', '/home/emi-store']) {
    await page.goto(HOST + route, { waitUntil: 'domcontentloaded' });
    await page.waitForLoadState('load').catch(() => {});
    await page.mouse.wheel(0, 4000);
    await pause(2500);
    const info = await page.evaluate(() => ({
      videos: [...document.querySelectorAll('video')].map((v) => ({
        src: (v.currentSrc || v.src || '').slice(0, 60), autoplay: v.autoplay, muted: v.muted,
        controls: v.controls, playsInline: v.playsInline, poster: !!v.poster, preload: v.preload,
      })),
      play: [...document.querySelectorAll('[aria-label^="Play"]')].map((b) => b.getAttribute('aria-label')),
    }));
    console.log(`${route}: ${info.videos.length} <video>, ${info.play.length} Play controls\n  ${JSON.stringify(info.videos.slice(0, 3))}`);
    await pause(1500);
  }
});
