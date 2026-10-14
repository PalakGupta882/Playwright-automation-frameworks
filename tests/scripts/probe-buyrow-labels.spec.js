const { test } = require('@playwright/test');
test.setTimeout(240000);
const HOST = 'https://www.bytepe.com';

test('what controls sit in the buy row now', async ({ page }) => {
  await page.goto(`${HOST}/pd/pixel-11-pro-fold/GOOSMMOBHFAJ3U`, { waitUntil: 'domcontentloaded' });
  await page.goto(`${HOST}/pd/phone-4b/NOTSMMOBK25WT5`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Buy Now', exact: true }).first().waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(2000);

  // Anything cart-ish or subscribe-ish, by any casing, button or not.
  for (const re of [/cart/i, /bag/i, /subscri/i, /buy/i]) {
    const c = await page.getByText(re).filter({ visible: true }).count();
    console.log(`text ${re}: ${c}`);
  }

  // The actual buy row: find Buy Now and dump its siblings.
  const info = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const buy = btns.find((b) => b.innerText.trim() === 'Buy Now');
    if (!buy) return 'no Buy Now';
    const row = buy.parentElement;
    return {
      rowTag: row.tagName + '.' + row.className,
      rowHTML: row.outerHTML.slice(0, 900),
      siblings: Array.from(row.children).map((c) => `${c.tagName}: ${c.innerText.replace(/\s+/g, ' ').trim().slice(0, 40)}`),
      grandparent: Array.from(row.parentElement.children).map((c) => `${c.tagName}: ${c.innerText.replace(/\s+/g, ' ').trim().slice(0, 50)}`),
    };
  });
  console.log(JSON.stringify(info, null, 1));
});
