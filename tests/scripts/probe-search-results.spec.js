const { test } = require('@playwright/test');
test.setTimeout(400000);
const HOST = 'https://www.bytepe.com';
test.use({ storageState: { cookies: [], origins: [] } });

const TERMS = ['iphone', 'luggage', 'zzzqqqxnothing'];

test('search results page behaviour', async ({ page }) => {
  // baseline: unfiltered listing
  await page.goto(`${HOST}/all-products`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);
  const baseline = await page.locator('a[href*="/pd/"]').count();
  console.log(`unfiltered /all-products: ${baseline} product links`);

  for (const term of TERMS) {
    await page.goto(`${HOST}/all-products?q=${encodeURIComponent(term)}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);
    const links = await page.locator('a[href*="/pd/"]').count();
    const body = (await page.locator('body').innerText()).replace(/\n{2,}/g, '\n');
    const announces = /results for/i.test(body);
    const emptyish = /no results|not found|nothing|no products|couldn'?t find/i.test(body);
    console.log(`\nq=${term}: links=${links} announcesTerm=${announces} emptyState=${emptyish}`);
    const i = body.search(/results for|no results|no products|not found/i);
    if (i >= 0) console.log('  copy:', JSON.stringify(body.slice(i, i + 120)));
    else console.log('  (no results/empty copy found)  head:', JSON.stringify(body.slice(0, 160)));
  }

  // does the old /search route still 404?
  const res = await page.goto(`${HOST}/search?q=iphone`, { waitUntil: 'domcontentloaded' });
  console.log(`\n/search?q=iphone -> ${res.status()}`);
});
