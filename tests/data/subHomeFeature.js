// tests/data/subHomeFeature.js
//
// Shared configuration for the Sub Home Page Tabs suite
// (E2E-NAV-*, E2E-SEC-*, E2E-SHP-*, TCB-*).
//
// WHY NOTHING HERE IS A FIXTURE NAME.
// The source sheet was written against a developer machine — base URL
// http://localhost:6009, Home carrying tabs "Laptop" and "5G Phones",
// Subscription carrying "tejash", EMI Store carrying "ffrisisi". None of that
// exists on production. Measured 19 Aug 2026:
//
//   Home          8 tabs: For You, Mobile, Electronics, Audio, Accessories,
//                 Luggage, Wearables, Appliances   (sequence 1..7, then 9)
//   Subscription  0 tabs
//   EMI Store     0 tabs
//
// So every spec reads the live nav and asserts the UI against THAT, never
// against a hardcoded label. A tab renamed in the CMS must not fail the suite;
// a tab the UI renders that the API never sent must.

const PUBLIC_API = 'https://www.bytepe.com/api/product-service';

// GET → { status, message, data: [ { id, name, slug, sequence, sub_home_pages[] } ] }
const navPath = (pageType) =>
  `${PUBLIC_API}/apps/home-page/nav${pageType ? `?page_type=${pageType}` : ''}`;

// GET → { status, message, data: { home_page_id, sections[], eager[] } }
function sectionsPath(params = {}) {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  return `${PUBLIC_API}/apps/home-page/sections${qs ? `?${qs}` : ''}`;
}

// The storefront reflects the selected tab in the query string. Measured: the
// path never changes, only this param, and it is applied on load as a deep link.
const TAB_QUERY_PARAM = 'sub_home_page';

// Design spec from the sheet (TCB-006 / TCB-007), confirmed against the live
// strip on 19 Aug 2026 at both widths — every number below was measured, not
// copied. They are asserted exactly because they were exact.
const DESIGN = {
  desktop: { viewport: { width: 1440, height: 900 }, tile: 110, icon: 44, label: 15, underline: 3, gap: 24 },
  mobile:  { viewport: { width: 390,  height: 844 }, tile: 68,  icon: 28, label: 10, underline: 2, gap: 8 },
};

// The active underline colour, measured on both widths.
const ACTIVE_UNDERLINE_RGB = 'rgb(255, 67, 6)';

// The strip's own accessible name, set by the site.
const TABLIST_LABEL = 'Home page categories';

// ---- Admin API (E2E-SHP-*) --------------------------------------------
//
// Not configured here on purpose. These endpoints create, edit and delete the
// tabs a shopper sees, so they need an explicit host as well as a token:
//
//   setx BYTEPE_SUBHOME_ADMIN_URL "http://localhost:6009/v1/product-service"
//   setx BYTEPE_ADMIN_JWT         "<admin jwt>"
//   set  BYTEPE_ALLOW_WRITES=1
//
// The sheet's own base URL is a developer machine. Pointing these at
// www.bytepe.com would rewrite the live Home strip, so productionGuard() below
// refuses that outright — a missing token is a skip, but a production host is
// an error, because it means someone meant to do it.
const adminApi = {
  baseUrl: process.env.BYTEPE_SUBHOME_ADMIN_URL || '',
  token: process.env.BYTEPE_ADMIN_JWT || '',
  writesAllowed: process.env.BYTEPE_ALLOW_WRITES === '1',
  homePageId: process.env.BYTEPE_TEST_HOME_PAGE_ID || '',
  otherHomePageId: process.env.BYTEPE_TEST_HOME_PAGE_ID_ALT || '',
};

const adminConfigured = () => Boolean(adminApi.baseUrl && adminApi.token);

const ADMIN_SKIP_REASON =
  'BYTEPE_SUBHOME_ADMIN_URL / BYTEPE_ADMIN_JWT are not set — the sub home page admin API is not reachable';
const WRITE_SKIP_REASON =
  'Creates or deletes real tabs on a live home page. Set BYTEPE_ALLOW_WRITES=1 to run deliberately.';
const NO_HOME_PAGE_REASON =
  'Set BYTEPE_TEST_HOME_PAGE_ID to a home page that is safe to add and remove tabs on';
const NO_SECOND_PAGE_REASON =
  'Set BYTEPE_TEST_HOME_PAGE_ID_ALT to a second home page, for the cross-parent ownership cases';

function productionGuard() {
  if (/(^|\/\/)(www\.)?bytepe\.com/i.test(adminApi.baseUrl)) {
    throw new Error(
      `BYTEPE_SUBHOME_ADMIN_URL points at production (${adminApi.baseUrl}). ` +
        'These cases create and delete tabs on a live home page — the strip every ' +
        'shopper sees. Point them at a dev or staging product-service instead.'
    );
  }
}

// ---- Shared readers ---------------------------------------------------

const unwrap = (body) => (body && body.data !== undefined ? body.data : body);

const tabsOf = (homePage) =>
  Array.isArray(homePage && homePage.sub_home_pages) ? homePage.sub_home_pages : [];

// Display order the app must follow: sequence ascending, then name.
// E2E-NAV-04 and TCB-011 both hang off this, so it lives in one place.
const inDisplayOrder = (tabs) =>
  [...tabs].sort((a, b) =>
    a.sequence === b.sequence
      ? String(a.name).localeCompare(String(b.name))
      : Number(a.sequence) - Number(b.sequence)
  );

// The one home page that actually carries tabs. Returns null rather than
// throwing so a caller can skip with a reason instead of erroring.
function pageWithTabs(navData) {
  return (navData || []).find((p) => tabsOf(p).length > 0) || null;
}

module.exports = {
  PUBLIC_API,
  navPath,
  sectionsPath,
  TAB_QUERY_PARAM,
  DESIGN,
  ACTIVE_UNDERLINE_RGB,
  TABLIST_LABEL,
  adminApi,
  adminConfigured,
  productionGuard,
  ADMIN_SKIP_REASON,
  WRITE_SKIP_REASON,
  NO_HOME_PAGE_REASON,
  NO_SECOND_PAGE_REASON,
  unwrap,
  tabsOf,
  inDisplayOrder,
  pageWithTabs,
};
