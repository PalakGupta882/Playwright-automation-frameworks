// tests/data/emiApi.js
//
// The two public endpoints behind the "Choose your plan" box on a product page.
// Both were confirmed by watching the PDP's own network calls — the payment
// plan does NOT come from the catalog endpoint.

const HOST = 'https://www.bytepe.com';

// Catalog record. Needed only to translate a slug/bpid into a variant id.
function pdpApiPath(slug, bpid) {
  return `${HOST}/api/product-service/apps/products/by-slug/${slug}/${bpid}`;
}

// Payment plans and pricing. This is where every EMI option lives.
function variantPricingPath(slug, variantId) {
  return `${HOST}/api/apps/variant-pricing/${slug}/${variantId}`;
}

// The bundled add-ons the PDP renders below the buyback slider. NOT part of
// variant-pricing — that response carries upfront/cc/cc_y2/nbfc/emi/emi_price/
// abb and no vas key at all, which is why the add-on term in the advertised
// saving has to be fetched separately. Public, no auth. Confirmed 26 Aug 2026.
function productVasPath(slug, bpid) {
  return `${HOST}/api/apps/product-vas/${slug}/${bpid}`;
}

// data.vas[] — one record per bundled row, in the order the PDP renders them.
//
//   vas_name   the label on the page
//   vas_mrp    the struck-through list price
//   vas_price  what the shopper pays (0 for a freebie)
//   details.other_type  "Damage Protection" | "Freebie" — the only field that
//                       separates the kinds, and it is not rendered on the page
//
// Returns [] rather than null for a product that bundles nothing, so callers can
// map over it without a guard.
function productVasFrom(body) {
  const vas = ((body && body.data) || {}).vas;
  return Array.isArray(vas) ? vas : [];
}

// Just the names, which is what priceText.parseAddOns needs to find each row in
// the page text.
function vasNamesFrom(body) {
  return productVasFrom(body)
    .map((row) => row.vas_name)
    .filter((name) => typeof name === 'string' && name.trim() !== '');
}

// data.nbfc — the cardless EMI (lender-funded, no credit card) offer.
// Present but zero-filled when the product has no offer, so check the amount,
// not the key.
function cardlessEmiFrom(body) {
  const nbfc = (body && body.data && body.data.nbfc) || {};
  if (!nbfc.emi_amount) return null;
  return {
    monthly: nbfc.emi_amount,
    tenureMonths: nbfc.tenure,
    downpayment: nbfc.downpay,
    interest: nbfc.interest,
    total: nbfc.total_amount,
  };
}

// data.cc — the credit card EMI offer, same zero-filled convention.
function creditCardEmiFrom(body) {
  const cc = (body && body.data && body.data.cc) || {};
  return cc.emi_amount ? { monthly: cc.emi_amount, total: cc.total_amount } : null;
}

// data.emi.emi_option[] — card-based tenure choices.
// emi_type: NCEMI = no cost, LCEMI = low cost, EMI = standard interest.
function cardEmiOptionsFrom(body) {
  const opts = ((body && body.data && body.data.emi) || {}).emi_option;
  return Array.isArray(opts) ? opts : [];
}

module.exports = {
  HOST,
  pdpApiPath,
  variantPricingPath,
  productVasPath,
  productVasFrom,
  vasNamesFrom,
  cardlessEmiFrom,
  creditCardEmiFrom,
  cardEmiOptionsFrom,
};
