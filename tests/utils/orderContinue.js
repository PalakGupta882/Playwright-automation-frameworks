// tests/utils/orderContinue.js
//
// Exactly-one-visible-button resolution for the checkout journey's Continue
// clicks, and the two named uses of it:
//
//   orderContinueButton  Review Order -> order. MINTS A REAL ORDER: create-order
//                        fires on this click, before any payment step.
//   cartContinueButton   Cart -> Review Order. Mints nothing, but it is the click
//                        that decides which basket gets reviewed.
//
// Refuses to guess. `.first()` resolves ambiguity by document order, which is
// how the recommended-products carousel once put a ₹1,24,999 phone in a live
// cart. These return a locator only when exactly one visible matching control
// exists, and otherwise throw with the labels found. Measured 5 Oct 2026: the
// cart renders exactly 1 Continue (1 visible), Review Order exactly 1 — so the
// guard costs nothing today and turns a future duplicate into a named failure.
//
// Waits for the first candidate before counting. A bare count() is instant: on
// a half-rendered page it reads 0 and reports "no control" for a page that was
// simply still loading.
//
// orderContinueButton moved here from device-protection-consistency.spec.js
// (checkoutContinueButton) on 5 Oct 2026; cartContinueButton replaced nine
// `.first()` cart clicks the same day.

const { TIMEOUTS } = require('../data/constants');

const CONTINUE_SHAPED = /^(continue|proceed to payment|proceed)$/i;

async function uniqueVisibleButton(page, name, { where, consequence, timeout = TIMEOUTS.nav }) {
  const candidates = page.getByRole('button', { name }).filter({ visible: true });

  const appeared = await candidates
    .first()
    .waitFor({ state: 'visible', timeout })
    .then(() => true)
    .catch(() => false);
  if (!appeared) {
    throw new Error(`${where} shows no ${name} control after ${timeout}ms, so the flow cannot proceed.`);
  }

  const count = await candidates.count();
  if (count > 1) {
    const labels = await candidates.allInnerTexts();
    throw new Error(
      `${where} shows ${count} visible ${name} buttons (${labels.join(' | ')}). ` +
        `Refusing to guess which one ${consequence} — scope the locator before running this.`
    );
  }
  return candidates.first();
}

function orderContinueButton(page, { timeout } = {}) {
  return uniqueVisibleButton(page, CONTINUE_SHAPED, {
    where: 'Review Order',
    consequence: 'mints the order',
    timeout,
  });
}

function cartContinueButton(page, { timeout } = {}) {
  return uniqueVisibleButton(page, /^continue$/i, {
    where: 'The cart',
    consequence: 'moves this basket to Review Order',
    timeout,
  });
}

module.exports = { orderContinueButton, cartContinueButton, uniqueVisibleButton, CONTINUE_SHAPED };
