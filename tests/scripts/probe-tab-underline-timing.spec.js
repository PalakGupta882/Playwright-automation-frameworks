const { test } = require('@playwright/test');

// DIAGNOSTIC. measure() finds no underline while probe-tab-underline (which
// waits 5s) finds it every time. Difference is settle time: open() waits only
// for the first tab to be visible. Sample the tablist row over time to find out
// when the indicator actually appears. Read-only.

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ retries: 0 });

test('when does the active underline appear?', async ({ page }) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('https://www.bytepe.com/', { waitUntil: 'domcontentloaded' });

  await page.locator('[role="tab"]').first().waitFor({ state: 'visible', timeout: 20000 });
  console.log('\nfirst tab visible — this is where open() returns and measure() runs\n');

  for (const wait of [0, 250, 500, 1000, 2000, 3000, 5000]) {
    if (wait) await page.waitForTimeout(wait === 250 ? 250 : wait - (wait === 500 ? 250 : wait / 2));
    const snap = await page.evaluate(() => {
      const tiles = [...document.querySelectorAll('[role="tab"]')];
      const active = tiles.find((t) => t.getAttribute('aria-selected') === 'true');
      const row = active ? active.parentElement : null;
      if (!row) return { row: false };
      const siblings = [...row.children].filter((n) => !tiles.includes(n));
      const bars = siblings
        .map((n) => ({ n, r: n.getBoundingClientRect() }))
        .filter((o) => o.r.height > 0 && o.r.height <= 6 && o.r.width > 20)
        .map((o) => ({
          cls: (o.n.className || '').toString().slice(0, 40),
          w: Math.round(o.r.width),
          h: Math.round(o.r.height),
          x: Math.round(o.r.left),
          bg: getComputedStyle(o.n).backgroundColor,
        }));
      return {
        row: true,
        tabs: tiles.length,
        rowChildren: row.children.length,
        nonTabSiblings: siblings.length,
        siblingShapes: siblings.map((n) => {
          const r = n.getBoundingClientRect();
          return `${n.tagName.toLowerCase()} ${Math.round(r.width)}x${Math.round(r.height)} bg=${getComputedStyle(n).backgroundColor}`;
        }),
        bars,
      };
    });
    console.log(`t=${String(wait).padStart(4)}ms  tabs=${snap.tabs} rowChildren=${snap.rowChildren} nonTabSiblings=${snap.nonTabSiblings} bars=${snap.bars.length}`);
    for (const s of snap.siblingShapes || []) console.log(`             sibling: ${s}`);
    for (const b of snap.bars || []) console.log(`             BAR: ${b.cls} ${b.w}x${b.h} @${b.x} bg=${b.bg}`);
  }
});
