// tests/regression/site-health.spec.js
//
// Catalogue-wide crash guard: is every page the catalogue advertises actually
// alive? The existing specs each walk one flow deeply; nothing asked the blunt
// question "does anything 404 across the whole site".
//
// HOW A DEAD PAGE LOOKS HERE — this is the whole reason this file is careful.
// An old or wrong product URL does NOT redirect and does NOT return 404. It
// returns HTTP 200 with the generic site shell. Measured:
//
//   /pd/phone-4b/NOTSMMOBK25WT5          -> 200, 278,884 bytes,
//                                           <title> "Buy Phone (4b) from BytePe…"
//   /pd/this-slug-does-not-exist/ZZZZ…   -> 200,  81,371 bytes,
//                                           <title> "BytePe - India's First Phone…"
//
// So a status check alone reports a dead catalogue as healthy. The <title> is
// the discriminator: a live PDP is titled for its product, a dead one inherits
// the homepage title.
//
// A first attempt at this used a body-text marker (/could not be found/) and
// flagged all 196 pages as broken — including the homepage — because that
// string sits in the JS bundle on every page. Hence the control test below,
// which is what stops that mistake shipping silently.
//
// Public, logged out — this is site availability, identical for everyone.
// API-level, so the whole catalogue costs seconds rather than 186 page loads.

const { test, expect } = require('../fixtures/pageFixtures');
const { BASE_URL } = require('../data/constants');
const { getWithRetry } = require('../utils/apiRetry');
const catalogue = require('../data/products.json');

test.use({ storageState: { cookies: [], origins: [] } });

// The title the site falls back to when a product URL resolves to nothing.
const GENERIC_TITLE = /India.{0,10}s First Phone Subscription Service/i;

const titleOf = (html) => ((html.match(/<title>([^<]*)<\/title>/i) || [])[1] || '').trim();

const CORE_PAGES = ['/', '/home/subscription', '/home/emi-store', '/all-products', '/about-us', '/cart'];

// Fetch with a small worker pool: 186 sequential round trips is slow enough to
// push this past a sane timeout, and unbounded parallelism rate-limits the
// origin (see tests/utils/apiRetry.js).
async function fetchAll(request, urls, concurrency = 4) {
  const results = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < urls.length) {
        const index = next++;
        // getWithRetry, not request.get. Sweeping the whole catalogue while the
        // rest of the suite is also hitting production earns a 429, and a 429 is
        // not a dead page — a full run once reported 122 products as dead when
        // every one of them was simply throttled. Concurrency dropped from 6 to
        // 4 for the same reason.
        const res = await getWithRetry(request, urls[index], {
          failOnStatusCode: false,
          timeout: 30000,
        });
        const status = res.status();
        results[index] = {
          url: urls[index],
          status,
          title: status === 200 ? titleOf(await res.text()) : '',
        };
      }
    })
  );
  return results;
}

const productUrl = (p) => (p.url.startsWith('http') ? p.url : `${BASE_URL}${p.url}`);
const products = catalogue.products || catalogue;

test.describe('Site health', () => {
  // CONTROL — proves the detector can actually detect a dead page.
  //
  // Without this, the catalogue test below is unfalsifiable: if the rule were
  // wrong in the lenient direction it would report a completely broken site as
  // healthy and nobody would know. This must fail on a URL that is known dead.
  test('a known-dead product URL is recognised as dead', async ({ request }) => {
    test.setTimeout(60000);

    const res = await request.get(
      `${BASE_URL}/pd/this-slug-does-not-exist/ZZZZZZZZZZ`,
      { failOnStatusCode: false }
    );

    // Documents the surprising part: it is a 200, not a 404.
    expect(res.status(), 'a dead product URL is expected to return 200, not 404').toBe(200);
    expect(
      titleOf(await res.text()),
      'the dead-page detector no longer recognises a dead page — every other ' +
        'assertion in this file is worthless until this is fixed'
    ).toMatch(GENERIC_TITLE);
  });

  // PRESENCE — a live product page must NOT look like the dead one above.
  test('a known-good product URL is recognised as live', async ({ request }) => {
    test.setTimeout(60000);

    const res = await request.get(productUrl(products[0]), { failOnStatusCode: false });
    expect(res.status()).toBe(200);
    expect(titleOf(await res.text())).not.toMatch(GENERIC_TITLE);
  });

  test('every core page responds', async ({ request }) => {
    test.setTimeout(120000);

    const results = await fetchAll(request, CORE_PAGES.map(p => `${BASE_URL}${p}`));
    const broken = results.filter(r => r.status !== 200);

    expect(broken.map(r => `${r.status} ${r.url}`), 'core pages that did not return 200').toEqual([]);
  });

  // The blunt question. Reports every dead page by name rather than failing on
  // the first, so one run tells you the full extent of a catalogue break.
  test('every product page in the catalogue is alive', async ({ request }) => {
    test.setTimeout(300000);

    // Guards the guard: an empty catalogue file would make the assertion below
    // pass against nothing at all.
    expect(products.length, 'products.json is empty — nothing was checked').toBeGreaterThan(50);

    const results = await fetchAll(request, products.map(productUrl));

    const dead = results
      .map((r, i) => ({ ...r, name: products[i].name }))
      .filter(r => r.status !== 200 || GENERIC_TITLE.test(r.title))
      .map(r => `${r.name} -> ${r.status} ${r.url}`);

    console.log(`checked ${results.length} product pages, ${dead.length} dead`);

    expect(
      dead,
      'these product pages resolve to the generic shell rather than a product. ' +
        'Usually catalogue drift, not an outage — re-run npm run discover and ' +
        'confirm before reporting a bug'
    ).toEqual([]);
  });
});
