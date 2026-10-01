// tests/utils/stageWallet.js
//
// Helpers for regression/stage-wallet-pricing.spec.js — the ByteCoins wallet,
// which exists on STAGE only (not live on production as of 30 Sep 2026).
//
// Everything here was measured on stage before it was written; see
// tests/scripts/probe-stage-wallet.spec.js. The contract, in one place:
//
//   GET  wallet-service/wallet                     availableBalance, redeemableCoins, faceValue
//   GET  wallet-service/wallet/ledger              EARN / BURN entries, each tied to an orderId
//   GET  wallet-service/product/:variantId/coins   maxRedeemableCoins, redeemableCoinsForUser,
//                                                  redeemableValue, earnCoins, applied
//                                                  (needs x-bucket-name — 400 without it)
//   POST wallet-service/product/:variantId/apply   {coins} or {} for the maximum
//   POST wallet-service/product/:variantId/remove
//   GET  wallet-service/order/:masterOrderId       lines[].burnCoins, totalBurnCoins
//
// Three measured facts that shape every assertion:
//
//   1. apply/remove only flip a flag. The wallet balance does NOT move, and
//      variant-pricing is byte-identical before and after — the pricing service
//      carries no coin field at all. Coins surface in the cart
//      (bytecoin_coins / total_bytecoin_coins), Review Order, and payment-summary
//      (bytecoin_discount).
//   2. Nothing is burned at create-order. The order sits PENDING with
//      burnCoins 0; the BURN ledger entry is written at payment.
//   3. The stage test account is SHARED and in active use — its balance moved
//      and a cart line vanished during the probe. So a raw before/after balance
//      delta proves nothing. reconcileWallet() explains the delta from the
//      ledger instead, and reports entries that are not ours as foreign rather
//      than mistaking them for a defect.
//
// Every failure carries one of five category tags so a report can be triaged
// without reading the stack:

const { SITE_HOST, BASE_API_URL, BASE_URL } = require('../data/env');
const { variantPricingPath } = require('../data/emiApi');

const CATEGORY = {
  PRICING: '[PRICING]', // a figure computed wrongly
  WALLET: '[WALLET]', // coins deducted, held, released or offered wrongly
  API: '[API]', // two API responses disagree, or one is malformed
  FRONTEND: '[FRONTEND]', // the page shows something the API did not say
  ENV: '[ENV]', // stage missing an endpoint, wrong host, no session
};

const STAGE_HOST = 'stage-web.bytepe.com';
const IS_STAGE = SITE_HOST === STAGE_HOST;

const num = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));

// Every page request is checked against the host. Anything bound for the
// production storefront is aborted and recorded, so a stage page that quietly
// calls production is a failure with a name, never a silent mix.
function guardProductionTraffic(page) {
  const leaks = [];
  page.route(/^https?:\/\/(www\.)?bytepe\.com\//, (route) => {
    leaks.push(`${route.request().method()} ${route.request().url()}`);
    return route.abort();
  });
  return leaks;
}

class StageWalletApi {
  constructor(request, bucket) {
    this.request = request;
    this.bucket = bucket;
  }

