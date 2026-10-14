// tests/scripts/probe-tab-strip-design.spec.js
//
// Diagnostic probe for TCB-005 / TCB-006 / TCB-007, not a regression test.
//
// Written 27 Aug 2026, when TCB-005 and TCB-007 failed while TCB-006 (mobile)
// passed on every number. Three questions had to be separated before that could
// be called a defect rather than test drift:
//
//   1. Is there a width at which the desktop spec IS met? (breakpoint moved?)
//   2. Is the whole strip affected, or only the first tile the page object
//      happens to measure?
//   3. What is actually in the CSS, so a report names a cause and not a symptom?
//
// Answers, all below: no width, the whole strip, and a wholesale change to the
// >=900px breakpoint. Re-run this before re-opening the question.
const { test } = require('@playwright/test');
const { SubHomeTabsPage } = require('../pages/subHomeTabsPage');

test.use({ storageState: { cookies: [], origins: [] } });

// Spans both sides of every plausible breakpoint. Measured: the only one that
// exists is at 900px, and neither side renders the desktop spec.
const WIDTHS = [390, 600, 768, 900, 1024, 1200, 1280, 1366, 1440, 1600, 1920];

test('Q1: is the desktop spec met at ANY width', async ({ page }) => {
  test.setTimeout(180000);
  const strip = new SubHomeTabsPage(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await strip.open('/');

  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(600);
    const m = await strip.measure();
    console.log(
      `w=${String(width).padStart(4)}  tile=${m.tile && m.tile.w}  icon=${m.icon && m.icon.w}x${m.icon && m.icon.h}  ` +
        `label=${m.labelFontSize}  underline=${m.underline ? m.underline.h : 'absent'}  gap=${m.gap}  ` +
        `border=${m.sticky && m.sticky.borderBottom}  tabs=${m.tabCount}`
    );
  }
});

for (const [name, vp] of [
  ['desktop', { width: 1440, height: 900 }],
  ['mobile', { width: 390, height: 844 }],
]) {
  test(`Q2: every tile at ${name}, not just the first`, async ({ page }) => {
    const strip = new SubHomeTabsPage(page);
    await page.setViewportSize(vp);
    await strip.open('/');
    const rows = await page.evaluate(() => {
      const tiles = [...document.querySelectorAll('[role="tab"]')];
      return tiles.map((t) => {
        const r = t.getBoundingClientRect();
        const img = t.querySelector('img');
        const ir = img && img.getBoundingClientRect();
        const cap = [...t.querySelectorAll('p,span,div')].find((n) => (n.innerText || '').trim());
        return {
          label: (t.innerText || '').trim().split('\n')[0],
          w: Math.round(r.width),
          h: Math.round(r.height),
          icon: ir ? `${Math.round(ir.width)}x${Math.round(ir.height)}` : 'none',
          font: cap ? getComputedStyle(cap).fontSize : null,
          selected: t.getAttribute('aria-selected'),
        };
      });
    });
    for (const r of rows) {
      console.log(
        `${name} ${r.label.padEnd(14)} tile=${r.w}x${r.h} icon=${r.icon} font=${r.font} sel=${r.selected}`
      );
    }
  });
}

test('Q3: the computed CSS behind the numbers, at 1440', async ({ page }) => {
  const strip = new SubHomeTabsPage(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await strip.open('/');
  const out = await page.evaluate(() => {
    const list = document.querySelector('[role="tablist"]');
    const tile = document.querySelector('[role="tab"]');
    const img = tile.querySelector('img');
    const cap = [...tile.querySelectorAll('p,span,div')].find((n) => (n.innerText || '').trim());
    const pick = (el, props) => Object.fromEntries(props.map((p) => [p, getComputedStyle(el)[p]]));
    return {
      stickyClass: list.parentElement.className,
      sticky: pick(list.parentElement, ['borderBottom', 'borderBottomWidth', 'position', 'top']),
      listClass: list.className,
      list: pick(list, ['gap', 'columnGap', 'display', 'justifyContent', 'padding']),
      tileClass: tile.className,
      tile: pick(tile, ['width', 'minWidth', 'maxWidth', 'padding', 'margin', 'flex']),
      imgClass: img.className,
      img: pick(img, ['width', 'height']),
      capClass: cap.className,
      cap: pick(cap, ['fontSize', 'lineHeight', 'fontWeight']),
    };
  });
  console.log(JSON.stringify(out, null, 2));
});
