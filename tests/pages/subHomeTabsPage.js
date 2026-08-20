// tests/pages/subHomeTabsPage.js
//
// The Sub Home Page tab strip — the category row under the header on /.
// Backs TCB-001..TCB-054.
//
// LOCATOR CHOICE, and why not the obvious alternatives.
//
//   role=tablist / role=tab   <- used here
//     The site sets both, plus aria-selected and aria-label="Home page
//     categories". Verified live 19 Aug 2026. ARIA is the only thing on this
//     strip that is authored rather than generated.
//
//   .mui-* class names        <- rejected
//     Build-hashed. The strip's own container is div.MuiBox-root.mui-1kfg1nu
//     today and something else after the next deploy. CLAUDE.md already
//     records this trap for the plan box.
//
//   text / alt = "Mobile"     <- rejected as an anchor
//     Those are CMS values. The tabs were nine lowercase names in the previous
//     design and are eight Title-Case ones now; a spec anchored on the label
//     fails on a rename that harms nobody. Labels are still ASSERTED — against
//     the live nav response, which is the thing that must agree with them.
//
// One caveat the strip forces on every caller: the tiles are <div role="tab">,
// not <button>, so .click() works but there is no implicit form semantics, and
// getByRole('tab') is the only stable handle.

const { BasePage } = require('./basePage');
const { BASE_URL } = require('../data/constants');
const { DESIGN, TAB_QUERY_PARAM } = require('../data/subHomeFeature');

class SubHomeTabsPage extends BasePage {
  constructor(page) {
    super(page);

    this.tabList = page.getByRole('tablist').first();
    this.tabs = page.getByRole('tab');
    this.header = page.locator('header').first();
  }

  tab(name) {
    // Anchored at the start of the label: the accessible name of a tile is its
    // icon alt plus its caption, so "Mobile" arrives as "Mobile Mobile".
    return this.page.getByRole('tab', { name: new RegExp(`^${name}\\b`, 'i') }).first();
  }

  async open(path = '/') {
    await this.page.goto(`${BASE_URL}${path}`, { waitUntil: 'domcontentloaded' });
    // The strip renders from the serialised nav payload, ahead of the sections.
    await this.tabs.first().waitFor({ state: 'visible', timeout: 20000 });
  }

  async useViewport(which) {
    await this.page.setViewportSize(DESIGN[which].viewport);
  }

  async labels() {
    return this.tabs.evaluateAll((els) =>
      els.map((el) => (el.innerText || '').trim().split('\n')[0])
    );
  }

  async activeLabels() {
    return this.tabs.evaluateAll((els) =>
      els
        .filter((el) => el.getAttribute('aria-selected') === 'true')
        .map((el) => (el.innerText || '').trim().split('\n')[0])
    );
  }

