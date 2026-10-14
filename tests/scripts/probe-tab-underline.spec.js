const { test } = require('@playwright/test');

// DIAGNOSTIC. subhome-tabs-ui TCB-016/018/020 fails with
//   the active underline is not the brand colour
//   Expected: "rgb(255, 67, 6)"   Received: "rgba(0, 0, 0, 0)"
//
// The page object finds the underline by SHAPE, inside the active tab:
//   active.querySelectorAll('*') -> height <= 6 && width > 20 -> [0]
//
// Two very different explanations, and the fix differs completely:
//   a) the site genuinely renders no active indicator (a real UI bug)
//   b) the indicator is NOT a descendant of the tab -- MUI renders
//      .MuiTabs-indicator as a child of the scroller, a SIBLING of the tabs --
//      so the heuristic matches some other thin, transparent box instead
//
// This dumps every candidate so the answer is measured, not assumed.
// Read-only, logged out.

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ retries: 0 });

const BRAND = 'rgb(255, 67, 6)';

test('where does the active tab indicator actually live?', async ({ page }) => {
  test.setTimeout(120000);

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('https://www.bytepe.com/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);

  const report = await page.evaluate((brand) => {
    const desc = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return {
        tag: el.tagName.toLowerCase(),
        cls: (el.className || '').toString().trim().slice(0, 70),
        w: Math.round(r.width),
        h: Math.round(r.height),
        x: Math.round(r.left),
        y: Math.round(r.top),
        bg: s.backgroundColor,
        borderBottom: s.borderBottom,
        boxShadow: s.boxShadow === 'none' ? null : s.boxShadow.slice(0, 60),
        text: (el.innerText || '').trim().slice(0, 20),
      };
    };

    const tabs = [...document.querySelectorAll('[role="tab"]')];
    const active = tabs.find((t) => t.getAttribute('aria-selected') === 'true');
    const list = document.querySelector('[role="tablist"]');

    // 1. What the page object's heuristic actually selects, in order.
    const heuristic = active
      ? [...active.querySelectorAll('*')]
          .map((n) => ({ n, r: n.getBoundingClientRect() }))
          .filter((o) => o.r.height > 0 && o.r.height <= 6 && o.r.width > 20)
          .map((o) => desc(o.n))
      : [];

    // 2. Anything MUI-indicator-shaped anywhere on the page.
    const muiIndicators = [...document.querySelectorAll('[class*="indicator" i]')].map(desc);

    // 3. Everything on the page painted in the brand colour.
    const brandPainted = [...document.querySelectorAll('*')]
      .filter((el) => {
        const s = getComputedStyle(el);
        return (
          s.backgroundColor === brand ||
          s.borderBottomColor === brand ||
          s.color === brand
        );
      })
      .slice(0, 25)
      .map((el) => {
        const d = desc(el);
        const s = getComputedStyle(el);
        d.which = [
          s.backgroundColor === brand ? 'bg' : null,
          s.borderBottomColor === brand ? 'border-bottom' : null,
          s.color === brand ? 'text' : null,
        ]
          .filter(Boolean)
          .join('+');
        return d;
      });

    // 4. The active tab itself and its immediate structure.
    const activeSelf = active ? desc(active) : null;
    const activeChildren = active ? [...active.children].map(desc) : [];
    const activeParentChildren =
      active && active.parentElement ? [...active.parentElement.children].map(desc) : [];

    // 5. What visually distinguishes active from inactive?
    const inactive = tabs.find((t) => t.getAttribute('aria-selected') !== 'true');
    const compare = (el) => {
      if (!el) return null;
      const s = getComputedStyle(el);
      const label = [...el.querySelectorAll('p,span,div')].find((n) => (n.innerText || '').trim());
      const ls = label ? getComputedStyle(label) : null;
      return {
        label: label ? label.innerText.trim().slice(0, 18) : null,
        tabBg: s.backgroundColor,
        tabBorderBottom: s.borderBottom,
        tabColor: s.color,
        labelColor: ls ? ls.color : null,
        labelWeight: ls ? ls.fontWeight : null,
      };
    };

    return {
      tabCount: tabs.length,
      activeLabel: active ? (active.innerText || '').trim().split('\n')[0] : null,
      listCls: list ? (list.className || '').toString().slice(0, 70) : null,
      heuristic,
      muiIndicators,
      brandPainted,
      activeSelf,
      activeChildren,
      activeParentChildren,
      activeVsInactive: { active: compare(active), inactive: compare(inactive) },
    };
  }, BRAND);

  const line = (d) =>
    `${d.tag}.${d.cls} ${d.w}x${d.h} @${d.x},${d.y} bg=${d.bg}` +
    (d.borderBottom && !/^0px/.test(d.borderBottom) ? ` border-bottom=${d.borderBottom}` : '') +
    (d.boxShadow ? ` shadow=${d.boxShadow}` : '') +
    (d.which ? `  [${d.which}]` : '') +
    (d.text ? `  "${d.text}"` : '');

  console.log(`\ntabs: ${report.tabCount}, active = "${report.activeLabel}"`);
  console.log(`tablist class: ${report.listCls}`);

  console.log(`\n=== 1. What the page object heuristic matches (${report.heuristic.length} candidates, it takes [0]):`);
  report.heuristic.forEach((d, i) => console.log(`   [${i}] ${line(d)}`));
  if (!report.heuristic.length) console.log('   NONE — the heuristic finds nothing at all');

  console.log(`\n=== 2. Elements with "indicator" in the class name (${report.muiIndicators.length}):`);
  report.muiIndicators.forEach((d) => console.log(`   ${line(d)}`));
  if (!report.muiIndicators.length) console.log('   none');

  console.log(`\n=== 3. Elements painted in the brand colour ${BRAND} (${report.brandPainted.length}):`);
  report.brandPainted.forEach((d) => console.log(`   ${line(d)}`));
  if (!report.brandPainted.length) console.log('   NONE ANYWHERE ON THE PAGE');

  console.log('\n=== 4. The active tab itself:');
  console.log(`   ${line(report.activeSelf)}`);
  console.log('   direct children:');
  report.activeChildren.forEach((d) => console.log(`     ${line(d)}`));
  console.log('   siblings (the tablist row):');
  report.activeParentChildren.forEach((d) => console.log(`     ${line(d)}`));

  console.log('\n=== 5. active vs inactive, visually:');
  console.log(`   active  : ${JSON.stringify(report.activeVsInactive.active)}`);
  console.log(`   inactive: ${JSON.stringify(report.activeVsInactive.inactive)}`);
});