  async call(method, path, { data, bucket = false } = {}) {
    const url = path.startsWith('http') ? path : `${BASE_API_URL}/${path}`;
    if (new URL(url).hostname !== STAGE_HOST) {
      throw new Error(`${CATEGORY.ENV} refusing to call a non-stage host: ${url}`);
    }
    const headers = bucket ? { 'x-bucket-name': this.bucket } : undefined;
    const res = await this.request.fetch(url, { method, data, headers });
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      // The storefront answers unknown /api routes with its HTML shell and a 200.
      throw new Error(
        `${CATEGORY.ENV} ${method} ${path} did not return JSON (HTTP ${res.status()}) — ` +
          'the endpoint is not available on stage. Not falling back to production.'
      );
    }
    // Two different 404s. "Route not found" means stage does not serve the
    // endpoint at all. Anything else is the service answering about the record —
    // e.g. coins -> 404 "No price for this variant/bucket" — which is data.
    if (res.status() === 404 && /route not found/i.test(json.message || '')) {
      throw new Error(`${CATEGORY.ENV} ${method} ${path} -> 404 Route not found: stage does not serve this endpoint`);
    }
    if (!res.ok()) {
      throw new Error(`${CATEGORY.API} ${method} ${path} -> HTTP ${res.status()}: ${text.slice(0, 400)}`);
    }
    return json;
  }

  wallet() {
    return this.call('GET', 'wallet-service/wallet').then((j) => j.data);
  }

  ledger(limit = 20) {
    return this.call('GET', `wallet-service/wallet/ledger?page=1&limit=${limit}`).then((j) => j.data.items || []);
  }

  coins(variantId) {
    return this.call('GET', `wallet-service/product/${variantId}/coins`, { bucket: true }).then((j) => j.data);
  }

  apply(variantId, coins) {
    const data = coins === undefined ? {} : { coins };
    return this.call('POST', `wallet-service/product/${variantId}/apply`, { data, bucket: true }).then((j) => j.data);
  }

  remove(variantId) {
    return this.call('POST', `wallet-service/product/${variantId}/remove`, { bucket: true }).then((j) => j.data);
  }

  orderCoins(masterOrderId) {
    return this.call('GET', `wallet-service/order/${masterOrderId}`).then((j) => j.data);
  }

  cart() {
    return this.call('GET', 'cart?payment_type=UPFRONT').then((j) => j.data);
  }

  reviewCart() {
    return this.call('GET', 'cart?payment_type=UPFRONT&is_review=true').then((j) => j.data);
  }

  pricing(slug, variantId) {
    return this.call('GET', variantPricingPath(slug, variantId)).then((j) => j.data);
  }

  // The add-to-cart body, captured from the PDP's own request (probe part 2).
  addToCart(productId, variantId) {
    return this.call('POST', 'cart', {
      data: { product_id: productId, variant_id: variantId, quantity: 1, payment_type: 'UPFRONT', purchase_mode: 'CC_EMI' },
    });
  }

  // PUT /cart/:itemId {quantity} is a DELTA, not an absolute quantity — the
  // client sends (new - current). Sending an absolute value adds to the line.
  changeQuantity(cartItemId, delta) {
    return this.call('PUT', `cart/${cartItemId}`, { data: { quantity: delta } });
  }

  removeFromCart(line) {
    return this.call('PUT', `cart/remove/${line.id}`, {
      data: { product_id: line.product_id, variant_id: line.variant_id },
    });
  }
}

// A point-in-time view of the wallet plus the ledger ids already seen, so the
// entries written after it can be isolated.
async function snapshotWallet(api) {
  const [wallet, ledger] = await Promise.all([api.wallet(), api.ledger(50)]);
  return {
    at: new Date().toISOString(),
    available: num(wallet.availableBalance),
    redeemable: num(wallet.redeemableCoins),
    faceValue: num(wallet.faceValue),
    seen: new Set(ledger.map((e) => e.id)),
  };
}

// Explains the change in availableBalance since `before` from the ledger.
//
// availableBalance includes pending (inactive) EARNs — measured: the gap between
// it and redeemableCoins equals the sum of inactive EARN entries — so it moves
// by exactly the sum of new ledger entries. Anything left over is unexplained
// and is a wallet defect; entries tied to someone else's order are foreign.
async function reconcileWallet(api, before, ourOrderIds = []) {
  const after = await snapshotWallet(api);
  const ledger = await api.ledger(50);
  const fresh = ledger.filter((e) => !before.seen.has(e.id));
  const isOurs = (e) => ourOrderIds.some((id) => id && (e.orderId === id || e.orderId === String(id)));
  const ours = fresh.filter(isOurs);
  const foreign = fresh.filter((e) => !isOurs(e));
  const sum = (xs) => xs.reduce((s, e) => s + num(e.coinAmount), 0);
  const availableDelta = after.available - before.available;
  return {
    before: { available: before.available, redeemable: before.redeemable },
    after: { available: after.available, redeemable: after.redeemable },
    availableDelta,
    oursSum: sum(ours),
    foreignSum: sum(foreign),
    unexplained: availableDelta - sum(fresh),
    ours: ours.map(brief),
    foreign: foreign.map(brief),
  };
}

const brief = (e) => `${e.createdAt} ${e.entryType} ${e.coinAmount} ${e.productName || ''} ${e.orderId || ''} ${e.status}`;

// ---- page text parsers ------------------------------------------------------
//
// Text, not locators, for the reason priceText.js gives: the summary rows carry
// no role, test id or stable class. What is stable is the label beside each
// figure. Measured on stage Review Order (30 Sep 2026):
//
//   Using / 1,949 Bytecoins / Remove              <- per-line chip
//   Price (1 Item) / ₹5,499
//   Discount / -₹1,600
//   Bytecoins Redeemed / 1,949 / -₹1,949
//   Total Amount / ₹1,950

const money = (s) => num(String(s).replace(/[₹,\s]/g, ''));

function lines(text) {
  return String(text).split('\n').map((l) => l.trim()).filter(Boolean);
}

function afterLabel(ls, label, offset = 1) {
  const i = ls.findIndex((l) => label.test(l));
  return i < 0 ? undefined : ls[i + offset];
}

