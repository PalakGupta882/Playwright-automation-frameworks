const { test, expect } = require('../fixtures/pageFixtures');
const { TIMEOUTS } = require('../data/constants');
const { fetchListingRows, variantInStock, isPreBooking, pdpUrl } = require('../utils/catalogue');
const { ADD_TO_CART_LABEL } = require('../utils/buyRow');

// Does a product page render the buy row its product's state calls for?
//
// The products come from the LIVE listing API, not tests/data/products.json,
// which was a scrape that drifted. That means the list is not known when
// Playwright collects tests, so this is one test with a step per product rather
// than one test per product. Soft assertions keep going after a miss, so one run
// reports every broken page.
//
// Scope: one product per buy-row state, plus the first FIRST_N listing rows.
// CLAUDE.md records that the PDP SUBSTITUTES the buy row rather than overlaying
// it, so each state has its own exact contract:
//
//   in stock, UPFRONT   "Add to cart" (icon) + "Buy Now"
//   in stock, BOTH      "Buy Now"
//   out of stock        a DISABLED "Sold Out" in the same slot
//   pre-booking         "Pre-book Now", and no normal buy control
//
// A state with no product in today's catalogue is annotated, not passed: all
// stock present is a skip of that shape, not evidence the Sold Out row works.

// Logged out, explicitly. This is product configuration, the same for every
// shopper, and it runs in CI. Measured 5 Oct 2026: with an expired auth.json
// the site opens the login Drawer by itself on some PDP loads; the Drawer is
// modal, hides the page from the accessibility tree, and every getByRole below
// then reports "element(s) not found" on a buy row the screenshot shows.
test.use({ storageState: { cookies: [], origins: [] } });

const FIRST_N = 5;
// Each stock check is one PDP payload request. Bounded so a fully in-stock
// catalogue costs a few seconds, not ~240 round trips.
const MAX_STOCK_CHECKS = 40;

// Matched by role and full name on purpose — a loose /subscribe/i text match
// would also hit the "Subscription" link in the header and pass on a page that
// never rendered a product.
const ANY_BUY_ROW = /^(buy now|subscribe|sold out|pre-?book now)$/i;

async function pickShapes(request, rows) {
  const shapes = { upfront: null, both: null, soldOut: null, preBooking: null };
  shapes.preBooking = rows.find(isPreBooking) || null;

  let checks = 0;
  for (const row of rows) {
    if (isPreBooking(row)) continue;
    const needed =
      !shapes.soldOut ||
      (row.prodPaymentMode === 'UPFRONT' && !shapes.upfront) ||
      (row.prodPaymentMode === 'BOTH' && !shapes.both);
    if (!needed) continue;
    if (checks++ >= MAX_STOCK_CHECKS) break;

    const inStock = await variantInStock(request, row);
    if (!inStock && !shapes.soldOut) shapes.soldOut = row;
    else if (inStock && row.prodPaymentMode === 'UPFRONT' && !shapes.upfront) shapes.upfront = row;
    else if (inStock && row.prodPaymentMode === 'BOTH' && !shapes.both) shapes.both = row;

    if (shapes.upfront && shapes.both && shapes.soldOut) break;
  }
  return shapes;
}

