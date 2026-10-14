const { test } = require('@playwright/test');
test.setTimeout(240000);
const HOST = 'https://www.bytepe.com';
test.use({ storageState: { cookies: [], origins: [] } });

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
];

for (const vp of VIEWPORTS) {
  test(`buy row at ${vp.name}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto(`${HOST}/pd/phone-4b/NOTSMMOBK25WT5`, { waitUntil: 'domcontentloaded' });
    const buy = page.getByRole('button', { name: 'Buy Now', exact: true }).first();
    const ok = await buy.waitFor({ state: 'visible', timeout: 45000 }).then(() => true).catch(() => false);
    console.log(`${vp.name}: Buy Now visible = ${ok}`);
    await page.waitForTimeout(2000);

    if (ok) {
      await buy.scrollIntoViewIfNeeded();
      await page.waitForTimeout(1000);
      const box = await buy.boundingBox();
      // Capture a wide strip around the buy row
      await page.screenshot({
        path: `test-results/buyrow-${vp.name}.png`,
        clip: {
          x: Math.max(0, box.x - 340),
          y: Math.max(0, box.y - 90),
          width: Math.min(vp.width, box.width + 380),
          height: box.height + 180,
        },
      });
      console.log(`  saved test-results/buyrow-${vp.name}.png (Buy Now at ${Math.round(box.x)},${Math.round(box.y)} ${Math.round(box.width)}x${Math.round(box.height)})`);
    } else {
      await page.screenshot({ path: `test-results/buyrow-${vp.name}-full.png`, fullPage: false });
      console.log(`  saved test-results/buyrow-${vp.name}-full.png`);
    }
  });
}
