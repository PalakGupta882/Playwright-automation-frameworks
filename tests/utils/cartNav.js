// tests/utils/cartNav.js
//
// Getting onto the cart and review pages without the two site behaviours that
// otherwise look like test faults.
//
// Extracted from checkout-flow.spec.js, which needed both and grew its own
// copies. A second spec now walks the same path, and two copies of a workaround
// for a live bug drift apart exactly when the bug's status changes.

const { BASE_URL, URLS, TIMEOUTS } = require('../data/constants');

// KNOWN PRODUCTION BUG. Loading /cart throws
// `window?.nitro?.updatecart is not a function` and Next.js replaces the page
// with "Application error: a client-side exception has occurred" — measured 7 of
// 9 loads with a populated cart, 0 of 6 with an empty one. Raised and accepted
// as expected behaviour, so the suite does not fail on it.
// Full analysis: docs/BUG-01-cart-nitro-crash.pdf
const CLIENT_SIDE_CRASH = /Application error: a client-side exception/i;

// Opens the cart, reloading past the crash above.
//
// This is a deliberate choice to ignore a known accepted condition, not an
// oversight. The specs that call it are about pricing and checkout; letting an
// intermittent third-party race mask their assertions would make them useless.
// If the bug's accepted status ever changes, the guard belongs in a test of its
// own rather than here.
async function openCart(page, attempts = 4) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    await page.goto(`${BASE_URL}${URLS.cart}?flow=shopping`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    const text = await page.locator('body').innerText().catch(() => '');
    if (!CLIENT_SIDE_CRASH.test(text)) return attempt;
    console.log(`cart load ${attempt}/${attempts} hit the nitro crash — reloading`);
  }
  throw new Error(
    `The cart crashed on all ${attempts} loads with a client-side exception ` +
      '(window?.nitro?.updatecart is not a function). This is the known bug, not a test fault.'
  );
}

// The site pops an "Exchange is now available!" dialog over the cart and review
// pages. Left alone it intercepts pointer events, which is how a click times out
// against a control that is plainly visible in the screenshot.
async function dismissExchangeDialog(page) {
  const notNow = page.getByRole('button', { name: /^not now$/i }).first();
  if (await notNow.isVisible().catch(() => false)) {
    await notNow.click({ timeout: TIMEOUTS.action }).catch(() => {});
  }
}

module.exports = { openCart, dismissExchangeDialog, CLIENT_SIDE_CRASH };
