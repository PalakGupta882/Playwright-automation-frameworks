// tests/data/config.js
const config = {
  baseURL: 'https://www.bytepe.com',

  // Your real number — OTP is always typed manually by you in the browser
  mobileNumber: 'YOUR_REAL_NUMBER',

  coupons: {
    valid: 'BYTE500',
    invalid: 'FAKE000',   // used by coupon-invalid.spec.js
  },

  timeouts: {
    otp: 120000,          // how long to allow for manual OTP entry
  },
};

module.exports = { config };