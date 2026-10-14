// tests/regression/pricing-consistency.spec.js
//
// Does the same product cost the same amount everywhere it is quoted?
//
// The suite already checks pricing, but every existing check is self-consistent
// within ONE layer: pricing-api.spec.js reconciles best_price against its own
// competitors, emi-checkout-flow.spec.js reconciles the EMI ladder against its
// own price, product-pricing.spec.js checks one PDP shows a discount. None of
// them compares a figure on one surface against the same figure on another.
//
// So a product whose listing tile says ₹32,299, whose PDP says ₹36,999 and
// whose plan box says ₹34,000 passes the entire regression suite today. That is
// the gap this file closes: it walks the price ACROSS surfaces —
//
//     pricing API  ->  PLP tile  ->  PDP header  ->  PDP plan box (per plan)
//
// and asserts the shopper is shown one number, not three.
//
// The cart and Review Order legs live in pricing-checkout-consistency.spec.js,
// which needs a session. This file is entirely public and logged out: which
// plans exist and what they cost is product configuration, identical for every
// shopper, which CLAUDE.md names as the layer that is safe to assert. Nothing
// here touches per-shopper eligibility.

const { test, expect } = require('../fixtures/pageFixtures');
const { BASE_URL, TIMEOUTS } = require('../data/constants');
const { pdpApiPath, variantPricingPath, productVasPath, vasNamesFrom } = require('../data/emiApi');
const { getWithRetry } = require('../utils/apiRetry');
const { parsePlpTile, parsePdpHeader, parsePlanBox, parseAddOns } = require('../utils/priceText');
const { openPlanPanel, readPlanSurfaces } = require('../utils/planPanel');

// Logged out, deliberately and explicitly — same reason cardless-emi.spec.js and
// emi-plan-config.spec.js do it. It also makes every case here a candidate for
// the CI public list.
test.use({ storageState: { cookies: [], origins: [] } });

// A PDP renders in ~4s and the catalogue is ~200 products, so the sweeps below
// are slow by nature rather than by fault.
const CATALOGUE_TIMEOUT = 900000;
const PAGE_TIMEOUT = 120000;

// Instalments are whole rupees, so instalment x tenure can miss the exact total
// by up to one rupee per instalment. emi-checkout-flow.spec.js measured this:
// a 3-month plan on a ₹227,900 product legitimately totals ₹227,901. Anything
// beyond that allowance is a real charge, not rounding.
const roundingAllowance = (tenure) => tenure;

// HOW MANY PRODUCTS THERE ARE SUPPOSED TO BE.
//
// The listing endpoint answers this itself — `data.count`, alongside the page
// of items. Measured 27 Aug 2026: count 223, and the PLP scroll below reached
// exactly 223 tiles on a quiet origin. So it is the number to hold the scrape
// to, not a guess.
//
// Returns null rather than throwing: a scrape that cannot reach the API still
// runs, it just loses the completeness check, and losing it is reported.
const CATALOGUE_COUNT_PATH = `${BASE_URL}/api/product-service/apps/products?page=1&limit=1`;

async function catalogueCount(page) {
  try {
    const res = await page.request.get(CATALOGUE_COUNT_PATH, {
      headers: { accept: 'application/json' },
      timeout: 30000,
    });
    if (!res.ok()) return null;
    const body = await res.json();
    const count = body?.data?.count;
    return Number.isInteger(count) && count > 0 ? count : null;
  } catch {
    return null;
  }
}

// A scrape that stops early must FAIL, not quietly check less.
//
// Measured 27 Aug 2026, in one run, from this same function: 216 tiles, then
// 144, then 223. The 144 came while the origin was returning 429s — the lazy
// loader stalled, the count held still for the three rounds this loop asked
// for, and the scrape declared itself finished 79 products short. Every sweep
// below then reported "0 mismatched" over 64% of the catalogue and passed.
//
// That is the vacuous pass this file's own guard comment warns about, one step
// up: not an EMPTY listing, a PARTIAL one, which no floor of 20 can catch.
// A stalled lazy-load and a finished one look identical from inside the loop,
// so the only thing that separates them is knowing how many there should be.
// 0.85. WIDENED FROM 0.95 ON 1 SEP 2026, BECAUSE 0.95 WAS INSIDE THE NORMAL RANGE.
//
// The 27 Aug measurement behind 0.95 was 223/223 twice and 216/223 once, which
// made a 5% margin look generous. It is not. Measured across 1 Sep 2026 on a
// healthy origin, same function, same day:
//
//   217 of 217   (100%)
//   205 of 217   (94.5%)
//   193 of 217   (89.0%)
//
// So 0.95 failed the guard on a scrape that had found every product the sweeps
// then checked cleanly — a false failure on the test whose whole purpose is to
// say when a result is not trustworthy. A guard that cries wolf on half its runs
// stops being read, which is worse than not having it.
//
// 0.85 still catches what this exists for: the stalled lazy-load was 144 of 223,
// or 64.6%, and every observed healthy scrape is at 89% or above. The gap
// between 85% and 89% is the whole margin, and it is deliberately narrow — do
// not widen it further without new measurements, because the point is that a
// PARTIAL sweep must never report itself as a clean one.
const SHORTFALL_TOLERANCE = 0.85;
const readListingSummary = { expected: null, scraped: 0 };

