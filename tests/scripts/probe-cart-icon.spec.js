const { test } = require('@playwright/test');
test.setTimeout(240000);
const HOST = 'https://www.bytepe.com';

test('find the cart icon control in the PDP buy row', async ({ page }) => {
  await page.goto(`${HOST}/pd/phone-4b/NOTSMMOBK25WT5`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Buy Now', exact: true }).first().waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(2500);

  const info = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const buy = btns.find((b) => b.innerText.trim() === 'Buy Now');
    if (!buy) return 'no Buy Now';

    // Walk up until we find a container holding more than just Buy Now.
    let node = buy.parentElement;
    const chain = [];
    for (let i = 0; i < 5 && node; i++) {
      const kids = Array.from(node.querySelectorAll('button'));
      chain.push({
        level: i,
        tag: node.tagName + '.' + node.className,
        buttons: kids.map((b) => ({
          text: b.innerText.replace(/\s+/g, ' ').trim().slice(0, 30),
          aria: b.getAttribute('aria-label'),
          title: b.getAttribute('title'),
          cls: String(b.className).slice(0, 70),
          svg: b.querySelectorAll('svg').length,
          img: Array.from(b.querySelectorAll('img')).map((im) => im.getAttribute('alt') || im.getAttribute('src') || '').slice(0, 2),
          rect: (() => { const r = b.getBoundingClientRect(); return `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`; })(),
        })),
      });
      node = node.parentElement;
    }
    return chain;
  });
  console.log(JSON.stringify(info, null, 1).slice(0, 4000));
});
