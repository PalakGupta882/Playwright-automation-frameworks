// tests/scripts/discover-video-products.spec.js
//
// Not a regression test — a discovery utility, like discover-products.spec.js.
// Walks every product in the LIVE listing API against the public PDP API and
// records which ones expose a non-empty product.videos[]. It read
// tests/data/products.json until 5 Oct 2026, which passed that scrape's
// staleness (241 rows against 335 live) straight into this file.
//
// The output file is what tests/regression/video-pdp-*.spec.js drive off, so
// re-run this after the content team publishes a video:
//
//   npx playwright test scripts/discover-video-products.spec.js --project=chromium
//
// Read-only: plain GETs against the public API, no auth, no writes.

const { test } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { pdpApiPath, videosFromPdpPayload } = require('../data/videoFeature');
const { fetchListingRows } = require('../utils/catalogue');
const { getWithRetry } = require('../utils/apiRetry');

const OUT_PATH = path.join(__dirname, '..', 'data', 'video-products.json');
// 4, not 8 — the limit site-health and discover-cardless-emi settled on.
const CONCURRENCY = 4;

test('discover which products have a live video', async ({ request }) => {
  test.setTimeout(600000);

  const items = (await fetchListingRows(request)).map((r) => ({
    name: r.name,
    slug: r.slug,
    bpid: r.variant.bpid,
  }));

  const withVideo = [];
  const unreachable = [];
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const item = items[cursor++];
      // getWithRetry: a 429 is not an unreachable product.
      const res = await getWithRetry(request, pdpApiPath(item.slug, item.bpid), {
        headers: { accept: 'application/json' },
        failOnStatusCode: false,
      });

      if (!res.ok()) {
        unreachable.push({ ...item, status: res.status() });
        continue;
      }

      const videos = videosFromPdpPayload(await res.json());
      if (videos.length) withVideo.push({ ...item, videos });
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const result = {
    scannedProducts: items.length,
    productsWithVideo: withVideo.length,
    unreachable,
    products: withVideo,
  };
  fs.writeFileSync(OUT_PATH, `${JSON.stringify(result, null, 2)}\n`);

  console.log(
    `Scanned ${items.length} products — ${withVideo.length} with video, ` +
      `${unreachable.length} unreachable. Wrote ${OUT_PATH}`
  );
  withVideo.forEach((p) => console.log(`  ${p.name} — /pd/${p.slug}/${p.bpid}`));
});
