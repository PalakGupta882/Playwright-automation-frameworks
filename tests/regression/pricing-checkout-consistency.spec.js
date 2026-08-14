// tests/regression/pricing-checkout-consistency.spec.js
//
// The second half of the pricing walk. pricing-consistency.spec.js takes the
// price from the pricing API through the listing tile to the PDP plan box, all
// logged out. This file carries the same number the rest of the way:
//
//     PDP  ->  Cart line item  ->  Cart Order Summary  ->  Review Order  ->  Payment Summary
//
// and asks the one question none of those surfaces answers about itself: is the
// figure the shopper agreed to on the product page the figure they are asked to
// pay for?
//
// LOGIN-GATED. The cart belongs to an account. assertFreshSession() fails fast
// with the real reason rather than timing out on a control that only renders for
// a logged-in user.
//
// WHAT THIS CREATES. Each run adds one real item to the real account's real cart
// and leaves it there. There is no add-to-cart endpoint to seed or clean up with
// — the client ships five cart routes and none of them is named add
// (tests/data/apiEndpoints.js) — so the UI is the only way in, and removal would
// mean calling the destructive PUT /cart/remove/:id. Adding and leaving is the
// accepted cost, and it is what checkout-flow.spec.js already does every run.
// The cheapest product on the listing is chosen to keep the residue small.
//
// WHAT THIS DOES NOT CREATE, unless you ask for it. Continue on Review Order
// mints a real order id before any payment step — that is how two real orders
// were left behind on 10 Aug 2026 (tests/utils/writes.js). Everything up to and
// including Review Order runs freely; the Payment Summary case is gated behind
// BYTEPE_ALLOW_WRITES=1 and skips by default.

const { test, expect } = require('../fixtures/pageFixtures');
const { BASE_URL, URLS, TIMEOUTS } = require('../data/constants');
const { assertFreshSession } = require('../utils/session');
const { writesAllowed, writeSkipReason } = require('../utils/writes');
const { openCart, dismissExchangeDialog } = require('../utils/cartNav');
const { parsePdpHeader, parseOrderSummary, toRupees } = require('../utils/priceText');

test.beforeAll(() => assertFreshSession());

// Four real page loads plus the pricing round trip behind each one.
const FLOW_TIMEOUT = 240000;

// Picks the cheapest priced product on the listing.
//
// Deliberate: this spec leaves a real line item on a real account's cart every
// run, and the residue should be a ₹1,700 cable rather than a ₹2,27,900 laptop.
// It also keeps the Order Summary arithmetic legible when it fails.
// Returns every priced tile, cheapest first.
//
// A list rather than a single winner: this spec adds the cheapest product on
// every run, so from the second run onwards the cheapest is already in the cart
// and its CTA reads "Go to Cart". The caller walks down the list until it finds
// one it can actually add — which is what stops it from clicking whatever else
// on the page happens to say "Add to Cart".
async function cheapestListedProduct(page) {
  await page.goto(`${BASE_URL}${URLS.products}`, { waitUntil: 'domcontentloaded' });
  await page.locator('a[href*="/pd/"]').first().waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(2000);

  const cards = page.locator('a[href*="/pd/"]');
  const total = await cards.count();

  const found = [];
  for (let i = 0; i < total; i++) {
    const href = await cards.nth(i).getAttribute('href');
    const match = /\/pd\/([^/?]+)\/([^/?]+)/.exec(href || '');
    if (!match) continue;

    const text = (await cards.nth(i).innerText().catch(() => '')) || '';
    const price = toRupees(text);
    if (price === null) continue;

    found.push({
      slug: match[1],
      bpid: match[2],
      price,
      // First line of the tile is the brand, or brand and name run together —
      // used for logging only. It is deliberately NOT used to find the line in
      // the cart: the cart renders the name without the brand, so no prefix of
      // this ever matches there.
      name: text.split('\n').map((s) => s.trim()).filter(Boolean)[0] || match[1],
    });
  }

  return found.sort((a, b) => a.price - b.price);
}