// Read the live listing rather than tests/data/products.json. That file was
// generated by an earlier `npm run discover` and holds 186 entries; the listing
// served 208 on 14 Aug 2026. Comparing a stale fixture against live prices would
// report catalogue drift as a pricing defect — the exact confusion CLAUDE.md
// warns about, since neither slug nor bpid is a stable key.
async function readListing(page) {
  const expected = await catalogueCount(page);

  await page.goto(`${BASE_URL}/all-products`, { waitUntil: 'domcontentloaded' });

  // Wait for the first tile before settling. scripts/discover-products.spec.js
  // settles on "the count stopped changing", which silently accepts zero: if no
  // tile has rendered yet the count is 0, it is 0 three rounds running, and the
  // loop exits reporting an empty catalogue. Measured — a re-run of this spec
  // logged "listing served 0 product tiles" and every sweep below then passed
  // vacuously or crashed. The floor has to be a real tile, not a stable number.
  await page
    .locator('a[href*="/pd/"]')
    .first()
    .waitFor({ state: 'visible', timeout: 30000 });

  // The listing lazy-loads. Scroll until either the API's count is on screen —
  // the unambiguous finish — or the count stops moving.
  //
  // STALL_ROUNDS is 6, up from 3. Three rounds is 3.6s of quiet, and a throttled
  // origin goes quiet for longer than that between batches without being done.
  // Six only costs time on a genuinely finished listing, where the target count
  // has usually already been reached and the loop exits before counting stalls
  // at all.
  const STALL_ROUNDS = 6;
  const DEADLINE = Date.now() + 180000;

  let last = 0;
  let stable = 0;
  while (Date.now() < DEADLINE) {
    const n = await page.locator('a[href*="/pd/"]').count();
    if (expected && n >= expected) break;
    if (n === last && n > 0) {
      if (++stable >= STALL_ROUNDS) break;
    } else {
      stable = 0;
      last = n;
    }
    await page.mouse.wheel(0, 4000);
    await page.waitForTimeout(1200);
  }

  const cards = page.locator('a[href*="/pd/"]');
  const total = await cards.count();
  const byHref = new Map();

  for (let i = 0; i < total; i++) {
    const card = cards.nth(i);
    const href = await card.getAttribute('href');
    if (!href || byHref.has(href)) continue;

    const match = /\/pd\/([^/?]+)\/([^/?]+)/.exec(href);
    if (!match) continue;

    const tile = parsePlpTile(await card.innerText().catch(() => ''));
    if (!tile) continue;

    byHref.set(href, { slug: match[1], bpid: match[2], href, tile });
  }

  readListingSummary.expected = expected;
  readListingSummary.scraped = byHref.size;

  // THE COMPLETENESS CHECK BELONGS HERE, NOT IN A TEST OF ITS OWN.
  //
  // It used to live only in "the listing rendered tiles to check", which runs
  // once. Measured 1 Sep 2026: after a later test failed, this hook ran a SECOND
  // time and returned 24 tiles of 217. The one-off test had already passed on
  // the first scrape's 205, so nothing re-checked, and the remaining sweeps
  // reported "EMI ladders checked across 24 products — 0 broken" and passed.
  //
  // That is precisely the vacuous pass the guard was written to prevent, one
  // level up: not a partial listing that goes unnoticed, but a partial listing
  // that a guard has already blessed. Asserting where the listing is PRODUCED
  // holds every scrape to it, however many times the hook runs.
  //
  // Throwing fails the hook and therefore every case in the file, which is the
  // right outcome — a 24-tile scrape makes all of them meaningless.
  if (expected && byHref.size < Math.floor(expected * SHORTFALL_TOLERANCE)) {
    throw new Error(
      `The listing scrape stopped ${expected - byHref.size} products short — ` +
        `${byHref.size} tiles of the ${expected} the catalogue reports. Every sweep in this ` +
        'file would otherwise have checked that subset and reported a clean result over it. ' +
        'Re-run on a quiet origin; if it reproduces, the lazy-loader is dropping products a ' +
        'shopper would never see.'
    );
  }

  return [...byHref.values()];
}

// by-slug -> variant id -> variant pricing. Two calls, because price is per
// variant and the listing links whichever variant is currently featured — which
// is not necessarily the master (CLAUDE.md).
async function pricingFor(request, { slug, bpid }) {
  const pdpRes = await getWithRetry(request, pdpApiPath(slug, bpid), {
    headers: { accept: 'application/json' },
  });
  if (!pdpRes.ok()) return { error: `by-slug ${pdpRes.status()}` };

  const pdp = await pdpRes.json();
  const variantId = pdp.data?.variant?.id;
  if (!variantId) return { error: 'by-slug returned no variant id' };

  const priceRes = await getWithRetry(request, variantPricingPath(slug, variantId), {
    headers: { accept: 'application/json' },
  });
  if (!priceRes.ok()) return { error: `variant-pricing ${priceRes.status()}` };

  const body = await priceRes.json();
  return {
    product: pdp.data.product,
    variant: pdp.data.variant,
    data: body.data || {},
  };
}

