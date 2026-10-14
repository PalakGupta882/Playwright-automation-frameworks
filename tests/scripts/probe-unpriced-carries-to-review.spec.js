// tests/scripts/probe-unpriced-carries-to-review.spec.js
//
// THE QUESTION DEVOPS ASKED, 27 Aug 2026.
//
// Their position on BUG-A: if variant-pricing is blocked, the PDP showing ₹0 is
// expected and the flow is meant to go ahead. It only becomes a blocker if the
// wrong price SURVIVES — i.e. the shopper reaches Review Order and is still
// quoted ₹0, or anything other than the real price.
//
// So the test is not "does the PDP show 0". It is:
//
//   block variant-pricing ONLY (never the cart API)
//     -> add the unpriced product to the cart from the PDP
//        -> read the cart
//           -> continue to Review Order
//              -> is the price there CORRECT, or is it 0?
//
// The block stays on for the whole journey, because a shopper whose network is
// dropping that call does not get it back when they navigate.
//
// WHAT THIS WRITES. One real product into the real cart on the real account —
// a normal, reversible cart write, which CLAUDE.md distinguishes from the
// order-minting actions behind BYTEPE_ALLOW_WRITES. It STOPS at Review Order and
// never clicks Continue there; that is the click that mints an order id.
// The line it adds is named in the output so it can be removed afterwards.
const { test, expect } = require('@playwright/test');
const { BASE_URL, BASE_API_URL, URLS, TIMEOUTS } = require('../data/constants');
const { assertFreshSession } = require('../utils/session');
const { openCart, dismissExchangeDialog } = require('../utils/cartNav');
const { parseOrderSummary } = require('../utils/priceText');

const VARIANT_PRICING = '**/apps/variant-pricing/**';

// Read the cart through a context that is NOT blocked, so the truth about what
// the basket holds never depends on the failure being injected into the page.
async function cartVia(request, paymentType = 'UPFRONT') {
  const res = await request.get(`${BASE_URL}/api/cart?payment_type=${paymentType}`, {
    headers: { accept: 'application/json' },
  });
  if (!res.ok()) return { status: res.status(), items: [], raw: null };
  const body = await res.json();
  const data = body?.data || {};
  const items = data.items || data.cart_items || data.cartItems || [];
  return { status: res.status(), items, raw: data };
}

// MEASURED SHAPE, 27 Aug 2026. The first version of this guessed flat keys
// (line.bpid, line.price) and found none, so every line came back with
// bpid=undefined, the "already in the cart" filter matched nothing, and it
// picked a product the cart ALREADY HELD. The POST then returned
// 200 "successfully added" and moved nothing — exactly the no-op CLAUDE.md
// warns about — and the whole run proved nothing.
//
//   items[].variant.bpid          the identity that matters
//   items[].variant.sku
//   items[].product.product_name
//   items[].MOP / .MRP            per line, already x quantity
//   data.total_amount             what the cart page shows as Total
function lineIdentity(line) {
  return {
    name: line.product?.product_name,
    bpid: line.variant?.bpid,
    sku: line.variant?.sku,
    variantId: line.variant_id,
    mop: line.MOP,
    mrp: line.MRP,
    purchaseMode: line.purchase_mode,
    qty: line.quantity,
  };
}

