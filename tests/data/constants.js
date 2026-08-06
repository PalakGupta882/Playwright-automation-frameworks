// tests/data/constants.js
module.exports = {
  BASE_URL: 'https://www.bytepe.com',
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
  // Obviously synthetic on purpose. The saved-addresses UI has no delete
  // control, so anything created here stays on the account permanently — it
  // needs to be recognisable as test data by a human looking at the account,
  // and matchable by the spec so it is only ever created once.
  //
  // AREA_STREET is the match key. Do not reuse it for anything else.
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