// tests/utils/catalogue.js
//
// The live catalogue, read from the listing API — the one source every spec
// that needs "a product" or "every product" should go through.
//
// WHY THE API AND NOT tests/data/products.json. That file is a scrape, and both
// keys it holds drift on their own (CLAUDE.md: slugs follow renames, the listing
// links whichever variant is featured). It recorded 186 products; the API served
// 241 on 16 Sep 2026.
//
// WHY THE API AND NOT /all-products. The rendered listing drops whole pages of
// 12 on some loads — an open defect owned by listing-completeness.spec.js.
// Sweeping the UI would inherit that bug as "products missing". The API pages
// are complete and stable, so this reads them and checks the total against
// `data.count`: a sweep that silently checked fewer rows than exist is the
// failure this guards against.

const { BASE_URL, BASE_API_URL } = require('../data/constants');
const { getWithRetry } = require('./apiRetry');
const { identitiesFromCart } = require('./surfaceIdentity');

const API = BASE_API_URL.replace(/\/+$/, '');
const PAGE_SIZE = 100;

const listingPath = (page) => `${API}/product-service/apps/products?page=${page}&limit=${PAGE_SIZE}`;
const pdpPayloadPath = (slug, bpid) => `${API}/product-service/apps/products/by-slug/${slug}/${bpid}`;
const pdpUrl = (row) => `${BASE_URL}/pd/${row.slug}/${row.variant.bpid}`;

const isPreBooking = (row) =>
  ((row && row.variant && row.variant.tags) || []).some((t) => /pre-?book/i.test((t && t.name) || ''));

// Every listing row, all pages. Throws rather than returning a short list.
async function fetchListingRows(request) {
  const rows = [];
  let count = null;

  for (let page = 1; page <= 50; page++) {
    const res = await getWithRetry(request, listingPath(page), { failOnStatusCode: false, timeout: 30000 });
    if (!res.ok()) throw new Error(`listing API page ${page} returned ${res.status()}`);

    const data = (await res.json())?.data || {};
    if (count === null) count = data.count;
    const items = data.items || [];
    rows.push(...items);
    if (items.length < PAGE_SIZE || (Number.isInteger(count) && rows.length >= count)) break;
  }

  if (!Number.isInteger(count) || count <= 0) {
    throw new Error(`listing API reported no usable count (got ${count}); cannot prove the sweep is complete`);
  }
  if (rows.length !== count) {
    throw new Error(`listing API reports ${count} products but ${rows.length} rows were read`);
  }

  // A row without slug or bpid has no PDP to visit. Logged, not hidden.
  const usable = rows.filter((r) => r && r.slug && r.variant && r.variant.bpid);
  if (usable.length !== rows.length) {
    console.log(`listing: ${rows.length - usable.length} of ${rows.length} rows carry no slug/bpid and were dropped`);
  }
  return usable;
}

// The PDP payload's own verdict on stock. The listing row does not carry it —
// on 29 Sep 2026 the first UPFRONT row was Sold Out.
async function variantInStock(request, row) {
  const res = await getWithRetry(request, pdpPayloadPath(row.slug, row.variant.bpid), { failOnStatusCode: false });
  if (!res.ok()) return false;
  const variant = (await res.json())?.data?.variant;
  return Boolean(variant && variant.available && variant.stock > 0);
}

// First listing row matching the payment mode, not pre-booking, not excluded,
// and in stock. Stock is checked per candidate, so it stops at `maxChecks`.
//
// mode: 'UPFRONT' (has the cart icon) or 'BOTH' (subscription-capable, Buy Now only).
async function pickProduct(request, { mode, exclude = new Set(), maxChecks = 15 } = {}) {
  const rows = await fetchListingRows(request);
  const candidates = rows.filter(
    (r) => r.prodPaymentMode === mode && !isPreBooking(r) && !exclude.has(r.variant.bpid)
  );

  for (const row of candidates.slice(0, maxChecks)) {
    if (await variantInStock(request, row)) return row;
  }
  return null;
}

// The logged-in basket as identity tuples. An empty basket comes back as
// `data: []` rather than `{ items: [] }`. Read on the storefront origin, not
// BASE_API_URL, because the session cookie is scoped to the storefront host.
async function readBasketIdentities(request, paymentType) {
  const res = await getWithRetry(request, `${BASE_URL}/api/cart?payment_type=${paymentType}`, {
    failOnStatusCode: false,
    headers: { accept: 'application/json' },
  });
  if (!res.ok()) throw new Error(`GET /api/cart?payment_type=${paymentType} returned ${res.status()}`);
  const data = (await res.json())?.data;
  return identitiesFromCart(Array.isArray(data) || !data ? {} : data);
}

module.exports = {
  fetchListingRows,
  variantInStock,
  pickProduct,
  readBasketIdentities,
  isPreBooking,
  pdpUrl,
};