test('does the PDP zero price carry through to Review Order', async ({ page, request }) => {
  test.setTimeout(300000);
  assertFreshSession();

  // ---- 1. What the basket holds now, and what to add -------------------
  const before = await cartVia(request);
  const heldBpids = new Set(before.items.map((l) => lineIdentity(l).bpid).filter(Boolean));
  console.log(`cart before: ${before.items.length} line(s); bpids held: ${[...heldBpids].join(', ') || 'none'}`);

  const listRes = await request.get(
    `${BASE_API_URL.replace(/\/+$/, '')}/product-service/apps/products?page=1&limit=100`,
    { headers: { accept: 'application/json' } }
  );
  const catalogue = ((await listRes.json())?.data?.items || []).filter(
    (p) => p?.slug && p?.variant?.bpid && p?.variant?.id
  );

  // Must not already be in the cart. CLAUDE.md: re-adding a product the cart
  // already holds is a 200 no-op — nothing moves, not even the quantity — so a
  // repeat subject would make every comparison below trivially true.
  let subject = null;
  let truth = null;
  for (const p of catalogue) {
    if (heldBpids.has(p.variant.bpid)) continue;
    // UPFRONT ONLY. The first attempt picked Pixel 11 Pro Fold, which is
    // prodPaymentMode BOTH — the subscription layout, measured as NOT affected
    // by the blocked pricing call (it still prices, renders no placeholder, and
    // has no Add to Cart / Buy Now at all). Testing the carry-through on a
    // product that never showed ₹0 answers nothing.
    if (p.prodPaymentMode !== 'UPFRONT') continue;
    const pr = await request.get(
      `${BASE_URL}/api/apps/variant-pricing/${p.slug}/${p.variant.id}`,
      { headers: { accept: 'application/json' } }
    );
    if (!pr.ok()) continue;
    const data = (await pr.json())?.data || {};
    if (!data.upfront?.price) continue;
    subject = p;
    truth = data.upfront;
    break;
  }
  expect(subject, 'no addable upfront product found that the cart does not already hold').toBeTruthy();
  console.log(
    `subject: ${subject.name} (${subject.slug}/${subject.variant.bpid})\n` +
      `  TRUE price from the API — upfront.price ₹${truth.price}, MRP ₹${truth.cut_price}`
  );

  // ---- 2. Block ONLY variant-pricing, for the whole journey -------------
  const blocked = [];
  await page.route(VARIANT_PRICING, (route) => {
    blocked.push(route.request().url().replace(BASE_URL, ''));
    return route.abort('failed');
  });

  // The cart API is deliberately NOT blocked — that is the whole point of the
  // scenario. Record what the page sends and what it gets back.
  const cartCalls = [];
  page.on('response', async (res) => {
    if (!/\/api\/cart/.test(res.url())) return;
    cartCalls.push({
      method: res.request().method(),
      status: res.status(),
      url: res.url().replace(BASE_URL, ''),
      payload: res.request().postData(),
      body: await res.text().catch(() => '').then((t) => t.slice(0, 200)),
    });
  });

  // ---- 3. The unpriced PDP ---------------------------------------------
  await page.goto(`${BASE_URL}/pd/${subject.slug}/${subject.variant.bpid}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.keyboard.press('Escape').catch(() => {});
  await page.getByText(/choose your plan/i).first().waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2500);

  const pdpText = await page.locator('body').innerText();
  const pdpPriced = await page.getByText(/^₹[\d,]+$/).first().isVisible().catch(() => false);
  const pdpPlaceholder = /₹0\s*x\s*undefined/i.test(pdpText);
  console.log(
    `PDP with pricing blocked: headline price visible=${pdpPriced}, ` +
      `"₹0 x undefinedmo" present=${pdpPlaceholder}, blocked calls=${blocked.length}`
  );

  // ---- 4. Add to cart, structurally anchored ---------------------------
  const addIndex = await page.evaluate(() => {
    const buttons = [...document.querySelectorAll('button')];
    const label = (b) => (b.innerText || '').trim();
    const buyNow = buttons.findIndex((b) => /^buy now$/i.test(label(b)));
    if (buyNow < 0) return null;
    return buttons
      .map((b, i) => (/^add to cart$/i.test(label(b)) ? i : -1))
      .filter((i) => i >= 0 && i < buyNow)
      .pop() ?? null;
  });
  expect(addIndex, 'no PDP-own Add to Cart button found').not.toBeNull();

  await page.evaluate((i) => document.querySelectorAll('button')[i].click(), addIndex);
  await page.waitForTimeout(5000);

  const post = cartCalls.find((c) => c.method === 'POST');
  console.log(
    `POST /api/cart -> ${post ? `${post.status} ${post.body}` : 'NO CART REQUEST WAS MADE'}\n` +
      `  sent: ${post ? post.payload : '-'}`
  );

  // ---- 5. What the cart API now holds for that line ---------------------
  const after = await cartVia(request);
  const added = after.items.map(lineIdentity).find((l) => l.bpid === subject.variant.bpid);
  console.log(
    `cart API after: ${after.items.length} line(s). The added line: ` +
      (added ? JSON.stringify(added) : 'NOT FOUND IN THE BASKET')
  );

  // ---- 6. The cart page, still with pricing blocked ---------------------
  //
  // A/B, because the first run of this hit the nitro crash on 4 of 4 loads
  // while an ordinary regression run the same morning hit it on 1 of 4. That
  // difference might be the block and might be the known intermittent bug, and
  // guessing which would put the wrong label on it. So: try with the block on,
  // and if the cart will not load, lift the block and try again. If it then
  // loads, blocking variant-pricing is what kills the cart page — a bigger
  // finding than a wrong number, and the honest answer to the DevOps question.
  let cartLoadedWithBlock = true;
  try {
    await openCart(page, 6);
  } catch (crash) {
    cartLoadedWithBlock = false;
    console.log(`CART PAGE would not load with variant-pricing blocked: ${crash.message}`);
    await page.unroute(VARIANT_PRICING);
    console.log('lifting the block and retrying the cart page to see whether the block was the cause...');
    await openCart(page, 6);
    console.log('CART PAGE loaded once the block was lifted.');
  }
  console.log(`cart page loaded with the block still on: ${cartLoadedWithBlock}`);
  await dismissExchangeDialog(page);
  await page.getByText(/total amount/i).first().waitFor({ state: 'visible', timeout: TIMEOUTS.nav }).catch(() => {});
  const cartSummary = parseOrderSummary(await page.locator('body').innerText());
  console.log(
    `CART PAGE  : ${cartSummary ? `${cartSummary.itemCount} items · price ₹${cartSummary.price} · ` +
      `discount ₹${cartSummary.discount} · extras ₹${cartSummary.extras} · TOTAL ₹${cartSummary.total}` : 'no Order Summary found'}`
  );

  // ---- 7. Review Order. STOP THERE. ------------------------------------
  await page.getByRole('button', { name: /^continue$/i }).first().click({ timeout: TIMEOUTS.action });
  await page.waitForURL(new RegExp(URLS.review), { timeout: 60000 });
  await dismissExchangeDialog(page);
  await page.getByText(/total amount/i).first().waitFor({ state: 'visible', timeout: TIMEOUTS.nav }).catch(() => {});

  const reviewText = await page.locator('body').innerText();
  const reviewSummary = parseOrderSummary(reviewText);
  console.log(
    `REVIEW PAGE: ${reviewSummary ? `${reviewSummary.itemCount} items · price ₹${reviewSummary.price} · ` +
      `discount ₹${reviewSummary.discount} · extras ₹${reviewSummary.extras} · TOTAL ₹${reviewSummary.total}` : 'no Order Summary found'}`
  );
  console.log(`  "₹0 x undefined" on Review Order: ${/₹0\s*x\s*undefined/i.test(reviewText)}`);
  console.log(`  any "undefined" in review copy  : ${/undefined/i.test(reviewText.split('\n').filter((l) => l.length < 120).join('\n'))}`);
  console.log(`  variant-pricing calls blocked so far: ${blocked.length}`);
  console.log(`  STOPPED at Review Order without pressing Continue: ${page.url()}`);

  // ---- 8. The verdict ---------------------------------------------------
  //
  // CLAUDE.md: "Price (N Items)" is a sum of MRPs, so the line that must move by
  // the selling price is the TOTAL, never the Price line.
  const beforeTotal = before.raw?.total_amount ?? null;
  const delta = cartSummary && beforeTotal !== null ? cartSummary.total - beforeTotal : null;
  console.log(
    `\nVERDICT INPUTS\n` +
      `  true upfront price of the added product : ₹${truth.price}\n` +
      `  cart total before                        : ₹${beforeTotal ?? 'unknown'}\n` +
      `  cart total after                         : ₹${cartSummary ? cartSummary.total : 'unknown'}\n` +
      `  total moved by                           : ₹${delta ?? 'unknown'}  (expected ₹${truth.price})\n` +
      `  review total                             : ₹${reviewSummary ? reviewSummary.total : 'unknown'}\n` +
      `  cart total === review total              : ${
        cartSummary && reviewSummary ? cartSummary.total === reviewSummary.total : 'unknown'
      }`
  );
  console.log(
    `\nCLEAN UP: remove "${subject.name}" (${subject.variant.bpid}) from the cart if you do not want it there.`
  );
});
