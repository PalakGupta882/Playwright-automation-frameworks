const { test } = require('@playwright/test');
test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(240000);
const HOST = 'https://www.bytepe.com';
const ROUTES = ['/', '/all-products', '/home/subscription', '/home/emi-store', '/about-us', '/pd/watch-ultra-4/APPSMSMA5WNTNY'];

test('how many headers per route', async ({ page }) => {
  for (const r of ROUTES) {
    await page.goto(HOST + r, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(4500);
    const info = await page.evaluate(() => {
      const hs = Array.from(document.querySelectorAll('header'));
      return {
        headers: hs.length,
        visible: hs.filter(h => h.getBoundingClientRect().width > 0 && getComputedStyle(h).visibility !== 'hidden').length,
        rects: hs.map(h => { const b = h.getBoundingClientRect(); return `${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.width)}x${Math.round(b.height)}`; }),
        logins: document.querySelectorAll('header button').length,
        h1: document.querySelectorAll('h1').length,
        navs: document.querySelectorAll('header nav').length,
      };
    });
    console.log(`${r.padEnd(42)} headers=${info.headers} visible=${info.visible} navs=${info.navs} headerBtns=${info.logins} h1=${info.h1} rects=${JSON.stringify(info.rects)}`);
  }
});
