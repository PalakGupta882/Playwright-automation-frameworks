// tests/api/products-api.spec.js
//
// Catalogue API. Entirely public — no session, no writes, safe to run any time.
//
// Structured on the four questions: presence, correctness, behavior (chained),
// negative.

const { test, expect } = require('@playwright/test');
const { getApiContext, safeJson } = require('./apiHelper');
const { ENDPOINTS, ENVELOPE } = require('../data/apiEndpoints');
const { getWithRetry } = require('../utils/apiRetry');
// products.json is { count, products: [{ name, url }] } — not a bare array.
const { products } = require('../data/products.json');

// products.json stores hrefs, not ids. Both halves drift on their own — a
// rename moves the slug and the listing links whichever variant is currently
// featured — so this parses rather than hardcodes, and the drift shows up as a
// 404 with an actionable message rather than as a mystery.
function slugAndBpidFrom(entry) {
  const match = /\/pd\/([^/?]+)\/([^/?]+)/.exec(entry.url || '');
  if (!match) throw new Error(`products.json entry has no /pd/ URL: ${JSON.stringify(entry)}`);
  return { slug: match[1], bpid: match[2], name: entry.name };
}

const SAMPLE = slugAndBpidFrom(products[0]);
const DRIFT_HINT =
  `If this is a 404, the catalogue has almost certainly drifted — slugs follow product ` +
  `names and the listing links whichever variant is featured. Re-run: npm run discover`;

