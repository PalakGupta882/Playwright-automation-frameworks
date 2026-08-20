const { test } = require('@playwright/test');

// DIAGNOSTIC. TCB-046/047 fails intermittently with
//   "Enter did not select Mobile - active is For You"
// and TCB-028 / TCB-044 with waitForFunction timeouts, roughly one run in three.
//
// Hypothesis to test, not assume: the tablist re-renders shortly after load --
// the active indicator mounts ~500ms after the tabs (measured in
// probe-tab-underline-timing) -- and a tile focused before that re-render loses
// focus, so the Enter that follows goes to the body and selects nothing.
//
// Measures focus survival with and without waiting for the strip to settle.
// Read-only, logged out.

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ retries: 0, mode: 'serial' });

const TABS = '[role="tab"]';

async function focusState(page) {
  return page.evaluate(() => {
    const el = document.activeElement;
    const tab = el && el.closest ? el.closest('[role="tab"]') : null;
    return {
      tag: el ? el.tagName.toLowerCase() : null,
      onTab: !!tab,
      label: tab ? (tab.innerText || '').trim().split('\n')[0] : null,
      isBody: el === document.body,
    };
  });
}

async function indicatorPresent(page) {
  return page.evaluate(() => {
    const tiles = [...document.querySelectorAll('[role="tab"]')];
    const active = tiles.find((t) => t.getAttribute('aria-selected') === 'true');
    if (!active || !active.parentElement) return false;
    return [...active.parentElement.children]
      .filter((n) => !tiles.includes(n))
      .some((n) => {
        const r = n.getBoundingClientRect();
        return r.height > 0 && r.height <= 6 && r.width > 20;
      });
  });
}

test('does focus survive the strip settling?', async ({ page }) => {
  test.setTimeout(180000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('https://www.bytepe.com/', { waitUntil: 'domcontentloaded' });
  await page.locator(TABS).first().waitFor({ state: 'visible', timeout: 20000 });

  const target = page.locator(TABS).nth(1);
  const name = (await target.innerText()).trim().split('\n')[0];
  console.log(`\ntarget tab: "${name}"`);
  console.log(`indicator present at open(): ${await indicatorPresent(page)}`);

  await target.focus();
  console.log(`immediately after focus(): ${JSON.stringify(await focusState(page))}`);

  for (const ms of [200, 300, 500, 1000, 2000]) {
    await page.waitForTimeout(ms);
    const f = await focusState(page);
    console.log(
      `  +${String(ms).padStart(4)}ms  onTab=${f.onTab} label=${f.label} isBody=${f.isBody} indicator=${await indicatorPresent(page)}`
    );
  }
});

test('Enter without settling, 5 attempts', async ({ page }) => {
  test.setTimeout(300000);
  let lost = 0;
  let failed = 0;

  for (let i = 1; i <= 5; i++) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('https://www.bytepe.com/', { waitUntil: 'domcontentloaded' });
    await page.locator(TABS).first().waitFor({ state: 'visible', timeout: 20000 });

    const target = page.locator(TABS).nth(1);
    const name = (await target.innerText()).trim().split('\n')[0];
    await target.focus();
    const before = await focusState(page);
    await page.keyboard.press('Enter');
    const after = await focusState(page);
    await page.waitForTimeout(3000);
    const active = await page.evaluate(
      () =>
        ([...document.querySelectorAll('[role="tab"]')].find(
          (t) => t.getAttribute('aria-selected') === 'true'
        ) || {}).innerText || ''
    );
    const ok = active.trim().toLowerCase().startsWith(name.toLowerCase());
    if (!before.onTab || !after.onTab) lost++;
    if (!ok) failed++;
    console.log(
      `  run ${i}: focusBefore=${before.onTab}(${before.label}) focusAfterKey=${after.onTab} selected="${active.trim().split('\n')[0]}" wanted="${name}" -> ${ok ? 'OK' : 'FAILED'}`
    );
  }
  console.log(`\nNO SETTLE: ${failed}/5 failed to select, focus lost in ${lost}/5`);
});

test('Enter after waiting for the indicator, 5 attempts', async ({ page }) => {
  test.setTimeout(300000);
  let failed = 0;

  for (let i = 1; i <= 5; i++) {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('https://www.bytepe.com/', { waitUntil: 'domcontentloaded' });
    await page.locator(TABS).first().waitFor({ state: 'visible', timeout: 20000 });

    // The proposed fix: wait for the late-mounting indicator, i.e. for the row
    // to have finished the re-render, before touching the keyboard.
    await page
      .waitForFunction(
        () => {
          const tiles = [...document.querySelectorAll('[role="tab"]')];
          const a = tiles.find((t) => t.getAttribute('aria-selected') === 'true');
          if (!a || !a.parentElement) return false;
          return [...a.parentElement.children]
            .filter((n) => !tiles.includes(n))
            .some((n) => {
              const r = n.getBoundingClientRect();
              return r.height > 0 && r.height <= 6 && r.width > 20;
            });
        },
        undefined,
        { timeout: 5000 }
      )
      .catch(() => {});

    const target = page.locator(TABS).nth(1);
    const name = (await target.innerText()).trim().split('\n')[0];
    await target.focus();
    const before = await focusState(page);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(3000);
    const active = await page.evaluate(
      () =>
        ([...document.querySelectorAll('[role="tab"]')].find(
          (t) => t.getAttribute('aria-selected') === 'true'
        ) || {}).innerText || ''
    );
    const ok = active.trim().toLowerCase().startsWith(name.toLowerCase());
    if (!ok) failed++;
    console.log(
      `  run ${i}: focusBefore=${before.onTab}(${before.label}) selected="${active.trim().split('\n')[0]}" wanted="${name}" -> ${ok ? 'OK' : 'FAILED'}`
    );
  }
  console.log(`\nWITH SETTLE: ${failed}/5 failed to select`);
});
