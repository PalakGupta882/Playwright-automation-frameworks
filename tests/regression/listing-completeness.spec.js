// tests/regression/listing-completeness.spec.js
//
// Can a shopper who browses /all-products actually reach every product the
// catalogue holds?
//
// WHY THIS IS ITS OWN FILE, AND NOT A TOLERANCE IN pricing-consistency.
// pricing-consistency's readListing() already counts tiles, and it carries a
// SHORTFALL_TOLERANCE of 0.85 with a long comment explaining that 89% is inside
// the normal range. That number is calibrated for the right question in that
// file — "is this scrape complete enough for the sweeps below to mean
// anything?" — and it deliberately tolerates a shortfall so a partial scrape
// does not fail six pricing tests for a reason that is not pricing.
//
// It is the WRONG question here, and reading the tolerance as "a listing that
// renders 89% of the catalogue is healthy" is how this went unnoticed. It is
// not scrape flakiness. Measured 2 Sep 2026, one worker, quiet origin, five
// consecutive loads of /all-products:
//
//   217 / 217     complete
//   217 / 217     complete
//   205 / 217     API page 12 missing entirely
//   193 / 217     API pages 5 and 13 missing entirely
//   180 / 217     API pages 3, 5, 12 and the 1-item tail page 19 missing
//
// The shortfall is always a whole PAGE of 12, never a scattering of tiles. The
// API is not at fault and was ruled out first: pages 1..19 at limit=12 serve
// 217 unique products with zero duplicates, ordering is stable across repeat
// calls, and the client is observed REQUESTING all 18 follow-up pages on every
// load. The response arrives and the render drops it — a lost state update in
// the infinite scroll, not a missing fetch and not rate limiting.
//
// What it costs the shopper is not evenly distributed. The 12 products lost on
// one measured load were:
//
//   iPhone 17 Pro Max · iPhone 17 Pro · iPhone Air · iPhone 17 · iPhone 15
//   Galaxy Z Fold7 · Galaxy Z Flip7 · Pixel 10 · iPad (A16) 11th Gen
//   AirPods Pro 3rd Gen · AirPods 4 (ANC) · AirPods 4
//
// — an entire page of flagships, unreachable by browsing. They still resolve by
// direct URL and by search, so nothing else in the suite can see this: every
// other spec reaches a product through the API or a known slug.
//
// Public and logged out. Which products the catalogue lists is configuration,
// identical for every shopper, so this is a candidate for the CI public list.

const { test, expect } = require('../fixtures/pageFixtures');
const { BASE_URL, BASE_API_URL } = require('../data/constants');
const { getWithRetry } = require('../utils/apiRetry');

test.use({ storageState: { cookies: [], origins: [] } });

// The page size the CLIENT uses, read off its own network calls — the storefront
// requests `?page=N&limit=12`. Sweeping at limit=100 (what catalogue-integrity
// does) would not reproduce this: the defect is per rendered page, so the
// comparison has to be made against the same pagination the browser walks.
const CLIENT_PAGE_SIZE = 12;

const listingPage = (page) =>
  `product-service/apps/products?page=${page}&limit=${CLIENT_PAGE_SIZE}`;

// Three loads. The defect is intermittent — 2 of 5 measured loads were clean —
// so a single load can pass on a page that is broken for the next shopper.
// Three is what fits in the time budget while making a clean run mean something;
// at the measured rate a fully clean spec run is roughly a one-in-ten event.
//
// Deliberately NOT wrapped in Playwright retries: a retry would re-roll the dice
// and report the flaky pass, which is exactly the outcome the loop exists to
// prevent.
const LOADS = 3;

