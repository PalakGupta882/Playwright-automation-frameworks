// tests/scripts/probe-home-nav.spec.js
//
// DIAGNOSTIC, not a regression. Written 19 Aug 2026 to explain three failures
// from that day's full run, each of which could have been our own two-worker
// load on production rather than a live defect:
//
//   smoke/homepage                "navigate to Subscription page" — URL never left /
//   smoke/core-pages              PLP rendered no /pd/ links
//   regression/category-browsing  all 9 category tiles never opened a listing
//
// Logged out, serial, one page at a time, so nothing competes for the origin.
// Read-only: navigation and DOM reads only.

const { test, expect } = require('@playwright/test');

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ mode: 'serial', retries: 0 });

const SITE = 'https://www.bytepe.com';

test('header nav: what is covering the Subscription link?', async ({ page }) => {
  test.setTimeout(240000);

  const results = [];
  for (let i = 1; i <= 5; i++) {
    await page.goto(`${SITE}/`, { waitUntil: 'domcontentloaded' });
    const link = page.getByRole('link', { name: 'Subscription' }).filter({ visible: true }).first();
    await link.waitFor({ state: 'visible', timeout: 20000 });
    await page.waitForTimeout(2000);

    const box = await link.boundingBox();
    // Whatever sits at the link's own centre point is what a shopper's click
    // lands on. If it is not the link, the click goes somewhere else.
    const cover = await page.evaluate(([x, y]) => {
      const el = document.elementFromPoint(x, y);
      if (!el) return { tag: 'none', isLink: false, chain: 'nothing at point' };
      const chain = [];
      for (let n = el, d = 0; n && d < 4; n = n.parentElement, d++) {
        const cs = getComputedStyle(n);
        const r = n.getBoundingClientRect();
        chain.push(
          `${n.tagName}.${(n.className || '').toString().trim().slice(0, 45)} ` +
            `[${Math.round(r.width)}x${Math.round(r.height)} @${Math.round(r.left)},${Math.round(r.top)}] ` +
            `z=${cs.zIndex} pos=${cs.position} opacity=${cs.opacity} bg=${cs.backgroundColor} pe=${cs.pointerEvents}`
        );
      }
      return { tag: el.tagName, isLink: el.tagName === 'A', chain: chain.join('\n      ') };
    }, [box.x + box.width / 2, box.y + box.height / 2]);

    const started = Date.now();
    const clicked = await link
      .click({ timeout: 8000 })
      .then(() => 'delivered')
      .catch(e => `blocked: ${String(e.message).split('\n')[0]}`);
    const moved = await page
      .waitForURL(/\/home\/subscription/, { timeout: 10000 })
      .then(() => true)
      .catch(() => false);

    const line =
      `load ${i}: elementAtLinkCentre=${cover.tag} isTheLink=${cover.isLink} click=${clicked} ` +
      `navigated=${moved} in ${Date.now() - started}ms url=${page.url()}\n      ${cover.chain}`;
    results.push(line);
    console.log(line);
  }

  console.log('SUBSCRIPTION NAV PROBE\n' + results.join('\n'));
  expect(
    results.filter(r => r.includes('navigated=false')),
    'loads where the header link did not navigate'
  ).toEqual([]);
});

test('category strip: what does the homepage actually render, and where does a tile go?', async ({ page }) => {
  test.setTimeout(120000);

  await page.goto(`${SITE}/`, { waitUntil: 'domcontentloaded' });
  const tabs = page.getByRole('tab');
  await tabs.first().waitFor({ state: 'visible', timeout: 20000 });

  const names = await tabs.evaluateAll(els =>
    els.map(el => (el.innerText || '').trim().split('\n')[0])
  );
  console.log(`LIVE CATEGORY TABS (${names.length}): ${names.join(' | ')}`);

  const target = names.find(n => /^mobile$/i.test(n)) || names[1];
  const before = page.url();
  await page
    .getByRole('tab', { name: new RegExp(`^${target}`, 'i') })
    .first()
    .click({ timeout: 15000 })
    .catch(e => console.log(`tab click failed: ${String(e.message).split('\n')[0]}`));
  await page.waitForTimeout(5000);
  console.log(`clicked tab "${target}": ${before} -> ${page.url()}`);
  console.log(`after the click the page renders ${await page.locator('a[href*="/pd/"]').count()} /pd/ links`);

  expect(names.length, 'homepage rendered no category tabs at all').toBeGreaterThan(0);
});

test('PLP: how long until /all-products renders a product link?', async ({ page }) => {
  test.setTimeout(180000);

  const results = [];
  for (let i = 1; i <= 3; i++) {
    const started = Date.now();
    await page.goto(`${SITE}/all-products`, { waitUntil: 'domcontentloaded' });
    const visible = await page
      .locator('a[href*="/pd/"]')
      .first()
      .waitFor({ state: 'visible', timeout: 30000 })
      .then(() => true)
      .catch(() => false);
    const count = await page.locator('a[href*="/pd/"]').count();
    results.push(`load ${i}: firstLink=${visible} after ${Date.now() - started}ms · ${count} links`);
    console.log(results[results.length - 1]);
  }

  console.log('PLP PROBE\n' + results.join('\n'));
  expect(
    results.filter(r => r.includes('firstLink=false')),
    'loads where the PLP rendered no product link'
  ).toEqual([]);
});
