const { test } = require('../fixtures/pageFixtures');
const { BASE_API_URL, BASE_URL } = require('../data/constants');

// DIAGNOSTIC. How hard does the storefront throttle a SINGLE ordinary visitor?
//
// Every 429 the suite has hit so far was assumed to be our own parallelism. But
// the loader probe saw 429s from ONE browser doing ONE page load, on requests
// the page issues itself (/api/users/me, the filters call, and Next.js _rsc
// route prefetches). If the limiter trips at browsing speed, a real shopper
// clicking through the catalogue sees the same thing, and every spec in this
// repo will keep failing for reasons that have nothing to do with what it tests.
//
// Two questions, measured separately:
//   1. Cold browser, one page load -- how many 429s does the page cause itself?
//   2. Sequential GETs at a fixed pace -- at which request does 429 start?
//
// Read-only, logged out.

test.use({ storageState: { cookies: [], origins: [] } });

test('probe: 429s caused by a single cold page load', async ({ page }) => {
  test.setTimeout(180000);

  for (const path of ['/', '/all-products']) {
    const seen = [];
    const onResponse = (r) => {
      if (r.status() === 429) seen.push(r.url().replace(BASE_URL, '').slice(0, 100));
    };
    page.on('response', onResponse);
    await page.goto(BASE_URL + path, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(12000);
    page.off('response', onResponse);

    console.log(`\n--- cold load of ${path}: ${seen.length} response(s) with HTTP 429`);
    const counts = new Map();
    for (const u of seen) counts.set(u, (counts.get(u) || 0) + 1);
    for (const [u, n] of [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) {
      console.log(`    x${n}  ${u}`);
    }
    // Let the limiter's window drain before the next page.
    await page.waitForTimeout(20000);
  }
});

test('probe: how many sequential GETs before 429', async ({ request }) => {
  test.setTimeout(300000);

  // A public, cacheable catalogue endpoint. Paced like a person clicking, not
  // like a load test.
  const url = `${BASE_API_URL}/product-service/apps/master-categories`;

  for (const gapMs of [1000, 300]) {
    let first429 = null;
    let ok = 0;
    const statuses = [];
    for (let i = 1; i <= 30; i++) {
      const res = await request.get(url, { timeout: 20000 });
      statuses.push(res.status());
      if (res.status() === 200) ok++;
      if (res.status() === 429 && first429 === null) first429 = i;
      await new Promise((r) => setTimeout(r, gapMs));
    }
    console.log(`\n--- 30 sequential GETs, ${gapMs}ms apart`);
    console.log(`    200s: ${ok}/30`);
    console.log(`    first 429 at request #: ${first429 === null ? 'never' : first429}`);
    console.log(`    sequence: ${statuses.join(' ')}`);
    // Drain before the next pace.
    await new Promise((r) => setTimeout(r, 30000));
  }
});