test('product pages render the buy row their state calls for', async ({ page, request }, testInfo) => {
  test.setTimeout(300000);

  const rows = await fetchListingRows(request);
  const shapes = await pickShapes(request, rows);

  const button = (name) => page.getByRole('button', { name, exact: true });
  const contracts = {
    upfront: async () => {
      await expect.soft(button('Buy Now').first()).toBeEnabled();
      // The cart icon is aria-label "Add to cart", lower-case c. Located as the
      // nearest one BEFORE Buy Now in document order — the same structural rule
      // as clickAddToCart() in utils/buyRow.js — so a recommended-products tile
      // further down cannot satisfy it for a buy row that lost its cart icon.
      await expect
        .soft(page.locator(`xpath=//button[normalize-space()="Buy Now"]/preceding::button[@aria-label="${ADD_TO_CART_LABEL}"][1]`).first())
        .toBeVisible();
    },
    both: async () => {
      await expect.soft(button('Buy Now').first()).toBeEnabled();
    },
    soldOut: async () => {
      await expect.soft(button('Sold Out').first()).toBeDisabled();
      await expect.soft(button('Buy Now'), 'a Sold Out page still offers Buy Now').toHaveCount(0);
    },
    preBooking: async () => {
      await expect.soft(button('Pre-book Now').first()).toBeVisible();
      await expect.soft(button('Buy Now'), 'a pre-booking page still offers Buy Now').toHaveCount(0);
    },
    listing: async () => {},
  };

  const { plan, missing } = buildPlan(rows, shapes);
  missing.forEach((shape) =>
    testInfo.annotations.push({ type: 'skip', description: `no ${shape} product in today's catalogue` })
  );

  for (const { label, shape, row } of plan) {
    await test.step(`${label}: ${row.name}`, async () => {
      // Record the page's own pricing call. An unpriced PDP renders a disabled
      // Buy Now with no plan selected, which reads as a buy-row defect unless
      // the log says the price never arrived.
      const pricing = page
        .waitForResponse((r) => r.url().includes(`/variant-pricing/${row.slug}/`), { timeout: TIMEOUTS.nav })
        .then((r) => String(r.status()))
        .catch(() => 'no response');
      await page.goto(pdpUrl(row), { waitUntil: 'domcontentloaded' });
      console.log(`${label} ${row.name}: variant-pricing -> ${await pricing}`);

      // Non-vacuous: prove a buy row rendered before checking which one. The
      // absence checks in the contracts would otherwise pass on a page that
      // never loaded — and this soft failure keeps the run red when that happens.
      const anyControl = page.getByRole('button', { name: ANY_BUY_ROW }).first();
      await expect
        .soft(anyControl, `${row.slug}/${row.variant.bpid} rendered no buy-row control at all`)
        .toBeVisible({ timeout: TIMEOUTS.nav });

      const shown = await anyControl.innerText({ timeout: 2000 }).catch(() => '<none>');
      console.log(`${label} ${row.name}: buy row shows "${shown.trim()}"`);
      await runContract({ shape, row, shown: shown.trim(), request, contracts, testInfo });
    });
  }
});

// Stock can move between pickShapes() and the page load. Measured 5 Oct 2026 in
// CI: iPhone 18 Pro Max was picked as in-stock BOTH, sold out moments later, and
// the page — correctly — rendered Sold Out, failing "Buy Now: element(s) not
// found" three times over. So when the page shows the OTHER stock state from
// the one the shape was picked for, re-read stock before judging:
//   - stock really moved   -> annotated, contract not run: the page was right
//   - stock did not move   -> a soft failure naming the mismatch: API and page
//                             disagree, which is a real defect
// Kept out of the test body so the test has no branching of its own.
const IN_STOCK_SHAPES = new Set(['upfront', 'both']);

async function runContract({ shape, row, shown, request, contracts, testInfo }) {
  const pageSoldOut = /^sold out$/i.test(shown);
  const pickedInStock = IN_STOCK_SHAPES.has(shape);
  const flipped = (pickedInStock && pageSoldOut) || (shape === 'soldOut' && !pageSoldOut && shown !== '<none>');
  if (!flipped) {
    await contracts[shape]();
    return;
  }

  const inStockNow = await variantInStock(request, row);
  const ref = `${row.slug}/${row.variant.bpid}`;
  if (inStockNow === !pageSoldOut) {
    const note = `${ref} ${pageSoldOut ? 'sold out' : 'came back in stock'} between the stock check and the page ` +
      `load — the page correctly shows "${shown}", so the ${shape} contract was not run`;
    console.log(note);
    testInfo.annotations.push({ type: 'skip', description: note });
    return;
  }

  expect.soft(
    shown,
    `${ref}: the PDP API says ${inStockNow ? 'in stock' : 'out of stock'} but the page shows "${shown}"`
  ).toBe(inStockNow ? 'Buy Now' : 'Sold Out');
}

// Shape samples first, then the head of the listing (shape 'listing' asserts
// only that some buy row rendered). Kept out of the test body so the test has
// no branching of its own.
function buildPlan(rows, shapes) {
  const present = Object.entries(shapes).filter(([, row]) => row);
  return {
    plan: [
      ...present.map(([shape, row]) => ({ label: shape, shape, row })),
      ...rows.slice(0, FIRST_N).map((row, i) => ({ label: `listing #${i + 1}`, shape: 'listing', row })),
    ],
    missing: Object.keys(shapes).filter((shape) => !shapes[shape]),
  };
}
