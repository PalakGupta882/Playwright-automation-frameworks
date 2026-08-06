// tests/scripts/discover-video-products.spec.js
//
// Not a regression test — a discovery utility, like discover-products.spec.js.
// Walks every product in tests/data/products.json against the public PDP API
// and records which ones expose a non-empty product.videos[].
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
const catalog = require('../data/products.json');

const OUT_PATH = path.join(__dirname, '..', 'data', 'video-products.json');
const CONCURRENCY = 8;

test('discover which products have a live video', async ({ request }) => {
  test.setTimeout(600000);

  const items = catalog.products
    .map((p) => {
      const m = p.url.match(/^\/pd\/([^/]+)\/([^/?]+)/);
      return m ? { name: p.name, slug: m[1], bpid: m[2] } : null;
    })
    .filter(Boolean);

  const withVideo = [];
  const unreachable = [];
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const item = items[cursor++];
      const res = await request.get(pdpApiPath(item.slug, item.bpid), {
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
