// tests/utils/buyRow.js
//
// The PDP buy row, as redesigned by 16 Sep 2026.
//
// WHAT CHANGED. "Add to Cart" is no longer a text button. The buy row is now a
// bar holding the selected plan's figure and, on the right, up to two controls:
//
//   [ EMI  ₹1,770 x 24mo ]            [ 🛒 ]  [ Buy Now ]
//
// The cart control is ICON-ONLY — 44x44, no text at all:
//
//   <button aria-label="Add to cart"> <svg data-testid="AddShoppingCartIcon"> </button>
//
// so every `getByRole('button', { name: 'Add to Cart' })` in this repo stopped
// matching, and every spec that added a product failed on a control that is
// plainly on screen.
//
// WHICH PRODUCTS HAVE IT. Measured across the catalogue, logged out:
//
//   prodPaymentMode  pre-booking   Add to cart   Buy Now   Pre-book Now
//   UPFRONT          no                1            1           0
//   BOTH             no                0            1           0
//   UPFRONT          yes               0            0           1
//
// The icon is an UPFRONT-ONLY affordance. A subscription-capable (`BOTH`)
// product offers Buy Now alone, and a pre-booking product offers neither — see
// regression/prebooking.spec.js. So a spec that needs to add to cart must pick
// an UPFRONT, non-pre-booking product; picking "the first product on the
// listing" now lands on a pre-booking Apple device and finds no control at all.
//
// WHY THE NAME IS NOT ENOUGH ON ITS OWN. CLAUDE.md records what locating this
// CTA by name cost on 14 Aug 2026: the recommended-products carousel further
// down the PDP had its own "Add to Cart", `.first()` reached it, and a
// ₹1,24,999 phone went into a live cart instead of a ₹1,200 powerbank. The new
// aria-label looked unique on the products sampled here, but that was measured
// on pages whose carousel had not mounted (`a[href*="/pd/"]` count 0 at the
// bottom of the page), so it is NOT evidence that the name is unique in
// general. Keep the structural constraint — the cart control BEFORE "Buy Now"
// in document order — which holds whether or not the carousel is present.
//
// Why `aria-label` and not `svg[data-testid="AddShoppingCartIcon"]`: the testid
// is MUI's own, tied to the specific icon glyph, and a design swap to a
// different cart icon silently breaks it. The aria-label is the name the site
// publishes to assistive technology, so it is the thing that must not change.

const ADD_TO_CART_LABEL = 'Add to cart';

// Clicks the cart control that belongs to THIS product, never a carousel tile.
// Runs in the page so the "before Buy Now" ordering is evaluated against the
// live DOM in one shot. Returns false when the row has no cart control, which
// is the correct answer for a BOTH or pre-booking product rather than an error.
async function clickAddToCart(page) {
  return page.evaluate((label) => {
    const buttons = [...document.querySelectorAll('button')];
    const isCart = (b) => (b.getAttribute('aria-label') || '').trim().toLowerCase() === label.toLowerCase();
    const isBuyNow = (b) => /^buy now$/i.test((b.innerText || '').trim());

    const buyNow = buttons.findIndex(isBuyNow);
    if (buyNow < 0) return false;

    const add = buttons
      .map((b, i) => (isCart(b) ? i : -1))
      .filter((i) => i >= 0 && i < buyNow)
      .pop();

    if (add === undefined) return false;
    buttons[add].click();
    return true;
  }, ADD_TO_CART_LABEL);
}

// For assertions and waits. Scoped by accessible name only — callers that are
// about to CLICK should use clickAddToCart() instead, for the carousel reason
// above.
function addToCartControl(page) {
  return page.getByRole('button', { name: ADD_TO_CART_LABEL, exact: true });
}

function buyNowControl(page) {
  return page.getByRole('button', { name: 'Buy Now', exact: true });
}

// True when this listing row can actually be added to a cart from its PDP.
// Takes a row from GET /product-service/apps/products.
function rowOffersAddToCart(row) {
  const preBooking = ((row && row.variant && row.variant.tags) || []).some((t) =>
    /pre-?book/i.test((t && t.name) || '')
  );
  return row && row.prodPaymentMode === 'UPFRONT' && !preBooking;
}

module.exports = {
  ADD_TO_CART_LABEL,
  clickAddToCart,
  addToCartControl,
  buyNowControl,
  rowOffersAddToCart,
};
