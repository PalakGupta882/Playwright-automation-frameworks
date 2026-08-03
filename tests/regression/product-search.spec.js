const { test, expect } = require('../fixtures/pageFixtures');
const { URLS } = require('../data/constants');

test.describe('product search', () => {
  test('searching a known product suggests it and opens its product page', async ({ page, productsListPage }) => {
    test.setTimeout(90000);

    await productsListPage.goto();
    await productsListPage.searchFor('iphone air');

    // The autocomplete must offer the product we typed, as its top hit
    const suggestions = page.getByRole('listitem').filter({ hasText: /\S/ });
    await expect(suggestions.first()).toContainText(/iPhone Air/i, { timeout: 15000 });

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
    const suggestions = page.getByRole('listitem').filter({ hasText: /\S/ });
    await productsListPage.searchFor('iphone');
    await expect(suggestions.first()).toBeVisible({ timeout: 15000 });

    // Now a term nothing matches — the suggestions must clear
    await productsListPage.searchFor('zzzqqqnotaproduct');
    await expect(suggestions).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(URLS.products));
    console.log('No results for gibberish search, still on:', page.url());
  });
});
