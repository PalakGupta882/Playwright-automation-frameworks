// tests/regression/search.spec.js
//
// Search relevance and edge cases.
//
// Complements product-search.spec.js, which already covers the happy path
// (a known product is suggested and opens its detail page) and the gibberish
// case. This file covers what that one does not: whether the suggestions are
// actually relevant, brand matching, and how odd input is handled.
//
// THERE IS NO SEARCH RESULTS PAGE. Measured:
//
//   pressing Enter on "iPhone"   -> url unchanged, no navigation
//   GET /search?q=iphone         -> 404
//
// Search is an autocomplete dropdown, and choosing a suggestion goes straight
// to that product's page. So there is nothing to assert about a results URL,
// no results-page pagination, and no "go back to the results" step — none of
// those exist to be tested.
//
// RELEVANCE IS TOKEN-BASED, NOT SUBSTRING. Measured:
//
//   "iPhone"          20 suggestions, every one contains "iphone"
//   "Apple"           20 suggestions, every one contains "apple" (brand label)
//   "samsung galaxy"  20 suggestions, NONE contain that literal phrase —
//                     they are "Galaxy ... Samsung", matched per word
//
// So "every result contains the search term" holds for a single word and is
// false for a phrase. Asserting it generally would fail against a search that
// is working correctly, so the correctness test below uses single-word terms
// and says why.
//
// Public and logged out: what the catalogue matches is the same for everyone.

const { test, expect } = require('../fixtures/pageFixtures');
const { BASE_URL, URLS } = require('../data/constants');

test.use({ storageState: { cookies: [], origins: [] } });

// Single words on purpose — see the note above. One is a product family, one is
// a brand that appears in the suggestion label rather than in product names.
const RELEVANT_TERMS = ['iphone', 'apple'];

