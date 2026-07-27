const { test } = require('@playwright/test');

test('crawl bytepe.com and map all pages', async ({ page }) => {
  test.setTimeout(180000); // 3 minutes — crawling takes longer than normal tests

  const visited = new Set();
  const toVisit = ['https://www.bytepe.com/'];
  const baseUrl = 'bytepe.com';
  const maxPages = 40; // safety limit so it doesn't run forever

  while (toVisit.length > 0 && visited.size < maxPages) {
    const url = toVisit.shift();
    if (visited.has(url)) continue;

    try {
      await page.goto(url, { timeout: 15000, waitUntil: 'domcontentloaded' });
      visited.add(url);
      console.log(`[${visited.size}] Visited: ${url}`);

      const links = await page.locator('a').evaluateAll(
        (elements) => elements.map(el => el.href)
      );

      for (const link of links) {
        const cleanLink = link.split('#')[0].split('?')[0]; // remove anchors/query params
        if (
          cleanLink.includes(baseUrl) &&
          !visited.has(cleanLink) &&
          !toVisit.includes(cleanLink)
        ) {
          toVisit.push(cleanLink);
        }
      }
    } catch (err) {
      console.log(`Failed to visit: ${url} — ${err.message}`);
    }
  }

  console.log('\n--- SITE MAP: ALL PAGES FOUND ---');
  console.log(`Total pages discovered: ${visited.size}\n`);
  [...visited].sort().forEach(url => console.log(url));
});