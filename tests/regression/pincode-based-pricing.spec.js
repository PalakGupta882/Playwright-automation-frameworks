// tests/regression/pincode-based-pricing.spec.js
//
// Does the shopper's pincode change the price on a product page?
//
// MEASURED ON 5 AUG 2026: NO. Not in the UI, not in the pricing payload.
//
//   /api/apps/variant-pricing/phone-4b/<variantId>
//     no pincode      -> upfront 32299, nbfc 1651, 6 tenures
//     ?pincode=110001 -> upfront 32299, nbfc 1651, 6 tenures
//     ?pincode=560001 -> upfront 32299, nbfc 1651, 6 tenures
//
//   The PDP payload carries no pincode / bucket / rc / tier field at all, and
//   the rendered price list is byte-for-byte identical across both pincodes on
//   two different products.
//
// This spec was requested as "assert the Gold-bucket price is greater than the
// Bronze-bucket price". That assertion cannot pass today, and making it pass
// would mean deleting it. So the behaviour test below pins the OPPOSITE — that
// price is invariant across pincodes — and is written to FAIL the day
// pincode-based pricing reaches the storefront. That failure is the point: it
// is the notification that the feature shipped, and the moment to rewrite this
// file around the real prices.
//
// Worth noting for whoever picks that up: the admin panel's RC buckets
// (Bronze / Silver / Gold / Platinum / Blacklist) may not be a price mechanism
// at all. "Blacklist" alongside the "Delivery is not available on this pincode"
// response for 206588 reads more like a serviceability and lending-risk tier
// than a price multiplier. Confirm what the bucket actually drives before
// assuming the storefront is wrong.
//
// Public — no session needed. Runs logged out on purpose: price is product
// configuration, which is the same for everyone, and pinning the logged-out
// view keeps a stale auth.json from ever being the reason this fails.

const { test, expect } = require('../fixtures/pageFixtures');
const { BASE_URL, TIMEOUTS } = require('../data/constants');
const { getWithRetry } = require('../utils/apiRetry');

test.use({ storageState: { cookies: [], origins: [] } });

const PRODUCT = {
  name: 'Phone (4b)',
  slug: 'phone-4b',
  bpid: 'NOTSMMOBK25WT5',
};
const PDP_URL = `${BASE_URL}/pd/${PRODUCT.slug}/${PRODUCT.bpid}`;

const PINCODES = {
  bronze: '110001',      // Delhi
  gold: '560001',        // Bangalore
  unserviceable: '206588',
};

async function openProduct(page) {
  await page.goto(PDP_URL, { waitUntil: 'domcontentloaded' });
  await page.keyboard.press('Escape').catch(() => {}); // promo modal, if present
}

test.describe('Pincode-based pricing', () => {
  // 1. PRESENCE — a price is on the page at all.
  test('the product page shows a price', async ({ page, productPage }) => {
    test.setTimeout(60000);
    await openProduct(page);

    await expect(productPage.priceText).toBeVisible({ timeout: TIMEOUTS.nav });
  });

  // 2. CORRECTNESS — it is a real number, and it is the RIGHT number.
  //
  // Checking "is a number" alone would pass on any rupee figure the page
  // happens to render first, including the struck-through MRP. Comparing it to
  // the pricing API is what makes this test mean something.
  test('the displayed price is a valid number and matches the pricing API', async ({
    page,
    productPage,
    request,
  }) => {
    test.setTimeout(60000);
    await openProduct(page);

    const displayed = await productPage.getPrice();
    expect(Number.isFinite(displayed)).toBe(true);
    expect(displayed).toBeGreaterThan(0);

    const pdp = await (
      await getWithRetry(
        request,
        `${BASE_URL}/api/product-service/apps/products/by-slug/${PRODUCT.slug}/${PRODUCT.bpid}`,
        { headers: { accept: 'application/json' } }
      )
    ).json();

    const pricing = await (
      await getWithRetry(
        request,
        `${BASE_URL}/api/apps/variant-pricing/${PRODUCT.slug}/${pdp.data.variant.id}`,
        { headers: { accept: 'application/json' } }
      )
    ).json();

    expect(
      displayed,
      'the price on the page is not the upfront price the pricing API returns'
    ).toBe(pricing.data.upfront.price);
  });

  // 3. BEHAVIOUR — the price does NOT move with the pincode.
  //
  // Inverted from the original request on purpose; see the header. Reads the
  // price after each pincode rather than once, so it is comparing two live
  // readings and not the same cached value twice.
  test('the price is the same in Delhi (110001) and Bangalore (560001)', async ({
    page,
    productPage,
  }) => {
    test.setTimeout(90000);
    await openProduct(page);

    await productPage.checkPincode(PINCODES.bronze);
    const bronzePrice = await productPage.getPrice();

    await productPage.checkPincode(PINCODES.gold);
    const goldPrice = await productPage.getPrice();

    console.log(`${PINCODES.bronze} -> ₹${bronzePrice} | ${PINCODES.gold} -> ₹${goldPrice}`);

    expect(
      goldPrice,
      'the price now differs by pincode — pincode-based pricing appears to have ' +
        'shipped, so this spec needs rewriting around the real bucket prices ' +
        'instead of asserting invariance'
    ).toBe(bronzePrice);
  });

  // 4. NEGATIVE — an unserviceable pincode is refused, and refusing it does not
  // break the page.
  //
  // The second half matters: a page that blanked out would also stop showing a
  // wrong price, and without it this would pass on a broken page.
  test('an unserviceable pincode is refused without breaking the page', async ({
    page,
    productPage,
  }) => {
    test.setTimeout(60000);
    await openProduct(page);

    const priceBefore = await productPage.getPrice();

    await productPage.checkPincode(PINCODES.unserviceable);

    await expect(page.getByText(/Delivery is not available on this pincode/i))
      .toBeVisible({ timeout: TIMEOUTS.nav });

    expect(await productPage.getPrice()).toBe(priceBefore);
  });
});
