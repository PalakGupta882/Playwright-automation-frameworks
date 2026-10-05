const { test } = require('@playwright/test');
test.setTimeout(240000);
const HOST = 'https://www.bytepe.com';
test.use({ storageState: { cookies: [], origins: [] } });

const PRODUCTS = [
  ['phone-4b', 'NOTSMMOBK25WT5'],
  ['pixel-11-pro-fold', 'GOOSMMOBHFAJ3U'],
];

for (const [slug, bpid] of PRODUCTS) {
  test(`cart icon on ${slug}`, async ({ page }) => {
    await page.goto(`${HOST}/pd/${slug}/${bpid}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Buy Now', exact: true }).first()
      .waitFor({ state: 'visible', timeout: 45000 }).catch(() => console.log('no Buy Now'));
    await page.waitForTimeout(2500);

    const probe = async (label) => {
      const r = await page.evaluate(() => {
        const svg = document.querySelector('svg.ShoppingCartOutlinedIcon, svg[class*="ShoppingCart"]');
        if (!svg) return 'absent';
        const box = svg.getBoundingClientRect();
        const chain = [];
        let n = svg.parentElement;
        for (let i = 0; i < 6 && n; i++, n = n.parentElement) {
          const cs = getComputedStyle(n);
          const nr = n.getBoundingClientRect();
          chain.push(`${n.tagName}.${String(n.className).slice(0, 40)} [${cs.display}/${cs.visibility}/op:${cs.opacity}] ${Math.round(nr.width)}x${Math.round(nr.height)}`);
        }
        return {
          svgRect: `${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}x${Math.round(box.height)}`,
          svgDisplay: getComputedStyle(svg).display,
          chain,
        };
      });
      console.log(`  [${label}]`, JSON.stringify(r, null, 1));
    };

    await probe('at top');
    await page.mouse.wheel(0, 1500);
    await page.waitForTimeout(2000);
    await probe('after scroll 1500');

    // Is there any clickable icon-only control near the buy row at all?
    const iconButtons = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('button, [role="button"]'))
        .filter((b) => {
          const r = b.getBoundingClientRect();
          return r.width > 20 && r.width < 90 && r.height > 20 && !b.innerText.trim();
        })
        .map((b) => {
          const r = b.getBoundingClientRect();
          return `${b.tagName}.${String(b.className).slice(0, 45)} ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)} svg=${b.querySelectorAll('svg').length}`;
        });
    });
    console.log('  icon-only controls:', JSON.stringify(iconButtons.slice(0, 12), null, 1));
  });
}
