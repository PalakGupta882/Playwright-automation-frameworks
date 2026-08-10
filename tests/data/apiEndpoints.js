// tests/data/apiEndpoints.js
//
// The BytePe HTTP API, as the storefront itself calls it.
//
// PROVENANCE — none of this is guessed. Paths, methods and request bodies were
// read out of the shipped client bundles (the `/_next/static/chunks/*.js` the
// homepage and a PDP reference, grepped for `url:"...",method:"..."`), and every
// GET listed here was then confirmed with a read-only probe against production.
// Anything that could not be confirmed without mutating state is marked.
//
// Two facts that surprise people:
//
//   1. There is no separate API host. `api.bytepe.com` does not exist — the API
//      is same-origin with the storefront under /api.
//   2. Auth is a COOKIE, not a header. The string "Bearer" appears nowhere in
//      the client. Requests are authenticated by the `access_token` cookie for
//      www.bytepe.com, which is why the helper attaches auth.json as a
//      storageState rather than setting an Authorization header.

const { BASE_API_URL } = require('./constants');

// Every path below is relative to BASE_API_URL, so they compose with the
// request context's baseURL rather than being concatenated by hand.
const ENDPOINTS = {
  // ---- Catalogue (public, no auth) -------------------------------------
  //
  // Confirmed 200 with `{status: true, message, data}`.
  productBySlug: (slug, bpid) =>
    `/product-service/apps/products/by-slug/${slug}/${bpid}`,
  // data.upfront.price is the figure a shopper sees. Priced PER VARIANT — see
  // CLAUDE.md; a product does not have a price.
  variantPricing: (slug, variantId) => `/apps/variant-pricing/${slug}/${variantId}`,
  productFilters: '/product-service/apps/products/filters',
  masterCategories: '/product-service/apps/master-categories',
  productAttributes: (productId) =>
    `/product-service/apps/products/${productId}/attributes`,

  // ---- Auth ------------------------------------------------------------
  //
  // POST /auth/login SENDS A REAL SMS to the number in the body. It is the
  // first leg of OTP login: it resolves the phone to a user_id and dispatches
  // the code. Nothing in this repo calls it unless BYTEPE_API_OTP_LOGIN=1.
  //   body: { emailOrPhone, loginType: 'OTP', role_type: 'customer' }
  login: '/auth/login',
  //   body: { user_id, otp_medium: 'phone', otp_for: 'login' }  — resends the SMS
  sendOtp: '/auth/send-otp',
  //   body: { user_id, otp }  — second leg; this is what mints the session
  verifyOtp: '/auth/verify-otp',
  refreshTokens: '/auth/refresh-tokens',
  logout: '/auth/logout',

  // ---- Account (auth required) -----------------------------------------
  //
  // Confirmed 401 `{status:false, code:401, message:'Unauthorized access!'}`
  // without a session. The cheapest honest "is this route protected" probe in
  // the whole API, which is why auth-api.spec.js uses it.
  userDetails: '/users/get-user-details',

  // ---- Cart (auth required) --------------------------------------------
  //
  // NOTE: there is no add-to-cart endpoint. The client ships exactly these five
  // cart routes and none of them is named add — a `POST /cart/add` does not
  // exist. Adding an item appears to happen through POST /cart with a body, but
  // that could not be confirmed without writing to a real cart, so nothing here
  // asserts it.
  //
  // GET /cart — confirmed 401 logged out. Read-only.
  cart: (params = {}) => {
    const qs = new URLSearchParams();
    if (params.payment_type) qs.append('payment_type', params.payment_type);
    if (params.address_id) qs.append('address_id', params.address_id);
    if (params.coupon_id) qs.append('coupon_id', params.coupon_id);
    if (params.is_review) qs.append('is_review', 'true');
    const q = qs.toString();
    return `/cart${q ? `?${q}` : ''}`;
  },
  // POST /cart with a body. The client names this `getCartItems`, so despite the
  // verb it reads rather than writes — but "POST that the vendor says is a read"
  // is not something to take on trust against a live cart. Treated as a write.
  cartPost: '/cart',
  // PUT — changes the quantity of a line already in the real cart.
  //   body: { quantity }
  updateCartItem: (cartId) => `/cart/${cartId}`,
  // DESTRUCTIVE. Removes a line item from the real shopper's real cart. Despite
  // being a removal the client sends PUT, not DELETE.
  //   body: { product_id, variant_id }
  removeCartItem: (cartItemId) => `/cart/remove/${cartItemId}`,
  // DESTRUCTIVE. Removes a value-added service (protection plan etc.) from the
  // real cart.
  removeCartVas: (vasId) => `/cart/vas/${vasId}`,

  // ---- Coupons (auth required) -----------------------------------------
  validateCoupon: '/coupons/validate-coupon',
  customerCoupons: '/coupons/customer',

  // ---- Addresses (auth required) ---------------------------------------
  // Note the storefront has no delete-address UI; see TEST_ADDRESS in
  // constants.js for why anything created here is permanent.
  customerAddresses: '/customer-address/',
  customerAddress: (id) => `/customer-address/${id}`,
};

// Real routes, deliberately NOT exposed above and never to be called from a
// test. These initiate orders, move money, or cancel real purchases. They are
// listed so that "is there an endpoint for X" has an answer without anyone
// going looking for one and finding it the hard way.
const FORBIDDEN = [
  '/payments/v2/create-payment/:orderId',
  '/payments/v2/down-payment/:orderId',
  '/payments/v2/initiate-loan/:orderId',
  '/payments/razorpay/payment/initialize-v2',
  '/payments/resolve-gateway',
  '/customer-order/emi-store/razp/initiate-order',
  '/customer-order/initiate-cancel-order/:orderId',
  '/users', // DELETE — deletes the account
];

// The envelope every route uses. Asserting on this is the point of the API
// layer: a 200 carrying {status:false} is precisely the regression a
// status-code-only test waves through.
const ENVELOPE = {
  unauthorizedMessage: 'Unauthorized access!',
  productNotFoundMessage: 'Product not found for the given slug/bpid',
};

// Playwright resolves a request path against baseURL with the URL constructor,
// which means a LEADING SLASH is root-relative and silently drops the `/api`
// segment:
//
//   new URL('/cart', 'https://www.bytepe.com/api')  ->  https://www.bytepe.com/cart
//
// That 404s, and it is not obvious from the failure — it cost a full run of 15
// false failures before being spotted. The table above keeps the leading slashes
// so it stays diffable against the client bundle it was read from; this strips
// them on the way out, and getApiContext() gives baseURL the matching trailing
// slash. Both halves are required.
function toRelative(value) {
  if (typeof value === 'string') return value.replace(/^\/+/, '');
  if (typeof value === 'function') return (...args) => toRelative(value(...args));
  return value;
}

const RELATIVE_ENDPOINTS = Object.fromEntries(
  Object.entries(ENDPOINTS).map(([name, value]) => [name, toRelative(value)])
);

module.exports = {
  BASE_API_URL,
  ENDPOINTS: RELATIVE_ENDPOINTS,
  FORBIDDEN,
  ENVELOPE,
};