test.describe('Products API', () => {
  let api;

  test.beforeAll(async () => {
    api = await getApiContext();
  });

  test.afterAll(async () => {
    await api.dispose();
  });

  // ---- Presence --------------------------------------------------------

  test('presence: product-by-slug responds 200 with the standard envelope', async () => {
    const res = await getWithRetry(api, ENDPOINTS.productBySlug(SAMPLE.slug, SAMPLE.bpid));

    expect(res.status(), `GET by-slug for ${SAMPLE.slug}/${SAMPLE.bpid}. ${DRIFT_HINT}`).toBe(200);

    const body = await safeJson(res);
    // The envelope, not just the status. A 200 carrying {status:false} is
    // exactly the regression a status-only assertion waves through.
    expect(body.status).toBe(true);
    expect(body).toHaveProperty('data.product');
  });

  test('presence: filters and master-categories both respond', async () => {
    const [filters, categories] = await Promise.all([
      getWithRetry(api, ENDPOINTS.productFilters),
      getWithRetry(api, ENDPOINTS.masterCategories),
    ]);

    expect(filters.status()).toBe(200);
    expect(categories.status()).toBe(200);

    const filtersBody = await safeJson(filters);
    expect(filtersBody.status).toBe(true);
    expect(Array.isArray(filtersBody.data.brands)).toBe(true);
    // Non-vacuous: a filters payload with zero brands would satisfy an
    // isArray check while telling us the catalogue is empty.
    expect(filtersBody.data.brands.length).toBeGreaterThan(0);
    expect(filtersBody.data.brands[0]).toMatchObject({
      id: expect.any(String),
      name: expect.any(String),
      slug: expect.any(String),
    });

    const categoriesBody = await safeJson(categories);
    expect(categoriesBody.status).toBe(true);
    expect(Array.isArray(categoriesBody.data)).toBe(true);
    expect(categoriesBody.data.length).toBeGreaterThan(0);
    expect(categoriesBody.data[0]).toMatchObject({
      id: expect.any(String),
      category_name: expect.any(String),
      category_slug: expect.any(String),
    });
  });

  // ---- Correctness -----------------------------------------------------

  test('correctness: the product record carries the fields the PDP needs', async () => {
    const res = await getWithRetry(api, ENDPOINTS.productBySlug(SAMPLE.slug, SAMPLE.bpid));
    expect(res.status(), DRIFT_HINT).toBe(200);

    const { data } = await safeJson(res);

    expect(data.product).toMatchObject({
      id: expect.any(String),
      name: expect.any(String),
      slug: expect.any(String),
      // Drives which plans the "Choose your plan" box offers — see CLAUDE.md.
      prodPaymentMode: expect.any(String),
    });
    // The endpoint is addressed by slug, so getting a different product back is
    // a real defect and not a drift artefact.
    expect(data.product.slug).toBe(SAMPLE.slug);

    // Deliberately NOT asserting a price on the product. There is no such
    // field: price is per variant. Asserting `product.price` would pass
    // vacuously as undefined-equals-undefined the day it appeared.
    expect(data.product).not.toHaveProperty('price');

    expect(data.variant).toMatchObject({
      id: expect.any(String),
      bpid: expect.any(String),
      isMaster: expect.any(Boolean),
    });
    expect(data.variant.bpid).toBe(SAMPLE.bpid);

    expect(Array.isArray(data.siblingVariants)).toBe(true);
  });

  test('correctness: variant pricing returns a positive upfront price', async () => {
    const pdp = await getWithRetry(api, ENDPOINTS.productBySlug(SAMPLE.slug, SAMPLE.bpid));
    expect(pdp.status(), DRIFT_HINT).toBe(200);
    const { data } = await safeJson(pdp);

    const res = await getWithRetry(api, ENDPOINTS.variantPricing(SAMPLE.slug, data.variant.id));
    expect(res.status()).toBe(200);

    const body = await safeJson(res);
    expect(body.status).toBe(true);
    expect(typeof body.data.upfront.price).toBe('number');
    // Shape, not a pinned figure. Prices move without a deploy; a hardcoded
    // ₹1,99,999 would be a scheduled false failure.
    expect(body.data.upfront.price).toBeGreaterThan(0);
    expect(body.data.upfront.cut_price).toBeGreaterThanOrEqual(body.data.upfront.price);

    // nbfc is subscription pricing, not an availability switch — emi_amount 0
    // means "not pre-priced", NOT "cardless EMI unavailable" (CLAUDE.md). So
    // this asserts the key exists, and says nothing about the amount.
    expect(body.data).toHaveProperty('nbfc');
  });

  // ---- Behavior (chained) ----------------------------------------------

  test('behavior: slug -> master variant -> that variant\'s price resolves end to end', async () => {
    const pdp = await getWithRetry(api, ENDPOINTS.productBySlug(SAMPLE.slug, SAMPLE.bpid));
    expect(pdp.status(), DRIFT_HINT).toBe(200);
    const { data } = await safeJson(pdp);

    // The bpid in products.json is whatever the listing linked and is not
    // necessarily the master. The price a shopper sees on landing is the
    // master's, so resolve it rather than assuming the linked one.
    const master = data.variant.isMaster
      ? data.variant
      : (data.siblingVariants || []).find(v => v.isMaster);

    expect(
      master,
      `Neither the linked variant nor any sibling is marked isMaster for ${SAMPLE.slug}. ` +
      'Every product should have exactly one default configuration.'
    ).toBeTruthy();

    const priced = await getWithRetry(api, ENDPOINTS.variantPricing(SAMPLE.slug, master.id));
    expect(priced.status()).toBe(200);

    const body = await safeJson(priced);
    expect(body.status).toBe(true);
    expect(body.data.upfront.price).toBeGreaterThan(0);
  });

  test('behavior: sibling variants are individually priceable', async () => {
    const pdp = await getWithRetry(api, ENDPOINTS.productBySlug(SAMPLE.slug, SAMPLE.bpid));
    expect(pdp.status(), DRIFT_HINT).toBe(200);
    const { data } = await safeJson(pdp);

    const sibling = (data.siblingVariants || [])[0];
    test.skip(!sibling, `${SAMPLE.slug} has no sibling variants to price.`);

    const res = await getWithRetry(api, ENDPOINTS.variantPricing(SAMPLE.slug, sibling.id));
    expect(res.status()).toBe(200);
    const body = await safeJson(res);
    expect(body.status).toBe(true);
    expect(body.data.upfront.price).toBeGreaterThan(0);
  });

  // ---- Negative --------------------------------------------------------

  test('negative: an unknown slug/bpid returns a clean 404, not a crash', async () => {
    const res = await getWithRetry(
      api,
      ENDPOINTS.productBySlug('no-such-product-xyz', 'BOGUSID000000')
    );

    expect(res.status()).toBe(404);

    const body = await safeJson(res);
    // The point of the test: a structured error, not an HTML error page and not
    // a 500. Asserting the envelope proves the API handled it rather than fell
    // over somewhere upstream.
    expect(body.status).toBe(false);
    expect(body.code).toBe(404);
    expect(body.message).toBe(ENVELOPE.productNotFoundMessage);
  });

  test('negative: a real slug with the wrong bpid is rejected', async () => {
    const res = await getWithRetry(api, ENDPOINTS.productBySlug(SAMPLE.slug, 'BOGUSID000000'));

    // The slug resolves but the variant does not, so the pair must not.
    // Returning the master variant here would silently serve a shopper a
    // different configuration than the URL asked for.
    expect(res.status()).toBe(404);
    const body = await safeJson(res);
    expect(body.status).toBe(false);
  });

  test('negative: pricing for a non-existent variant id does not return a price', async () => {
    const res = await getWithRetry(
      api,
      ENDPOINTS.variantPricing(SAMPLE.slug, '00000000-0000-0000-0000-000000000000')
    );

    const body = await safeJson(res);

    // Two contracts are acceptable — an error status, or a 200 that reports
    // status:false. What is NOT acceptable is a 200 carrying a real price for a
    // variant that does not exist, so that is what this pins down directly
    // rather than branching on the status.
    const servedARealPrice =
      res.status() === 200 && body.status === true && Number(body?.data?.upfront?.price) > 0;

    expect(
      servedARealPrice,
      `Pricing served a real price for a non-existent variant id. ` +
      `status=${res.status()} body=${JSON.stringify(body).slice(0, 300)}`
    ).toBe(false);
  });
});
