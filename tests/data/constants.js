// tests/data/constants.js
module.exports = {
  BASE_URL: 'https://www.bytepe.com',
  // The HTTP API behind the storefront. Same origin — there is no
  // api.bytepe.com. Overridable so the api/ suite can be pointed at a staging
  // host without editing a spec; see tests/data/apiEndpoints.js for the routes.
  BASE_API_URL: process.env.BYTEPE_API_BASE || 'https://www.bytepe.com/api',
  URLS: {
    subscription: '/home/subscription',
    emiStore: '/home/emi-store',
    products: '/all-products',
    aboutUs: '/about-us',
    cart: '/cart',
    // Review Order — the last page before an order is minted. Both the
    // subscription (Subscribe) and the upfront (Buy Now) purchase paths land
    // here; the order id is created by Continue on this page, not by arriving.
    review: '/review',
    // Where the subscription flow lands after Continue on Review Order. This is
    // the last page before the payment gateway — the E2E flow stops here.
    orderSummary: '/payment-summary',
  },
  MESSAGES: {
    invalidCoupon: 'Invalid or inactive coupon',
  },
  // Address used by regression/address-management.spec.js.
  //
  // Obviously synthetic on purpose: it sits on a real account alongside real
  // addresses, so a human looking at the account has to be able to tell at a
  // glance that it is test data.
  //
  // This comment used to say the saved-addresses UI has no delete control and
  // that anything created here was therefore permanent. Both halves were wrong
  // — every card carries an unlabelled delete icon; see tests/pages/accountPage.js.
  //
  // It is still created at most once, but now by choice rather than necessity:
  // several cases read this address, and re-creating it every run would leave a
  // pile of near-identical rows. Throwaway addresses take the other route and
  // delete themselves.
  //
  // areaStreet is the match key. Do not reuse it for anything else.
  TEST_ADDRESS: {
    fullName: 'QA Automation',
    flatNo: 'Apt 4B',
    areaStreet: '123 Test Street',
    landmark: 'Automation Landmark',
    pincode: '110001',
    city: 'New Delhi',
    state: 'Delhi',
    addressType: 'Other',
  },
  TIMEOUTS: {
    nav: 15000,
    // A human reading an SMS and typing it. Only used when BYTEPE_OTP is unset.
    otp: 120000,
    // Unattended login, where nobody is waiting on a message: the OTP screen to
    // render, then submit-to-logged-in. Kept short on purpose — a broken
    // selector should report in seconds, not sit on the human budget.
    otpScreen: 10000,
    otpAuto: 20000,
    login: 20000,
    action: 15000,
  },
};