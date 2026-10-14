// RESOLVED 20 Aug 2026 -- CONFIRMED EXPECTED. Kept as a record of the measured
// behaviour, not as an open question. Do not file a defect from this file.
//
// variant-pricing validates the SLUG and not the VARIANT. Any variant id that
// cannot exist returns HTTP 200 with {"status":true,"message":"Data fetched
// successfully."} and a data object with every pricing block absent, while an
// unknown slug returns 404 {"status":false,"message":"Product not found"}.
// Product confirmed this is the intended contract: callers null-check
// data.upfront rather than branching on status.
//
const { test } = require('../fixtures/pageFixtures');
const { BASE_API_URL } = require('../data/constants');

// DIAGNOSTIC. Edge-case behaviour of the PUBLIC catalogue endpoints: bad ids,
// out-of-range pagination, hostile-looking strings, wrong types. Nothing in the
// suite covers these -- api/products-api and api/pricing-api both assert the
// happy path -- so this measures what production actually answers before any
// of it is turned into an assertion.
//
// Read-only: every request is a GET against a public endpoint. Logged out.

test.use({ storageState: { cookies: [], origins: [] } });

// Spaced out on purpose: the storefront 429s this suite at very modest
// concurrency, and a burst here would report throttling as a contract bug.
const GAP_MS = 700;

const CASES = [
  ['by-slug: unknown slug + unknown bpid', '/product-service/apps/products/by-slug/no-such-product-xyz/NOSUCHBPID1'],
  ['by-slug: real slug, wrong bpid', '/product-service/apps/products/by-slug/iphone-air/TOTALLYFAKE9'],
  ['by-slug: empty bpid', '/product-service/apps/products/by-slug/iphone-air/'],
  ['by-slug: path traversal in slug', '/product-service/apps/products/by-slug/..%2F..%2Fetc%2Fpasswd/X1'],
  ['by-slug: sql-ish string', "/product-service/apps/products/by-slug/' OR '1'='1/X1"],
  ['by-slug: very long slug (2000 chars)', `/product-service/apps/products/by-slug/${'a'.repeat(2000)}/X1`],
  ['by-slug: unicode slug', '/product-service/apps/products/by-slug/%E2%98%83%E2%98%83/X1'],

  ['variant-pricing: unknown slug + uuid', '/apps/variant-pricing/no-such-product-xyz/00000000-0000-0000-0000-000000000000'],
  ['variant-pricing: non-uuid variant id', '/apps/variant-pricing/iphone-air/not-a-uuid'],
  ['variant-pricing: empty variant id', '/apps/variant-pricing/iphone-air/'],

  ['filters: no params', '/product-service/apps/products/filters'],
  ['filters: page=0', '/product-service/apps/products/filters?page=0'],
  ['filters: page=-1', '/product-service/apps/products/filters?page=-1'],
  ['filters: page=99999', '/product-service/apps/products/filters?page=99999'],
  ['filters: limit=100000', '/product-service/apps/products/filters?limit=100000'],
  ['filters: page=abc (wrong type)', '/product-service/apps/products/filters?page=abc'],
  ['filters: limit=-5', '/product-service/apps/products/filters?limit=-5'],

  ['master-categories', '/product-service/apps/master-categories'],
];

test('probe: public API contract edge cases', async ({ request }) => {
  test.setTimeout(300000);

  const rows = [];
  for (const [label, path] of CASES) {
    let status = null;
    let body = '';
    let shape = '';
    try {
      const res = await request.get(BASE_API_URL + path, { timeout: 30000 });
      status = res.status();
      const text = await res.text();
      body = text.slice(0, 160).replace(/\s+/g, ' ');
      try {
        const json = JSON.parse(text);
        const keys = Object.keys(json).join(',');
        const d = json.data;
        const dShape = Array.isArray(d)
          ? `data[] len=${d.length}`
          : d && typeof d === 'object'
            ? `data{${Object.keys(d).slice(0, 6).join(',')}}`
            : `data=${JSON.stringify(d)}`;
        shape = `keys={${keys}} ${dShape} status_field=${JSON.stringify(json.status)}`;
      } catch {
        shape = '(not JSON)';
      }
    } catch (err) {
      status = 'THREW';
      body = String(err.message).slice(0, 160);
    }
    rows.push({ label, path, status, shape, body });
    await new Promise((r) => setTimeout(r, GAP_MS));
  }

  console.log('\n================ PUBLIC API CONTRACT PROBE ================');
  for (const r of rows) {
    console.log(`\n[${r.status}]  ${r.label}`);
    console.log(`     ${r.path.slice(0, 110)}`);
    if (r.shape) console.log(`     ${r.shape}`);
    console.log(`     body: ${r.body}`);
  }
});