  // Everything TCB-002..007, 031..034 and 037..043 needs, in one round trip.
  // Reading it in a single evaluate keeps the numbers from a single layout —
  // two separate reads can straddle a re-render and disagree with each other.
  async measure() {
    // The active underline mounts AFTER the tabs do.
    //
    // Measured 20 Aug 2026 (scripts/probe-tab-underline-timing.spec.js), from
    // the moment open() returns — i.e. first tab visible:
    //
    //   t=  0ms  rowChildren=8  bars=0
    //   t=250ms  rowChildren=8  bars=0
    //   t=500ms  rowChildren=9  bars=1   <- indicator appears
    //
    // open() waits only for the first tab, so measure() read the row while the
    // indicator still had not rendered and reported it as absent. That is a race
    // in this page object, not a missing feature.
    //
    // Waiting for the element rather than sleeping a fixed amount: this is the
    // real signal, it returns as soon as the bar is there, and it deliberately
    // does NOT throw on timeout — if the indicator genuinely never renders,
    // underline stays null and the caller's assertion reports that as the
    // defect it would be, instead of this helper masking it.
    await this.page
      .waitForFunction(
        () => {
          const tiles = [...document.querySelectorAll('[role="tab"]')];
          const active = tiles.find((t) => t.getAttribute('aria-selected') === 'true');
          if (!active || !active.parentElement) return false;
          return [...active.parentElement.children]
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

    return this.page.evaluate(() => {
      const round = (n) => Math.round(n);
      const box = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { w: round(r.width), h: round(r.height), x: round(r.left), y: round(r.top), bottom: round(r.bottom) };
      };

      const list = document.querySelector('[role="tablist"]');
      const tiles = [...document.querySelectorAll('[role="tab"]')];
      const header = document.querySelector('header');
      const first = tiles[0];
      const img = first && first.querySelector('img');
      const caption =
        first && [...first.querySelectorAll('p,span,div')].find((n) => (n.innerText || '').trim());
      const active = tiles.find((t) => t.getAttribute('aria-selected') === 'true');

      // The active underline is a SIBLING of the tabs, not a descendant.
      //
      // Measured 20 Aug 2026 (scripts/probe-tab-underline.spec.js). Two boxes of
      // identical size sit at identical coordinates under the active tab:
      //
      //   div.mui-1kjjyxg  104x3 @262,153  bg rgba(0,0,0,0)   <- INSIDE the tab
      //   div.mui-6djk2t   104x3 @262,153  bg rgb(255,67,6)   <- sibling, the real one
      //
      // The one inside the tab is a transparent spacer reserving the indicator's
      // height. This used to search active.querySelectorAll('*'), so it could
      // only ever find that spacer, and reported the underline as transparent —
      // failing TCB-016/018/020 against a feature that renders correctly.
      //
      // So search the TABLIST ROW instead, and exclude the tabs' own subtrees.
      // Confirmed it is the indicator and not decoration: selecting a different
      // tab moves it (x 262 -> 610, tracking the tab exactly).
      //
      // Position is reported alongside the colour on purpose. A brand-coloured
      // bar under the WRONG tab is a real defect that a colour-only check would
      // pass, so the caller can assert alignment as well.
      const row = active ? active.parentElement : null;
      const underline = row
        ? [...row.children]
            // A tab is not its own indicator; the bar is a plain box beside them.
            .filter((n) => !tiles.includes(n))
            .map((n) => ({ n, r: n.getBoundingClientRect() }))
            .filter((o) => o.r.height > 0 && o.r.height <= 6 && o.r.width > 20)
            .map((o) => {
              const ar = active.getBoundingClientRect();
              return {
                h: round(o.r.height),
                w: round(o.r.width),
                x: round(o.r.left),
                bg: getComputedStyle(o.n).backgroundColor,
                // Alignment against the active tab, so "is it under the right
                // tab" is answerable without a second query.
                activeX: round(ar.left),
                activeW: round(ar.width),
                alignedToActive: Math.abs(o.r.left - ar.left) <= 4,
                widthMatchesActive: Math.abs(o.r.width - ar.width) <= 4,
              };
            })[0] || null
        : null;

      // The sticky container is the tablist's parent, not the tablist itself.
      const sticky = list && list.parentElement ? getComputedStyle(list.parentElement) : null;

      return {
        tabCount: tiles.length,
        list: box(list),
        header: box(header),
        headerZIndex: header ? getComputedStyle(header).zIndex : null,
        sticky: sticky
          ? {
              position: sticky.position,
              top: sticky.top,
              zIndex: sticky.zIndex,
              background: sticky.backgroundColor,
              borderBottom: sticky.borderBottom,
            }
          : null,
        overflowX: list ? getComputedStyle(list).overflowX : null,
        justifyContent: list ? getComputedStyle(list).justifyContent : null,
        gap: tiles.length > 1
          ? round(tiles[1].getBoundingClientRect().left - tiles[0].getBoundingClientRect().right)
          : null,
        tile: box(first),
        icon: box(img),
        iconAlt: img ? img.alt : null,
        label: caption ? caption.innerText.trim() : null,
        labelFontSize: caption ? getComputedStyle(caption).fontSize : null,
        underline,
        scrollWidth: list ? list.scrollWidth : null,
        clientWidth: list ? list.clientWidth : null,
        bodyScrollWidth: document.body.scrollWidth,
        bodyClientWidth: document.body.clientWidth,
        tabsWithoutIcon: tiles.filter((t) => !t.querySelector('img')).length,
        brokenIcons: [...document.querySelectorAll('[role="tab"] img')].filter(
          (i) => i.complete && i.naturalWidth === 0
        ).length,
      };
    });
  }

  // The sections arrive after the strip does, so a body-text snapshot taken
  // straight after open() catches a half-rendered page and then differs from
  // itself on the next read. Wait until the text stops growing before
  // capturing a baseline. Two equal reads in a row, not one: a single quiet
  // moment happens mid-render.
  async settle(timeoutMs = 15000) {
    await this.page.waitForLoadState('load').catch(() => {});
    const deadline = Date.now() + timeoutMs;
    let previous = -1;
    let stable = 0;
    while (Date.now() < deadline) {
      const length = await this.page.evaluate(() => document.body.innerText.length);
      stable = length === previous ? stable + 1 : 0;
      if (stable >= 2) return length;
      previous = length;
      await this.page.waitForTimeout(700);
    }
    return previous;
  }

  // TCB-023: the selected tab is reflected in the query string, not the path.
  selectedFromUrl() {
    return new URL(this.page.url()).searchParams.get(TAB_QUERY_PARAM);
  }

  pathOf() {
    return new URL(this.page.url()).pathname;
  }

  // A tab click is a client-side swap. There is no navigation to wait for, so
  // wait on the thing that actually changes: the active tile.
  //
  // waitForFunction rather than locator.and(): intersecting a .first() with an
  // [aria-selected="true"] locator resolved intermittently — the attribute and
  // the re-render do not land in the same frame — and produced a 15s timeout on
  // a strip that had in fact switched. Reading the attribute in the page is
  // unambiguous.
  async select(name) {
    await this.tab(name).click();
    await this.waitForActive(name);
  }

  async waitForActive(name, timeout = 15000) {
    await this.page.waitForFunction(
      (label) => {
        const tile = [...document.querySelectorAll('[role="tab"]')].find((el) =>
          (el.innerText || '').trim().toLowerCase().startsWith(label)
        );
        return Boolean(tile && tile.getAttribute('aria-selected') === 'true');
      },
      name.toLowerCase(),
      { timeout }
    );
  }

  // Turns "the strip did not do what the sheet says" into a report naming what
  // it did instead. Called only on a failure path.
  async diagnose(what) {
    const m = await this.measure().catch(() => null);
    if (!m) return `${what} — and the strip could not be measured at all.`;
    return (
      `${what}\n` +
      `  tabs rendered   : ${m.tabCount} (${(await this.labels()).join(', ')})\n` +
      `  active          : ${(await this.activeLabels()).join(', ') || 'none'}\n` +
      `  url             : ${this.page.url()}\n` +
      `  strip           : ${JSON.stringify(m.list)} sticky=${JSON.stringify(m.sticky)}\n` +
      `  tile / icon     : ${JSON.stringify(m.tile)} / ${JSON.stringify(m.icon)}`
    );
  }
}

module.exports = { SubHomeTabsPage };