function parseReviewCoins(text) {
  const ls = lines(text);
  const usingLine = afterLabel(ls, /^using$/i);
  return {
    using: usingLine ? money(usingLine.replace(/bytecoins?/i, '')) : NaN,
    redeemedCoins: money(afterLabel(ls, /^bytecoins redeemed$/i) || ''),
    redeemedRupees: Math.abs(money(afterLabel(ls, /^bytecoins redeemed$/i, 2) || '')),
    price: money(afterLabel(ls, /^price \(\d+ items?\)$/i) || ''),
    discount: Math.abs(money(afterLabel(ls, /^discount$/i) || '')),
    total: money(afterLabel(ls, /^total amount$/i) || ''),
  };
}

// Payment Summary's breakdown, as label/amount pairs between "Price (N item)"
// and "Order Total". A row reading "Free" contributes nothing.
function parsePaymentBreakdown(text) {
  const ls = lines(text);
  const start = ls.findIndex((l) => /^price \(\d+ items?\)$/i.test(l));
  const end = ls.findIndex((l, i) => i > start && /^order total$/i.test(l));
  if (start < 0 || end < 0) return null;
  // Most rows are label / amount. The Bytecoins row is three lines —
  // "Bytecoins Redeemed / 1,949 / -₹1,949" — a coin count then the rupees.
  const rows = [];
  for (let i = start; i < end; ) {
    const next = ls[i + 1];
    const threeLine = !/₹|^free$/i.test(next) && /₹/.test(ls[i + 2] || '') && i + 2 < end;
    const amount = threeLine ? ls[i + 2] : next;
    rows.push({ label: ls[i], amount: /^free$/i.test(amount) ? 0 : money(amount) });
    i += threeLine ? 3 : 2;
  }
  return { rows, orderTotal: money(ls[end + 1]) };
}

