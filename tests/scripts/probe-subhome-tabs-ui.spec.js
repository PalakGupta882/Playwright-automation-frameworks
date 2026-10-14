// tests/scripts/probe-subhome-tabs-ui.spec.js
//
// DIAGNOSTIC. Measures the live tab strip so the TCB-* specs assert measured
// numbers instead of the sheet's fixture values. Read-only, logged out.
const { test } = require('@playwright/test');

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ mode: 'serial', retries: 0 });

const SITE = 'https://www.bytepe.com';

const GEOMETRY = () => {
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  const list = document.querySelector('[role="tablist"]');
  const header = document.querySelector('header');
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.left), y: Math.round(r.top) };
  };
  const cs = (el, ...props) => {
    if (!el) return {};
    const s = getComputedStyle(el);
    return Object.fromEntries(props.map((p) => [p, s[p]]));
  };
  const first = tabs[0];
  const img = first && first.querySelector('img');
  const label = first && [...first.querySelectorAll('p,span,div')].find((n) => (n.innerText || '').trim());
  const active = tabs.find((t) => t.getAttribute('aria-selected') === 'true');

  // The underline: whatever child of the active tab is a thin full-width box.
  const underline = active
    ? [...active.querySelectorAll('*')]
        .map((n) => ({ n, r: n.getBoundingClientRect() }))
        .filter((o) => o.r.height > 0 && o.r.height <= 6 && o.r.width > 20)
        .map((o) => ({ h: Math.round(o.r.height), w: Math.round(o.r.width), bg: getComputedStyle(o.n).backgroundColor }))
    : [];

  return {
    tabCount: tabs.length,
    listBox: box(list),
    listStyle: cs(list, 'position', 'top', 'zIndex', 'backgroundColor', 'overflowX', 'justifyContent', 'gap', 'borderBottom'),
    listParentStyle: cs(list && list.parentElement, 'position', 'top', 'zIndex', 'backgroundColor', 'borderBottom'),
    headerBox: box(header),
    headerZ: cs(header, 'zIndex', 'position').zIndex,
    firstTab: box(first),
    firstTabStyle: cs(first, 'width', 'gap', 'flexDirection', 'cursor', 'tabIndex'),
    icon: box(img),
    iconAlt: img && img.alt,
    labelText: label && label.innerText.trim(),
    labelStyle: cs(label, 'fontSize', 'fontWeight', 'textTransform'),
    gap: tabs.length > 1 ? Math.round(tabs[1].getBoundingClientRect().left - tabs[0].getBoundingClientRect().right) : null,
    underline,
    scrollWidth: list ? list.scrollWidth : null,
    clientWidth: list ? list.clientWidth : null,
    bodyScrollW: document.body.scrollWidth,
    bodyClientW: document.body.clientWidth,
  };
};

for (const vp of [{ name: 'desktop 1440', width: 1440, height: 900 }, { name: 'mobile 390', width: 390, height: 844 }]) {
  test(`geometry @ ${vp.name}`, async ({ page }) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await page.goto(`${SITE}/`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('tab').first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(2500);

    const g = await page.evaluate(GEOMETRY);
    console.log(`\n=== ${vp.name} ===\n${JSON.stringify(g, null, 2)}`);

    // Sticky: scroll and see whether the strip holds its viewport position.
    const before = g.listBox;
    await page.mouse.wheel(0, 2000);
    await page.waitForTimeout(1200);
    const after = await page.evaluate(() => {
      const l = document.querySelector('[role="tablist"]');
      const h = document.querySelector('header');
      const r = l && l.getBoundingClientRect();
      const hr = h && h.getBoundingClientRect();
      return {
        listY: r ? Math.round(r.top) : null,
        headerBottom: hr ? Math.round(hr.bottom) : null,
        scrollY: Math.round(window.scrollY),
      };
    });
    console.log(`sticky check: listY before=${before && before.y} after=${after.listY} (scrollY=${after.scrollY}, headerBottom=${after.headerBottom})`);
  });
}

test('switching behaviour: url, sections, active state, scroll', async ({ page }) => {
  test.setTimeout(180000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${SITE}/`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('tab').first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(2500);

  const snapshot = () =>
    page.evaluate(() => ({
      url: location.href,
      active: [...document.querySelectorAll('[role="tab"]')]
        .filter((t) => t.getAttribute('aria-selected') === 'true')
        .map((t) => (t.innerText || '').trim().split('\n')[0]),
      bodyLen: document.body.innerText.length,
      firstSection: (document.body.innerText.match(/\n([A-Z][^\n]{3,40})\n/) || [])[1],
      scrollY: Math.round(window.scrollY),
      tablists: document.querySelectorAll('[role="tablist"]').length,
    }));

  let reloaded = false;
  page.on('load', () => { reloaded = true; });

  console.log(`before: ${JSON.stringify(await snapshot())}`);

  await page.mouse.wheel(0, 1500);
  await page.waitForTimeout(800);
  console.log(`scrolled to y=${(await snapshot()).scrollY}`);

  await page.getByRole('tab', { name: /^Audio/i }).first().click();
  await page.waitForTimeout(4000);
  console.log(`after clicking Audio: ${JSON.stringify(await snapshot())}`);
  console.log(`full page reload fired: ${reloaded}`);

  // Re-click the active tab (TCB-026)
  await page.getByRole('tab', { name: /^Audio/i }).first().click();
  await page.waitForTimeout(2500);
  console.log(`after re-clicking Audio: ${JSON.stringify(await snapshot())}`);

  // Back button — does the tab selection restore?
  await page.goBack();
  await page.waitForTimeout(3000);
  console.log(`after goBack: ${JSON.stringify(await snapshot())}`);

  // Keyboard activation (TCB-046/047)
  const tab = page.getByRole('tab', { name: /^Luggage/i }).first();
  await tab.focus().catch((e) => console.log(`focus failed: ${e.message.split('\n')[0]}`));
  const focused = await page.evaluate(() => {
    const el = document.activeElement;
    return el ? `${el.tagName} role=${el.getAttribute('role')} text=${(el.innerText || '').trim().split('\n')[0]}` : 'none';
  });
  console.log(`activeElement after focus(): ${focused}`);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3000);
  console.log(`after Enter: ${JSON.stringify(await snapshot())}`);
});
