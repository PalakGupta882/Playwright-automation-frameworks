const { test } = require('@playwright/test');
test.setTimeout(240000);
const HOST = 'https://www.bytepe.com';
test.use({ storageState: { cookies: [], origins: [] } });

test('the cart icon button: attributes and a stable locator', async ({ page }) => {
  await page.goto(`${HOST}/pd/phone-4b/NOTSMMOBK25WT5`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Buy Now', exact: true }).first().waitFor({ state: 'visible', timeout: 45000 });
  await page.waitForTimeout(2000);

  const info = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'));
    const buy = btns.find((b) => b.innerText.trim() === 'Buy Now');
    const idx = btns.indexOf(buy);
    const cand = btns.slice(Math.max(0, idx - 2), idx); // buttons just before Buy Now
    return cand.map((b) => {
      const r = b.getBoundingClientRect();
      const svg = b.querySelector('svg');
      return {
        outerHTML: b.outerHTML.slice(0, 500),
        ariaLabel: b.getAttribute('aria-label'),
        title: b.getAttribute('title'),
        testid: b.getAttribute('data-testid'),
        type: b.getAttribute('type'),
        disabled: b.disabled,
        rect: `${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)}`,
        svgClass: svg && String(svg.getAttribute('class') || ''),
        svgTestId: svg && svg.getAttribute('data-testid'),
      };
    });
  });
  console.log(JSON.stringify(info, null, 1));

  // Candidate locators
  const byTestId = await page.locator('button:has(svg[data-testid="ShoppingCartOutlinedIcon"])').count();
  const byClass = await page.locator('button:has(svg.ShoppingCartOutlinedIcon)').count();
  const byRoleName = await page.getByRole('button', { name: /cart/i }).count();
  console.log(`locator counts -> :has(svg[data-testid]) = ${byTestId} | :has(svg.class) = ${byClass} | role+name /cart/i = ${byRoleName}`);
});