test.describe('Listing completeness', () => {
  test.describe.configure({ retries: 0 });

  /** @type {import('@playwright/test').APIRequestContext} */
  let api;
  /** @type {Map<string, number>} key "slug/bpid" -> the API page it arrives on */
  const apiPageOf = new Map();
  let catalogueCount = null;

  test.beforeAll(async ({ playwright }) => {
    // storageState passed explicitly rather than inherited from the config, for
    // the reason apiHelper.js records: an "anonymous" context that silently
    // comes up logged in behaves differently locally and in CI.
    api = await playwright.request.newContext({
      baseURL: `${BASE_API_URL.replace(/\/+$/, '')}/`,
      storageState: { cookies: [], origins: [] },
    });

    for (let page = 1; page <= 40; page++) {
      const res = await getWithRetry(api, listingPage(page), { failOnStatusCode: false });
      expect(res.status(), `listing page ${page} did not return 200`).toBe(200);
      const body = await res.json();
      const items = (body && body.data && body.data.items) || [];
      if (catalogueCount === null) catalogueCount = body && body.data && body.data.count;
      for (const item of items) {
        apiPageOf.set(`${item.slug}/${item.variant.bpid}`, page);
      }
      if (items.length < CLIENT_PAGE_SIZE) break;
    }
  });

  test.afterAll(async () => {
    await api.dispose();
  });

  // NON-VACUITY, AND THE FIRST STEP OF THE DIAGNOSIS IN ONE.
  //
  // The UI test below is only allowed to blame the client if the API is known
  // good, so this runs first and states the API's side of it: every page the
  // client walks is served, the pages sum to the count the API itself reports,
  // and no product is served twice. If this fails, the shortfall downstream is
  // a pagination fault and the UI is innocent.
  test('the paged API the listing walks serves the whole catalogue exactly once', () => {
    expect(apiPageOf.size, 'the listing API returned nothing to check').toBeGreaterThan(50);

    // count is the API's own answer to "how many are there", alongside the page
    // of items — so this compares the API against itself rather than a fixture.
    if (typeof catalogueCount === 'number') {
      expect(
        apiPageOf.size,
        `paging at limit=${CLIENT_PAGE_SIZE} yielded ${apiPageOf.size} unique products but the ` +
          `API reports a catalogue of ${catalogueCount}. A gap here is a pagination fault — ` +
          'the rows never reach the client at all, so no amount of scrolling would show them.'
      ).toBe(catalogueCount);
    }
  });

  test('every product the catalogue lists is reachable by scrolling /all-products', async ({
    page,
  }) => {
    // Three loads of a lazy listing, each scrolling to the end.
    test.setTimeout(600000);

    const total = apiPageOf.size;
    const runs = [];

    // Cool-down. The hook above just pulled 19 pages out of the same origin,
    // and the first measured run of this file went straight into a load that
    // rendered 12 tiles and then a load that rendered none — the client's own
    // page requests were being refused. That is throttling, and reporting it as
    // a dropped render would be exactly the wrong bug.
    await page.waitForTimeout(5000);

    for (let run = 1; run <= LOADS; run++) {
      // WATCH WHAT THE CLIENT ITSELF GETS BACK.
      //
      // The claim this test makes is specific: the response ARRIVED and the
      // render dropped it. That claim is only available if the fetch is known
      // to have succeeded, so every listing call the page makes is recorded
      // with its status. A page missing because its fetch 429'd is a throttled
      // run, not a defect, and is reported as such below instead of failing.
      const served = new Map(); // api page -> status
      const onResponse = (res) => {
        const m = /apps\/products\?page=(\d+)&limit=(\d+)/.exec(res.url());
        if (m && Number(m[2]) === CLIENT_PAGE_SIZE) served.set(Number(m[1]), res.status());
      };
      page.on('response', onResponse);

      await page.goto(`${BASE_URL}/all-products`, { waitUntil: 'domcontentloaded' });

      // Wait for a real tile, not for a count to settle. A count-based settle
      // accepts zero: nothing has rendered yet, the count is 0 three rounds
      // running, and the loop exits calling an empty listing complete.
      //
      // A listing that renders NO tile is its own outage and not what this file
      // is about, so it is recorded and the loop moves on rather than aborting
      // the run with a bare locator timeout that names the wrong problem.
      const painted = await page
        .locator('a[href*="/pd/"]')
        .first()
        .waitFor({ state: 'visible', timeout: 30000 })
        .then(() => true)
        .catch(() => false);

      if (!painted) {
        page.off('response', onResponse);
        runs.push({ run, rendered: 0, missingByPage: new Map(), served, blank: true });
        console.log(`load ${run}: the listing rendered no tiles at all`);
        continue;
      }

      // Scroll until the catalogue is on screen, or the count stops moving.
      //
      // The stall allowance is generous on purpose. The whole claim of this test
      // is "the page never renders these products", so it must not be possible
      // to read a slow load as a missing one — 12 quiet rounds is ~11s of
      // nothing happening, well past the ~1s cadence of a healthy fetch.
      const STALL_ROUNDS = 12;
      let stable = 0;
      let last = 0;
      for (let i = 0; i < 150; i++) {
        const n = await page.locator('a[href*="/pd/"]').count();
        if (n >= total) break;
        if (n === last && n > 0) {
          if (++stable >= STALL_ROUNDS) break;
        } else {
          stable = 0;
          last = n;
        }
        await page.mouse.wheel(0, 4000);
        await page.waitForTimeout(900);
      }

      // evaluateAll in one round trip. Reading 217 hrefs with .nth(i) is 217
      // protocol calls and takes long enough that the page can lazy-load more
      // tiles underneath the loop, which makes the scrape non-atomic.
      const hrefs = await page
        .locator('a[href*="/pd/"]')
        .evaluateAll((els) => els.map((el) => el.getAttribute('href')));

      const rendered = new Set();
      for (const href of hrefs) {
        const match = /\/pd\/([^/?]+)\/([^/?]+)/.exec(href || '');
        if (match) rendered.add(`${match[1]}/${match[2]}`);
      }

      // Group the misses by the API page they arrive on. A scattering of tiles
      // and a dropped page are different defects with different fixes, and the
      // grouping is what tells them apart — so the failure names which.
      const missingByPage = new Map();
      for (const [key, apiPage] of apiPageOf) {
        if (rendered.has(key)) continue;
        if (!missingByPage.has(apiPage)) missingByPage.set(apiPage, []);
        missingByPage.get(apiPage).push(key);
      }

      page.off('response', onResponse);

      // Split the misses by what the client's own fetch did. Only a page the
      // browser fetched successfully and then failed to show is this defect.
      const dropped = [];
      const throttled = [];
      for (const [apiPage, keys] of missingByPage) {
        const status = served.get(apiPage);
        if (status === 200) dropped.push([apiPage, keys]);
        else throttled.push([apiPage, keys, status === undefined ? 'never requested' : status]);
      }

      runs.push({ run, rendered: rendered.size, missingByPage, dropped, throttled, served });
      console.log(
        `load ${run}: rendered ${rendered.size}/${total}` +
          (dropped.length
            ? ` — DROPPED after a 200 on API page(s) ${dropped.map(([p]) => p).join(', ')}`
            : '') +
          (throttled.length
            ? ` — not served: ${throttled.map(([p, , s]) => `page ${p} (${s})`).join(', ')}`
            : '') +
          (missingByPage.size === 0 ? ' — complete' : '')
      );
    }

    // Reported, never failed on. A run the origin refused to serve says nothing
    // about the render, and failing on it would make this file a throttling
    // detector that cries wolf during a full regression pass.
    const starved = runs.filter((r) => r.blank || r.throttled?.length);
    if (starved.length) {
      console.log(
        `\n${starved.length} of ${LOADS} loads were incomplete because the origin did not serve ` +
          'them. Those pages are excluded from the verdict below — they prove nothing either way.'
      );
    }

    const short = runs.filter((r) => r.dropped && r.dropped.length > 0);

    // NON-VACUITY. If every load was starved or blank, this test checked
    // nothing and must not report a pass.
    const usable = runs.filter((r) => !r.blank && !r.throttled?.length);
    expect(
      usable.length,
      `all ${LOADS} loads of /all-products were throttled or blank, so the render was never ` +
        'actually observed. Re-run on a quiet origin — this is not a pass.'
    ).toBeGreaterThan(0);

    if (short.length === 0) return;

    const detail = short
      .map((r) => {
        const pages = [...r.dropped].sort((a, b) => a[0] - b[0]);
        const whole = pages.filter(([, keys]) => keys.length === CLIENT_PAGE_SIZE);
        const lines = pages.map(
          ([apiPage, keys]) =>
            `    API page ${apiPage} (fetched, HTTP 200): ${keys.length} missing — ` +
            keys.slice(0, 4).join(', ') +
            (keys.length > 4 ? `, +${keys.length - 4} more` : '')
        );
        return (
          `  load ${r.run}: ${r.rendered}/${total} rendered` +
          (whole.length
            ? ` (${whole.length} WHOLE page(s) of ${CLIENT_PAGE_SIZE} dropped)`
            : '') +
          '\n' +
          lines.join('\n')
        );
      })
      .join('\n');

    expect(
      short.length,
      `/all-products fetched products and then did not render them, on ${short.length} of ` +
        `${usable.length} usable loads.\n${detail}\n\n` +
        'Every page listed above returned HTTP 200 to the browser on this very load, so the ' +
        'data reached the client and the render discarded it. The API is not the cause — the ' +
        'test above proves it serves every page exactly once. Those products cannot be reached ' +
        'by browsing at all.'
    ).toBe(0);
  });
});
