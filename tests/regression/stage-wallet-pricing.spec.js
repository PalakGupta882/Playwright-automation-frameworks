// tests/regression/stage-wallet-pricing.spec.js
//
// ByteCoins wallet x pricing, on STAGE ONLY. The wallet is not live on
// production (30 Sep 2026), so this file skips unless the run targets stage:
//
//   BASE_URL=https://stage-web.bytepe.com npx playwright test regression/stage-wallet-pricing.spec.js --project=chromium --workers=1
//   + BYTEPE_ALLOW_WRITES=1 for the create-order case (mints a stage order, stops before payment)
//
// Session: auth.stage.json, written by
//   BASE_URL=https://stage-web.bytepe.com BYTEPE_MOBILE=<stage test number> BYTEPE_OTP=999000 npm run auth
//
// Read tests/utils/stageWallet.js first — it records the measured contract
// these assertions are built on, and three facts that change what "before minus
// after equals redeemed" can mean on this system:
//
//   * applying coins deducts nothing; it is a flag on the variant
//   * the pricing API carries no coin field; coins surface in the cart, Review
//     Order and payment-summary
//   * nothing is burned at create-order; the BURN happens at payment, which this
//     suite never reaches
//
// The account is SHARED. Other people's cart lines are never touched: products
// are picked from outside the current basket, and only lines this run added are
// removed afterwards. Balance deltas are reconciled against the ledger, never
// compared raw.
//
// Every failure is tagged [PRICING] [WALLET] [API] [FRONTEND] or [ENV].

const fs = require('fs');
const path = require('path');
const { test, expect } = require('../fixtures/pageFixtures');
const { assertFreshSession } = require('../utils/session');
const { buyNowControl } = require('../utils/buyRow');
const { watchCreateOrder, readCreateOrder } = require('../utils/createOrder');
const { writesAllowed } = require('../utils/writes');
const { AUTH_PATH, SITE_HOST } = require('../data/env');
const { pdpApiPath } = require('../data/emiApi');
const {
  CATEGORY: C,
  IS_STAGE,
  BASE_URL,
  num,
  guardProductionTraffic,
  StageWalletApi,
  snapshotWallet,
  reconcileWallet,
  parseReviewCoins,
  parsePaymentBreakdown,
  reconcilePaymentSummary,
} = require('../utils/stageWallet');

const SUMMARY_FILE = path.join(__dirname, '..', '..', 'test-results', 'stage-wallet-summary.json');

test.describe.configure({ mode: 'default', retries: 0 });
test.skip(!IS_STAGE, `stage-only: the ByteCoins wallet is not live on ${SITE_HOST}. Set BASE_URL=https://stage-web.bytepe.com`);

// ---- shared state, resolved once --------------------------------------------

let bucket; // the shopper's price bucket, as the browser itself sends it
let A; // product under test
let B; // second product, for the change-product case
let freeBudget; // redeemable coins no existing cart line has claimed
const added = []; // cart lines THIS run added — the only ones cleanup may remove
const touchedVariants = new Set(); // variants this run applied coins to

function record(name, data) {
  let all = {};
  try {
    all = JSON.parse(fs.readFileSync(SUMMARY_FILE, 'utf8'));
  } catch {
    /* first write of this run */
  }
  all[name] = { environment: BASE_URL, bucket, ...data };
  fs.mkdirSync(path.dirname(SUMMARY_FILE), { recursive: true });
  fs.writeFileSync(SUMMARY_FILE, JSON.stringify(all, null, 2));
  console.log(`\n[summary] ${name}\n${JSON.stringify(data, null, 2)}`);
}

// The cart spreads the WHOLE redeemable balance over the lines flagged applied
// (measured twice: total_bytecoin_coins == wallet.redeemableCoins exactly). On a
// shared account whose other lines hold all of it, a line this run adds gets 0 —
// so the cart-line cases skip, naming the numbers, rather than fail on someone
// else's state or clear their coins.
function skipUnlessCartBudget(product) {
  test.skip(
    freeBudget < product.offered,
    `${C.ENV} other cart lines on this shared account hold ${product.offered - Math.max(0, freeBudget)} of the ${product.offered} coins ` +
      `${product.slug} needs (free budget ${freeBudget}). Clear them or use a dedicated account.`
  );
}

const lineFor = (cart, variantId) => ((cart && cart.items) || []).find((i) => i.variant_id === variantId);