// ---- Payment Summary, to the rupee ------------------------------------------
//
// Reconciles every figure Payment Summary can show against one base — the
// payable the order was created for — and returns the mismatches, each tagged.
// Measured sources (30 Sep 2026, order DCM300926EA456E):
//
//   payments/v2/payment-summary/:id     upfront.{price, discount, cut_price,
//                                       payable_amount, bytecoin_discount},
//                                       bajaj_emi.{emi_options[], payable_amount}
//   payments/v2/bank-emi-options/:id    banks[].plans[] {emi, lastEmi, interest,
//                                       discount, totalPayable, payable}
//   payments/v2/split/plan/:id          total_gross, part_1_gross, part_2_gross
//
// Formulas, all measured exact on the plans that were right:
//   payable        = cut_price - discount - bytecoin_discount   (= price - bytecoins)
//   plan total     = emi x (tenure - 1) + lastEmi
//   plan total     = payable - discount + interest
//   no-cost plan   total = payable
async function reconcilePaymentSummary(api, masterId, pageText) {
  const out = { mismatches: [], figures: {} };
  const miss = (cat, msg) => out.mismatches.push(`${cat} ${msg}`);
  const ps = (await api.call('GET', `payments/v2/payment-summary/${masterId}`)).data;
  const banks = (await api.call('GET', `payments/v2/bank-emi-options/${masterId}`)).data;
  const split = await api.call('GET', `payments/v2/split/plan/${masterId}`).then((j) => j.data).catch(() => null);

  const u = ps.upfront;
  const payable = num(u.payable_amount);
  const coins = num(u.bytecoin_discount) || 0; // absent when no coins were applied
  out.figures.upfront = { cut_price: u.cut_price, discount: u.discount, price: u.price, bytecoin_discount: coins, payable };

  if (num(u.cut_price) - num(u.discount) - coins !== payable) {
    miss(CATEGORY.PRICING, `payable ${payable} != MRP ${u.cut_price} - discount ${u.discount} - bytecoins ${coins}`);
  }
  if ((num(ps.bytecoin_discount) || 0) !== coins) {
    miss(CATEGORY.API, `payment-summary top-level bytecoin_discount ${ps.bytecoin_discount} != upfront.bytecoin_discount ${coins}`);
  }
  if (banks.principal && num(banks.principal.total_MOP) - num(banks.principal.bytecoin_discount) !== payable) {
    miss(CATEGORY.API, `bank-emi-options principal ${banks.principal.total_MOP} - ${banks.principal.bytecoin_discount} != payable ${payable}`);
  }

  // Card EMI plans, every bank.
  for (const bank of banks.banks || []) {
    for (const p of bank.plans || []) {
      const tag = `${bank.bank} ${p.tenure}mo`;
      const byInstalments = num(p.emi) * (num(p.tenure) - 1) + num(p.lastEmi);
      if (byInstalments !== num(p.totalPayable)) miss(CATEGORY.PRICING, `${tag}: ${p.emi} x ${p.tenure - 1} + ${p.lastEmi} = ${byInstalments}, plan says ${p.totalPayable}`);
      if (payable - num(p.discount) + num(p.interest) !== num(p.totalPayable)) miss(CATEGORY.PRICING, `${tag}: payable ${payable} - discount ${p.discount} + interest ${p.interest} != total ${p.totalPayable}`);
      if (num(p.payable) !== payable) miss(CATEGORY.PRICING, `${tag}: plan payable ${p.payable} != order payable ${payable}`);
      if (/NCEMI/.test(p.type) && num(p.totalPayable) !== payable) miss(CATEGORY.PRICING, `${tag}: no-cost plan totals ${p.totalPayable}, not ${payable}`);
    }
  }

  // Bajaj Finserv EMI card.
  const bj = ps.bajaj_emi;
  if (bj) {
    out.figures.bajaj = { payable_amount: bj.payable_amount, total_amount: bj.total_amount, options: (bj.emi_options || []).map((o) => ({ tenure: o.tenure, inst: o.installment_amount, principal: o.principal })) };
    if (num(bj.payable_amount) !== payable) miss(CATEGORY.PRICING, `Bajaj payable_amount ${bj.payable_amount} != order payable ${payable} (diff ₹${num(bj.payable_amount) - payable})`);
    for (const o of bj.emi_options || []) {
      if (num(o.principal) !== payable) miss(CATEGORY.PRICING, `Bajaj ${o.tenure}mo principal ${o.principal} != payable ${payable}`);
      const total = num(o.installment_amount) * num(o.tenure);
      if (o.is_no_cost_emi && Math.abs(total - payable) > num(o.tenure)) miss(CATEGORY.PRICING, `Bajaj ${o.tenure}mo no-cost: ${o.installment_amount} x ${o.tenure} = ${total}, payable is ${payable} (diff ₹${total - payable})`);
    }
  }

  if (split && num(split.total_gross) !== payable) miss(CATEGORY.PRICING, `split total_gross ${split.total_gross} != payable ${payable}`);
  if (split && num(split.part_1_gross) + num(split.part_2_gross) !== num(split.total_gross)) miss(CATEGORY.PRICING, `split parts ${split.part_1_gross} + ${split.part_2_gross} != ${split.total_gross}`);

  // The page. Its breakdown rows must add up to its own Order Total, and
  // Order Total + interest must be the Total Cost the plan charges.
  if (pageText) {
    const b = parsePaymentBreakdown(pageText);
    const ls = lines(pageText);
    const totalCost = money(afterLabel(ls, /^total cost$/i) || '');
    const interest = money(afterLabel(ls, /^interest charged by bank$/i) || '');
    out.figures.page = { breakdown: b, interest, totalCost };
    if (!b) miss(CATEGORY.FRONTEND, 'Payment Summary rendered no "Price ... Order Total" breakdown');
    const rowsSum = b ? b.rows.reduce((s, r) => s + r.amount, 0) : NaN;
    if (b && rowsSum !== b.orderTotal) {
      const gap = rowsSum - b.orderTotal;
      miss(CATEGORY.FRONTEND, `breakdown rows add to ₹${rowsSum}, Order Total reads ₹${b.orderTotal} — ₹${gap} of deductions not shown as a row` + (gap === coins ? ` (exactly the ₹${coins} Bytecoins)` : ''));
    }
    if (b && !Number.isNaN(totalCost) && b.orderTotal + (Number.isNaN(interest) ? 0 : interest) !== totalCost) {
      miss(CATEGORY.FRONTEND, `Order Total ₹${b.orderTotal} + interest ₹${interest} != Total Cost ₹${totalCost}`);
    }
    const bajajFrom = (pageText.match(/Bajaj[^\n]*\n[^\n]*\n\s*From ₹([\d,]+)\/mo/i) || [])[1];
    if (bajajFrom && bj && bj.emi_options && bj.emi_options.length) {
      const expectFrom = Math.ceil(payable / Math.max(...bj.emi_options.map((o) => num(o.tenure))));
      if (money(bajajFrom) !== expectFrom) miss(CATEGORY.FRONTEND, `page says Bajaj "From ₹${bajajFrom}/mo"; on payable ₹${payable} the lowest instalment is ₹${expectFrom}`);
    }
  }
  return out;
}

module.exports = {
  reconcilePaymentSummary,
  CATEGORY,
  STAGE_HOST,
  IS_STAGE,
  BASE_URL,
  num,
  guardProductionTraffic,
  StageWalletApi,
  snapshotWallet,
  reconcileWallet,
  parseReviewCoins,
  parsePaymentBreakdown,
};
