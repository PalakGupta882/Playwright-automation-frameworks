// tests/regression/pdp-pricing-failure.spec.js
//
// WHAT A PRODUCT PAGE SHOWS WHEN ITS PRICING CALL DOES NOT ANSWER,
// AND — THE PART THAT ACTUALLY DECIDES SEVERITY — WHETHER THAT SURVIVES
// TO THE PAGE THE SHOPPER PAYS FROM.
//
// THE RULING, 27 Aug 2026. Raised with DevOps as a possible blocker. Their
// position, and it is now measured to be correct:
//
//   If variant-pricing is blocked, the PDP showing ₹0 is EXPECTED and the flow
//   is meant to proceed. It is only a blocker if the wrong price SURVIVES to
//   Review Order. If Review Order prices correctly, the shopper is never asked
//   for the wrong amount and this is cosmetic.
//
// MEASURED END TO END with variant-pricing blocked for the WHOLE journey and
// the cart API left alone — scripts/probe-unpriced-carries-to-review.spec.js,
// subject Odyssey Large Hard Luggage 110L, true upfront.price ₹6,399:
//
//   PDP            "₹0 x undefinedmo", no headline price, buy controls live
//   POST /api/cart 200, purchase_mode CC_EMI
//   cart API line  MOP ₹6,399          <- CORRECT, not 0
//   cart page      total 337,293 -> 343,692, moved by exactly ₹6,399
//   Review Order   ₹343,692, identical to cart, no "undefined" anywhere
//
// So the zero does NOT carry. Cart and Review Order re-price server-side from
// /api/cart and never consult variant-pricing — it stayed blocked throughout
// and neither page needed it. NOT A BLOCKER.
//
// THE `undefined` STRING IS ACCEPTED TOO — ruled 27 Aug 2026. The copy reads
//
//   "₹0 x undefinedmo"
//
// and the literal `undefined` in the tenure was raised separately and accepted
// along with the ₹0. Nothing in this file asserts its absence any more. Do not
// re-add such an assertion; it argues with a decision that has been taken.
//
// What the cases below DO still hold the page to is that an unpriced plan box
// quotes ZERO and never a number. ₹0 is acceptable because it is visibly empty.
// A stale or invented instalment — ₹276 x 24mo on a page whose pricing call
// just died — is a figure the shopper was quoted that nothing substantiates,
// and that is a defect under the same reasoning that cleared the ₹0.
//
// HOW IT WAS FOUND, kept because it first looked like a test fault.
// pricing-consistency.spec.js failed twice with openPdp() timing out waiting for
// a headline price. Under load that reads as contention and gets retried away.
// The saved snapshot showed the page had rendered fine — it had rendered the
// state above.
//
// MEASURED, scripts/probe-pdp-unpriced-render.spec.js:
//
//   quiet origin, 12 consecutive loads      0 unpriced — not spontaneous
//   variant-pricing forced to 429           reproduces
//   variant-pricing forced to 500           reproduces
//   variant-pricing aborted at the network  reproduces
//   variant-pricing 200 with `data: {}`     reproduces
//
// A clean 200 reproducing it rules out throttling: the client has no unpriced
// state at all, and formats whatever it got into the copy.
//
// SCOPE — scripts/probe-unpriced-breadth.spec.js, 16 products sampled across
// the catalogue: 16 of 16 UPFRONT-layout products affected; subscription-layout
// products are NOT (they still price, render no placeholder, and have no
// Add to Cart / Buy Now at all). Do not report it as catalogue-wide.
//
// WHAT WAS REMOVED FROM THIS FILE, so nobody re-adds it. It used to assert that
// the buy controls must be disabled while the page shows no price. Product have
// decided the opposite — proceeding is intended, because the real price is
// applied downstream. Asserting it would be encoding a preference against a
// decision that has been taken.

const { test, expect } = require('../fixtures/pageFixtures');
const { cartContinueButton } = require('../utils/orderContinue');
const { BASE_URL, BASE_API_URL, URLS, TIMEOUTS } = require('../data/constants');
const { getWithRetry } = require('../utils/apiRetry');
const { assertFreshSession } = require('../utils/session');
const { openCart, dismissExchangeDialog } = require('../utils/cartNav');
const { parseOrderSummary } = require('../utils/priceText');
const { clickAddToCart: clickAddToCartControl, rowOffersAddToCart } = require('../utils/buyRow');

const VARIANT_PRICING = '**/apps/variant-pricing/**';