async function ensureInCart(api, product) {
  const cart = await api.cart();
  if (lineFor(cart, product.variantId)) return lineFor(cart, product.variantId);
  await api.addToCart(product.productId, product.variantId);
  const line = lineFor(await api.cart(), product.variantId);
  expect(line, `${C.API} POST /cart answered but ${product.slug} is not in GET /cart`).toBeTruthy();
  added.push(line);
  return line;
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180000);
  assertFreshSession();
  fs.rmSync(SUMMARY_FILE, { force: true });

  // The bucket decides maxRedeemableCoins, and the browser takes it from the
  // saved delivery address' pincode. Read it from the browser rather than
  // guessing a pincode: probe measured GOLD for 560005 and PLATINUM for the
  // account's own 201309 address.
  const context = await browser.newContext({ storageState: AUTH_PATH });
  const page = await context.newPage();
  const leaks = guardProductionTraffic(page);
  // A PDP, not /all-products: the bucket is set by the pincode check the PDP runs
  // for its product (measured — /all-products never sets it).
  const first = (await new StageWalletApi(context.request).call('GET', 'product-service/apps/products?page=1&limit=1')).data.items[0];
  await page.goto(`${BASE_URL}/pd/${first.slug}/${first.variant.bpid}`, { waitUntil: 'domcontentloaded' });
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('priceBucket')), {
      message: `${C.ENV} stage never set localStorage.priceBucket — no delivery pincode resolved for this account`,
      timeout: 45000,
    })
    .toBeTruthy();
  bucket = await page.evaluate(() => localStorage.getItem('priceBucket'));
  expect(leaks, `${C.ENV} the stage page called production`).toEqual([]);

  const api = new StageWalletApi(context.request, bucket);
  const wallet = await api.wallet();
  const cart = await api.cart();
  const inCart = new Set(((cart && cart.items) || []).map((i) => i.variant_id));
  const committed = num(cart && cart.total_bytecoin_coins) || 0;
  const free = num(wallet.redeemableCoins) - committed;

  // Pick from the live listing: upfront, not pre-booking, in stock, not already
  // in the shared basket, and redeemable in full from the budget nobody else's
  // cart line has claimed. Cheapest first — these go through create-order.
  const listing = await api.call('GET', 'product-service/apps/products?page=1&limit=100');
  const candidates = [];
  const unpriced = [];
  for (const r of listing.data.items) {
    if (r.prodPaymentMode !== 'UPFRONT' || ((r.variant && r.variant.tags) || []).length) continue;
    if (inCart.has(r.variant.id)) continue;
    const pdp = await api.call('GET', pdpApiPath(r.slug, r.variant.bpid));
    const v = pdp.data && pdp.data.variant;
    if (!v || v.available === false) continue;
    // 404 "No price for this variant/bucket" — the wallet has no coin pricing
    // for this variant in this shopper's bucket. Not a candidate; counted.
    const coins = await api.coins(v.id).catch((e) => {
      unpriced.push(`${r.slug}: ${e.message.slice(-80)}`);
      return null;
    });
    if (!coins) continue;
    const offered = num(coins.redeemableCoinsForUser);
    if (offered > 0 && offered === num(coins.maxRedeemableCoins)) {
      candidates.push({ slug: r.slug, bpid: r.variant.bpid, productId: r.id, variantId: v.id, mop: num(coins.mop), offered });
    }
    if (candidates.length >= 6) break;
  }
  candidates.sort((x, y) => x.mop - y.mop);
  freeBudget = free;
  [A, B] = candidates;
  console.log(
    `\nSTAGE ${BASE_URL} bucket=${bucket} wallet redeemable=${wallet.redeemableCoins} ` +
      `committed-in-cart=${committed} free=${free}\nA=${JSON.stringify(A)}\nB=${JSON.stringify(B)}\n` +
      `variants with no coin price in bucket ${bucket}: ${unpriced.length}\n  ${unpriced.slice(0, 5).join('\n  ')}`
  );
  await context.close();
});

test.afterAll(async ({ browser }) => {
  const context = await browser.newContext({ storageState: AUTH_PATH });
  const api = new StageWalletApi(context.request, bucket);
  for (const v of touchedVariants) await api.remove(v).catch(() => {});
  const cart = await api.cart().catch(() => null);
  for (const mine of added) {
    const line = lineFor(cart, mine.variant_id);
    if (line) await api.removeFromCart(line).catch(() => {});
  }
  await context.close();
});

// ---- the cases ----------------------------------------------------------------

