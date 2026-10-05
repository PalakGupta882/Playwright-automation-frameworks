// tests/scripts/probe-pdp-video-thumb.spec.js
//
// DIAGNOSTIC. The PDP gallery now shows a play tile in the slot that used to be
// empty. Does clicking it mount a player? Logged out, read-only.
const { test } = require('@playwright/test');

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ retries: 0 });

test('PDP gallery video tile', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('https://www.bytepe.com/pd/jbl-flip-7/JBLAUAUD10QE32', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Buy Now', exact: true }).waitFor({ timeout: 30000 });
  await page.waitForTimeout(3000);
  console.log(`<video> before click: ${await page.locator('video').count()}`);
  const thumb = page.locator('[data-testid=PlayArrowIcon], [data-testid=PlayCircleIcon], svg[data-testid*=Play]').first();
  console.log(`play icons: ${await page.locator('svg[data-testid*=Play]').count()}`);
  await thumb.click({ timeout: 10000 }).catch((e) => console.log(`click failed: ${e.message.split('\n')[0]}`));
  await page.waitForTimeout(5000);
  const v = await page.locator('video').evaluateAll((els) => els.map((e) => ({
    src: (e.currentSrc || e.src || '').slice(0, 80), controls: e.controls, autoplay: e.autoplay, muted: e.muted,
    playsInline: e.playsInline, poster: e.poster ? e.poster.slice(0, 60) : '', preload: e.preload,
    paused: e.paused, time: e.currentTime, w: e.getBoundingClientRect().width,
  })));
  console.log(`<video> after click: ${JSON.stringify(v)}`);
  await page.screenshot({ path: 'test-results/pdp-video-thumb.png' });
});