// The four ways the pricing call can fail to deliver a usable body. The last is
// the one that rules out "it is just rate limiting" — a clean 200 with an empty
// data object reproduces exactly the same render.
const PRICING_FAILURES = [
  {
    name: 'the pricing call is rate limited (429)',
    apply: (route) =>
      route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: '{"status":false,"message":"Too many requests"}',
      }),
  },
  {
    name: 'the pricing call errors (500)',
    apply: (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: '{"status":false,"message":"internal error"}',
      }),
  },
  {
    name: 'the pricing call never completes (network failure)',
    apply: (route) => route.abort('failed'),
  },
  {
    name: 'the pricing call succeeds but returns no pricing (200, empty data)',
    apply: (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{"status":true,"message":"ok","data":{}}',
      }),
  },
];

const headlinePrice = (page) => page.getByText(/^₹[\d,]+$/).first();

async function openPdp(page, { slug, bpid }) {
  await page.goto(`${BASE_URL}/pd/${slug}/${bpid}`, { waitUntil: 'domcontentloaded' });
  await page.keyboard.press('Escape').catch(() => {});
}

// The plan box carries no role, test id or stable class (CLAUDE.md), so the copy
// is read from body text and narrowed to the lines that quote money or name a
// plan. Lines over 120 chars are dropped: Next.js serialises its RSC payload
// into the page and that payload is dense with "$undefined" markers which are
// never rendered — counting them reported a placeholder on pages showing none.
function moneyCopy(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /EMI|Choose your plan|Pay in Full|Buy Upfront|Subscription|₹/i.test(line))
    .filter((line) => line.length < 120);
}

// Is the PDP showing its unpriced state? Two renderings, both measured:
//
//   until Sep 2026   "₹0 x undefinedmo" in the pre-selected plan
//   1 Oct 2026       "EMI From /mo" with no amount, and NO instalment row at all
//
// The second replaced the first. Detecting only the old copy made every check
// in this file skip ("priced itself despite the block") while the page was in
// fact unpriced — so the cart re-price guard below silently stopped running.
// Bank-offer cards ("₹496 Off") still carry amounts in this state: they come
// from variant-offers, which is not blocked, and are discounts, not a price.
const UNPRICED = [/₹0\s*x\s*undefined/i, /EMI\s+From\s*\/\s*mo/i];
const isUnpriced = (text) => UNPRICED.some((re) => re.test(text));