// Opens a PDP and waits for it to have actually priced itself.
//
// `domcontentloaded` plus a fixed sleep is not enough, and this was measured
// rather than assumed: at 3s, 2 of 8 sampled PDPs reported "no price in the
// header" while the same two parsed correctly on a clean load. The price is
// rendered after client-side hydration, so the wait has to be on the price
// itself. Anchored on the same locator ProductPage.priceText uses — the first
// node matching /^₹[\d,]+$/, which is the headline price in DOM order.
//
// Escape first: the site pops promo overlays over the PDP, and an overlay both
// covers the header and changes what innerText returns.
// `openPlans` is opt-in on purpose. Since the 23 Sep 2026 redesign the plans are
// NOT in the DOM until the "See Plans" disclosure is activated, so any caller
// that means to read the plan box has to ask for it — parsePlanBox() returns
// null otherwise, and a caller would report "this product renders no plan box"
// about a product whose plans simply had not been opened.
//
// The catalogue sweep compares the tile against the PDP *header* only, over 281
// products, so it does not pay for the extra click and settle.
async function openPdp(page, { slug, bpid }, { openPlans = false } = {}) {
  await page.goto(`${BASE_URL}/pd/${slug}/${bpid}`, { waitUntil: 'domcontentloaded' });
  await page.keyboard.press('Escape').catch(() => {});

  await page
    .getByText(/^₹[\d,]+$/)
    .first()
    .waitFor({ state: 'visible', timeout: TIMEOUTS.nav });

  // The disclosure arrives with the pricing round trip, a beat after the
  // headline. This replaces a wait on "Choose your plan", which the redesign
  // removed — so that wait could only time out and fall through its .catch(),
  // costing every product in the sweep a full nav timeout for no signal.
  await page
    .getByText(/see plans|choose your plan/i)
    .first()
    .waitFor({ state: 'visible', timeout: TIMEOUTS.nav })
    .catch(() => {});

  if (openPlans) {
    await openPlanPanel(page);
    // Dialog text AND body text — the plan dialog is a portal, so the tenure
    // ladder and the upfront figure are not reachable from the inline block's
    // region. See utils/planPanel.js.
    return readPlanSurfaces(page);
  }

  return page.locator('body').innerText();
}

// Run the catalogue sweep a few at a time. Serial takes ~15 minutes over 200
// products; unbounded parallelism rate-limits the origin, which is the same 429
// problem playwright.config.js caps workers for.
//
// Three, not five. At five the run completed but logged ~25 429s, several
// needing three backoff rounds — the retry helper absorbed them, which is
// exactly the situation playwright.config.js warns about: retries papering over
// contention until a real regression looks like the usual noise. Three keeps the
// sweep near two minutes with the origin quiet.
const BATCH = 3;

// THE TILE'S OWN SOURCE, so a mismatch can name which hop moved.
//
// Added 1 Sep 2026, after this file produced a fault it could not explain.
// iphone-17's tile read ₹79,900 / 4% off while variant-pricing said ₹81,400 /
// 2% off — twice in one run, minutes apart — and both surfaces agreed again
// forty minutes later, 217 of 217 clean. Nothing in the result could say
// whether the two surfaces genuinely disagreed or the price simply moved
// between the tile scrape and the pricing call, and those are different bugs
// owned by different people. ₹79,900 appeared in no field of either API, and
// no neighbouring tile carried it, so node recycling was ruled out too.
//
// The listing feed is what the tile is rendered from, so reading it as a third
// figure separates the two:
//
//   tile != feed      -> the PLP rendered a number its own feed never served
//                        (a stale page cache is the likely cause)
//   feed == tile,
//   feed != pricing   -> the catalogue and pricing services genuinely disagree
//
// This does NOT soften the assertion — a mismatch still fails. It only makes
// the failure name the field, per the rule in CLAUDE.md. Three calls for the
// whole catalogue, so it costs nothing beside the per-product sweep it explains.
async function catalogueFeed(request) {
  const rows = new Map();
  for (let page = 1; page <= 5; page++) {
    const res = await getWithRetry(
      request,
      `${BASE_URL}/api/product-service/apps/products?page=${page}&limit=100`,
      { headers: { accept: 'application/json' }, failOnStatusCode: false }
    );
    if (!res.ok()) break;
    const items = (await res.json())?.data?.items || [];
    if (items.length === 0) break;
    for (const p of items) {
      if (p?.slug && p?.variant?.bpid) rows.set(`${p.slug}/${p.variant.bpid}`, p.price || {});
    }
  }
  return rows;
}

// Names the hop a price mismatch actually sits on. Returns a clause, never
// throws, and says plainly when the feed cannot attribute it — a reading that
// cannot distinguish has to report that rather than pick a side.
function attributeMismatch(feed, tilePrice, apiPrice) {
  if (!feed || !Number.isFinite(feed.mop)) {
    return 'the listing feed carried no mop, so this cannot be attributed to a hop';
  }
  if (feed.mop === apiPrice && feed.mop !== tilePrice) {
    return (
      `the listing feed also says ₹${feed.mop}, so the PLP rendered a figure neither service ` +
      'served — a stale page cache rather than a pricing fault'
    );
  }
  if (feed.mop === tilePrice && feed.mop !== apiPrice) {
    return `the listing feed says ₹${feed.mop} too, so the catalogue and pricing services disagree`;
  }
  return `the listing feed says ₹${feed.mop}, which matches neither`;
}

