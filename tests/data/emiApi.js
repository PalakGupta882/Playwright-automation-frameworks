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
  cardlessEmiFrom,
  creditCardEmiFrom,
  cardEmiOptionsFrom,
};
