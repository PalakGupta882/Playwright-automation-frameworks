const { test } = require('@playwright/test');
test.setTimeout(240000);
const HOST = 'https://www.bytepe.com';
test.use({ storageState: { cookies: [], origins: [] } });

test('hunt the cart icon anywhere on the PDP', async ({ page }) => {
  await page.goto(`${HOST}/pd/phone-4b/NOTSMMOBK25WT5`, { waitUntil: 'domcontentloaded' });
  const buy = page.getByRole('button', { name: 'Buy Now', exact: true }).first();
  await buy.waitFor({ state: 'visible', timeout: 45000 }).catch(() => console.log('NO Buy Now rendered'));
  await page.waitForTimeout(2500);

  const box = await buy.boundingBox().catch(() => null);
  console.log('Buy Now box:', JSON.stringify(box));

  const found = await page.evaluate((b) => {
    const out = { byAsset: [], nearBuyRow: [], clickableIcons: [] };

    // 1. Anything whose class/id/src/alt/testid mentions cart
    document.querySelectorAll('*').forEach((el) => {
      const hay = [
        el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className,
        el.id,
        el.getAttribute && el.getAttribute('src'),
        el.getAttribute && el.getAttribute('alt'),
        el.getAttribute && el.getAttribute('data-testid'),
        el.getAttribute && el.getAttribute('aria-label'),
      ].filter(Boolean).join(' ');
      if (/cart/i.test(String(hay))) {
        const r = el.getBoundingClientRect();
        out.byAsset.push({
          tag: el.tagName,
          hay: String(hay).slice(0, 120),
          rect: `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`,
        });
      }
    });

    // 2. Anything sitting on the same visual row as Buy Now
    if (b) {
      const midY = b.y + b.height / 2;
      document.querySelectorAll('div,button,span,svg,img,a').forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.width > 300) return;
        if (Math.abs(r.y + r.height / 2 - midY) > 40) return;
        if (r.x + r.width > b.x + 5) return; // strictly left of Buy Now
        out.nearBuyRow.push({
          tag: el.tagName,
          cls: String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className).slice(0, 70),
          cursor: getComputedStyle(el).cursor,
          rect: `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`,
          text: (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 30),
        });
      });
    }
    return out;
  }, box);

  console.log('--- elements mentioning "cart" ---');
  found.byAsset.slice(0, 20).forEach((e) => console.log(' ', JSON.stringify(e)));
  console.log('--- elements on the Buy Now row, left of it ---');
  found.nearBuyRow.slice(0, 20).forEach((e) => console.log(' ', JSON.stringify(e)));
});