// Adds the product currently on screen to the cart.
//
// Subscription-first products lead with "Subscribe" and only expose the upfront
// CTA once a plan is picked, which is why the fallback exists — the same step
// CartPage.addFirstProductToCart performs, kept here because this spec needs to
// add a SPECIFIC product rather than whichever is first.
async function addCurrentProductToCart(page) {
  // WAIT FOR HYDRATION BEFORE CLICKING.
  //
  // Measured 14 Aug 2026, and it cost three runs to find: clicking Add to Cart
  // as soon as it was visible did nothing at all — no exception, no request, the
  // button still reading "Add to Cart" 15s later. A diagnostic that waited 4s
  // first got `POST 200 /api/cart {"status":true,"message":"Your Item has been
  // successfully added in Cart"}` on the same product. The button renders before
  // React binds its handler, so an early click lands on an inert element.
  //
  // "Choose your plan" is the right thing to wait on: it is populated from the
  // pricing round trip, so its presence means the client has finished wiring
  // this page up. A bare timeout would work too and would be a guess.
  await page
    .getByText(/choose your plan/i)
    .first()
    .waitFor({ state: 'visible', timeout: TIMEOUTS.nav })
    .catch(() => {});

  // THE CTA IS ANCHORED TO "Buy Now", NOT SEARCHED FOR BY NAME.
  //
  // This is the most expensive lesson in the file. The previous version used
  // `getByRole('button', {name:'Add to Cart'}).filter({visible:true}).first()`,
  // and on 14 Aug 2026 it ADDED THE WRONG PRODUCT TO A REAL CART — a Galaxy Z
  // Flip8 5G at ₹1,24,999 instead of a ₹1,200 powerbank.
  //
  // The mechanism: once the chosen product is already in the cart, its own CTA
  // changes from "Add to Cart" to "Go to Cart". The name-based locator then
  // found the next "Add to Cart" on the page — one belonging to a tile in the
  // recommended-products carousel further down — and clicked it. Nothing threw;
  // POST /api/cart returned 200; the wrong item was bought into the basket. The
  // price-delta assertion caught it only afterwards.
  //
  // "Buy Now" sits immediately after the real CTA in the same parent and does
  // NOT exist on carousel tiles, so the button before it is the product's own
  // control and cannot be anything else. Reading its label rather than assuming
  // it: "Go to Cart" means this product is already in the basket, and the
  // caller picks a different one instead of clicking something at random.
  const buyNow = page
    .getByRole('button', { name: 'Buy Now' })
    .filter({ visible: true })
    .first();
  await buyNow.waitFor({ state: 'visible', timeout: 20000 });

  const cta = buyNow.locator('xpath=preceding-sibling::button[1]');

  // Wait for the CTA to actually carry a label before reading it. Reading it
  // immediately returned an empty string, and an empty string is not
  // "Go to Cart", so a product already in the basket fell through to the click
  // path — and then the "the label flipped, so our add landed" branch below
  // read the pre-existing "Go to Cart" as proof of success and reported a
  // phantom add. The cart never moved and the delta assertion failed by the
  // whole price.
  await expect(cta, 'the buy-box CTA never rendered a label').toHaveText(
    /add to cart|go to cart|subscribe/i,
    { timeout: 20000 }
  );

  const label = (await cta.innerText()).trim();
  if (/go to cart/i.test(label)) {
    return { alreadyInCart: true };
  }

  if (!/add to cart/i.test(label)) {
    // Subscription-first products lead with "Subscribe" and only expose the
    // upfront CTA once a plan is picked. The plan tile ignores a plain click, so
    // the event is dispatched directly — same workaround as
    // ProductsListPage.selectBuyUpfrontPlan.
    const planCard = page.locator('.MuiBox-root.mui-1eub90p').filter({ visible: true }).first();
    await planCard.waitFor({ state: 'visible', timeout: 20000 });
    await planCard.dispatchEvent('click');
    await page.waitForTimeout(1500);
  }

  const addToCart = cta;
  await addToCart.waitFor({ state: 'visible', timeout: 10000 });

  // Belt and braces after the incident above: never click a control that is not
  // literally this product's Add to Cart.
  const finalLabel = (await addToCart.innerText()).trim();
  if (!/add to cart/i.test(finalLabel)) {
    throw new Error(
      `Refusing to click: the button before "Buy Now" reads ${JSON.stringify(finalLabel)}, ` +
        'not "Add to Cart". Clicking an unidentified control on a live cart is how the wrong ' +
        'product gets bought.'
    );
  }

  // THE ADD IS CONFIRMED BY ITS REQUEST, NOT BY A BUTTON LABEL.
  //
  // Two weaker signals were tried first and both cost a run:
  //
  //   1. Navigating to /cart straight after the click. That aborted the
  //      in-flight add and the cart came back unchanged, which read as "the
  //      product is missing from the cart" — a site defect — when it was a race.
  //   2. Waiting for "Go to Cart" to replace "Add to Cart". Better, but it
  //      still times out when the click itself was inert, and then reports the
  //      wrong thing: the button never changed because nothing was ever sent.
  //
  // POST /api/cart is the actual commit, and its body carries the site's own
  // verdict — `{"status":true,"message":"Your Item has been successfully added
  // in Cart"}` when it works. Waiting on it distinguishes "the click did
  // nothing" from "the site refused" from "the site accepted", which no button
  // label can.
  const isCartPost = (res) =>
    /\/api\/cart(\?|$)/.test(res.url()) && res.request().method() === 'POST';

  // Retried because the click can land before React binds the handler: the
  // button renders early, an early click is silently inert, and no request is
  // sent at all. Measured — a diagnostic that waited 4s first got a 200 on the
  // same product that produced nothing here.
  //
  // Retrying cannot double-add: it only happens when NO response arrived AND
  // the button still reads "Add to Cart". A late-but-successful add flips the
  // label, so the guard below sees it and stops.
  const ATTEMPTS = 3;
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const settled = page.waitForResponse(isCartPost, { timeout: 15000 }).catch(() => null);
    await addToCart.click({ timeout: TIMEOUTS.action });

    const res = await settled;
    if (res) {
      const body = await res.text().catch(() => '');
      if (!res.ok() || /"status"\s*:\s*false/.test(body)) {
        throw new Error(
          `The site refused the add: POST /api/cart returned ${res.status()} ${body.slice(0, 200)}`
        );
      }
      console.log(`added via POST /api/cart ${res.status()} — ${body.slice(0, 120)}`);
      return { added: true };
    }

    // The CTA flipping means a late add did land, so stop rather than retry.
    // Scoped to this product's own control, for the reason above.
    const flipped = /go to cart/i.test((await cta.innerText().catch(() => '')).trim());
    if (flipped) return { added: true };

    if (attempt === ATTEMPTS) {
      throw new Error(
        `Clicked "Add to Cart" ${ATTEMPTS} times and no POST /api/cart was ever sent, and the ` +
          'button never became "Go to Cart". The control is rendering without a handler bound, ' +
          'or the add endpoint moved.'
      );
    }
    await page.waitForTimeout(2000);
  }
}

