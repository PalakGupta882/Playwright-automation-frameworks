const { test, expect } = require('../fixtures/pageFixtures');
const { URLS } = require('../data/constants');

test.describe('product search', () => {
  test('searching a known product suggests it and opens its product page', async ({ page, productsListPage }) => {
    test.setTimeout(90000);

    await productsListPage.goto();
    // search(), not searchFor(): the dropdown is debounced AND the endpoint is
    // rate-limited when the rest of the suite is running, so a term that should
    // match comes back empty on the first try. searchFor() waits a flat 1s and
    // accepts that empty result; search() waits out the debounce and retries
    // with backoff. CI run 32329663580 failed here with "element(s) not found"
    // and passed on Playwright retry -- i.e. the whole test was being used as
    // the retry loop that the page object already provides.
    const count = await productsListPage.search('iphone air');
    expect(count, 'autocomplete returned no suggestions for a term that matches a live product').toBeGreaterThan(0);

    // The autocomplete must offer the product we typed, as its top hit
    await expect(productsListPage.suggestions.first()).toContainText(/iPhone Air/i, { timeout: 15000 });

    await productsListPage.selectAutocompleteSuggestion('iPhone Air');

    // Picking the suggestion takes us to that product's detail page
    await expect(page).toHaveURL(/\/pd\/iphone-air/, { timeout: 20000 });
    await expect(page.getByText(/iPhone Air/i).first()).toBeVisible();
    console.log('Search landed on:', page.url());
  });

  test('searching a term that matches nothing shows no suggestions', async ({ page, productsListPage }) => {
    test.setTimeout(60000);

    await productsListPage.goto();

    // First prove the dropdown renders at all. Without this, the zero-count
    // assertion below can pass vacuously against a not-yet-rendered page
    // rather than because the search genuinely returned nothing.
    const suggestions = productsListPage.suggestions;
    // search(), not searchFor(): this is the positive control, and under a full
    // parallel run the search endpoint is rate-limited hard enough that a flat
    // 1s wait returns an empty dropdown. Measured -- this line failed exactly
    // that way inside a 122-test run while passing when the file runs alone,
    // which reads as "the control is broken" rather than "we were throttled".
    const control = await productsListPage.search('iphone');
    expect(control, 'positive control returned no suggestions').toBeGreaterThan(0);
    await expect(suggestions.first()).toBeVisible({ timeout: 15000 });

    // Now a term nothing matches — the suggestions must clear
    await productsListPage.searchFor('zzzqqqnotaproduct');
    await expect(suggestions).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(URLS.products));
    console.log('No results for gibberish search, still on:', page.url());
  });
});
