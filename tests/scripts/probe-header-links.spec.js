const { test } = require('@playwright/test');

// DIAGNOSTIC. smoke/homepage 'navigate to About Us' now fails with "no visible
// header link for aboutUs" -- a different failure from the covered-click one.
// Enumerate what the header actually offers, logged out and logged in.
test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ retries: 0 });

test('what links does the homepage header render?', async ({ page }) => {
  test.setTimeout(90000);
  await page.goto('https://www.bytepe.com/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);

  const links = await page.evaluate(() =>
    [...document.querySelectorAll('header a')].map((a) => {
      const r = a.getBoundingClientRect();
      const cs = getComputedStyle(a);
      return {
        text: (a.innerText || '').replace(/\s+/g, ' ').trim(),
        href: a.getAttribute('href'),
        box: `${Math.round(r.width)}x${Math.round(r.height)}`,
        visible: r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none',
      };
    })
  );

  console.log(`\nheader anchors: ${links.length}`);
  for (const l of links) {
    console.log(`  ${l.visible ? 'VIS ' : 'hid '} ${String(l.text).padEnd(18)} ${l.box.padEnd(10)} ${l.href}`);
  }

  const about = await page.getByRole('link', { name: /about/i }).count();
  const aboutVisible = await page.getByRole('link', { name: /about/i }).filter({ visible: true }).count();
  console.log(`\nrole=link name~/about/i : ${about} total, ${aboutVisible} visible`);
  console.log(`a[href="/about-us"]     : ${await page.locator('a[href="/about-us"]').count()}`);

  // Does the destination still exist?
  const res = await page.request.get('https://www.bytepe.com/about-us');
  console.log(`GET /about-us -> ${res.status()}`);
});
