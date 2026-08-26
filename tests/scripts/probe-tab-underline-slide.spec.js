const { test } = require('@playwright/test');

// DIAGNOSTIC follow-up. probe-tab-underline found a brand-coloured 104x3 box
// that is a SIBLING of the tabs, not a descendant. If it is really the active
// indicator it must move when a different tab is selected. Read-only.
test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ retries: 0 });

test('does the brand-coloured bar follow the selected tab?', async ({ page }) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('https://www.bytepe.com/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);

  const snap = () =>
    page.evaluate(() => {
      const tabs = [...document.querySelectorAll('[role="tab"]')];
      const active = tabs.find((t) => t.getAttribute('aria-selected') === 'true');
      const bar = [...document.querySelectorAll('div')].find(
        (d) => getComputedStyle(d).backgroundColor === 'rgb(255, 67, 6)' &&
               d.getBoundingClientRect().height <= 6 &&
               d.getBoundingClientRect().width > 20
      );
      const br = bar ? bar.getBoundingClientRect() : null;
      const ar = active ? active.getBoundingClientRect() : null;
      return {
        activeLabel: active ? (active.innerText || '').trim().split('\n')[0] : null,
        activeX: ar ? Math.round(ar.left) : null,
        barX: br ? Math.round(br.left) : null,
        barW: br ? Math.round(br.width) : null,
        aligned: br && ar ? Math.abs(br.left - ar.left) < 4 : null,
      };
    });

  const before = await snap();
  console.log(`\nbefore: active="${before.activeLabel}" tabX=${before.activeX} barX=${before.barX} barW=${before.barW} aligned=${before.aligned}`);

  await page.getByRole('tab').nth(3).click();
  await page.waitForTimeout(2500);
  const after = await snap();
  console.log(`after : active="${after.activeLabel}" tabX=${after.activeX} barX=${after.barX} barW=${after.barW} aligned=${after.aligned}`);

  console.log(
    before.barX !== after.barX && after.aligned
      ? '\n=> The bar MOVED and sits under the newly selected tab. It IS the active indicator.'
      : '\n=> The bar did not track the selection.'
  );
});