// The Order Summary, read off whichever page is open. Both Cart and Review
// Order render the same block, which is the point — they must agree.
//
// WAITS FOR IT FIRST. Measured 14 Aug 2026: reading innerText the instant
// waitForURL(/review/) resolved returned a page with no summary on it at all,
// and the failure read as "Review Order has no Order Summary" — a site defect —
// when the page simply had not rendered yet. openCart() happens to absorb this
// with its own 3s settle, so the cart half passed and only the review half
// failed, which made it look even more like a real difference between the two
// pages. Same hydration race as the PDP headline; same fix.
async function readSummary(page, label) {
  await page
    .getByText(/total amount/i)
    .first()
    .waitFor({ state: 'visible', timeout: TIMEOUTS.nav })
    .catch(() => {});

  const text = await page.locator('body').innerText();
  const summary = parseOrderSummary(text);

  if (!summary) {
    throw new Error(
      `${label}: no Order Summary on the page. Expected a "Price (N Items) ₹X" line and a ` +
        '"Total Amount ₹Y" line; neither was found after waiting for one.\n' +
        `  url: ${page.url()}\n` +
        `  page text: ${text.replace(/\s+/g, ' ').slice(0, 600)}`
    );
  }
  return summary;
}

// price - discount + everything charged between them and the total.
//
// Everything in that region is summed rather than named. checkout-flow.spec.js
// records why: the summary once failed by exactly ₹1 and it was read as a
// rounding defect. It was a "Device Protection ₹1" add-on line, and the site's
// arithmetic was right — the assertion's model was incomplete. A second add-on
// must not reintroduce that.
function expectSummaryAddsUp(summary, label) {
  expect(
    summary.total,
    `${label}: the total does not follow from its own line items.\n` +
      `  price     ₹${summary.price}\n` +
      `  discount -₹${summary.discount}\n` +
      `  add-ons  +₹${summary.extras}  ${summary.extrasRegion || '(none on the page)'}\n` +
      `  expected  ₹${summary.price - summary.discount + summary.extras}\n` +
      `  shown     ₹${summary.total}`
  ).toBe(summary.price - summary.discount + summary.extras);
}

