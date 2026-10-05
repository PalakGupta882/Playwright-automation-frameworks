// tests/utils/orderContinue.js
//
// The Continue on Review Order that MINTS A REAL ORDER — create-order fires on
// this click, before any payment step. Every spec that presses it goes through
// here.
//
// Refuses to guess. `.first()` on a page that mints an order resolves ambiguity
// by document order, which is how the recommended-products carousel once put a
// ₹1,24,999 phone in a live cart. This returns a locator only when exactly one
// visible Continue-shaped control exists, and otherwise throws with the labels
// it found.
//
// Waits for the first candidate before counting. A bare count() is instant: on
// a half-rendered Review Order it reads 0 and throws "no Continue control" for
// a page that was simply still loading.
//
// Moved from device-protection-consistency.spec.js (checkoutContinueButton),
// 5 Oct 2026, so pricing-checkout-consistency and ReviewOrderPage.clickContinue
// share it.

const { TIMEOUTS } = require('../data/constants');

const CONTINUE_SHAPED = /^(continue|proceed to payment|proceed)$/i;

async function orderContinueButton(page, { timeout = TIMEOUTS.nav } = {}) {
  const candidates = page.getByRole('button', { name: CONTINUE_SHAPED }).filter({ visible: true });

  const appeared = await candidates
    .first()
    .waitFor({ state: 'visible', timeout })
    .then(() => true)
    .catch(() => false);
  if (!appeared) {
    throw new Error(`Review Order shows no Continue control after ${timeout}ms, so the flow cannot proceed.`);
  }

  const count = await candidates.count();
  if (count > 1) {
    const labels = await candidates.allInnerTexts();
    throw new Error(
      `Review Order shows ${count} visible Continue-shaped buttons (${labels.join(' | ')}). ` +
        'Refusing to guess which one mints the order — scope the locator before running this.'
    );
  }
  return candidates.first();
}

module.exports = { orderContinueButton, CONTINUE_SHAPED };
