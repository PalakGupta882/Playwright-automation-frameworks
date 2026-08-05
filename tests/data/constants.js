// tests/data/constants.js
module.exports = {
  BASE_URL: 'https://www.bytepe.com',
  URLS: {
    subscription: '/home/subscription',
    emiStore: '/home/emi-store',
    products: '/all-products',
    aboutUs: '/about-us',
    cart: '/cart',
    // Where the subscription flow lands after Continue on Review Order. This is
    // the last page before the payment gateway — the E2E flow stops here.
    orderSummary: '/payment-summary',
  },
  MESSAGES: {
    invalidCoupon: 'Invalid or inactive coupon',
  },
  TIMEOUTS: { nav: 15000, otp: 120000 },
};