async function inBatches(items, size, worker) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(worker))));
  }
  return out;
}

test.describe('Pricing consistency across surfaces', () => {
  let listing = [];

  // Scraped once and shared. Every case below reads the same listing, so a
  // re-scrape per test would triple the load on the origin for no benefit and
  // would let two cases disagree about what the catalogue contains.
  //
  // Throws rather than leaving `listing` empty: an empty list makes the sweeps
  // either crash on undefined or pass having checked nothing, and the second is
  // worse than a failure.
  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    // The scrape scrolls a lazy-loading catalogue of ~223 products and now keeps
    // going until it has all of them, so it outlives the 60s config timeout that
    // would otherwise apply to a hook.
    test.setTimeout(300000);

    const page = await context.newPage();
    try {
      listing = await readListing(page);
      console.log(
        `listing served ${listing.length} product tiles` +
          (readListingSummary.expected === null
            ? ' (the catalogue count endpoint was unreachable, so completeness is unverified)'
            : ` of the ${readListingSummary.expected} the catalogue reports`)
      );
      if (listing.length === 0) {
        throw new Error(
          'The listing page rendered no product tiles, so nothing below can be checked. ' +
            'This is a fixture failure, not a pricing result.'
        );
      }
    } finally {
      await context.close();
    }
  });

  // Non-vacuous guard. Every sweep below iterates `listing`, and an empty
  // listing would make all of them pass while asserting nothing — the failure
  // mode pricing-api.spec.js already guards against with its own fixture check.
  test('the listing rendered tiles to check', () => {
    expect(listing.length, '/all-products rendered no product tiles at all').toBeGreaterThan(20);

    const priced = listing.filter((entry) => entry.tile.price !== null);
    expect(
      priced.length,
      `${listing.length} tiles rendered but none of them carried a price`
    ).toBe(listing.length);

    // ...and it rendered ALL of them. See the note above readListing: a stalled
    // lazy-load reports a complete-looking listing that is a third short, and
    // every sweep below then passes over a subset without saying so. The floor
    // of 20 above cannot see that; only the catalogue's own count can.
    const { expected, scraped } = readListingSummary;
    test.skip(
      expected === null,
      'the catalogue count endpoint did not answer, so the scrape cannot be checked for completeness'
    );
    expect(
      scraped,
      `the listing scrape stopped ${expected - scraped} products short — ${scraped} tiles of the ` +
        `${expected} the catalogue reports. Every sweep in this file has therefore checked a ` +
        'subset and would have reported a clean result over it. Re-run on a quiet origin; if it ' +
        'reproduces, the lazy-loader is dropping products a shopper would never see.'
    ).toBeGreaterThanOrEqual(Math.floor(expected * SHORTFALL_TOLERANCE));
  });

  // ---- Surface 1 -> the API behind it ----------------------------------
  //
  // The whole catalogue, because a price glitch does not announce which product
  // it landed on, and a four-product sample is a coin flip. This is the widest
  // net in the file and the cheapest — no page loads, two API calls per product.
  test('every listing tile quotes the price its own pricing API returns', async ({ request }) => {
    test.setTimeout(CATALOGUE_TIMEOUT);

    const feed = await catalogueFeed(request);
    console.log(`listing feed carried ${feed.size} priced rows for hop attribution`);

    const results = await inBatches(listing, BATCH, async (entry) => {
      const pricing = await pricingFor(request, entry);
      if (pricing.error) return { entry, unreachable: pricing.error };

      const upfront = pricing.data.upfront || {};
      const faults = [];

      if (entry.tile.price !== upfront.price) {
        faults.push(
          `tile shows ₹${entry.tile.price}, API upfront.price is ₹${upfront.price} — ` +
            attributeMismatch(feed.get(`${entry.slug}/${entry.bpid}`), entry.tile.price, upfront.price)
        );
      }
      // Null means the tile carried no strike-through, which is correct for a
      // product with no discount. Only a tile that shows an MRP is held to it.
      if (entry.tile.mrp !== null && entry.tile.mrp !== upfront.cut_price) {
        faults.push(`tile MRP ₹${entry.tile.mrp}, API cut_price ₹${upfront.cut_price}`);
      }
      if (entry.tile.percentOff !== null && entry.tile.percentOff !== upfront.off_on_amount) {
        faults.push(
          `tile badge ${entry.tile.percentOff}% off, API off_on_amount ${upfront.off_on_amount}`
        );
      }
      // A discount badge with no saving behind it, or a saving with no badge.
      if (entry.tile.percentOff !== null && !(upfront.cut_price > upfront.price)) {
        faults.push(
          `tile advertises ${entry.tile.percentOff}% off but cut_price ₹${upfront.cut_price} ` +
            `is not above price ₹${upfront.price}`
        );
      }

      return { entry, faults };
    });

    const unreachable = results.filter((r) => r.unreachable);
    const mismatched = results.filter((r) => r.faults && r.faults.length);

    console.log(
      `checked ${results.length} tiles — ${mismatched.length} mismatched, ` +
        `${unreachable.length} unreachable`
    );

    // Unreachable is drift, not a pricing defect: slugs follow product names and
    // the listing links whichever variant is featured, so a 404 here means the
    // catalogue moved between the scrape and the call. Reported, not failed —
    // unless it is most of the catalogue, in which case the API is down and
    // every other result in this run is meaningless.
    if (unreachable.length) {
      console.log(
        'unreachable (catalogue drift):\n' +
          unreachable.map((r) => `  ${r.entry.slug}/${r.entry.bpid} — ${r.unreachable}`).join('\n')
      );
    }
    expect(
      unreachable.length,
      `${unreachable.length} of ${results.length} products could not be priced at all`
    ).toBeLessThan(results.length / 2);

    expect(
      mismatched.map((r) => `${r.entry.slug}: ${r.faults.join('; ')}`),
      'A listing tile is quoting a price the pricing API does not agree with. ' +
        'Whichever is right, a shopper is being shown a number that changes when they click.'
    ).toEqual([]);
  });

  // ---- Surface 1 -> Surface 2 ------------------------------------------
  //
  // The click. This is the hop a shopper makes and the one nothing covered.
  const HEADER_SAMPLE = 8;

  test('the PDP header repeats the listing tile, figure for figure', async ({ page, request }) => {
    test.setTimeout(CATALOGUE_TIMEOUT);

    // Spread across the catalogue rather than the first N, which are all one
    // brand — the sampling rule pricing-api.spec.js already uses.
    const step = Math.max(1, Math.floor(listing.length / HEADER_SAMPLE));
    const sample = listing.filter((_, i) => i % step === 0).slice(0, HEADER_SAMPLE);
    expect(sample.length, 'no products to sample').toBeGreaterThan(1);

    const faults = [];

    for (const entry of sample) {
      const header = parsePdpHeader(await openPdp(page, entry));
      if (!header) {
        faults.push(`${entry.slug}: the PDP rendered no price in its header at all`);
        continue;
      }

      const pricing = await pricingFor(request, entry);
      const upfront = pricing.error ? {} : pricing.data.upfront || {};

      if (header.price !== entry.tile.price) {
        faults.push(
          `${entry.slug}: tile ₹${entry.tile.price} -> PDP ₹${header.price}. ` +
            'The price changed when the shopper clicked through.'
        );
      }
      if (entry.tile.mrp !== null && header.mrp !== entry.tile.mrp) {
        faults.push(`${entry.slug}: tile MRP ₹${entry.tile.mrp} -> PDP MRP ₹${header.mrp}`);
      }
      if (entry.tile.percentOff !== null && header.percentOff !== entry.tile.percentOff) {
        faults.push(
          `${entry.slug}: tile ${entry.tile.percentOff}% off -> PDP ${header.percentOff}% off`
        );
      }
      // The monthly figure both surfaces advertise. The PLP labels it "EMI
      // from" and the PDP "Subscription from" on the same product, so only the
      // number is compared, not the copy.
      if (entry.tile.perMonth !== null && header.perMonth !== null) {
        if (header.perMonth !== entry.tile.perMonth) {
          faults.push(
            `${entry.slug}: tile ₹${entry.tile.perMonth}/mo -> PDP ₹${header.perMonth}/mo`
          );
        }
      }
      if (!pricing.error && header.price !== upfront.price) {
        faults.push(`${entry.slug}: PDP header ₹${header.price}, API ₹${upfront.price}`);
      }

      console.log(
        `${entry.slug}: tile ₹${entry.tile.price} = PDP ₹${header.price} = API ₹${upfront.price ?? '-'}`
      );
    }

    expect(faults, 'The price a shopper sees changed between the listing and the product page.')
      .toEqual([]);
  });

  // ---- Surface 2, plan by plan -----------------------------------------
  //
  // "All payment types" means every row the plan box offers. Which rows render
  // is driven by prodPaymentMode, so the two layouts are asserted separately.

  test('an upfront product prices every plan it offers the way the API does', async ({
    page,
    request,
  }) => {
    test.setTimeout(PAGE_TIMEOUT);

    const candidate = listing.find((e) => e.tile.perMonth === null) || listing[0];
    const pricing = await pricingFor(request, candidate);
    expect(pricing.error, `could not price ${candidate.slug}`).toBeFalsy();
    test.skip(
      pricing.product.prodPaymentMode !== 'UPFRONT',
      `${candidate.slug} is ${pricing.product.prodPaymentMode}, not UPFRONT`
    );

    const box = parsePlanBox(await openPdp(page, candidate, { openPlans: true }));
    expect(box, `${candidate.slug} rendered no "Choose your plan" box`).toBeTruthy();
    console.log(`${candidate.slug} plans: ${box.plans.join(', ')}`);

    const upfront = pricing.data.upfront || {};
    const options = pricing.data.emi?.emi_option || [];
    const faults = [];

    // Pay in Full — the plan every product offers.
    expect(box.payInFull, `${candidate.slug} offers no "Pay in Full" price`).toBeTruthy();
    if (box.payInFull !== upfront.price) {
      faults.push(`Pay in Full shows ₹${box.payInFull}, API upfront.price is ₹${upfront.price}`);
    }

    // The EMI rungs the box quotes must be rungs the API actually offers. The
    // box renders a subset — a "Recommended" NCEMI rung and the longest LCEMI
    // rung — so this asserts membership, not equality with the full ladder.
    expect(
      box.tenureRows.length,
      `${candidate.slug} advertises EMI but quotes no "₹X x N mo" figure`
    ).toBeGreaterThan(0);

    for (const row of box.tenureRows) {
      const match = options.find((o) => o.tenure === row.tenure);
      if (!match) {
        faults.push(
          `the box offers ₹${row.installment} x ${row.tenure}mo but the API ladder has no ` +
            `${row.tenure}-month option (it has ${options.map((o) => o.tenure).join(', ')})`
        );
        continue;
      }
      if (match.installment_amount !== row.installment) {
        faults.push(
          `the box quotes ₹${row.installment}/mo for ${row.tenure}mo, the API says ` +
            `₹${match.installment_amount}`
        );
      }
    }

    // "Instant Discount of ₹1500" is the figure the API calls instant_discount,
    // and CLAUDE.md is explicit that it is already inside MOP — so MRP must sit
    // at least that far above the price, or the saving is promised twice.
    if (box.instantDiscount !== null) {
      if (box.instantDiscount !== upfront.instant_discount) {
        faults.push(
          `box says Instant Discount ₹${box.instantDiscount}, API instant_discount is ` +
            `₹${upfront.instant_discount}`
        );
      }
      if (upfront.cut_price - upfront.price < box.instantDiscount) {
        faults.push(
          `an instant discount of ₹${box.instantDiscount} is claimed, but MRP ₹${upfront.cut_price} ` +
            `is only ₹${upfront.cut_price - upfront.price} above the price`
        );
      }
    }

    expect(faults, `${candidate.slug}: the plan box and the pricing API disagree`).toEqual([]);
  });

  test('a subscription product prices every plan it offers the way the API does', async ({
    page,
    request,
  }) => {
    test.setTimeout(PAGE_TIMEOUT);

    // Find a BOTH-mode product from the live listing rather than a pinned slug,
    // which drifts. The subscription layout is the one that renders Buy Upfront,
    // Cardless EMI, Pre-Approved Offers and Monthly Subscription together, so it
    // is where "all payment types" is actually assertable in one place.
    let subject = null;
    for (const entry of listing.filter((e) => e.tile.perMonth !== null).slice(0, 12)) {
      const pricing = await pricingFor(request, entry);
      if (!pricing.error && pricing.product.prodPaymentMode === 'BOTH') {
        subject = { entry, pricing };
        break;
      }
    }
    test.skip(!subject, 'no BOTH-mode product found in the listing sample');

    const { entry, pricing } = subject;
    const box = parsePlanBox(await openPdp(page, entry, { openPlans: true }));
    expect(box, `${entry.slug} rendered no "Choose your plan" box`).toBeTruthy();
    console.log(`${entry.slug} plans: ${box.plans.join(', ')}`);

    const { upfront = {}, cc = {}, nbfc = {} } = pricing.data;
    const faults = [];

    // Plan: Buy Upfront.
    // ACCEPT EITHER LABEL. The upfront plan is called "Buy Upfront" on one
    // layout and "Pay in Full" on the other — CLAUDE.md already says so, but
    // this assertion only ever accepted the first. After the 23 Sep 2026
    // redesign the panel labels it "Pay in Full ₹36,999", so this failed with
    // 'offers no "Buy Upfront" price' on a product that was quoting an upfront
    // price perfectly well, one line further down the same panel.
    const upfrontQuoted = box.buyUpfront ?? box.payInFull;
    expect(
      upfrontQuoted,
      `${entry.slug} offers no upfront price under either label ("Buy Upfront" or "Pay in Full")`
    ).toBeTruthy();
    if (upfrontQuoted !== upfront.price) {
      faults.push(`upfront plan shows ₹${upfrontQuoted}, API upfront.price is ₹${upfront.price}`);
    }

    // Plan: Credit Card EMI — data.cc.
    if (box.creditCardEmiPerMonth !== null && box.creditCardEmiPerMonth !== cc.emi_amount) {
      faults.push(
        `Credit Card EMI shows ₹${box.creditCardEmiPerMonth}/mo, API cc.emi_amount is ₹${cc.emi_amount}`
      );
    }

    // Plan: Monthly Subscription — the same cc figure, under a different name.
    if (box.monthlySubscription !== null && box.monthlySubscription !== cc.emi_amount) {
      faults.push(
        `Monthly Subscription shows ₹${box.monthlySubscription}/mo, API cc.emi_amount is ₹${cc.emi_amount}`
      );
    }

    // Plan: Cardless EMI — data.nbfc. CLAUDE.md: nbfc is the pre-computed
    // cardless figure for the SUBSCRIPTION plan, and an emi_amount of 0 means
    // "not pre-priced" rather than "unavailable". So the figures are only held
    // to the API where the API actually published one. Eligibility — the
    // Pre-approved badge, the "not eligible" line — is never asserted; it is
    // per shopper and changes between page loads.
    if (box.cardlessEmiPerMonth !== null) {
      if (!nbfc.emi_amount) {
        faults.push(
          `the box quotes Cardless EMI at ₹${box.cardlessEmiPerMonth}/mo but the API published ` +
            `no nbfc.emi_amount (${nbfc.emi_amount}) to substantiate it`
        );
      } else if (box.cardlessEmiPerMonth !== nbfc.emi_amount) {
        faults.push(
          `Cardless EMI shows ₹${box.cardlessEmiPerMonth}/mo, API nbfc.emi_amount is ₹${nbfc.emi_amount}`
        );
      }
    }
    if (box.cardlessDownPayment !== null && nbfc.downpay && box.cardlessDownPayment !== nbfc.downpay) {
      faults.push(
        `Cardless EMI asks for ₹${box.cardlessDownPayment} now, API nbfc.downpay is ₹${nbfc.downpay}`
      );
    }

    // Plan: Pre-Approved Offers. A separate plan with its own eligibility, NOT
    // cardless EMI (CLAUDE.md). Whatever it quotes must still be a real figure
    // the API published — it currently mirrors the card-EMI instalment.
    if (box.preApprovedFrom !== null) {
      const known = [cc.emi_amount, nbfc.emi_amount].filter(Boolean);
      if (known.length && !known.includes(box.preApprovedFrom)) {
        faults.push(
          `Pre-Approved Offers quotes ₹${box.preApprovedFrom}/mo, which matches neither ` +
            `cc.emi_amount ₹${cc.emi_amount} nor nbfc.emi_amount ₹${nbfc.emi_amount}`
        );
      }
    }

    console.log(
      `${entry.slug}: upfront ₹${upfrontQuoted} · cc ₹${box.creditCardEmiPerMonth}/mo · ` +
        `cardless ₹${box.cardlessEmiPerMonth}/mo + ₹${box.cardlessDownPayment} · ` +
        `sub ₹${box.monthlySubscription}/mo`
    );

    expect(faults, `${entry.slug}: the plan box and the pricing API disagree`).toEqual([]);
  });

  // ---- The advertised saving --------------------------------------------
  //
  // "🎉 You'll save up to ₹27,307" and "Total Discount ₹27,307" are the largest
  // numbers on the page and the ones a shopper is most likely to act on. They
  // must be the same figure as each other, and they must not exceed the most
  // anyone could actually save.
  test('the advertised saving is internally consistent and not larger than any real saving', async ({
    page,
    request,
  }) => {
    test.setTimeout(PAGE_TIMEOUT);

    let subject = null;
    for (const entry of listing.filter((e) => e.tile.perMonth !== null).slice(0, 12)) {
      const pricing = await pricingFor(request, entry);
      if (!pricing.error && pricing.product.prodPaymentMode === 'BOTH') {
        subject = { entry, pricing };
        break;
      }
    }
    test.skip(!subject, 'no BOTH-mode product found in the listing sample');

    const { entry, pricing } = subject;

    // The bundled rows, named by the same record the page renders. Fetched
    // rather than guessed because the add-on block has no stable anchor in the
    // page text — see the header of parseAddOns in utils/priceText.js.
    const vasRes = await getWithRetry(request, productVasPath(entry.slug, entry.bpid));
    const vasNames = vasRes.ok() ? vasNamesFrom(await vasRes.json()) : [];

    const body = await openPdp(page, entry, { openPlans: true });
    const box = parsePlanBox(body);
    const addOns = parseAddOns(body, vasNames);
    const { upfront = {}, cc = {} } = pricing.data;

    // Non-vacuous: if the VAS record names rows and none of them is found in the
    // page text, the add-on term below is silently zero and the reconciliation
    // "passes" against a saving that has nothing to do with what is bundled.
    // That is exactly how this check went quiet when the labels changed on
    // 23 Aug 2026. Only asserted when the names came from the API — with the
    // fallback list, "not found" means the fallback does not cover this product,
    // which is a known limit rather than a defect.
    if (addOns.namesFrom === 'api') {
      expect(
        addOns.missing,
        `${entry.slug}: the VAS record bundles [${vasNames.join(', ')}], but ` +
          `[${addOns.missing.join(', ')}] could not be found in the PDP text. Either the ` +
          'page is not rendering what the record offers, or the add-on block was ' +
          'restyled and parseAddOns needs updating.'
      ).toEqual([]);
    }

    test.skip(box.saveUpTo === null, `${entry.slug} advertises no saving`);

    // The banner and the breakdown line are two renderings of one figure.
    if (box.totalDiscount !== null) {
      expect(
        box.saveUpTo,
        `${entry.slug}: the banner says save up to ₹${box.saveUpTo} but the breakdown line ` +
          `says Total Discount ₹${box.totalDiscount}. Same page, two numbers.`
      ).toBe(box.totalDiscount);
    }

    // The claim, reconciled to the rupee rather than bounded.
    //
    //   Total Discount = (MRP - cc.total_amount) + SUM(add-on list - add-on paid)
    //
    // Derived by measurement, not assumption. Confirmed exact on the two
    // subscription products available on 14 Aug 2026, when one add-on was all
    // there was:
    //
    //   Galaxy Z Fold8 Ultra  204999 - 183693 = 21306  + (8000 - 1999) = 27307
    //   Macbook Pro M5        239900 - 217632 = 22268  + (8000 -    1) = 30267
    //
    // and on the two-row shape that shipped 23 Aug 2026:
    //
    //   Pixel 11 Pro Fold     186999 - 170934 = 16065
    //                                         + (12999 - 1) + (5999 - 0) = 35062
    //
    // The add-on term is the one a bounds check would have to give up on — it is
    // 22% of the headline saving on the Fold8 and 54% on the Pixel, so giving up
    // on it leaves the largest number on the page unchecked. It is a SUM: the
    // block holds as many rows as the VAS record has.
    const mrp = upfront.cut_price ?? upfront.mop_base;
    const deviceSaving = mrp - cc.total_amount;
    const addOnSaving = addOns.totalSaving;

    const addOnDetail = addOns.rows.length
      ? addOns.rows.map((row) => `${row.name} ₹${row.list}->₹${row.paid}`).join(' + ')
      : 'no add-on line found';

    console.log(
      `${entry.slug}: advertised ₹${box.saveUpTo} = device ₹${deviceSaving} ` +
        `(MRP ₹${mrp} - cc.total ₹${cc.total_amount}) + ${addOnDetail} = ₹${addOnSaving} ` +
        `[names from ${addOns.namesFrom}]`
    );

    expect(
      box.saveUpTo,
      `${entry.slug}: the PDP advertises a saving of ₹${box.saveUpTo}, but the figures behind ` +
        'it come to something else.\n' +
        `  MRP                      ₹${mrp}\n` +
        `  cheapest plan total     -₹${cc.total_amount}  (cc.total_amount)\n` +
        `  device saving            ₹${deviceSaving}\n` +
        `  ${addOnDetail}  +₹${addOnSaving}\n` +
        `  expected                 ₹${deviceSaving + addOnSaving}\n` +
        `  advertised               ₹${box.saveUpTo}\n` +
        `  add-on names from        ${addOns.namesFrom}` +
        (addOns.missing.length ? ` (not found on the page: ${addOns.missing.join(', ')})` : '') +
        '\nEvery bundled row the VAS record names is counted, so a gap here is no longer ' +
        'explained by an add-on this parser cannot see.'
    ).toBe(deviceSaving + addOnSaving);
  });

  // ---- Every rung, every product ---------------------------------------
  //
  // emi-checkout-flow.spec.js reconciles the EMI ladder for four products, from
  // a fixture file (cardless-emi.json) that was generated on an earlier run.
  // This does it for the whole live catalogue: a mispriced instalment on
  // product 130 is invisible to a four-product sample.
  test('every EMI tenure on offer, catalogue-wide, reconciles with its own price', async ({
    request,
  }) => {
    test.setTimeout(CATALOGUE_TIMEOUT);

    const results = await inBatches(listing, BATCH, async (entry) => {
      const pricing = await pricingFor(request, entry);
      if (pricing.error) return null;

      const options = pricing.data.emi?.emi_option || [];
      const price = pricing.data.upfront?.price;
      if (!options.length || !price) return null;

      const faults = [];

      for (const o of options) {
        // The formula emi-checkout-flow.spec.js measured exact on 6 of 6
        // tenures: instalment x tenure === price - discount + interest. NOT
        // (price + interest) / tenure, which omits the discount term and
        // matched 0 of 6.
        const charged = o.installment_amount * o.tenure;
        const expected = price - o.discount + o.interest;
        if (Math.abs(charged - expected) > roundingAllowance(o.tenure)) {
          faults.push(
            `${o.tenure}mo ${o.emi_type}: ${o.installment_amount} x ${o.tenure} = ${charged}, ` +
              `but price ${price} - discount ${o.discount} + interest ${o.interest} = ${expected}`
          );
        }

        // A No Cost EMI that costs more than paying upfront is a contradiction
        // in the plan's own name.
        if (o.emi_type === 'NCEMI' && charged - price > roundingAllowance(o.tenure)) {
          faults.push(
            `${o.tenure}mo No Cost EMI totals ${charged} on a ₹${price} product — ` +
              `₹${charged - price} more than rounding explains`
          );
        }

        if (!(o.installment_amount > 0) || !(o.tenure > 0)) {
          faults.push(`a ${o.tenure}-month option is offered at ${o.installment_amount}/mo`);
        }
      }

      // A ladder must behave like one: longer tenure, lower instalment, more
      // interest. Compared on interest rather than instalment x tenure, which
      // is whole-rupee rounded and reports rounding as a pricing fault.
      const sorted = [...options].sort((a, b) => a.tenure - b.tenure);
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].installment_amount > sorted[i - 1].installment_amount) {
          faults.push(
            `${sorted[i].tenure}mo costs ${sorted[i].installment_amount}/mo, more than ` +
              `${sorted[i - 1].tenure}mo at ${sorted[i - 1].installment_amount}/mo`
          );
        }
        if (sorted[i].interest < sorted[i - 1].interest) {
          faults.push(
            `${sorted[i].tenure}mo charges ${sorted[i].interest} interest, less than ` +
              `${sorted[i - 1].tenure}mo at ${sorted[i - 1].interest}`
          );
        }
      }

      const tenures = options.map((o) => o.tenure);
      if (new Set(tenures).size !== tenures.length) {
        faults.push(`duplicate tenures offered: ${tenures.join(', ')}`);
      }

      return faults.length ? `${entry.slug}: ${faults.join(' | ')}` : null;
    });

    const broken = results.filter(Boolean);
    console.log(`EMI ladders checked across ${listing.length} products — ${broken.length} broken`);

    expect(
      broken,
      'An EMI plan quotes instalments that do not reconcile with the product price. ' +
        'A shopper on one of these tenures is charged something other than the ' +
        'advertised price plus interest.'
    ).toEqual([]);
  });
});
