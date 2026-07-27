const fs = require('fs');
const path = require('path');
const { test } = require('@playwright/test');

test('discover all products from the site and save them', async ({ page }) => {
  test.setTimeout(120000);

  await page.goto('https://www.bytepe.com/all-products', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  let lastCount = 0;
  let stableRounds = 0;
  while (stableRounds < 3) {
    await page.mouse.wheel(0, 4000);
    await page.waitForTimeout(1500);
    const count = await page.locator('a[href*="/pd/"]').count();
    if (count === lastCount) {
      stableRounds++;
    } else {
      stableRounds = 0;
      lastCount = count;
    }
  }

  const cards = page.locator('a[href*="/pd/"]');
  const total = await cards.count();
  const seen = new Map();

  for (let i = 0; i < total; i++) {
    const card = cards.nth(i);
    const href = await card.getAttribute('href');
    if (!href || seen.has(href)) continue;

    let name = '';
    const img = card.locator('img').first();
    if (await img.count()) {
      name = (await img.getAttribute('alt')) || '';
    }
    if (!name) {
      name = (await card.innerText()).split('\n')[0].trim();
    }
    seen.set(href, name.trim());
  }

  const products = [...seen.entries()].map(([url, name]) => ({ name, url }));

  fs.writeFileSync(
    path.join(__dirname, '..', 'data', 'products.json'),
    JSON.stringify({ count: products.length, products }, null, 2)
  );

  console.log(`✅ Discovered ${products.length} products and saved to tests/data/products.json`);
});