test.describe('ByteCoins x pricing on stage', () => {
  test.beforeEach(() => {
    test.skip(!A, `${C.ENV} no product in the listing offers redeemable coins in bucket ${bucket}`);
  });

  test('pricing without coins leaves the wallet untouched', async ({ page }) => {
    const api = new StageWalletApi(page.request, bucket);
    await api.remove(A.variantId);
    const before = await snapshotWallet(api);
    const p1 = await api.pricing(A.slug, A.variantId);
    const offer = await api.coins(A.variantId);
    const p2 = await api.pricing(A.slug, A.variantId);
    const rec = await reconcileWallet(api, before);

    record('no coins applied', { product: `${A.slug}/${A.bpid}`, offer, pricingUpfront: p1.upfront, wallet: rec });
    expect(p2, `${C.API} two identical variant-pricing calls returned different bodies`).toEqual(p1);
    expect(rec.unexplained, `${C.WALLET} balance moved by ${rec.unexplained} with no ledger entry to explain it`).toBe(0);
    expect(rec.ours, `${C.WALLET} pricing alone wrote ledger entries`).toEqual([]);
  });

  test('the maximum redeemable is what the shopper is offered', async ({ page }) => {
    const api = new StageWalletApi(page.request, bucket);
    const wallet = await api.wallet();
    const offer = await api.coins(A.variantId);
    const max = num(offer.maxRedeemableCoins);
    const forUser = num(offer.redeemableCoinsForUser);

    record('max redeemable', { product: `${A.slug}/${A.bpid}`, walletRedeemable: wallet.redeemableCoins, offer });
    expect(max, `${C.WALLET} maxRedeemableCoins ${max} exceeds the price ${offer.mop}`).toBeLessThanOrEqual(num(offer.mop));
    expect(forUser, `${C.WALLET} offered ${forUser}, but min(cap ${max}, balance ${wallet.redeemableCoins}) is the most the shopper can hold`)
      .toBe(Math.min(max, num(wallet.redeemableCoins)));
    expect(num(offer.redeemableValue), `${C.PRICING} redeemableValue is not coins x faceValue`)
      .toBe(forUser * num(offer.faceValue));
  });

  test('applying the maximum: API, cart and wallet agree', async ({ page }) => {
    skipUnlessCartBudget(A);
    const api = new StageWalletApi(page.request, bucket);
    const line0 = await ensureInCart(api, A);
    const cart0 = await api.cart();
    const offer = await api.coins(A.variantId);
    const pricing0 = await api.pricing(A.slug, A.variantId);
    const before = await snapshotWallet(api);

    touchedVariants.add(A.variantId);
    const applied = await api.apply(A.variantId);
    const cart1 = await api.cart();
    const line1 = lineFor(cart1, A.variantId);
    const pricing1 = await api.pricing(A.slug, A.variantId);
    const rec = await reconcileWallet(api, before);

    record('apply maximum', {
      product: `${A.slug}/${A.bpid}`,
      offered: offer.redeemableCoinsForUser,
      applyResponse: applied,
      cartLine: { coins: line1.bytecoin_coins, discount: line1.bytecoin_discount, applied: line1.bytecoin_applied },
      cartTotalCoins: { before: cart0.total_bytecoin_coins, after: cart1.total_bytecoin_coins },
      wallet: rec,
      lineBefore: line0.bytecoin_coins,
    });
    expect(num(applied.coins), `${C.WALLET} apply {} returned ${applied.coins}, but the shopper was offered ${offer.redeemableCoinsForUser}`)
      .toBe(num(offer.redeemableCoinsForUser));
    expect(num(line1.bytecoin_coins), `${C.WALLET} apply said ${applied.coins} coins; the cart line carries ${line1.bytecoin_coins}`)
      .toBe(num(applied.coins));
    expect(num(line1.bytecoin_discount), `${C.PRICING} cart line discount is not coins x faceValue`)
      .toBe(num(line1.bytecoin_coins) * before.faceValue);
    expect(num(cart1.total_bytecoin_coins) - num(cart0.total_bytecoin_coins), `${C.API} cart total_bytecoin_coins did not move by the line's coins`)
      .toBe(num(line1.bytecoin_coins) - num(line0.bytecoin_coins));
    expect(pricing1, `${C.PRICING} variant-pricing changed when coins were applied — it carried no coin field when measured`).toEqual(pricing0);
    expect(rec.unexplained, `${C.WALLET} applying coins moved the balance by ${rec.unexplained} with no ledger entry`).toBe(0);
    expect(rec.ours, `${C.WALLET} applying coins wrote ledger entries`).toEqual([]);
  });

  test('applying a partial amount is exact', async ({ page }) => {
    skipUnlessCartBudget(A);
    const api = new StageWalletApi(page.request, bucket);
    await ensureInCart(api, A);
    const offer = await api.coins(A.variantId);
    const partial = Math.max(1, Math.floor(num(offer.redeemableCoinsForUser) / 3));
    const before = await snapshotWallet(api);

    touchedVariants.add(A.variantId);
    const applied = await api.apply(A.variantId, partial);
    const line = lineFor(await api.cart(), A.variantId);
    const rec = await reconcileWallet(api, before);

    record('apply partial', { product: `${A.slug}/${A.bpid}`, requested: partial, applyResponse: applied, cartLineCoins: line.bytecoin_coins, wallet: rec });
    expect(num(applied.coins), `${C.WALLET} asked for ${partial}, apply returned ${applied.coins}`).toBe(partial);
    expect(num(line.bytecoin_coins), `${C.WALLET} apply returned ${partial}; the cart line carries ${line.bytecoin_coins}`).toBe(partial);
    expect(rec.unexplained, `${C.WALLET} balance moved by ${rec.unexplained} unexplained`).toBe(0);
  });

  test('asking for more than the cap is capped, not honoured', async ({ page }) => {
    skipUnlessCartBudget(A);
    const api = new StageWalletApi(page.request, bucket);
    await ensureInCart(api, A);
    const offer = await api.coins(A.variantId);
    const tooMany = num(offer.redeemableCoinsForUser) + 1000;

    touchedVariants.add(A.variantId);
    let applied;
    let refused;
    try {
      applied = await api.apply(A.variantId, tooMany);
    } catch (e) {
      refused = e.message;
    }
    const line = lineFor(await api.cart(), A.variantId);

    record('apply above cap', { product: `${A.slug}/${A.bpid}`, requested: tooMany, cap: offer.redeemableCoinsForUser, applyResponse: applied || refused, cartLineCoins: line.bytecoin_coins });
    expect(num(line.bytecoin_coins), `${C.WALLET} cart line carries ${line.bytecoin_coins} coins, above the cap ${offer.redeemableCoinsForUser}`)
      .toBeLessThanOrEqual(num(offer.redeemableCoinsForUser));
  });

  test('repeating apply does not stack or deduct', async ({ page }) => {
    skipUnlessCartBudget(A);
    const api = new StageWalletApi(page.request, bucket);
    await ensureInCart(api, A);
    const offer = await api.coins(A.variantId);
    const n = Math.max(1, Math.floor(num(offer.redeemableCoinsForUser) / 2));
    const before = await snapshotWallet(api);

    touchedVariants.add(A.variantId);
    const responses = [];
    for (let i = 0; i < 3; i++) responses.push(num((await api.apply(A.variantId, n)).coins));
    const line = lineFor(await api.cart(), A.variantId);
    const rec = await reconcileWallet(api, before);

    record('repeated apply', { product: `${A.slug}/${A.bpid}`, n, responses, cartLineCoins: line.bytecoin_coins, wallet: rec });
    expect(responses, `${C.WALLET} repeated apply of ${n} answered differently`).toEqual([n, n, n]);
    expect(num(line.bytecoin_coins), `${C.WALLET} three applies of ${n} left ${line.bytecoin_coins} on the line`).toBe(n);
    expect(rec.unexplained, `${C.WALLET} balance moved by ${rec.unexplained} unexplained`).toBe(0);
    expect(rec.ours, `${C.WALLET} repeated apply wrote ledger entries`).toEqual([]);
  });

  test('removing coins restores the line and the offer', async ({ page }) => {
    skipUnlessCartBudget(A);
    const api = new StageWalletApi(page.request, bucket);
    await ensureInCart(api, A);
    touchedVariants.add(A.variantId);
    await api.apply(A.variantId);
    const offerApplied = await api.coins(A.variantId);
    const before = await snapshotWallet(api);

    await api.remove(A.variantId);
    const line = lineFor(await api.cart(), A.variantId);
    const offerAfter = await api.coins(A.variantId);
    const rec = await reconcileWallet(api, before);

    record('remove', { product: `${A.slug}/${A.bpid}`, offerWhileApplied: offerApplied, offerAfterRemove: offerAfter, cartLine: { coins: line.bytecoin_coins, applied: line.bytecoin_applied }, wallet: rec });
    expect(line.bytecoin_applied, `${C.WALLET} the line still reads applied after remove`).toBe(false);
    expect(num(line.bytecoin_coins), `${C.WALLET} ${line.bytecoin_coins} coins still on the line after remove`).toBe(0);
    expect(offerAfter.applied, `${C.API} coins endpoint still reports applied after remove`).toBe(false);
    expect(num(offerAfter.redeemableCoinsForUser), `${C.WALLET} after remove the offer is ${offerAfter.redeemableCoinsForUser}, was ${A.offered} before any apply`).toBe(A.offered);
    expect(rec.unexplained, `${C.WALLET} balance moved by ${rec.unexplained} unexplained`).toBe(0);
  });

  test('changing quantity recalculates coins within bounds, and changing back restores them', async ({ page }) => {
    skipUnlessCartBudget(A);
    const api = new StageWalletApi(page.request, bucket);
    const line0 = await ensureInCart(api, A);
    touchedVariants.add(A.variantId);
    await api.apply(A.variantId);
    const at1 = lineFor(await api.cart(), A.variantId);
    const wallet = await api.wallet();

    await api.changeQuantity(line0.id, +1); // delta, not absolute
    const at2 = lineFor(await api.cart(), A.variantId);
    const offer2 = await api.coins(A.variantId);
    await api.changeQuantity(line0.id, -1);
    const back = lineFor(await api.cart(), A.variantId);

    record('quantity change', {
      product: `${A.slug}/${A.bpid}`,
      qty1: { quantity: at1.quantity, coins: at1.bytecoin_coins, total: at1.total_amount },
      qty2: { quantity: at2.quantity, coins: at2.bytecoin_coins, total: at2.total_amount, offer: offer2.redeemableCoinsForUser },
      backTo1: { quantity: back.quantity, coins: back.bytecoin_coins },
    });
    expect(at2.quantity, `${C.API} quantity delta +1 did not produce ${at1.quantity + 1}`).toBe(at1.quantity + 1);
    expect(num(at2.bytecoin_coins), `${C.WALLET} ${at2.bytecoin_coins} coins exceed the line total ${at2.total_amount}`).toBeLessThanOrEqual(num(at2.total_amount));
    expect(num(at2.bytecoin_coins), `${C.WALLET} ${at2.bytecoin_coins} coins exceed the redeemable balance ${wallet.redeemableCoins}`).toBeLessThanOrEqual(num(wallet.redeemableCoins));
    expect(num(at2.bytecoin_discount), `${C.PRICING} discount is not coins x faceValue at quantity 2`).toBe(num(at2.bytecoin_coins) * num(wallet.faceValue));
    expect(back.quantity, `${C.API} quantity did not return to ${at1.quantity}`).toBe(at1.quantity);
    expect(num(back.bytecoin_coins), `${C.WALLET} back at quantity ${at1.quantity} the line carries ${back.bytecoin_coins}, was ${at1.bytecoin_coins}`).toBe(num(at1.bytecoin_coins));
  });

  test('changing product releases the first product\'s coins', async ({ page }) => {
    test.skip(!B, `${C.ENV} only one product offers coins; the change-product case needs two`);
    skipUnlessCartBudget(A);
    skipUnlessCartBudget(B);
    const api = new StageWalletApi(page.request, bucket);
    await ensureInCart(api, A);
    touchedVariants.add(A.variantId);
    await api.apply(A.variantId);
    const withA = await api.cart();
    const aCoins = num(lineFor(withA, A.variantId).bytecoin_coins);
    const before = await snapshotWallet(api);

    // Swap A for B, the way a shopper would: take A out, put B in, redeem on B.
    const aLine = lineFor(withA, A.variantId);
    await api.removeFromCart(aLine);
    const withoutA = await api.cart();
    await ensureInCart(api, B);
    touchedVariants.add(B.variantId);
    const bApplied = await api.apply(B.variantId);
    const withB = await api.cart();
    const rec = await reconcileWallet(api, before);

    record('change product', {
      from: `${A.slug}/${A.bpid}`, to: `${B.slug}/${B.bpid}`, aCoins,
      totals: { withA: withA.total_bytecoin_coins, withoutA: withoutA.total_bytecoin_coins, withB: withB.total_bytecoin_coins },
      bApplied, bLineCoins: lineFor(withB, B.variantId).bytecoin_coins, wallet: rec,
    });
    expect(num(withA.total_bytecoin_coins) - num(withoutA.total_bytecoin_coins), `${C.WALLET} removing A did not release its ${aCoins} coins from the cart total`).toBe(aCoins);
    expect(num(lineFor(withB, B.variantId).bytecoin_coins), `${C.WALLET} B was offered ${B.offered}; its line carries a different amount`).toBe(num(bApplied.coins));
    expect(rec.unexplained, `${C.WALLET} balance moved by ${rec.unexplained} unexplained`).toBe(0);
    expect(rec.ours, `${C.WALLET} swapping products wrote ledger entries`).toEqual([]);
  });

  // ---- through the page ----------------------------------------------------

  // Buy Now writes an is_review line into the shared UPFRONT basket (it shows in
  // GET /cart), so it is tracked for cleanup exactly like an API add.
  async function trackReviewLine(api) {
    const line = lineFor(await api.cart(), A.variantId);
    if (line && !added.some((l) => l.variant_id === line.variant_id)) added.push(line);
  }

  async function buyNowToReview(page) {
    await page.goto(`${BASE_URL}/pd/${A.slug}/${A.bpid}`, { waitUntil: 'domcontentloaded' });
    const buy = buyNowControl(page);
    await buy.waitFor({ state: 'visible', timeout: 60000 });
    await trackReviewLine(new StageWalletApi(page.request, bucket)).catch(() => {});
    // Early clicks are inert here — the button renders before its handler binds.
    await expect(async () => {
      await buy.click({ timeout: 5000 });
      await page.waitForURL(/\/review/, { timeout: 5000 });
    }).toPass({ timeout: 60000 });
    await trackReviewLine(new StageWalletApi(page.request, bucket));
    await page.getByText(/^bytecoins redeemed$/i).first().waitFor({ state: 'visible', timeout: 45000 }).catch(() => {});
    return parseReviewCoins(await page.locator('body').innerText());
  }

  test('Review Order shows the applied coins, and a reload keeps them', async ({ page }) => {
    test.setTimeout(180000);
    const leaks = guardProductionTraffic(page);
    const api = new StageWalletApi(page.request, bucket);
    touchedVariants.add(A.variantId);
    const applied = await api.apply(A.variantId);
    const before = await snapshotWallet(api);

    const review = await buyNowToReview(page);
    const reviewCart = await api.reviewCart();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByText(/^bytecoins redeemed$/i).first().waitFor({ state: 'visible', timeout: 45000 }).catch(() => {});
    const reloaded = parseReviewCoins(await page.locator('body').innerText());
    const rec = await reconcileWallet(api, before);

    record('review order + reload', { product: `${A.slug}/${A.bpid}`, applyResponse: applied, review, reloaded, reviewBpids: reviewCart.items.map((i) => i.variant.bpid), wallet: rec });
    expect(leaks, `${C.ENV} the stage page called production`).toEqual([]);
    expect(reviewCart.items.map((i) => i.variant.bpid), `${C.API} Review Order is not showing ${A.bpid} alone`).toEqual([A.bpid]);
    expect(review.redeemedCoins, `${C.FRONTEND} Review Order says ${review.redeemedCoins} Bytecoins Redeemed; apply returned ${applied.coins}`).toBe(num(applied.coins));
    expect(review.using, `${C.FRONTEND} the line chip says Using ${review.using}; the summary says ${review.redeemedCoins}`).toBe(review.redeemedCoins);
    expect(review.redeemedRupees, `${C.PRICING} ${review.redeemedCoins} coins shown as -₹${review.redeemedRupees}`).toBe(review.redeemedCoins * before.faceValue);
    expect(review.total, `${C.PRICING} Total ₹${review.total} != Price ₹${review.price} - Discount ₹${review.discount} - Bytecoins ₹${review.redeemedRupees}`)
      .toBe(review.price - review.discount - review.redeemedRupees);
    expect(reloaded, `${C.FRONTEND} Review Order changed across a reload`).toEqual(review);
    expect(rec.unexplained, `${C.WALLET} reaching Review Order moved the balance by ${rec.unexplained} unexplained`).toBe(0);
    expect(rec.ours, `${C.WALLET} reaching Review Order wrote ledger entries`).toEqual([]);
  });

  test('a failed pricing call deducts nothing and changes no coin figure', async ({ page }) => {
    test.setTimeout(180000);
    const api = new StageWalletApi(page.request, bucket);
    touchedVariants.add(A.variantId);
    const applied = await api.apply(A.variantId);
    const before = await snapshotWallet(api);

    let blocked = 0;
    await page.route('**/api/apps/variant-pricing/**', (route) => {
      blocked += 1;
      return route.fulfill({ status: 500, contentType: 'application/json', body: '{"status":false,"message":"injected"}' });
    });
    // Measured 30 Sep 2026: with pricing failed, stage renders Buy Now DISABLED —
    // the flow cannot reach Review Order at all, which is the safe outcome. If a
    // later build enables it, the case follows through and checks the coins.
    await page.goto(`${BASE_URL}/pd/${A.slug}/${A.bpid}`, { waitUntil: 'domcontentloaded' });
    const buy = buyNowControl(page);
    await buy.waitFor({ state: 'visible', timeout: 60000 });
    await expect.poll(() => blocked, { message: `${C.ENV} no variant-pricing call was made, so nothing was failed — the case proved nothing`, timeout: 30000 })
      .toBeGreaterThan(0);
    const blockedAtPdp = await buy.isDisabled();
    const review = blockedAtPdp ? null : await buyNowToReview(page);
    const rec = await reconcileWallet(api, before);

    record('pricing API failure', {
      product: `${A.slug}/${A.bpid}`, pricingCallsFailed: blocked, applyResponse: applied,
      outcome: blockedAtPdp ? 'Buy Now disabled — flow blocked at PDP' : 'reached Review Order', review, wallet: rec,
    });
    expect(rec.unexplained, `${C.WALLET} a failed pricing call moved the balance by ${rec.unexplained} unexplained`).toBe(0);
    expect(rec.ours, `${C.WALLET} a failed pricing call wrote ledger entries`).toEqual([]);
    expect(blockedAtPdp || (review && review.redeemedCoins === num(applied.coins)),
      `${C.FRONTEND} with pricing failed, Review Order shows ${review && review.redeemedCoins} coins; apply returned ${applied.coins}`).toBe(true);
  });

  // ---- Payment Summary pricing, read-only ------------------------------------
  //
  // Re-opens an order that already exists and is unpaid, so every rupee on
  // Payment Summary can be checked without minting anything:
  //   STAGE_MASTER_ORDER_ID=DCM300926EA456E
  test('Payment Summary reconciles to the rupee (existing unpaid order)', async ({ page }) => {
    const masterId = process.env.STAGE_MASTER_ORDER_ID;
    test.skip(!masterId, 'set STAGE_MASTER_ORDER_ID to an unpaid stage order to check its Payment Summary read-only');
    test.setTimeout(120000);
    const leaks = guardProductionTraffic(page);
    const api = new StageWalletApi(page.request, bucket);
    await page.goto(`${BASE_URL}/payment-summary?master_order_id=${masterId}`, { waitUntil: 'domcontentloaded' });
    // The breakdown renders after "Total Cost" does — poll until it parses rather
    // than reading the page the instant the label appears.
    await expect
      .poll(async () => parsePaymentBreakdown(await page.locator('body').innerText()), {
        message: `${C.FRONTEND} Payment Summary never rendered a "Price ... Order Total" breakdown`,
        timeout: 60000,
      })
      .toBeTruthy();
    // The Bytecoins row renders seconds after the rest of the breakdown
    // (measured: absent 4s after Order Total, present later). Give the rows up
    // to 30s to add up before judging — a row still missing after that is a
    // real gap, not an early read.
    const settled = async () => {
      const b = parsePaymentBreakdown(await page.locator('body').innerText());
      return b ? b.rows.reduce((s, r) => s + r.amount, 0) - b.orderTotal : NaN;
    };
    await expect.poll(settled, { timeout: 30000 }).toBe(0).catch(() => {});
    const result = await reconcilePaymentSummary(api, masterId, await page.locator('body').innerText());

    record('payment summary reconciliation', { masterOrderId: masterId, ...result });
    expect(leaks, `${C.ENV} the stage page called production`).toEqual([]);
    expect(result.mismatches, `Payment Summary for ${masterId} does not reconcile:\n${result.mismatches.join('\n')}`).toEqual([]);
  });

  // ---- order creation (writes) ------------------------------------------------

  test('create-order carries the reviewed coins, and the wallet burns exactly what it records', async ({ page }) => {
    test.skip(!writesAllowed(), 'mints a STAGE order (stops before payment). Set BYTEPE_ALLOW_WRITES=1 to run it.');
    test.setTimeout(240000);
    const leaks = guardProductionTraffic(page);
    const api = new StageWalletApi(page.request, bucket);
    touchedVariants.add(A.variantId);
    const applied = await api.apply(A.variantId);
    const before = await snapshotWallet(api);

    const review = await buyNowToReview(page);
    const reviewCart = await api.reviewCart();
    expect(reviewCart.items.map((i) => i.variant.bpid), `${C.API} refusing to press Continue: Review Order is not ${A.bpid} alone`).toEqual([A.bpid]);

    const watcher = watchCreateOrder(page);
    await page.getByRole('button', { name: 'Continue' }).click({ timeout: 15000 });
    const verdict = await readCreateOrder(watcher);
    expect(verdict.ok, `${C.API} create-order refused: ${verdict.message}`).toBe(true);
    const order = JSON.parse(verdict.body || '{}').data || {};
    await page.waitForURL(/payment-summary/, { timeout: 60000 });
    const masterId = new URL(page.url()).searchParams.get('master_order_id') || order.master_order_id;
    const summary = (await api.call('GET', `payments/v2/payment-summary/${masterId}`)).data.upfront;
    await expect.poll(async () => parsePaymentBreakdown(await page.locator('body').innerText()), { timeout: 60000 }).toBeTruthy();
    const paymentText = await page.locator('body').innerText();
    const breakdown = parsePaymentBreakdown(paymentText);
    const pricing = await reconcilePaymentSummary(api, masterId, paymentText);
    const walletOrder = await api.orderCoins(masterId);
    const rec = await reconcileWallet(api, before, [masterId, ...(order.orders || []).map((o) => o.order_id)]);

    const lineSum = (order.orders || []).reduce((s, o) => s + num(o.amount), 0);
    const shown = breakdown ? breakdown.rows.reduce((s, r) => s + r.amount, 0) : NaN;
    record('create-order', {
      product: `${A.slug}/${A.bpid}`, masterOrderId: masterId, applyResponse: applied, review,
      createOrder: { masterAmount: order.amount, lines: order.orders },
      paymentSummaryApi: { total_amount: summary.total_amount, payable_amount: summary.payable_amount, bytecoin_discount: summary.bytecoin_discount },
      paymentSummaryPage: breakdown,
      walletOrder: { totalBurnCoins: walletOrder.totalBurnCoins, lines: walletOrder.lines },
      paymentSummaryReconciliation: pricing,
      wallet: rec,
      note: 'BURN is written at payment, which this suite never reaches — at PENDING both sides of before-after=burned are 0',
    });

    expect(leaks, `${C.ENV} the stage page called production`).toEqual([]);
    expect((order.orders || []).map((o) => o.bpid), `${C.API} create-order minted something other than the reviewed ${A.bpid}`).toEqual([A.bpid]);
    expect.soft(lineSum, `${C.API} order line amounts sum to ${lineSum}, Review Order quoted ₹${review.total}`).toBe(review.total);
    expect.soft(num(order.amount), `${C.API} create-order master amount ${order.amount} != sum of its lines ${lineSum}`).toBe(lineSum);
    expect.soft(num(summary.bytecoin_discount), `${C.API} payment-summary bytecoin_discount ${summary.bytecoin_discount} != Review Order's ${review.redeemedRupees}`).toBe(review.redeemedRupees);
    expect.soft(num(summary.payable_amount), `${C.API} payment-summary payable ${summary.payable_amount} != Review Order total ${review.total}`).toBe(review.total);
    expect.soft(breakdown, `${C.FRONTEND} Payment Summary rendered no "Price ... Order Total" breakdown`).toBeTruthy();
    expect.soft(shown, `${C.FRONTEND} Payment Summary rows add to ₹${shown} but its Order Total reads ₹${breakdown && breakdown.orderTotal} — a ₹${breakdown && shown - breakdown.orderTotal} deduction is not shown (Bytecoins redeemed: ₹${review.redeemedRupees})`)
      .toBe(breakdown && breakdown.orderTotal);
    expect.soft(pricing.mismatches, `Payment Summary for ${masterId} does not reconcile:\n${pricing.mismatches.join('\n')}`).toEqual([]);
    // before - after = actual redeemed, with other people's activity reconciled out.
    expect(rec.unexplained, `${C.WALLET} balance moved by ${rec.unexplained} with no ledger entry to explain it`).toBe(0);
    expect(-rec.oursSum, `${C.WALLET} the ledger burned ${-rec.oursSum} for this order; the wallet's order record says ${walletOrder.totalBurnCoins}`)
      .toBe(num(walletOrder.totalBurnCoins));
  });
});