test.describe('Search', () => {
  // PRESENCE — the box is there and typing produces suggestions.
  test('the search box offers suggestions for a real product', async ({ page, productsListPage }) => {
    test.setTimeout(90000);

    await productsListPage.goto();
    await expect(productsListPage.searchBox).toBeVisible({ timeout: 15000 });

    const count = await productsListPage.search('iphone');
    expect(count, 'searching a stocked product returned no suggestions').toBeGreaterThan(0);
    await expect(productsListPage.suggestions.first()).toBeVisible();
    console.log(`"iphone" -> ${count} suggestions`);
  });

  // CORRECTNESS — the best matches are actually matches.
  //
  // Asserting ALL suggestions contain the term is wrong here, and measuring
  // showed why: "iphone" returns 20 suggestions of which only the first few are
  // iPhones. The rest are Apple accessories — chargers, cables, EarPods, Watch,
  // MacBook — and the tail reaches as far as "Galaxy Z Fold8 Ultra Samsung" and
  // an Ambrane power bank. The dropdown fills to 20 with loosely related stock.
  //
  // So this pins the contract that matters to a shopper: the top hits are
  // relevant. A search that returned 20 arbitrary products would still satisfy
  // a bare "results are not empty" check, and this would catch it.
  const TOP_HITS = 5;

  for (const term of RELEVANT_TERMS) {
    test(`the top suggestions for "${term}" are relevant`, async ({ page, productsListPage }) => {
      test.setTimeout(90000);

      await productsListPage.goto();
      const count = await productsListPage.search(term);
      expect(count, `"${term}" returned nothing to check`).toBeGreaterThan(0);

      const texts = (await productsListPage.suggestions.allInnerTexts())
        .map(t => t.replace(/\s+/g, ' ').trim())
        .filter(Boolean);

      const top = texts.slice(0, TOP_HITS);
      const irrelevantTop = top.filter(t => !t.toLowerCase().includes(term));

      expect(
        irrelevantTop,
        `the first ${TOP_HITS} suggestions for "${term}" should all mention it`
      ).toEqual([]);

      // Not asserted, only reported: how far the tail drifts. If this number
      // grows, relevance is degrading even though the test still passes.
      const tailDrift = texts.slice(TOP_HITS).filter(t => !t.toLowerCase().includes(term)).length;
      console.log(`"${term}": ${texts.length} suggestions, top ${TOP_HITS} relevant, ${tailDrift} of the tail unrelated`);
    });
  }

  // BEHAVIOUR — the dropdown tracks what is typed rather than caching.
  //
  // The requested behaviour question was pagination. There is no results page,
  // so there is no pagination. This asks the equivalent thing of the control
  // that does exist: does it respond to a changed query?
  test('changing the term changes the suggestions', async ({ page, productsListPage }) => {
    test.setTimeout(90000);

    await productsListPage.goto();

    await productsListPage.search('iphone');
    const first = (await productsListPage.suggestions.allInnerTexts()).join(' | ');
    expect(first.length, 'no suggestions for the first term').toBeGreaterThan(0);

    await productsListPage.search('galaxy');
    const second = (await productsListPage.suggestions.allInnerTexts()).join(' | ');
    expect(second.length, 'no suggestions for the second term').toBeGreaterThan(0);

    expect(second, 'the dropdown showed the same suggestions for a different term')
      .not.toBe(first);
    expect(second.toLowerCase(), 'searching "galaxy" returned no Galaxy product')
      .toContain('galaxy');
  });

  // NEGATIVE — odd input is handled without breaking the page.
  test('a symbol-only search returns nothing and leaves the page working', async ({ page, productsListPage }) => {
    test.setTimeout(90000);

    await productsListPage.goto();

    // Prove the dropdown works first, so the zero below means "no matches"
    // rather than "the search never ran".
    expect(await productsListPage.search('iphone')).toBeGreaterThan(0);

    expect(await productsListPage.search('₹'), 'a currency symbol matched products')
      .toBe(0);

    // The catalogue is still there — a search that matches nothing must not
    // take the page down with it.
    await expect(page.locator('a[href*="/pd/"]').first()).toBeVisible({ timeout: 15000 });
    await expect(page).toHaveURL(new RegExp(URLS.products));
  });

  // NEGATIVE — an empty search does nothing rather than something surprising.
  //
  // Measured: Enter on an empty box does not navigate, shows no error, and
  // leaves the catalogue on screen. That is the behaviour being pinned.
  test('submitting an empty search does not navigate away', async ({ page, productsListPage }) => {
    test.setTimeout(90000);

    await productsListPage.goto();
    const before = page.url();

    await productsListPage.searchBox.click();
    await productsListPage.searchBox.fill('');
    await productsListPage.searchBox.press('Enter');
    await page.waitForTimeout(3000);

    expect(page.url(), 'an empty search navigated somewhere').toBe(before);
    expect(await productsListPage.suggestions.count(), 'an empty search produced suggestions').toBe(0);
    await expect(page.locator('a[href*="/pd/"]').first()).toBeVisible({ timeout: 15000 });
  });

  // Pins the contract the tests above depend on: search never leaves the page.
  // If a results page is ever added this fails, which is the signal to revisit
  // every "there is no results page" note in this file.
  test('there is no search results page', async ({ page, productsListPage }) => {
    test.setTimeout(90000);

    await productsListPage.goto();
    const before = page.url();

    await productsListPage.search('iphone');
    await productsListPage.searchBox.press('Enter');
    await page.waitForTimeout(4000);

    expect(page.url(), 'pressing Enter navigated — search may now have a results page').toBe(before);

    // Retry past a 429. Under a full-suite run this returned 429 rather than
    // 404, and the test read that as "a results page now exists" — a rate limit
    // is not an answer about whether the route exists.
    let status;
    for (let attempt = 1; attempt <= 4; attempt++) {
      const res = await page.goto(`${BASE_URL}/search?q=iphone`, { waitUntil: 'domcontentloaded' });
      status = res.status();
      if (status !== 429) break;
      await page.waitForTimeout(2000 * attempt);
    }

    expect(status, '/search now resolves — search may now have a results page').toBe(404);
  });
});
