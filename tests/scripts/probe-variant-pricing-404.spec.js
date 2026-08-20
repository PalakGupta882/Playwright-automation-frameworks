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

// DIAGNOSTIC. variant-pricing answered 200 {"status":true} for
// /apps/variant-pricing/iphone-air/not-a-uuid -- a variant that cannot exist --
// while an unknown SLUG on the same endpoint answers 404 {"status":false}.
//
// Separate the two possible explanations before calling it a bug:
//   a) it only fails closed on the slug, and any variant id is accepted
//   b) "not-a-uuid" specifically bypasses a lookup that a well-formed but
//      unknown UUID would still fail
//
// Read-only, logged out.

test.use({ storageState: { cookies: [], origins: [] } });

test('probe: what variant-pricing does with variant ids that do not exist', async ({ request }) => {
  test.setTimeout(180000);

  // A real slug, and a real variant id for it, as the control.
  const real = await request.get(
    `${BASE_API_URL}/product-service/apps/products/by-slug/iphone-air/APPSMMOBTFDX4S`
  );
  const product = (await real.json()).data;
  const realVariantId = product?.variant?.id || product?.variant?.variant_id;
  console.log(`\ncontrol: slug=iphone-air realVariantId=${realVariantId}`);

  const CASES = [
    ['real slug + REAL variant id (control)', 'iphone-air', realVariantId],
    ['real slug + well-formed but unknown UUID', 'iphone-air', '00000000-0000-0000-0000-000000000000'],
    ['real slug + random valid UUID', 'iphone-air', 'deadbeef-dead-beef-dead-beefdeadbeef'],
    ['real slug + non-uuid junk', 'iphone-air', 'not-a-uuid'],
    ['real slug + numeric', 'iphone-air', '12345'],
    ['real slug + another product variant id', 'iphone-air', 'MISMATCHED-VARIANT'],
    ['unknown slug + real variant id', 'no-such-product-xyz', realVariantId],
  ];

  console.log('\n=========== variant-pricing failure modes ===========');
  for (const [label, slug, variantId] of CASES) {
    const res = await request.get(`${BASE_API_URL}/apps/variant-pricing/${slug}/${variantId}`, {
      timeout: 30000,
    });
    const text = await res.text();
    let summary = text.slice(0, 130).replace(/\s+/g, ' ');
    try {
      const j = JSON.parse(text);
      const d = j.data || {};
      summary =
        `status=${JSON.stringify(j.status)} ` +
        `upfront.price=${JSON.stringify(d.upfront?.price)} ` +
        `emi_price=${JSON.stringify(d.emi_price)} ` +
        `dataKeys=[${Object.keys(d).join(',')}] ` +
        `msg=${JSON.stringify(j.message)}`;
    } catch { /* leave raw */ }
    console.log(`\n[HTTP ${res.status()}] ${label}`);
    console.log(`    id=${variantId}`);
    console.log(`    ${summary}`);
    await new Promise((r) => setTimeout(r, 800));
  }
});
