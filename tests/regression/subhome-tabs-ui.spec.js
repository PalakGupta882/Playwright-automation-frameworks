// tests/regression/subhome-tabs-ui.spec.js
//
// TCB-001..TCB-054 — the Sub Home Page tab strip on the storefront.
// Public and logged out: the strip is the same for every shopper.
//
// THE SHEET'S FIXTURES DO NOT EXIST HERE. It was written against a developer
// machine where Home carried "Laptop" and "5G Phones", Subscription carried
// "tejash" and EMI Store carried "ffrisisi". Production, measured 19 Aug 2026:
//
//   Home          8 tabs — For You, Mobile, Electronics, Audio, Accessories,
//                 Luggage, Wearables, Appliances (sequence 1..7 then 9)
//   Subscription  0 tabs, no strip
//   EMI Store     0 tabs, no strip
//
// So the label cases assert the UI against the LIVE nav response rather than
// against a name, and the five cases that need a second page to have its own
// tabs assert the zero-tab promise instead — which is TCB-050, and is what
// those routes actually promise today.
//
// TCB-023 DEVIATION, recorded rather than silently accommodated. The sheet says
// selecting a tab leaves the URL at "/" unchanged. Production appends
// ?sub_home_page=<slug>, applies it as a deep link on load, and does NOT push a
// history entry. Everything the case was protecting against still holds — no
// reload, no route transition, no remount — so the test asserts those, asserts
// the PATH is unchanged, and logs the query parameter as a deviation for the
// sheet's author to confirm or retire.

const { test, expect } = require('../fixtures/pageFixtures');
const { BASE_URL } = require('../data/constants');
const {
  navPath,
  unwrap,
  tabsOf,
  inDisplayOrder,
  pageWithTabs,
  DESIGN,
  ACTIVE_UNDERLINE_RGB,
  TABLIST_LABEL,
  TAB_QUERY_PARAM,
} = require('../data/subHomeFeature');

test.use({ storageState: { cookies: [], origins: [] } });

// The nav is the source of truth for what the strip must render. Fetched once.
let navTabs = [];
let hostPage = null;
let tabLessPages = [];

test.beforeAll(async ({ request }) => {
  const res = await request.get(navPath());
  const nav = res.ok() ? unwrap(await res.json()) : [];
  hostPage = pageWithTabs(nav);
  navTabs = hostPage ? inDisplayOrder(tabsOf(hostPage)) : [];
  tabLessPages = nav.filter((p) => tabsOf(p).length === 0);
  console.log(
    `nav says the strip should render ${navTabs.length} tabs: ${navTabs.map((t) => t.name).join(', ')}`
  );
});

