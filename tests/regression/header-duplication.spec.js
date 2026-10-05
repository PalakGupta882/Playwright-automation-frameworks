// tests/regression/header-duplication.spec.js
//
// The site header must render once per page.
//
// OPEN DEFECT, found 16 Sep 2026. This test asserts the CORRECT behaviour and
// fails until the duplication is fixed — it does not encode the bug as expected.
//
// WHAT WAS MEASURED. On the three Sub Home routes the app shell renders the
// MuiAppBar header TWICE:
//
//   route                  <header>  <nav>  header buttons
//   /                          2       2         12
//   /home/subscription         2       2         12
//   /home/emi-store            2       2         12
//   /all-products              1       0          5
//   /about-us                  1       1          6
//   /pd/<slug>/<bpid>          1       0          5
//
// Both copies are real: same parent, position:fixed, z-index 1100, identical
// 0,0 1280x77 rects, identical text ("Home Subscription EMI Store Products
// About Us Cart Login"), neither aria-hidden, neither inert, both
// pointer-events:auto. The accessibility tree exposes 2 banner landmarks and
// 2 navigation landmarks.
//
// WHY IT MATTERS. Visually the two stack exactly, so a sighted shopper sees one
// header and their click lands on the copy on top. The cost falls on assistive
// technology: a screen-reader user meets the entire primary navigation twice and
// has two indistinguishable "banner" landmarks to choose between.
//
// WHAT IT ALREADY COST. It broke `npm run auth` outright. The page object took
// `getByText('Login').filter({visible:true}).first()`, which resolves the copy
// UNDERNEATH, and every click on it was swallowed by its own twin —
// Playwright reporting `<span>Login</span> ... subtree intercepts pointer
// events`, an element the screenshot plainly shows. `force: true` did not help:
// it skips the actionability check, not the browser's hit-testing, so the click
// still landed on the copy above. The fix was `.last()` in
// tests/pages/homepage.js, and that workaround stays correct either way — with
// the duplication gone there is only one match.
//
// Scoped to the Sub Home routes because that is where it reproduces, but the
// assertion is written for every route in the list so a regression that spreads
// to the PDP or the listing is caught by the same file.
//
// Public and logged out: the header renders for everyone, and nothing here
// depends on a session.

const { test, expect } = require('../fixtures/pageFixtures');
const { BASE_URL } = require('../data/constants');

test.use({ storageState: { cookies: [], origins: [] } });

// Retrying would re-roll a render-count read and could report a flaky pass.
test.describe.configure({ retries: 0 });

const ROUTES = [
  { path: '/', label: 'home (Sub Home)' },
  { path: '/home/subscription', label: 'subscription (Sub Home)' },
  { path: '/home/emi-store', label: 'EMI store (Sub Home)' },
  { path: '/all-products', label: 'listing' },
  { path: '/about-us', label: 'about us' },
];

test.describe('Header duplication', () => {
  test('every route renders exactly one header and one primary nav', async ({ page }) => {
    test.setTimeout(300000);

    const report = [];

    for (const route of ROUTES) {
      await page.goto(`${BASE_URL}${route.path}`, { waitUntil: 'domcontentloaded' });

      // Wait for the header to exist before counting. The shell paints before
      // it hydrates, and counting early would see zero headers everywhere and
      // call that a pass.
      await page
        .locator('header')
        .first()
        .waitFor({ state: 'visible', timeout: 45000 });
      // The second copy arrives with hydration, a beat after the first.
      await page.waitForTimeout(3000);

      // Count only headers a user or a screen reader can actually reach.
      // A copy that is display:none, aria-hidden or inert is not the defect.
      const live = await page.evaluate(() =>
        Array.from(document.querySelectorAll('header')).filter((h) => {
          if (h.hasAttribute('inert') || h.getAttribute('aria-hidden') === 'true') return false;
          const s = getComputedStyle(h);
          if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') return false;
          return h.getBoundingClientRect().width > 0;
        }).length
      );

      const snapshot = await page.locator('body').ariaSnapshot();
      const banners = (snapshot.match(/^\s*- banner/gm) || []).length;

      report.push({ route: route.label, path: route.path, headers: live, banners });
    }

    // NON-VACUOUS. Every route must have rendered a header at all — otherwise
    // "not more than one" would pass on a page that failed to load.
    const missing = report.filter((r) => r.headers === 0);
    expect(
      missing.map((r) => `${r.route} (${r.path}) rendered no header at all`),
      'a route rendered no header, so the duplication check below would pass vacuously'
    ).toEqual([]);

    const duplicated = report
      .filter((r) => r.headers > 1 || r.banners > 1)
      .map(
        (r) =>
          `${r.route} (${r.path}): ${r.headers} live <header> elements, ${r.banners} banner landmarks`
      );

    expect(
      duplicated,
      'The site header is rendered more than once. The copies stack exactly, so this is ' +
        'invisible to a sighted shopper, but the accessibility tree carries the whole primary ' +
        'navigation twice and every header control has an unreachable twin underneath it — ' +
        'which is what broke npm run auth (see the header of this file).'
    ).toEqual([]);
  });
});
