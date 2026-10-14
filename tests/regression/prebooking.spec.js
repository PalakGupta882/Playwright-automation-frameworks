// tests/regression/prebooking.spec.js
//
// Pre-booking — NEW SURFACE, first covered 16 Sep 2026.
//
// CLAUDE.md records `isPrebookingAllow` as present on the PDP payload but
// enabled on NO product ("0 of 217 on 2 Sep 2026"), with the standing
// instruction not to write a test against a state the catalogue cannot produce.
// The catalogue now produces it: 8 of 241 products are pre-booking, all Apple,
// all launching 2026-09-18. So this file exists now and could not have before.
//
// UPDATE 1 Oct 2026 — those 8 launched. Their tag was renamed "New Launch"
// (same colour, same priority) and pre-booking was switched off on all of
// them: isPrebookingAllow=false, normal_order_access "all",
// can_place_normal_order true, no prebooking key. The listing badge is
// marketing copy and is reused for other states, so this file no longer
// identifies pre-booking by the badge NAME. It resolves every BADGED product
// and treats isPrebookingAllow on the PDP payload as the source of truth. A
// badge whose name says pre-booking must still agree with that flag.
//
// WHAT THE FEATURE IS, measured end to end on 16 Sep 2026:
//
//   listing row   variant.tags[] carries {name:"Pre-booking", bgHexColor:"#FF5722",
//                 textHexColor:"#FFFFFF", priority:1}            <- new array
//   PDP payload   product.isPrebookingAllow  = true
//                 product.launchDate         = "2026-09-18T00:00:00.000Z"
//                 product.normalOrderAccess  = "pre_booked_only"  <- new field
//   pricing       data.prebooking            = { amount: 99 }     <- new key
//                 data.normal_order_access   = "pre_booked_only"  <- new key
//                 data.can_place_normal_order = false             <- new key
//   PDP render    one "Pre-book Now" button, a "Pre-booking Price ₹99" line,
//                 and NO cart icon (aria-label="Add to cart") / "Buy Now"
//
// THE ASSERTION THAT MATTERS is the last one. `can_place_normal_order: false`
// is the business rule — these are unreleased devices and only a pre-booking
// may be placed against them. The page enforces it by substituting the buy row,
// exactly as Sold Out does. If a normal buy control ever appears on one of
// these, a shopper can place a full order for a device that does not exist yet,
// which is the same class of failure as ordering out-of-stock goods.
//
// NOTHING HERE CLICKS "Pre-book Now". That control takes ₹99 and mints a real
// pre-booking. The file is read-only and needs no BYTEPE_ALLOW_WRITES, because
// every state it checks is visible without pressing anything.
//
// WHY "Buy Now" IS THE ANCHOR — the same reason stock-availability.spec.js
// gives: the recommended-products carousel further down the PDP has its own
// "Add to Cart", and locating the buy CTA by that name once put a ₹1,24,999
// phone in the live cart. Carousel tiles carry no "Buy Now", so that name
// identifies the real buy control and nothing else.
//
// Public and logged out: pre-booking eligibility here is catalogue state, not
// per-shopper state. Confirmed by loading a pre-booking PDP with a real session
// — the buy row is identical, only the "Already pre-booked? Sign in to buy now"
// prompt drops away.

const { test, expect } = require('../fixtures/pageFixtures');
const { BASE_URL, BASE_API_URL } = require('../data/constants');
const { getWithRetry } = require('../utils/apiRetry');

test.use({ storageState: { cookies: [], origins: [] } });

// A retry here would re-roll a live-catalogue read and could report a flaky
// pass on a gate that decides whether an unreleased device can be ordered.
test.describe.configure({ retries: 0 });

const PAGE_SIZE = 100;
const listingPage = (page) => `product-service/apps/products?page=${page}&limit=${PAGE_SIZE}`;
const bySlug = (slug, bpid) => `product-service/apps/products/by-slug/${slug}/${bpid}`;
const variantPricing = (slug, variantId) => `apps/variant-pricing/${slug}/${variantId}`;

const PREBOOK_TAG = /pre-?booking/i;
const tagsOf = (row) => (row && row.variant && row.variant.tags) || [];
const isBadged = (row) => tagsOf(row).length > 0;
const badgeSaysPrebook = (row) => tagsOf(row).some((t) => PREBOOK_TAG.test(t.name || ''));