test.describe('Sub home page tab strip', () => {
  // ---- Rendering & placement (TCB-001..007) ---------------------------

  test('TCB-001 / TCB-003: the strip renders below the header, above every section', async ({
    subHomeTabsPage,
  }) => {
    await subHomeTabsPage.useViewport('desktop');
    await subHomeTabsPage.open('/');
    const m = await subHomeTabsPage.measure();

    expect(m.tabCount, await subHomeTabsPage.diagnose('the strip rendered no tabs')).toBeGreaterThan(0);
    expect(
      m.list.y,
      await subHomeTabsPage.diagnose('the strip does not sit below the header')
    ).toBeGreaterThanOrEqual(m.header.bottom - 1);

    // TCB-003: nothing from the CMS may render above it. The strip's top must
    // be the first thing under the header, whatever order the backend sends.
    const firstContentTop = await subHomeTabsPage.page.evaluate(() => {
      const list = document.querySelector('[role="tablist"]');
      const header = document.querySelector('header');
      const headerBottom = header.getBoundingClientRect().bottom;
      const above = [...document.querySelectorAll('main *, body > div *')].filter((el) => {
        const r = el.getBoundingClientRect();
        return (
          r.height > 40 &&
          r.width > 200 &&
          r.top >= headerBottom - 2 &&
          r.bottom <= list.getBoundingClientRect().top + 1 &&
          !list.contains(el) &&
          !header.contains(el)
        );
      });
      return above.length;
    });
    expect(firstContentTop, 'a page section renders between the header and the tab strip').toBe(0);
  });

  test('TCB-002: no gap and no overlap between the search row and the strip', async ({
    subHomeTabsPage,
  }) => {
    await subHomeTabsPage.useViewport('desktop');
    await subHomeTabsPage.open('/');
    const m = await subHomeTabsPage.measure();

    const gap = m.list.y - m.header.bottom;
    console.log(`header bottom ${m.header.bottom}px, strip top ${m.list.y}px, gap ${gap}px`);
    expect(gap, `the strip overlaps the header by ${-gap}px`).toBeGreaterThanOrEqual(-1);
    expect(gap, `${gap}px of page shows between the header and the strip`).toBeLessThanOrEqual(2);
  });

  test('TCB-004: the strip is not gated on the section payload', async ({ subHomeTabsPage, page }) => {
    // Hold the sections endpoint open. If the strip waits for it, nothing
    // renders; the sheet requires the strip while the body is still a skeleton.
    await page.route('**/apps/home-page/sections*', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 8000));
      await route.continue();
    });

    await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
    await expect(
      subHomeTabsPage.tabs.first(),
      'the strip did not render while the sections request was still in flight'
    ).toBeVisible({ timeout: 7000 });
    console.log('strip rendered with the sections request deliberately stalled');
  });

  test('TCB-005: a single hairline divider closes the strip', async ({ subHomeTabsPage }) => {
    await subHomeTabsPage.useViewport('desktop');
    await subHomeTabsPage.open('/');
    const m = await subHomeTabsPage.measure();

    console.log(`sticky container border-bottom: ${m.sticky.borderBottom}`);
    expect(m.sticky.borderBottom, 'the strip has no bottom divider').not.toMatch(/^0px|none/);
    expect(m.sticky.borderBottom, 'the divider is thicker than a hairline').toMatch(/^1px/);
  });

  for (const width of ['desktop', 'mobile']) {
    test(`TCB-00${width === 'mobile' ? 6 : 7}: design spec at ${width} (${DESIGN[width].viewport.width}px)`, async ({
      subHomeTabsPage,
    }) => {
      const spec = DESIGN[width];
      await subHomeTabsPage.useViewport(width);
      await subHomeTabsPage.open('/');
      const m = await subHomeTabsPage.measure();

      console.log(
        `${width}: tile ${m.tile.w}px · icon ${m.icon.w}x${m.icon.h} · label ${m.labelFontSize} · ` +
          `underline ${m.underline && m.underline.h}px · gap ${m.gap}px`
      );

      const off = [];
      if (m.tile.w !== spec.tile) off.push(`tile ${m.tile.w}px, spec ${spec.tile}px`);
      if (m.icon.w !== spec.icon || m.icon.h !== spec.icon)
        off.push(`icon ${m.icon.w}x${m.icon.h}, spec ${spec.icon}x${spec.icon}`);
      if (m.labelFontSize !== `${spec.label}px`) off.push(`label ${m.labelFontSize}, spec ${spec.label}px`);
      if (!m.underline || m.underline.h !== spec.underline)
        off.push(`underline ${m.underline ? `${m.underline.h}px` : 'absent'}, spec ${spec.underline}px`);
      if (m.gap !== spec.gap) off.push(`gap ${m.gap}px, spec ${spec.gap}px`);

      expect(off, `the ${width} strip is off its design spec`).toEqual([]);
    });
  }

  // ---- Data binding & ordering (TCB-008..015) -------------------------

  test('TCB-008 / TCB-011: the strip renders exactly the nav tab list, in sequence order', async ({
    subHomeTabsPage,
  }) => {
    test.skip(navTabs.length === 0, 'the nav returned no tabs to compare against');

    await subHomeTabsPage.useViewport('desktop');
    await subHomeTabsPage.open('/');
    const rendered = await subHomeTabsPage.labels();

    // Case-insensitive: the API stores "laptop" and the strip capitalises it
    // (TCB-013), so the comparison has to allow that and nothing else.
    expect(
      rendered.map((r) => r.toLowerCase()),
      `the strip does not match the nav.\n  nav      : ${navTabs.map((t) => t.name).join(', ')}\n  rendered : ${rendered.join(', ')}`
    ).toEqual(navTabs.map((t) => t.name.toLowerCase()));

    // TCB-008's other half: top-level page names must not leak into the strip.
    const topLevel = ['Subscription', 'EMI Store', 'Products', 'About Us'];
    const leaked = rendered.filter((r) => topLevel.some((t) => t.toLowerCase() === r.toLowerCase()));
    expect(leaked, 'a top-level nav page is being rendered as a tab').toEqual([]);
  });

  test('TCB-012: duplicate sequence values still render a stable order', async ({ subHomeTabsPage }) => {
    const duplicated = navTabs
      .map((t) => t.sequence)
      .filter((s, i, all) => all.indexOf(s) !== i);
    test.skip(
      duplicated.length === 0,
      `no two tabs share a sequence today (${navTabs.map((t) => t.sequence).join(',')}) — nothing to prove`
    );

    await subHomeTabsPage.useViewport('desktop');
    await subHomeTabsPage.open('/');
    const first = await subHomeTabsPage.labels();
    await subHomeTabsPage.open('/');
    const second = await subHomeTabsPage.labels();
    expect(second, 'tab order reshuffles between reloads when sequences tie').toEqual(first);
  });

  test('TCB-013: labels come from name, displayed capitalised', async ({ subHomeTabsPage }) => {
    test.skip(navTabs.length === 0, 'no tabs in the nav');
    await subHomeTabsPage.useViewport('desktop');
    await subHomeTabsPage.open('/');

    const transform = await subHomeTabsPage.page.evaluate(() => {
      const tile = document.querySelector('[role="tab"]');
      const caption = [...tile.querySelectorAll('p,span,div')].find((n) => (n.innerText || '').trim());
      return caption ? getComputedStyle(caption).textTransform : null;
    });
    console.log(`label text-transform: ${transform}`);
    expect(transform, 'labels are not capitalised, so a lower-case CMS name renders raw').toBe(
      'capitalize'
    );
  });

  test('TCB-014 / TCB-048: every icon comes from icon_url, renders undistorted and is labelled', async ({
    subHomeTabsPage,
  }) => {
    test.skip(navTabs.length === 0, 'no tabs in the nav');
    await subHomeTabsPage.useViewport('desktop');
    await subHomeTabsPage.open('/');

    const icons = await subHomeTabsPage.page.evaluate(() =>
      [...document.querySelectorAll('[role="tab"]')].map((t) => {
        const img = t.querySelector('img');
        const label = (t.innerText || '').trim().split('\n')[0];
        return img
          ? {
              label,
              src: img.currentSrc || img.src,
              alt: img.alt,
              objectFit: getComputedStyle(img).objectFit,
              naturalWidth: img.naturalWidth,
              complete: img.complete,
            }
          : { label, src: null };
      })
    );
    icons.forEach((i) => console.log(`  ${i.label}: alt="${i.alt}" fit=${i.objectFit} natural=${i.naturalWidth}`));

    const unlabelled = icons.filter((i) => i.src && (!i.alt || i.alt.toLowerCase() !== i.label.toLowerCase()));
    expect(
      unlabelled.map((i) => `${i.label}: alt="${i.alt}"`),
      'an icon alt does not match its tab label — a screen reader announces the wrong thing'
    ).toEqual([]);

    const stretched = icons.filter((i) => i.src && !/contain|cover|scale-down/.test(i.objectFit));
    expect(
      stretched.map((i) => `${i.label}: object-fit ${i.objectFit}`),
      'an icon is stretched rather than contained'
    ).toEqual([]);
  });

  test('TCB-015 / TCB-053: every icon URL actually resolves', async ({ subHomeTabsPage, request }) => {
    test.skip(navTabs.length === 0, 'no tabs in the nav');
    await subHomeTabsPage.useViewport('desktop');
    await subHomeTabsPage.open('/');
    const m = await subHomeTabsPage.measure();

    // Covers the sheet's spaces-in-filename case without needing that exact
    // fixture: whatever the CMS stored, the browser must have fetched it.
    expect(
      m.brokenIcons,
      `${m.brokenIcons} tab icon(s) failed to load — the strip shows a broken-image glyph`
    ).toBe(0);

    const withSpaces = navTabs.filter((t) => /\s/.test(t.icon_url || ''));
    console.log(
      withSpaces.length
        ? `icon_url values containing spaces: ${withSpaces.map((t) => t.name).join(', ')} — all loaded`
        : 'no icon_url on this page contains a space, so TCB-015 is covered only by the general load check'
    );
  });

  // ---- Default selection (TCB-016..021) -------------------------------

  test('TCB-016 / TCB-018 / TCB-020: the lowest-sequence tab is active on load, and only it', async ({
    subHomeTabsPage,
  }) => {
    test.skip(navTabs.length === 0, 'no tabs in the nav');
    await subHomeTabsPage.useViewport('desktop');
    await subHomeTabsPage.open('/');

    const active = await subHomeTabsPage.activeLabels();
    expect(
      active.length,
      await subHomeTabsPage.diagnose(`${active.length} tabs are active — exactly one must be`)
    ).toBe(1);

    // navTabs is sorted by sequence, so [0] is the lowest — not the first in
    // the raw array, which is what TCB-018 is about.
    expect(active[0].toLowerCase(), 'the default tab is not the lowest-sequence one').toBe(
      navTabs[0].name.toLowerCase()
    );

    const m = await subHomeTabsPage.measure();
    expect(m.underline.bg, 'the active underline is not the brand colour').toBe(ACTIVE_UNDERLINE_RGB);
  });

  test('TCB-017: the sections on screen belong to the selected tab', async ({ subHomeTabsPage, page }) => {
    test.skip(navTabs.length < 2, 'need two tabs to tell one tab sections from another');
    await subHomeTabsPage.useViewport('desktop');

    const sectionRequests = [];
    page.on('request', (r) => {
      if (r.url().includes('/apps/home-page/sections')) sectionRequests.push(r.url());
    });

    await subHomeTabsPage.open('/');
    await page.waitForTimeout(4000);

    const withTab = sectionRequests.filter((u) => u.includes('sub_home_page_id='));
    console.log(`${sectionRequests.length} section requests, ${withTab.length} carrying a tab id`);
    expect(
      withTab.length,
      'the page fetched sections without naming a tab, so it is rendering the parent page content'
    ).toBeGreaterThan(0);
    expect(
      withTab.some((u) => u.includes(navTabs[0].id)),
      `no section request named the default tab (${navTabs[0].name}, ${navTabs[0].id})`
    ).toBe(true);
  });

  test('TCB-021: the row does not shift when the active tab changes', async ({ subHomeTabsPage }) => {
    test.skip(navTabs.length < 2, 'need two tabs to switch between');
    await subHomeTabsPage.useViewport('desktop');
    await subHomeTabsPage.open('/');

    const before = await subHomeTabsPage.measure();
    await subHomeTabsPage.select(navTabs[1].name);
    const after = await subHomeTabsPage.measure();

    expect(after.list.h, `the strip height moved from ${before.list.h}px to ${after.list.h}px on switch`).toBe(
      before.list.h
    );
    expect(after.tile.y, 'the tab labels moved vertically on switch').toBe(before.tile.y);
  });

  // ---- Switching (TCB-022..030) ---------------------------------------

  test('TCB-022 / TCB-023 / TCB-024 / TCB-025 / TCB-030: selecting a tab swaps content in place', async ({
    subHomeTabsPage,
    page,
  }) => {
    test.skip(navTabs.length < 2, 'need two tabs to switch between');
    await subHomeTabsPage.useViewport('desktop');
    await subHomeTabsPage.open('/');
    // settle() before attaching the listener: open() waits for
    // domcontentloaded, so the first page's own load event is still to come and
    // would otherwise be counted as a reload caused by the click.
    await subHomeTabsPage.settle();

    let reloads = 0;
    page.on('load', () => { reloads += 1; });

    const before = await page.evaluate(() => document.body.innerText);
    await page.mouse.wheel(0, 1500);
    await page.waitForTimeout(600);
    const scrolledTo = await page.evaluate(() => Math.round(window.scrollY));
    expect(scrolledTo, 'the page did not scroll, so the scroll-to-top check would be vacuous').toBeGreaterThan(200);

    const target = navTabs[1];
    await subHomeTabsPage.select(target.name);
    await page.waitForTimeout(3000);

    // TCB-024
    expect(await subHomeTabsPage.activeLabels(), 'the active state did not move to the clicked tab').toEqual([
      expect.stringMatching(new RegExp(`^${target.name}$`, 'i')),
    ]);

    // TCB-022 — the content below must actually change. Read into a variable
    // first: this is a comparison against a snapshot taken before the click,
    // not a wait for a known string, so a web-first assertion does not apply.
    const after = await page.evaluate(() => document.body.innerText);
    expect(after, 'the sections did not change when the tab changed').not.toBe(before);

    // TCB-030 — the strip itself stays mounted
    expect(await subHomeTabsPage.tabList.count(), 'the strip unmounted during the switch').toBe(1);

    // TCB-025 — back to the top
    expect(
      await page.evaluate(() => Math.round(window.scrollY)),
      'the page did not return to the top after switching'
    ).toBeLessThan(50);

    // TCB-023 — no reload, no route change. See the deviation note at the top:
    // the path must not move; the query parameter does, and that is reported.
    expect(reloads, 'selecting a tab triggered a full page reload').toBe(0);
    expect(subHomeTabsPage.pathOf(), 'selecting a tab changed the route').toBe('/');
    console.log(
      `TCB-023 DEVIATION FROM THE SHEET: the sheet says the URL is unchanged; production sets ` +
        `?${TAB_QUERY_PARAM}=${subHomeTabsPage.selectedFromUrl()} on the same path, with no reload ` +
        'and no history entry. Confirm or retire the sheet wording.'
    );
    expect(
      subHomeTabsPage.selectedFromUrl(),
      'the query parameter does not name the selected tab'
    ).toBe(target.slug);
  });

  test('TCB-026: re-clicking the active tab changes nothing', async ({ subHomeTabsPage, page }) => {
    test.skip(navTabs.length === 0, 'no tabs in the nav');
    await subHomeTabsPage.useViewport('desktop');
    await subHomeTabsPage.open('/');

    // The sections land after the strip does, so the baseline has to be taken
    // from a settled page — otherwise it differs from itself on the next read
    // and every no-op looks like a re-render.
    await subHomeTabsPage.settle();
    const active = (await subHomeTabsPage.activeLabels())[0];
    const before = { url: page.url(), body: await page.evaluate(() => document.body.innerText) };

    let refetches = 0;
    page.on('request', (r) => {
      if (r.url().includes('/apps/home-page/sections')) refetches += 1;
    });

    await subHomeTabsPage.tab(active).click();
    await page.waitForTimeout(3000);

    const bodyAfter = await page.evaluate(() => document.body.innerText);
    expect(await subHomeTabsPage.activeLabels(), 'the selection moved off the re-clicked tab').toEqual([active]);
    expect(page.url(), 'the URL changed on a no-op click').toBe(before.url);
    expect(bodyAfter, 'the content re-rendered on a no-op click').toBe(before.body);
    console.log(`re-clicking "${active}" issued ${refetches} section request(s)`);
  });

  test('TCB-028: switching back and forth renders the right sections each time', async ({
    subHomeTabsPage,
    page,
  }) => {
    test.skip(navTabs.length < 2, 'need two tabs');
    await subHomeTabsPage.useViewport('desktop');
    await subHomeTabsPage.open('/');

    const [a, b] = navTabs;
    const seen = {};
    for (const name of [b.name, a.name, b.name]) {
      await subHomeTabsPage.select(name);
      // settle rather than a fixed wait: the comparison is between two full
      // renders of the same tab, so a half-rendered read fails on timing alone.
      await subHomeTabsPage.settle();
      const body = await page.evaluate(() => document.body.innerText);
      if (seen[name] !== undefined) {
        expect(
          body,
          `${name} rendered different content the second time it was selected — stale or mixed sections`
        ).toBe(seen[name]);
      }
      seen[name] = body;
      expect(await subHomeTabsPage.activeLabels(), `${name} is not the active tab after selecting it`).toEqual([
        expect.stringMatching(new RegExp(`^${name}$`, 'i')),
      ]);
    }
  });

  test('TCB-029: rapid switching settles on the last tab clicked', async ({ subHomeTabsPage, page }) => {
    test.skip(navTabs.length < 2, 'need two tabs');
    await subHomeTabsPage.useViewport('desktop');
    await subHomeTabsPage.open('/');

    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message).split('\n')[0]));

    const [a, b] = navTabs;
    // Track what was actually clicked last. Deriving it from the loop bound
    // instead named the wrong tab and reported a strip that had settled
    // correctly as broken.
    let last = null;
    for (let i = 0; i < 6; i++) {
      last = i % 2 ? a.name : b.name;
      await subHomeTabsPage.tab(last).click();
    }
    await page.waitForTimeout(6000);

    expect(await subHomeTabsPage.activeLabels(), 'the strip did not settle on the last tab clicked').toEqual([
      expect.stringMatching(new RegExp(`^${last}$`, 'i')),
    ]);
    expect(errors, 'rapid switching threw a page error').toEqual([]);
  });

  test('TCB-027: a skeleton covers the swap rather than the previous tab content', async ({
    subHomeTabsPage,
    page,
  }) => {
    test.skip(navTabs.length < 2, 'need two tabs');
    await subHomeTabsPage.useViewport('desktop');
    await subHomeTabsPage.open('/');
    await subHomeTabsPage.settle();

    const before = await page.evaluate(() => document.body.innerText);

    // Stall the next sections call so the intermediate state is observable.
    await page.route('**/apps/home-page/sections*', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 6000));
      await route.continue();
    });

    await subHomeTabsPage.tab(navTabs[1].name).click();
    await page.waitForTimeout(2500);

    const during = await page.evaluate(() => document.body.innerText);
    const skeleton = await page.locator('[class*="skeleton"], [class*="Skeleton"]').count();
    console.log(`skeleton nodes while the swap was stalled: ${skeleton}`);

    expect(
      during === before && skeleton === 0,
      'the previous tab sections stayed on screen with no loading state, so they read as the new tab content'
    ).toBe(false);
  });

  // ---- Sticky (TCB-031..036) ------------------------------------------

  test('TCB-031 / TCB-032 / TCB-033 / TCB-034: the strip pins under the header and stays opaque', async ({
    subHomeTabsPage,
    page,
  }) => {
    await subHomeTabsPage.useViewport('desktop');
    await subHomeTabsPage.open('/');
    const before = await subHomeTabsPage.measure();

    await page.mouse.wheel(0, 3000);
    await page.waitForTimeout(1200);
    const after = await subHomeTabsPage.measure();

    console.log(
      `strip top before ${before.list.y}px, after scrolling ${after.list.y}px ` +
        `(sticky ${after.sticky.position} top ${after.sticky.top} z ${after.sticky.zIndex}; header z ${after.headerZIndex})`
    );

    expect(after.list.y, 'the strip scrolled away instead of staying pinned').toBe(before.list.y);
    expect(after.list.y, 'the strip is not flush beneath the header').toBeGreaterThanOrEqual(
      after.header.bottom - 1
    );

    // TCB-033 — content must scroll behind it, so the background cannot be
    // transparent.
    expect(
      after.sticky.background,
      'the pinned strip is transparent, so content shows through it'
    ).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);

    // TCB-034 — the header must stack above the strip.
    expect(
      Number(after.headerZIndex),
      'the strip is stacked at or above the header, so it can cover header controls'
    ).toBeGreaterThan(Number(after.sticky.zIndex));
  });

  test('TCB-036: the strip is still pinned after a tab switch', async ({ subHomeTabsPage, page }) => {
    test.skip(navTabs.length < 2, 'need two tabs');
    await subHomeTabsPage.useViewport('desktop');
    await subHomeTabsPage.open('/');

    await page.mouse.wheel(0, 2000);
    await page.waitForTimeout(800);
    await subHomeTabsPage.select(navTabs[1].name);
    await page.waitForTimeout(2500);
    await page.mouse.wheel(0, 2000);
    await page.waitForTimeout(800);

    const m = await subHomeTabsPage.measure();
    expect(m.list.y, 'the strip lost its pinned position after the content swap').toBeGreaterThanOrEqual(
      m.header.bottom - 1
    );
    expect(m.list.y, 'the strip drifted below the header after the swap').toBeLessThanOrEqual(
      m.header.bottom + 2
    );
  });

  // ---- Responsive & overflow (TCB-037..043) ---------------------------

  test('TCB-037 / TCB-039: tabs are centred, and centring never clips the first one', async ({
    subHomeTabsPage,
  }) => {
    await subHomeTabsPage.useViewport('desktop');
    await subHomeTabsPage.open('/');
    const m = await subHomeTabsPage.measure();

    console.log(`justify-content: ${m.justifyContent} · first tile x=${m.tile.x}`);
    expect(m.justifyContent, 'the strip is not centred').toMatch(/center/);

    // "safe center" is what keeps an overflowing strip from clipping its first
    // tile off the left edge. A plain "center" would.
    expect(m.tile.x, 'the first tab is clipped off the left edge').toBeGreaterThanOrEqual(0);
  });

  test('TCB-038 / TCB-040: an overflowing strip scrolls itself, not the page', async ({
    subHomeTabsPage,
    page,
  }) => {
    await subHomeTabsPage.useViewport('mobile');
    await subHomeTabsPage.open('/');
    const m = await subHomeTabsPage.measure();

    console.log(
      `mobile: strip scrollWidth ${m.scrollWidth} vs clientWidth ${m.clientWidth}; ` +
        `body ${m.bodyScrollWidth} vs ${m.bodyClientWidth}; overflow-x ${m.overflowX}`
    );
    expect(
      m.scrollWidth,
      'the strip does not overflow at 390px, so horizontal scrolling is unproven'
    ).toBeGreaterThan(m.clientWidth);
    expect(m.overflowX, 'the strip does not scroll horizontally').toMatch(/auto|scroll/);
    expect(
      m.bodyScrollWidth,
      'the page body itself scrolls sideways — the overflow escaped the strip'
    ).toBe(m.bodyClientWidth);

    // It must actually move, not merely be allowed to.
    const moved = await page.evaluate(() => {
      const list = document.querySelector('[role="tablist"]');
      const start = list.scrollLeft;
      list.scrollLeft = start + 120;
      const end = list.scrollLeft;
      list.scrollLeft = start;
      return end - start;
    });
    expect(moved, 'the strip would not scroll horizontally').toBeGreaterThan(0);
  });

  test('TCB-041: the active tab is scrolled into view on load', async ({ subHomeTabsPage, page }) => {
    test.skip(navTabs.length === 0, 'no tabs in the nav');
    await subHomeTabsPage.useViewport('mobile');

    // Deep-link the last tab so the active one starts off-screen at 390px.
    const last = navTabs[navTabs.length - 1];
    await page.goto(`${BASE_URL}/?${TAB_QUERY_PARAM}=${last.slug}`, { waitUntil: 'domcontentloaded' });
    await subHomeTabsPage.tabs.first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(3000);

    const visible = await page.evaluate(() => {
      const active = [...document.querySelectorAll('[role="tab"]')].find(
        (t) => t.getAttribute('aria-selected') === 'true'
      );
      if (!active) return null;
      const list = document.querySelector('[role="tablist"]');
      const a = active.getBoundingClientRect();
      const l = list.getBoundingClientRect();
      return { label: (active.innerText || '').trim().split('\n')[0], left: Math.round(a.left - l.left), width: Math.round(a.width), stripWidth: Math.round(l.width) };
    });
    console.log(`active tab on load: ${JSON.stringify(visible)}`);

    expect(visible, 'no tab is active after a deep link').toBeTruthy();
    expect(visible.left, 'the active tab starts off the left edge of the strip').toBeGreaterThanOrEqual(-1);
    expect(
      visible.left + visible.width,
      'the active tab is off the right edge — the strip did not scroll it into view'
    ).toBeLessThanOrEqual(visible.stripWidth + 1);
  });

  test('TCB-042: long labels wrap to at most two lines and keep the underlines aligned', async ({
    subHomeTabsPage,
  }) => {
    await subHomeTabsPage.useViewport('mobile');
    await subHomeTabsPage.open('/');

    const rows = await subHomeTabsPage.page.evaluate(() => {
      const tiles = [...document.querySelectorAll('[role="tab"]')];
      return tiles.map((t) => {
        const caption = [...t.querySelectorAll('p,span,div')].find((n) => (n.innerText || '').trim());
        const cs = caption ? getComputedStyle(caption) : null;
        const lineHeight = cs ? parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2 : 0;
        const lines = caption ? Math.round(caption.getBoundingClientRect().height / lineHeight) : 0;
        return {
          label: (t.innerText || '').trim().split('\n')[0],
          lines,
          bottom: Math.round(t.getBoundingClientRect().bottom),
        };
      });
    });
    console.log(rows.map((r) => `${r.label}:${r.lines}ln`).join(' · '));

    const tooTall = rows.filter((r) => r.lines > 2).map((r) => `${r.label} wraps to ${r.lines} lines`);
    expect(tooTall, 'a label wraps past two lines').toEqual([]);

    const baselines = [...new Set(rows.map((r) => r.bottom))];
    expect(
      baselines.length,
      `tab baselines do not line up: ${rows.map((r) => `${r.label}@${r.bottom}`).join(', ')}`
    ).toBe(1);
  });

  test('TCB-043: crossing the 900px breakpoint switches cleanly', async ({ subHomeTabsPage, page }) => {
    await subHomeTabsPage.useViewport('desktop');
    await subHomeTabsPage.open('/');
    const wide = await subHomeTabsPage.measure();

    await page.setViewportSize({ width: 880, height: 900 });
    await page.waitForTimeout(1200);
    const narrow = await subHomeTabsPage.measure();

    await page.setViewportSize(DESIGN.desktop.viewport);
    await page.waitForTimeout(1200);
    const backWide = await subHomeTabsPage.measure();

    console.log(
      `tile width: 1440px→${wide.tile.w} · 880px→${narrow.tile.w} · back to 1440px→${backWide.tile.w}`
    );
    expect(narrow.tile.w, 'the strip did not switch to its mobile sizing below 900px').toBe(DESIGN.mobile.tile);
    expect(backWide.tile.w, 'the strip did not return to desktop sizing').toBe(wide.tile.w);
  });

  // ---- Accessibility (TCB-044..047) -----------------------------------

  test('TCB-044 / TCB-045: roles, accessible name and aria-selected', async ({ subHomeTabsPage }) => {
    test.skip(navTabs.length < 2, 'need two tabs to watch aria-selected move');
    await subHomeTabsPage.useViewport('desktop');
    await subHomeTabsPage.open('/');

    await expect(subHomeTabsPage.tabList, 'the strip does not expose role=tablist').toHaveCount(1);
    await expect(
      subHomeTabsPage.tabList,
      'the tablist has no accessible name'
    ).toHaveAttribute('aria-label', TABLIST_LABEL);
    await expect(subHomeTabsPage.tabs, 'not every tile exposes role=tab').toHaveCount(navTabs.length);

    const selectedBefore = await subHomeTabsPage.activeLabels();
    await subHomeTabsPage.select(navTabs[1].name);
    const selectedAfter = await subHomeTabsPage.activeLabels();

    expect(selectedBefore.length, 'more than one tab was aria-selected before the switch').toBe(1);
    expect(selectedAfter.length, 'more than one tab is aria-selected after the switch').toBe(1);
    expect(selectedAfter[0], 'aria-selected did not move with the selection').not.toBe(selectedBefore[0]);
  });

  test('TCB-046 / TCB-047: tabs take keyboard focus and Enter and Space select', async ({
    subHomeTabsPage,
    page,
  }) => {
    test.skip(navTabs.length < 3, 'need three tabs to test Enter and Space separately');
    await subHomeTabsPage.useViewport('desktop');
    await subHomeTabsPage.open('/');

    // Reachable by Tab at all — a div with no tabindex would not be.
    let presses = 0;
    for (let i = 1; i <= 30; i++) {
      await page.keyboard.press('Tab');
      const onTab = await page.evaluate(
        () => document.activeElement && document.activeElement.closest('[role="tab"]') !== null
      );
      if (onTab) { presses = i; break; }
    }
    console.log(`a tab tile takes focus after ${presses || 'more than 30'} Tab presses`);
    expect(presses, 'no tab tile is reachable with the keyboard').toBeGreaterThan(0);

    const focusVisible = await page.evaluate(() => {
      const el = document.activeElement.closest('[role="tab"]');
      const cs = getComputedStyle(el);
      return { outline: cs.outlineStyle, outlineWidth: cs.outlineWidth, boxShadow: cs.boxShadow };
    });
    console.log(`focus indicator: ${JSON.stringify(focusVisible)}`);

    for (const [key, tab] of [['Enter', navTabs[1]], [' ', navTabs[2]]]) {
      const pressed = key === ' ' ? 'Space' : key;
      await subHomeTabsPage.tab(tab.name).focus();
      await page.keyboard.press(pressed);

      // Wait for the selection to move rather than pausing a fixed 2.5s: the
      // swap is a client-side fetch, and a slow one read as a dead key.
      const moved = await subHomeTabsPage
        .waitForActive(tab.name, 15000)
        .then(() => true)
        .catch(() => false);
      expect(
        moved,
        `${pressed} did not select ${tab.name} — active is ${(await subHomeTabsPage.activeLabels()).join(', ')}`
      ).toBe(true);
    }

    // Space must not also scroll the page.
    expect(
      await page.evaluate(() => Math.round(window.scrollY)),
      'Space scrolled the page as well as selecting the tab'
    ).toBeLessThan(50);
  });

  // ---- Edge cases (TCB-049..054) --------------------------------------

  test('TCB-049: a tab with no icon_url falls back to a placeholder', async ({ subHomeTabsPage }) => {
    const iconless = navTabs.filter((t) => !t.icon_url);
    test.skip(
      iconless.length === 0,
      'every tab on this page has an icon_url, so the fallback cannot be observed here'
    );

    await subHomeTabsPage.useViewport('desktop');
    await subHomeTabsPage.open('/');
    const m = await subHomeTabsPage.measure();

    expect(m.brokenIcons, 'a tab renders a broken-image glyph instead of a placeholder').toBe(0);
    expect(m.tabsWithoutIcon, 'the icon-less tab rendered nothing in its icon slot').toBe(iconless.length);
  });

  test('TCB-050 / TCB-009 / TCB-010 / TCB-019 / TCB-051 / TCB-054: a page with no tabs renders no strip', async ({
    subHomeTabsPage,
    page,
  }) => {
    // The sheet expects Subscription and EMI Store to carry one tab each
    // ("tejash", "ffrisisi"). On production both carry zero, so what those
    // routes actually promise is TCB-050: no strip, no empty bar, no stray
    // divider, no gap. That is what is asserted, and the missing fixtures are
    // named so nobody reads this as coverage of the single-tab case.
    const routes = ['/home/subscription', '/home/emi-store'];
    for (const route of routes) {
      await page.goto(`${BASE_URL}${route}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3500);

      const state = await page.evaluate(() => {
        const list = document.querySelector('[role="tablist"]');
        const header = document.querySelector('header');
        const firstBlock = [...document.querySelectorAll('body *')].find((el) => {
          const r = el.getBoundingClientRect();
          return r.height > 60 && r.width > 300 && r.top >= header.getBoundingClientRect().bottom;
        });
        return {
          tablists: document.querySelectorAll('[role="tablist"]').length,
          tabs: document.querySelectorAll('[role="tab"]').length,
          listBox: list ? list.getBoundingClientRect().height : null,
          gapUnderHeader: firstBlock
            ? Math.round(
                firstBlock.getBoundingClientRect().top - header.getBoundingClientRect().bottom
              )
            : null,
        };
      });
      console.log(`${route}: ${JSON.stringify(state)}`);

      expect(state.tablists, `${route} renders a tab strip for a page with no tabs`).toBe(0);
      expect(state.tabs, `${route} renders tab tiles for a page with no tabs`).toBe(0);

      // The sheet also says "no blank gap below the header". Reported, not
      // asserted: there is no agreed figure for what these pages' own top
      // spacing should be, and /home/emi-store measures 148px, which is as
      // likely to be its hero padding as a leftover strip slot. Asserting an
      // invented threshold would report a design question as a defect.
      console.log(
        `${route}: ${state.gapUnderHeader}px between the header and the first block — ` +
          'compare against the design if the strip slot is suspected of being reserved'
      );
    }

    console.log(
      'NOT COVERED HERE: TCB-009/010/019/051/054 need a secondary home page that owns tabs. ' +
        'Both Subscription and EMI Store report sub_home_pages: 0 on production, so the ' +
        'single-tab, default-selection-on-a-secondary-route and selection-reset cases stay ' +
        'unverified until one is configured.'
    );
  });

  test('TCB-052: the page survives the nav endpoint failing', async ({ page, subHomeTabsPage }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message).split('\n')[0]));

    await page.route('**/apps/home-page/nav*', (route) => route.abort('failed'));
    await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(6000);

    const body = await page.evaluate(() => document.body.innerText);
    expect(body.length, 'the page rendered nothing when the nav failed').toBeGreaterThan(200);
    expect(body, 'the page crashed client-side when the nav failed').not.toMatch(
      /Application error|client-side exception/i
    );
    expect(errors, 'a nav failure threw an unhandled page error').toEqual([]);

    // Whether the strip survives depends on the serialised payload; either
    // outcome is acceptable to the sheet, so report rather than assert.
    console.log(
      `with the nav blocked the strip rendered ${await subHomeTabsPage.tabs.count()} tab(s) ` +
        'from the server-serialised payload'
    );
  });
});
