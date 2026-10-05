// tests/scripts/probe-sub-home.spec.js
//
// DIAGNOSTIC. The homepage category tabs now navigate to /?sub_home_page=<cat>
// instead of /all-products?category=<cat>, and that view rendered 0 /pd/ links.
// Zero product ANCHORS is not the same as zero products — the homepage renders
// its tiles as clickable divs — so count both before calling anything broken.
const { test } = require('@playwright/test');

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ mode: 'serial', retries: 0 });

for (const cat of ['mobile', 'audio', 'appliances']) {
  test(`what does /?sub_home_page=${cat} render?`, async ({ page }) => {
    test.setTimeout(90000);
    await page.goto(`https://www.bytepe.com/?sub_home_page=${cat}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(5000);

    const r = await page.evaluate(() => ({
      pdAnchors: document.querySelectorAll('a[href*="/pd/"]').length,
      // The homepage's own product tiles: a picture with a rupee figure beside it.
      rupeeBlocks: [...document.querySelectorAll('div')].filter((d) => {
        const t = (d.innerText || '');
        return /₹/.test(t) && t.length < 120 && d.querySelector('img');
      }).length,
      headings: [...document.querySelectorAll('h1,h2,h3,p')]
        .map((h) => (h.innerText || '').trim())
        .filter((t) => t && t.length < 60)
        .slice(0, 14),
      bodyLen: document.body.innerText.length,
    }));

    console.log(`\n=== /?sub_home_page=${cat} ===`);
    console.log(`/pd/ anchors: ${r.pdAnchors} · price tiles: ${r.rupeeBlocks} · body text length: ${r.bodyLen}`);
    console.log(`headings: ${r.headings.join(' | ')}`);
  });
}