test.describe('Pre-booking', () => {
  /** @type {import('@playwright/test').APIRequestContext} */
  let api;
  const catalogue = [];
  const badged = [];
  const untagged = [];
  // Badged rows whose PDP payload says isPrebookingAllow — filled in beforeAll.
  const tagged = [];
  /** @type {Map<string, any>} */
  const detail = new Map(); // bpid -> { row, product, variant, pricing }

  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(300000);

    api = await playwright.request.newContext({
      baseURL: `${BASE_API_URL.replace(/\/+$/, '')}/`,
      storageState: { cookies: [], origins: [] },
    });

    for (let page = 1; page <= 20; page++) {
      const res = await getWithRetry(api, listingPage(page), { failOnStatusCode: false });
      expect(res.status(), `listing page ${page} did not return 200`).toBe(200);
      const body = await res.json();
      const items = (body && body.data && body.data.items) || [];
      catalogue.push(...items);
      if (items.length < PAGE_SIZE) break;
    }

    catalogue.forEach((row) => (isBadged(row) ? badged : untagged).push(row));

    // Resolve the PDP payload and the pricing for every tagged product, plus a
    // few untagged ones as the negative control. Sequential and small on
    // purpose: sweeping this origin unthrottled earns a 429, and a 429 is not
    // a defect.
    // Controls must be IN STOCK. A sold-out variant substitutes its buy row
    // with a disabled "Sold Out" (see stock-availability.spec.js), so a
    // sold-out control reports "no Buy Now" for a reason unrelated to
    // pre-booking — which is what happened on 29 Sep 2026 with Nord CE 6 Lite.
    // Resolve untagged rows until three available ones are found.
    const CONTROLS = 3;
    let controlsFound = 0;
    const toResolve = [...badged, ...untagged.slice(0, 15)];
    for (const row of toResolve) {
      const isControl = !isBadged(row);
      if (isControl && controlsFound >= CONTROLS) break;
      const res = await getWithRetry(api, bySlug(row.slug, row.variant.bpid), {
        failOnStatusCode: false,
        timeout: 30000,
      });
      const body = await res.json().catch(() => null);
      const data = body && body.data;
      if (!data || !data.variant) continue;
      if (isControl) {
        if (!(data.variant.available && data.variant.stock > 0)) continue;
        controlsFound++;
      }

      const pres = await getWithRetry(api, variantPricing(row.slug, data.variant.id), {
        failOnStatusCode: false,
        timeout: 30000,
      });
      const pbody = await pres.json().catch(() => null);

      detail.set(row.variant.bpid, {
        row,
        product: data.product || {},
        variant: data.variant,
        pricing: (pbody && pbody.data) || null,
      });
    }

    for (const row of badged) {
      const d = detail.get(row.variant.bpid);
      if (d && d.product.isPrebookingAllow === true) tagged.push(row);
    }

    console.log(
      `pre-booking sweep: ${badged.length} badged (${[...new Set(badged.flatMap((r) => tagsOf(r).map((t) => t.name)))].join(', ') || 'none'}), ${tagged.length} pre-booking of ${catalogue.length} listed; ` +
        `${detail.size} payloads resolved`
    );
    tagged.forEach((p) => console.log(`  pre-booking: ${p.name} — /pd/${p.slug}/${p.variant.bpid}`));
  });

  test.afterAll(async () => {
    await api.dispose();
  });

  // Skips below are not passes. A pre-booking product is transient by nature —
  // the tag comes off at launch.
  const needTagged = () =>
    test.skip(
      tagged.length === 0,
      'no product currently has isPrebookingAllow=true, so the feature cannot be exercised. ' +
        'This is a skip and not a pass — pre-booking is unverified until the catalogue holds one.'
    );

  // Runs whether or not anything is pre-booking today: a badge that SAYS
  // pre-booking on a product that sells normally is wrong in either state.
  test('the listing tag and the PDP flag agree', () => {
    expect(catalogue.length, 'the listing sweep resolved nothing').toBeGreaterThan(50);

    const mismatched = [];
    for (const [bpid, d] of detail) {
      const tagSays = badgeSaysPrebook(d.row);
      const pdpSays = d.product.isPrebookingAllow === true;
      if (tagSays !== pdpSays) {
        mismatched.push(
          `${d.row.name} (/pd/${d.row.slug}/${bpid}): listing tag=${tagSays} isPrebookingAllow=${pdpSays}`
        );
      }
    }

    expect(
      mismatched,
      'The listing badge and the PDP flag are two copies of the same fact. A tile badged ' +
        'Pre-booking whose PDP sells normally — or the reverse — misleads the shopper about ' +
        'what they are buying before they ever open the product.'
    ).toEqual([]);
  });

  test('every pre-booking product carries a complete pre-booking contract', () => {
    needTagged();

    const problems = [];
    for (const row of tagged) {
      const d = detail.get(row.variant.bpid);
      if (!d) {
        problems.push(`${row.name}: PDP payload did not resolve`);
        continue;
      }
      const where = `${row.name} (/pd/${row.slug}/${row.variant.bpid})`;

      if (d.product.isPrebookingAllow !== true) {
        problems.push(`${where}: isPrebookingAllow=${JSON.stringify(d.product.isPrebookingAllow)}`);
      }
      if (!d.product.launchDate || Number.isNaN(Date.parse(d.product.launchDate))) {
        problems.push(`${where}: launchDate=${JSON.stringify(d.product.launchDate)} is not a date`);
      }
      if (!d.pricing) {
        problems.push(`${where}: variant-pricing did not resolve`);
        continue;
      }
      // The amount the shopper is actually charged to reserve the device. A
      // missing or zero amount is a free reservation on an unreleased flagship.
      const amount = d.pricing.prebooking && d.pricing.prebooking.amount;
      if (!(typeof amount === 'number' && amount > 0)) {
        problems.push(`${where}: prebooking.amount=${JSON.stringify(d.pricing.prebooking)}`);
      }
      // The gate itself.
      if (d.pricing.can_place_normal_order !== false) {
        problems.push(
          `${where}: can_place_normal_order=${JSON.stringify(d.pricing.can_place_normal_order)} — ` +
            'a pre-booking product is accepting normal orders'
        );
      }
      // Two copies of the same rule, one per payload. They must not disagree.
      if (d.pricing.normal_order_access !== d.product.normalOrderAccess) {
        problems.push(
          `${where}: normalOrderAccess=${JSON.stringify(d.product.normalOrderAccess)} on the PDP ` +
            `but ${JSON.stringify(d.pricing.normal_order_access)} in pricing`
        );
      }
    }

    expect(problems, 'pre-booking contract violations').toEqual([]);
  });

  // The inverse. Without this, every assertion above would still pass if the
  // backend started reporting pre_booked_only for the whole catalogue.
  test('an ordinary product is not gated', () => {
    const controls = untagged
      .map((r) => detail.get(r.variant.bpid))
      .filter(Boolean)
      .slice(0, 3);
    expect(controls.length, 'no untagged product resolved to act as a control').toBeGreaterThan(0);

    const wrong = controls
      .filter(
        (d) =>
          d.product.isPrebookingAllow !== false ||
          (d.pricing && d.pricing.can_place_normal_order !== true)
      )
      .map(
        (d) =>
          `${d.row.name}: isPrebookingAllow=${JSON.stringify(d.product.isPrebookingAllow)} ` +
          `can_place_normal_order=${JSON.stringify(d.pricing && d.pricing.can_place_normal_order)}`
      );

    expect(wrong, 'a product with no Pre-booking tag is being gated as if it were one').toEqual([]);
  });

  // The exit from pre-booking. A device past its launch date that is still
  // pre_booked_only cannot be bought at all — the opposite failure to the gate
  // above, and the one the 1 Oct 2026 launch exercised for the first time.
  test('a launched product is no longer gated', () => {
    const launched = [...detail.values()].filter(
      (d) => d.product.launchDate && Date.parse(d.product.launchDate) < Date.now()
    );
    test.skip(launched.length === 0, 'no resolved product has a launch date in the past');

    const stuck = launched
      .filter(
        (d) =>
          d.product.isPrebookingAllow === true ||
          (d.pricing && d.pricing.can_place_normal_order === false)
      )
      .map(
        (d) =>
          `${d.row.name} (launched ${d.product.launchDate.slice(0, 10)}): ` +
          `isPrebookingAllow=${d.product.isPrebookingAllow} ` +
          `can_place_normal_order=${d.pricing && d.pricing.can_place_normal_order}`
      );

    expect(stuck, 'launched devices that still only accept a pre-booking').toEqual([]);
  });

  // THE CONTROL CASE for the next test, and the reason it cannot pass
  // vacuously. "No enabled Buy Now here" is also true of a page that failed to
  // render, of a 404 body, and of a selector that stopped matching. This proves
  // the same locator finds a live buy control on an ordinary product.
  test('an ordinary product renders a live buy control', async ({ page }) => {
    test.setTimeout(120000);
    const control = untagged.find((r) => detail.has(r.variant.bpid));
    expect(control, 'no untagged product to use as a control').toBeTruthy();

    await page.goto(`${BASE_URL}/pd/${control.slug}/${control.variant.bpid}`, {
      waitUntil: 'domcontentloaded',
    });

    await expect(
      page.getByRole('button', { name: 'Buy Now', exact: true }),
      `${control.name} is an ordinary product but renders no Buy Now — if the buy row was ` +
        'redesigned, the pre-booking test below is now asserting nothing and needs a new anchor.'
    ).toBeEnabled({ timeout: 30000 });
  });

  test('a pre-booking product offers only Pre-book Now, never a normal buy control', async ({
    page,
  }) => {
    test.setTimeout(300000);
    needTagged();

    const failures = [];

    for (const row of tagged.slice(0, 3)) {
      const where = `${row.name} (/pd/${row.slug}/${row.variant.bpid})`;
      await page.goto(`${BASE_URL}/pd/${row.slug}/${row.variant.bpid}`, {
        waitUntil: 'domcontentloaded',
      });

      // Wait for the buy row to exist before judging it. Every button on this
      // PDP renders before its handler is bound, and an early read would see a
      // page with no buttons at all and call it correct.
      const preBook = page.getByRole('button', { name: /pre-?book now/i });
      const rendered = await preBook
        .first()
        .waitFor({ state: 'visible', timeout: 45000 })
        .then(() => true)
        .catch(() => false);

      if (!rendered) {
        failures.push(`${where}: no "Pre-book Now" control rendered at all`);
        continue;
      }

      // "Add to cart", lower-case c: the control is icon-only and carries that
      // exact aria-label. The old title-case "Add to Cart" was a text button
      // that no longer exists, so asserting its absence would pass vacuously on
      // every product in the catalogue. See utils/buyRow.js.
      for (const name of ['Buy Now', 'Add to cart']) {
        const count = await page.getByRole('button', { name, exact: true }).count();
        if (count > 0) {
          failures.push(
            `${where}: renders ${count} "${name}" button(s) alongside Pre-book Now, but ` +
              'can_place_normal_order is false — a shopper can place a full order for a device ' +
              'that has not launched'
          );
        }
      }

      // The quoted reservation price must be the one the API charges.
      //
      // POLLED, not read once. "Pre-book Now" paints roughly a second before
      // the pricing block below it — measured: at the moment the button is
      // visible the body contains no "99" at all, and the "Pre-booking Price
      // ₹99" row appears on the next tick. Reading innerText the instant the
      // button resolves reported all three watches as quoting nothing, which
      // was this test being early rather than the page being wrong.
      const d = detail.get(row.variant.bpid);
      const amount = d && d.pricing && d.pricing.prebooking && d.pricing.prebooking.amount;
      if (typeof amount === 'number' && amount > 0) {
        const wanted = new RegExp(`₹\\s*${amount.toLocaleString('en-IN')}\\b`);
        const deadline = Date.now() + 20000;
        let body = '';
        let shown = false;
        while (Date.now() < deadline && !shown) {
          body = await page.locator('body').innerText();
          shown = wanted.test(body);
          if (!shown) await page.waitForTimeout(500);
        }
        if (!shown) {
          failures.push(
            `${where}: pricing says prebooking.amount=${amount} but no "₹${amount}" appears on ` +
              'the page — the shopper is quoted a reservation price the API does not charge'
          );
        }
      }
    }

    expect(failures, 'pre-booking buy-row failures').toEqual([]);
  });
});
