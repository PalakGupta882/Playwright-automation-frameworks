// tests/scripts/probe-rating-consistency.spec.js
//
// DIAGNOSTIC. Listing rows now carry `rating`; the PDP reads a review summary
// from /product-review/approved_product_review/:productId. Compares the two for
// every rated row. Logged out, GETs only, 1 request/s.
const { test } = require('@playwright/test');

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ retries: 0 });

const HOST = 'https://www.bytepe.com';
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

test('listing rating vs PDP review summary', async ({ request }) => {
  test.setTimeout(300000);
  const rows = [];
  for (let page = 1; page <= 5; page++) {
    const items = (await (await request.get(`${HOST}/api/product-service/apps/products?page=${page}&limit=100`)).json()).data?.items || [];
    rows.push(...items);
    if (items.length < 100) break;
    await pause(1000);
  }
  const rated = rows.filter((r) => r.rating != null);
  console.log(`rated ${rated.length}/${rows.length}`);
  for (const r of rated) {
    const res = await request.get(`${HOST}/api/product-review/approved_product_review/${r.id}?page=1&limit=3`);
    const body = await res.json().catch(() => ({}));
    const s = body.summary || {};
    console.log(`${r.rating} vs ${s.average_rating} (${s.ratings} ratings, ${body.count} reviews) | ${res.status()} | ${r.name}`);
    await pause(1000);
  }
});