test.describe('Pricing consistency through checkout', () => {
  test('the price on the product page is the price that lands in the cart', async ({ page }) => {
    test.setTimeout(FLOW_TIMEOUT);

    const candidates = await cheapestListedProduct(page);
    expect(candidates.length, 'the listing rendered no priced product to add').toBeGreaterThan(0);

    // ---- Cart baseline --------------------------------------------------
    //
    // Read before anything is added, through the same waiting reader as
    // everything else. It used to parse the page directly and tolerate null,
    // which meant a cart that had not finished rendering skipped the price-delta
    // assertion below — the strongest check in this test — without saying so.
    await openCart(page);
    const summaryBefore = await readSummary(page, 'cart (before adding)');
    const cartTextBefore = (await page.locator('body').innerText()).replace(/\s+/g, ' ');

    // ---- Pick something the cart does not already hold ------------------
    //
    // RE-ADDING AN ITEM ALREADY IN THE CART IS A NO-OP. Measured 14 Aug 2026:
    // POST /api/cart returns 200 with "Your Item has been successfully added in
    // Cart" and the totals do not move — the quantity does not even increment.
    // Since this spec adds the cheapest product every run, from the second run
    // onwards it was re-adding the same powerbank and then failing its own
    // delta assertion by the whole price.
    //
    // The PDP is no help here: it renders "Add to Cart" whether or not the item
    // is in the basket, flipping to "Go to Cart" only transiently after a click.
    // So the cart itself is the source of truth, matched on the price string
    // because the cart shows the product name without the brand while the tile
    // runs them together.
    const fresh = candidates.filter(
      (c) => !cartTextBefore.includes(`₹${c.price.toLocaleString('en-IN')}`)
    );
    expect(
      fresh.length,
      'every listed product already appears in the cart at its listed price, so adding one ' +
        'cannot change the total and the PDP -> cart hop cannot be exercised'
    ).toBeGreaterThan(0);

    console.log(
      `${candidates.length} listed, ${fresh.length} not already in the cart; ` +
        `cheapest addable: ${fresh[0].name} ₹${fresh[0].price}`
    );

    // ---- PDP, walking down the price-sorted list ------------------------
    //
    // Walking a list rather than committing to one product is what replaced the
    // old behaviour of clicking whatever else on the page said "Add to Cart" —
    // which on 14 Aug 2026 put a ₹1,24,999 phone into a real basket.
    let product = null;
    let header = null;

    for (const candidate of fresh.slice(0, 5)) {
      await page.goto(`${BASE_URL}/pd/${candidate.slug}/${candidate.bpid}`, {
        waitUntil: 'domcontentloaded',
      });
      await page.keyboard.press('Escape').catch(() => {});
      await page
        .getByText(/^₹[\d,]+$/)
        .first()
        .waitFor({ state: 'visible', timeout: TIMEOUTS.nav });

      const parsed = parsePdpHeader(await page.locator('body').innerText());
      expect(parsed, `${candidate.slug}: the PDP rendered no price`).toBeTruthy();

      // PLP -> PDP, checked on whichever product this run ends up using.
      expect(
        parsed.price,
        `${candidate.slug}: the listing tile said ₹${candidate.price} and the PDP says ₹${parsed.price}`
      ).toBe(candidate.price);

      const outcome = await addCurrentProductToCart(page);
      if (outcome.added) {
        product = candidate;
        header = parsed;
        console.log(`added: ${candidate.name} — ₹${candidate.price} (${candidate.slug})`);
        break;
      }
      console.log(`skipped ${candidate.slug} — already in the cart`);
    }

    expect(
      product,
      'none of the five cheapest addable products could be added — every attempt reported the ' +
        'item as already in the cart. Nothing was written; the PDP -> cart hop was not exercised.'
    ).toBeTruthy();

    await openCart(page);
    await dismissExchangeDialog(page);

    const summaryAfter = await readSummary(page, 'cart');
    const cartText = (await page.locator('body').innerText()).replace(/\s+/g, ' ');

    // The product's own line, identified by its PRICE rather than its name.
    //
    // Matching on the name was tried first and is wrong here: the listing tile
    // renders brand and product name run together ("samsungGalaxy Z Fold8
    // Ultra") while the cart renders the name alone, so a prefix of the tile
    // text never appears in the cart. The price is the same string on both
    // surfaces, and it is also the figure this test is actually about.
    //
    // "the first line item" would not do either — the account's cart already
    // holds other products (7 on 14 Aug 2026), so it would assert against
    // somebody else's.
    const priceOnPage = `₹${header.price.toLocaleString('en-IN')}`;
    expect(
      cartText,
      `${product.name} was added at ${priceOnPage} but no line in the cart shows that price.\n` +
        `  cart: ${cartText.slice(0, 500)}`
    ).toContain(priceOnPage);
    expectSummaryAddsUp(summaryAfter, 'cart');

    // THE CART'S "Price (N Items)" LINE IS A SUM OF MRPs, NOT SELLING PRICES.
    //
    // Measured 14 Aug 2026 by adding a ₹1,200 powerbank whose MRP is ₹2,999:
    //
    //   Price     ₹6,60,197 -> ₹6,63,196   (+2,999, the MRP)
    //   Discount    ₹60,201 ->   ₹62,000   (+1,799)
    //   Total     ₹5,99,997 -> ₹6,01,197   (+1,200, what the shopper pays)
    //
    // So the figure to hold the PDP to is the TOTAL, not the Price line. An
    // earlier version of this test compared the PDP price against the Price
    // delta and failed by exactly the discount — which would have read as a
    // pricing defect when the cart's arithmetic was right and the assertion's
    // model was wrong. Same trap checkout-flow.spec.js hit with the ₹1 add-on.
    console.log(
      `cart before: ${summaryBefore.itemCount} items · price ₹${summaryBefore.price} · ` +
        `total ₹${summaryBefore.total}\n` +
        `cart after:  ${summaryAfter.itemCount} items · price ₹${summaryAfter.price} · ` +
        `total ₹${summaryAfter.total}`
    );

    // Not `>`. Adding a product the cart already holds increments that line's
    // quantity instead of creating a new one, so the count legitimately stays
    // put — and this spec adds the same cheapest product on every run, so the
    // second run onwards is exactly that case. The total delta below is what
    // actually proves the add landed.
    expect(
      summaryAfter.itemCount,
      'the cart lost a line item while adding one'
    ).toBeGreaterThanOrEqual(summaryBefore.itemCount);

    // THE ASSERTION THIS FILE EXISTS FOR: the number on the product page is the
    // number the shopper is charged.
    const chargedDelta = summaryAfter.total - summaryBefore.total;
    expect(
      chargedDelta,
      `${product.name}: the PDP quoted ₹${header.price}, but adding it moved the cart's ` +
        `Total Amount by ₹${chargedDelta} (₹${summaryBefore.total} -> ₹${summaryAfter.total}). ` +
        'The shopper agreed to one figure and the cart charged another.'
    ).toBe(header.price);

    // ...and the MRP line moved by the MRP, which is what makes the discount
    // line above it add up. Only checked where the PDP showed a strike-through.
    if (header.mrp !== null) {
      const mrpDelta = summaryAfter.price - summaryBefore.price;
      expect(
        mrpDelta,
        `${product.name}: the PDP struck through ₹${header.mrp}, but the cart's Price line ` +
          `moved by ₹${mrpDelta}`
      ).toBe(header.mrp);
    }
  });

  test('the cart and Review Order quote the same totals', async ({ page }) => {
    test.setTimeout(FLOW_TIMEOUT);

    await openCart(page);
    await dismissExchangeDialog(page);

    const cart = await readSummary(page, 'cart');
    expectSummaryAddsUp(cart, 'cart');
    console.log(
      `cart:   ${cart.itemCount} items · price ₹${cart.price} · discount ₹${cart.discount} · ` +
        `add-ons ₹${cart.extras} · total ₹${cart.total}`
    );

    // Non-vacuous: an empty cart would make every comparison below trivially
    // true, and there is no add-to-cart endpoint to seed one from here.
    expect(cart.itemCount, 'the cart is empty, so there is nothing to carry into review').toBeGreaterThan(0);

    await page
      .getByRole('button', { name: /^continue$/i })
      .first()
      .click({ timeout: TIMEOUTS.action });
    await page.waitForURL(new RegExp(URLS.review), { timeout: 60000 });
    await dismissExchangeDialog(page);

    const review = await readSummary(page, 'review order');
    expectSummaryAddsUp(review, 'review order');
    console.log(
      `review: ${review.itemCount} items · price ₹${review.price} · discount ₹${review.discount} · ` +
        `add-ons ₹${review.extras} · total ₹${review.total}`
    );

    // The hop that matters. Cart and Review Order are two renderings of one
    // basket; a difference here is a shopper agreeing to one total and being
    // charged another, and neither page's own internal arithmetic would catch
    // it — both can be self-consistent and still disagree with each other.
    expect(
      {
        items: review.itemCount,
        price: review.price,
        discount: review.discount,
        total: review.total,
      },
      'Review Order restated the basket differently from the cart the shopper just left.\n' +
        `  cart    ${cart.itemCount} items · ₹${cart.price} - ₹${cart.discount} + ₹${cart.extras} = ₹${cart.total}\n` +
        `  review  ${review.itemCount} items · ₹${review.price} - ₹${review.discount} + ₹${review.extras} = ₹${review.total}`
    ).toEqual({
      items: cart.itemCount,
      price: cart.price,
      discount: cart.discount,
      total: cart.total,
    });

    // The stop line. Continue is present — its absence would mean the flow is
    // broken rather than that we stopped safely — and it is not pressed.
    await expect(
      page.getByRole('button', { name: /^continue$/i }).first()
    ).toBeVisible({ timeout: TIMEOUTS.nav });
    expect(page.url()).not.toMatch(/payment-summary|razorpay|payment_id/i);
    console.log('stopped at Review Order without pressing Continue:', page.url());
  });

  // ---- The last surface -------------------------------------------------
  //
  // Payment Summary is the only page that shows the shopper what they are about
  // to pay, and it is unreachable without minting a real order: Continue on
  // Review Order creates the order id before any payment step. So this case
  // cannot be made free, and it is gated rather than skipped quietly — the skip
  // reason names what would be created.
  //
  // It stops at Payment Summary. It does not touch the gateway, and
  // tests/data/apiEndpoints.js lists the payment routes as forbidden precisely
  // so nobody goes looking for one.
  test.describe('Payment Summary', () => {
    test.skip(
      !writesAllowed(),
      writeSkipReason('Reaching Payment Summary mints a real order id')
    );

    test('payment summary asks for exactly what Review Order quoted', async ({ page }) => {
      test.setTimeout(FLOW_TIMEOUT);

      await openCart(page);
      await dismissExchangeDialog(page);

      const cart = await readSummary(page, 'cart');
      expect(cart.itemCount, 'the cart is empty — nothing to check out').toBeGreaterThan(0);

      await page
        .getByRole('button', { name: /^continue$/i })
        .first()
        .click({ timeout: TIMEOUTS.action });
      await page.waitForURL(new RegExp(URLS.review), { timeout: 60000 });
      await dismissExchangeDialog(page);

      const review = await readSummary(page, 'review order');
      console.log(`review total ₹${review.total} — pressing Continue now MINTS A REAL ORDER`);

      // THE IRREVERSIBLE CLICK.
      await page
        .getByRole('button', { name: /^continue$/i })
        .first()
        .click({ timeout: TIMEOUTS.action });
      await page.waitForURL(new RegExp(URLS.orderSummary), { timeout: 90000 });

      const paymentText = await page.locator('body').innerText();
      console.log('order minted; landed on', page.url());

      // The figure the shopper is asked to pay. Read as the Total Amount line
      // where the page renders one, falling back to any "payable" phrasing —
      // this page has never been measured, because measuring it costs an order.
      const summary = parseOrderSummary(paymentText);
      const payable =
        summary?.total ??
        toRupees((paymentText.replace(/\s+/g, ' ').match(/(?:Amount Payable|To Pay|Payable)\s*₹\s?[\d,]+/i) || [])[0]);

      expect(
        payable,
        'Payment Summary rendered no total at all. The page was reached (a real order was ' +
          'created) but nothing on it states what the shopper owes.\n' +
          `first 600 chars: ${paymentText.replace(/\s+/g, ' ').slice(0, 600)}`
      ).toBeTruthy();

      expect(
        payable,
        `Review Order quoted ₹${review.total} and Payment Summary asks for ₹${payable}. ` +
          'This is the last figure before money moves.'
      ).toBe(review.total);
    });
  });
});
