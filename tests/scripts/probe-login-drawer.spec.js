const { test } = require('@playwright/test');

test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(120000);

test('login drawer contents', async ({ page }) => {
  await page.goto('https://www.bytepe.com/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);
  await page.getByRole('button', { name: 'Login' }).last().dispatchEvent('click');
  await page.waitForTimeout(2500);

  const drawer = page.locator('.MuiDrawer-paper');
  console.log('drawer count:', await drawer.count());
  console.log('DRAWER TEXT:\n' + (await drawer.first().innerText()));
  console.log('--- drawer html (2500) ---');
  console.log((await drawer.first().innerHTML()).slice(0, 2500));

  const btns = drawer.first().getByRole('button');
  const n = await btns.count();
  for (let i = 0; i < n; i++) {
    const b = btns.nth(i);
    console.log(`btn[${i}] text=${JSON.stringify((await b.innerText()).trim())} enabled=${await b.isEnabled()} vis=${await b.isVisible()}`);
  }
});
