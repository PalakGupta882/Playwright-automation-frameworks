// tests/utils/surfaceIdentity.js
//
// WHICH item is this surface showing?
//
// Every pricing check in this suite compares amounts: does the tile match the
// PDP, does the cart total follow from its lines, does Review Order agree with
// Payment Summary. All of it is blind to the bug class that actually bit us.
//
// On 14 Aug 2026 a Device Protection charge read ₹1 on Review Order and ₹2,001
// on Payment Summary. Every amount check passed at every hop, because each page
// was internally consistent — the pages were showing DIFFERENT PRODUCTS. No
// arithmetic assertion can see that. A shopper in that state is charged for
// something they never reviewed, which is the worst failure this storefront can
// produce, and it is invisible to a suite that only adds up numbers.
//
// Two measured facts make it easy to reach:
//
//   1. The SUBSCRIPTION basket holds exactly ONE line. Subscribing to a product
//      silently replaces whatever was in it. Review one product, subscribe to
//      another, and the basket has swapped underneath.
//   2. The same product exists under different bpids in the two baskets —
//      MacBook Air M5 as APPLALAPO1IYU3 (vas 0) and APPLALAPO55QSK (vas 1).
//      Same name on screen, different variant, different price, different
//      add-ons.
//
// So: capture an identity tuple at every hop and assert it did not change.
// Identity first, arithmetic second — when a figure differs between surfaces,
// a changed item explains it more often than broken maths.

// Normalises whatever a surface gives us into one comparable shape.
//
// Fields are optional by design: a listing tile knows a bpid and nothing else,
// the cart API knows variant and product ids, and create-order returns a sku.
// Comparison is over the fields BOTH sides actually carry, so a hop is never
// waved through for lacking a field, and never fails for a field one side
// cannot know.
function identityOf(source = {}) {
  return {
    bpid: source.bpid ?? source.variant?.bpid ?? null,
    sku: source.sku ?? source.variant?.sku ?? null,
    variantId: source.variant_id ?? source.variantId ?? source.variant?.id ?? null,
    productId: source.product_id ?? source.productId ?? source.product?.id ?? null,
    name: source.product_name ?? source.name ?? source.product?.product_name ?? null,
  };
}

// Every line of a cart-API basket, as identity tuples.
function identitiesFromCart(cartData = {}) {
  const items = cartData.items || cartData.cart_items || [];
  return items.map((item) => ({
    ...identityOf(item),
    quantity: Number(item.quantity ?? item.qty ?? 1),
    vasAmount: Number(item.vas_amount) || 0,
  }));
}

// The order that was actually created, out of POST /customer-order/v2/create-order.
//
// This is the authoritative answer to "what did the shopper just buy", and it is
// the one surface that cannot be argued with — everything before it is a
// rendering, this is a record.
function identitiesFromCreateOrder(body = {}) {
  const orders = body?.data?.orders || [];
  return orders.map((order) => ({
    ...identityOf(order),
    orderId: order.order_id ?? null,
    amount: Number(order.amount) || 0,
  }));
}

// A stable key for set comparison. bpid is preferred because every surface that
// names an item at all carries one; sku and variant id are fallbacks.
function keyOf(identity) {
  return identity.bpid || identity.sku || identity.variantId || identity.name || '(unidentified)';
}

// Compares two surfaces and returns what differs, in a form a failure message
// can print directly. Returns [] when the surfaces agree.
//
// Only fields present on BOTH sides are compared — see identityOf.
function compareIdentities(before, after, { beforeLabel = 'before', afterLabel = 'after' } = {}) {
  const problems = [];

  const beforeKeys = before.map(keyOf);
  const afterKeys = after.map(keyOf);

  const missing = beforeKeys.filter((k) => !afterKeys.includes(k));
  const added = afterKeys.filter((k) => !beforeKeys.includes(k));

  if (missing.length) {
    problems.push(
      `item(s) present on ${beforeLabel} but gone from ${afterLabel}: ${missing.join(', ')}`
    );
  }
  if (added.length) {
    problems.push(
      `item(s) on ${afterLabel} that were never on ${beforeLabel}: ${added.join(', ')}`
    );
  }

  // Same item, changed particulars.
  for (const b of before) {
    const a = after.find((x) => keyOf(x) === keyOf(b));
    if (!a) continue;
    for (const field of ['sku', 'variantId', 'productId']) {
      if (b[field] && a[field] && b[field] !== a[field]) {
        problems.push(`${keyOf(b)}: ${field} changed from ${b[field]} to ${a[field]}`);
      }
    }
    if (b.quantity !== undefined && a.quantity !== undefined && b.quantity !== a.quantity) {
      problems.push(`${keyOf(b)}: quantity changed from ${b.quantity} to ${a.quantity}`);
    }
  }

  return problems;
}

// A one-line-per-item rendering for logs and failure messages.
function formatIdentities(identities, label) {
  if (!identities.length) return `  ${label}: (no items)`;
  return (
    `  ${label} (${identities.length} item${identities.length === 1 ? '' : 's'}):\n` +
    identities
      .map(
        (i) =>
          `    ${String(i.name ?? '?').slice(0, 30).padEnd(32)} bpid=${String(i.bpid ?? '-').padEnd(16)} ` +
          `sku=${String(i.sku ?? '-').slice(0, 28).padEnd(30)}` +
          (i.vasAmount !== undefined ? ` vas=${i.vasAmount}` : '') +
          (i.amount !== undefined ? ` amount=${i.amount}` : '')
      )
      .join('\n')
  );
}

module.exports = {
  identityOf,
  identitiesFromCart,
  identitiesFromCreateOrder,
  compareIdentities,
  formatIdentities,
  keyOf,
};
