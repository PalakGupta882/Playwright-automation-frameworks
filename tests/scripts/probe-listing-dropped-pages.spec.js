// Is the shortfall a whole DROPPED PAGE, and how often?
const { test } = require('../fixtures/pageFixtures');
const { BASE_URL } = require('../data/constants');

test.use({ storageState: { cookies: [], origins: [] } });

test('dropped pages on all-products', async ({ page }) => {
  test.setTimeout(600000);

  const pages = new Map(); // "slug/bpid" -> api page number
  let total = 0;
  for (let p = 1; p <= 40; p++) {
    const res = await page.request.get(
      `${BASE_URL}/api/product-service/apps/products?page=${p}&limit=12`
    );
    const items = (await res.json()).data.items || [];
    items.forEach((i) => pages.set(`${i.slug}/${i.variant.bpid}`, p));
    total += items.length;
    if (items.length < 12) break;
  }
  console.log('API total:', total, 'pages:', Math.max(...pages.values()));

  for (let run = 1; run <= 4; run++) {
    await page.goto(`${BASE_URL}/all-products`, { waitUntil: 'domcontentloaded' });
    await page.locator('a[href*="/pd/"]').first().waitFor({ state: 'visible', timeout: 30000 });

    let stall = 0;
    let last = 0;
    for (let i = 0; i < 120; i++) {
      await page.mouse.wheel(0, 4000);
      await page.waitForTimeout(900);
      const n = await page.locator('a[href*="/pd/"]').count();
      if (n >= total) break;
      if (n === last) { if (++stall >= 12) break; } else { stall = 0; last = n; }
    }

    const hrefs = await page.locator('a[href*="/pd/"]').evaluateAll((els) =>
      els.map((e) => e.getAttribute('href'))
    );
    const seen = new Set();
    for (const h of hrefs) {
      const m = /\/pd\/([^/?]+)\/([^/?]+)/.exec(h || '');
      if (m) seen.add(`${m[1]}/${m[2]}`);
    }

    const missingByPage = new Map();
    for (const [key, p] of pages) {
      if (!seen.has(key)) missingByPage.set(p, (missingByPage.get(p) || 0) + 1);
    }
    console.log(
      `run ${run}: rendered ${seen.size}/${total}, missing ${total - seen.size} — ` +
        `by API page ${JSON.stringify([...missingByPage.entries()].sort((a, b) => a[0] - b[0]))}`
    );
  }
});