// An UPFRONT product the cart does not already hold.
//
// prodPaymentMode matters: a BOTH-mode product renders the subscription layout,
// which is measured as unaffected, so testing either half of this file against
// one proves nothing.
//
// "not already held" matters too: CLAUDE.md records that re-adding a product the
// cart already has is a 200 no-op — nothing moves, not even the quantity — and
// the first run of the probe behind this file did exactly that and proved
// nothing for a full cycle.
async function pickUpfrontProduct(request, heldBpids = new Set()) {
  const res = await getWithRetry(
    request,
    `${BASE_API_URL.replace(/\/+$/, '')}/product-service/apps/products?page=1&limit=100`,
    { failOnStatusCode: false }
  );
  if (!res.ok()) return null;
  const items = (await res.json())?.data?.items || [];
  // rowOffersAddToCart() also rules out PRE-BOOKING products, added
  // 16 Sep 2026. Those are prodPaymentMode UPFRONT and would pass the mode
  // filter, but their buy row is substituted for a single "Pre-book Now" —
  // no Add to Cart and no Buy Now — so this file cannot add one to a cart.
  // The listing now sorts them to the front, so "the first UPFRONT product"
  // lands on one.
  const candidates = items.filter(
    (p) =>
      p?.slug &&
      p?.variant?.bpid &&
      p?.variant?.id &&
      rowOffersAddToCart(p) &&
      !heldBpids.has(p.variant.bpid)
  );
  // In stock only: a Sold Out variant renders a disabled cart icon, and the
  // listing does not carry stock. The first UPFRONT row on 29 Sep 2026 was
  // Sold Out.
  for (const p of candidates.slice(0, 15)) {
    const pd = await getWithRetry(
      request,
      `${BASE_API_URL.replace(/\/+$/, '')}/product-service/apps/products/by-slug/${p.slug}/${p.variant.bpid}`,
      { failOnStatusCode: false }
    );
    const variant = pd.ok() ? (await pd.json())?.data?.variant : null;
    if (variant && variant.available && variant.stock > 0) return p;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 1. The PDP itself. Public, logged out, no cart write.
// ---------------------------------------------------------------------------
test.describe('PDP when its pricing call fails', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  let subject = null;

  test.beforeAll(async ({ playwright }) => {
    const api = await playwright.request.newContext({
      storageState: { cookies: [], origins: [] },
    });
    try {
      const p = await pickUpfrontProduct(api);
      if (p) subject = { slug: p.slug, bpid: p.variant.bpid, name: p.name };
    } finally {
      await api.dispose();
    }
  });

  // NON-VACUOUS GUARD, and both cases below lean on it. They assert something
  // about a page with no price; if the PDP were simply broken, or the product
  // resolved to nothing, they would "pass" against a blank page. So prove first
  // that this exact product, untouched, prices correctly and renders no
  // placeholder.
  test('control: the same PDP prices correctly when nothing is interfering', async ({ page }) => {
    test.skip(!subject, 'the live listing returned no upfront product to open');

    await openPdp(page, subject);
    await expect(
      headlinePrice(page),
      `${subject.slug} did not price at all, so nothing below would be meaningful`
    ).toBeVisible({ timeout: TIMEOUTS.nav });

    const copy = moneyCopy(await page.locator('body').innerText());
    console.log(`control (${subject.name}): ${copy.slice(0, 6).join(' | ')}`);
    expect(
      copy.filter((line) => /undefined|NaN/i.test(line)),
      'the untouched PDP already renders a placeholder, so the failure cases below prove nothing'
    ).toEqual([]);
  });

  for (const failure of PRICING_FAILURES) {
    // CONTRACT TEST, and it PASSES — it encodes the confirmed-expected state
    // rather than arguing with it.
    //
    // This used to assert that no placeholder ever reaches the page, and it
    // failed four times over. Both halves have since been ruled expected: ₹0 is
    // the agreed fallback, and `undefined` in the tenure is accepted too. So
    // asserting their absence was encoding a preference against a decision that
    // had been taken.
    //
    // It is NOT deleted, and it does NOT assert nothing. The same shape the
    // video suite uses for "the web PDP mounts no player" — pin the accepted
    // degraded state, so that if it ever changes, a test says so and points at
    // the ruling in CLAUDE.md instead of the change landing silently.
    //
    // WHAT IT STILL GUARDS, and it is the part worth guarding: an unpriced plan
    // box must quote ZERO, never a number. Rendering ₹0 is a visible, honest
    // failure. Rendering a stale or invented instalment — ₹276 x 24mo on a page
    // whose pricing call just died — is a shopper being quoted a figure nothing
    // substantiates, and that WOULD be a defect under the same ruling that
    // cleared the ₹0.
    test(`the plan box falls back to zero and invents no figure when ${failure.name}`, async ({
      page,
    }) => {
      test.skip(!subject, 'the live listing returned no upfront product to open');

      await page.route(VARIANT_PRICING, failure.apply);
      await openPdp(page, subject);

      // No price node to wait on — that is the point — so wait for the plan box,
      // which renders either way.
      await page
        .getByText(/see plans|choose your plan/i)
        .first()
        .waitFor({ state: 'visible', timeout: TIMEOUTS.nav })
        .catch(() => {});

      const bodyText = await page.locator('body').innerText();
      const copy = moneyCopy(bodyText);

      // Recorded on every run, so the accepted copy is on the record and a
      // change to it is visible in the log before anyone has to go looking.
      const fallbackRows = copy.filter((line) => /₹[\d,]+\s*x\s*\S+?mo/i.test(line));
      console.log(`${failure.name} -> plan box quotes: ${fallbackRows.join(' | ') || '(no ladder row)'}`);

      // Non-vacuous: prove the degraded state is actually on screen. If the PDP
      // priced itself anyway there is nothing here to check, and passing would
      // claim a check that never ran. The current unpriced render carries no
      // ladder row at all, so with zero rows the assertion below holds only
      // because the unpriced marker was proved first.
      test.skip(
        !isUnpriced(bodyText),
        'the PDP priced itself despite the block, so there is no fallback to inspect'
      );

      const nonZero = fallbackRows.filter((line) => {
        const amount = /₹([\d,]+)\s*x\s*\S+?mo/i.exec(line);
        return amount && Number(amount[1].replace(/,/g, '')) !== 0;
      });

      expect(
        nonZero,
        `${subject.slug}: the pricing call failed, yet the plan box quotes a non-zero ` +
          'instalment. ₹0 is the agreed fallback precisely because it is visibly empty; a real ' +
          'number here is a figure the shopper was quoted that nothing in the response ' +
          `substantiates.\n    ${copy.join('\n    ')}`
      ).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
// 2. THE ONE THAT DECIDES SEVERITY. Logged in; adds one real line to the cart.
// ---------------------------------------------------------------------------
//
// This is the invariant the ruling above rests on. Nothing else in the suite
// proves it: every other pricing spec compares figures between surfaces that
// were all priced normally. If this ever fails, the PDP defect stops being
// cosmetic and becomes a blocker — a shopper quoted ₹0 and charged ₹0, or
// charged something they never saw.
test.describe('a PDP that could not price still charges the right amount', () => {
  // ONE real cart line per run, and the config retries once locally — a retry
  // would add a second. Same reason device-protection-consistency pins it.
  test.describe.configure({ retries: 0 });

  test.beforeAll(() => assertFreshSession());

  test('the price the PDP could not show is still the price cart and Review Order ask for', async ({
    page,
    request,
  }) => {
    test.setTimeout(300000);

    // Truth, and the basket baseline, read through a context that is NOT
    // blocked — so what the cart holds never depends on the injected failure.
    const cartBefore = await (
      await request.get(`${BASE_URL}/api/cart?payment_type=UPFRONT`, {
        headers: { accept: 'application/json' },
      })
    ).json();
    const held = new Set(
      (cartBefore?.data?.items || []).map((l) => l?.variant?.bpid).filter(Boolean)
    );
    // An EMPTY basket answers `data: []` — an array, not the usual object with
    // a zero total (measured 29 Sep 2026). That is an empty cart, not a missing
    // field, so it is a ₹0 baseline. Any other shape still fails below.
    const emptyBasket = Array.isArray(cartBefore?.data) && cartBefore.data.length === 0;
    const totalBefore = emptyBasket ? 0 : cartBefore?.data?.total_amount;

    // Guard the baseline, not just the delta. If `total_amount` is ever absent
    // or renamed, every comparison below becomes NaN and reports itself as
    // "the cart total moved by NaN" — a pricing defect that is really a missing
    // field. Measured in scripts/probe-unpriced-carries-to-review.spec.js:
    // data.total_amount is what the cart page renders as Total, so it is the
    // right field to anchor on; this only fails loudly if that stops being true.
    expect(
      Number.isFinite(totalBefore),
      `GET /api/cart returned no numeric data.total_amount (got ${JSON.stringify(totalBefore)}), ` +
        'so there is no baseline to measure the add against.'
    ).toBe(true);

    const product = await pickUpfrontProduct(request, held);
    test.skip(!product, 'no addable upfront product the cart does not already hold');

    const pricingRes = await getWithRetry(
      request,
      `${BASE_URL}/api/apps/variant-pricing/${product.slug}/${product.variant.id}`,
      { failOnStatusCode: false }
    );
    const truePrice = (await pricingRes.json())?.data?.upfront?.price;
    expect(truePrice, `${product.slug} has no upfront price to reconcile against`).toBeGreaterThan(0);

    // Block pricing for the WHOLE journey. A shopper whose network is dropping
    // that call does not get it back when they navigate — and the point is
    // precisely that cart and Review Order must not need it.
    await page.route(VARIANT_PRICING, (route) => route.abort('failed'));

    await openPdp(page, { slug: product.slug, bpid: product.variant.bpid });
    await page
      .getByText(/see plans|choose your plan/i)
      .first()
      .waitFor({ state: 'visible', timeout: TIMEOUTS.nav })
      .catch(() => {});

    // Non-vacuous: if the PDP priced itself anyway there is no unpriced state to
    // carry, and this would pass without testing the thing it names.
    const pdpUnpriced = isUnpriced(await page.locator('body').innerText());
    test.skip(
      !pdpUnpriced,
      `${product.slug} priced itself despite the block — nothing unpriced to carry through`
    );

    // Structural anchor: the cart control immediately before Buy Now. Never by
    // name alone — that reaches the recommended-products carousel, which on
    // 14 Aug 2026 put a ₹1,24,999 phone into a live cart.
    //
    // MOVED TO utils/buyRow.js 16 Sep 2026, because the control is no longer a
    // text button. It is icon-only now — `aria-label="Add to cart"` with an
    // empty innerText — so the /^add to cart$/i test against innerText that
    // used to live here matched nothing and this spec failed on a control that
    // was on screen the whole time.
    const clickAddToCart = () => clickAddToCartControl(page);

    // CONFIRM THE ADD BY ITS REQUEST, AND RETRY AN INERT CLICK.
    //
    // Measured here: the first click fired no POST at all and the test died on
    // a 15s waitForResponse. That is the race CLAUDE.md names — the control
    // renders before its handler is bound, so the event is delivered and
    // nothing happens. A one-shot click plus a wait reports it as "the cart
    // never responded", which blames the wrong thing.
    //
    // Retrying is safe: re-adding a product the cart already holds is a 200
    // no-op, so a click that turns out to have landed cannot double the line.
    let postResponse = null;
    for (let attempt = 1; attempt <= 3 && !postResponse; attempt++) {
      const waiter = page
        .waitForResponse(
          (r) => /\/api\/cart/.test(r.url()) && r.request().method() === 'POST',
          { timeout: 8000 }
        )
        .catch(() => null);
      const clicked = await clickAddToCart();
      expect(clicked, 'the PDP rendered no Add to Cart before its Buy Now').toBe(true);
      postResponse = await waiter;
      if (!postResponse) {
        console.log(`add attempt ${attempt} was inert — the handler had not bound yet; retrying`);
      }
    }

    expect(
      postResponse,
      'Add to Cart never produced a POST /api/cart across 3 attempts'
    ).toBeTruthy();
    expect(postResponse.status(), 'the cart refused the add').toBe(200);

    // The line the site actually recorded, priced by the server.
    const cartAfter = await (
      await request.get(`${BASE_URL}/api/cart?payment_type=UPFRONT`, {
        headers: { accept: 'application/json' },
      })
    ).json();
    const line = (cartAfter?.data?.items || []).find(
      (l) => l?.variant?.bpid === product.variant.bpid
    );
    expect(line, `${product.variant.bpid} is not in the basket after a 200 add`).toBeTruthy();

    console.log(
      `${product.name}: PDP showed no price; cart API line MOP ₹${line.MOP} ` +
        `(true upfront.price ₹${truePrice}), purchase_mode ${line.purchase_mode}`
    );
    expect(
      line.MOP,
      `the cart recorded ₹${line.MOP} for a product whose real price is ₹${truePrice}. ` +
        'The PDP failing to price has leaked into what the shopper is charged.'
    ).toBe(truePrice);

    // ---- The two pages a shopper actually reads ------------------------
    await openCart(page, 6);
    await dismissExchangeDialog(page);
    await page
      .getByText(/total amount/i)
      .first()
      .waitFor({ state: 'visible', timeout: TIMEOUTS.nav })
      .catch(() => {});
    const cart = parseOrderSummary(await page.locator('body').innerText());
    expect(cart, 'no Order Summary on the cart page').toBeTruthy();

    // CLAUDE.md: "Price (N Items)" is a sum of MRPs. The line that must move by
    // the selling price is the TOTAL, never the Price line.
    expect(
      cart.total - totalBefore,
      `adding a ₹${truePrice} product moved the cart total by ₹${cart.total - totalBefore}`
    ).toBe(truePrice);

    await (await cartContinueButton(page)).click({ timeout: TIMEOUTS.action });
    await page.waitForURL(new RegExp(URLS.review), { timeout: 60000 });
    await dismissExchangeDialog(page);
    await page
      .getByText(/total amount/i)
      .first()
      .waitFor({ state: 'visible', timeout: TIMEOUTS.nav })
      .catch(() => {});

    const reviewText = await page.locator('body').innerText();
    const review = parseOrderSummary(reviewText);
    expect(review, 'no Order Summary on Review Order').toBeTruthy();

    console.log(
      `cart ₹${cart.total} · review ₹${review.total} · moved by ₹${cart.total - totalBefore} ` +
        `(product ₹${truePrice}) — pricing call blocked throughout`
    );

    expect(
      review.total,
      `cart quotes ₹${cart.total} and Review Order quotes ₹${review.total} with the pricing ` +
        'call blocked. The shopper is asked for a different amount on the page they pay from.'
    ).toBe(cart.total);

    expect(
      moneyCopy(reviewText).filter((line) => /undefined|NaN/i.test(line)),
      'Review Order carries a placeholder value through from the PDP. This is the blocker case: ' +
        'the unpriced state has reached the page the shopper pays from.'
    ).toEqual([]);

    // The stop line. Continue on Review Order is what mints an order id.
    console.log(`stopped at Review Order without pressing Continue: ${page.url()}`);
    console.log(
      `NOTE: this run added "${product.name}" (${product.variant.bpid}) to the live cart.`
    );
  });
});
