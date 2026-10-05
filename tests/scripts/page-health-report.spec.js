const fs = require('fs');
const path = require('path');
const { test } = require('../fixtures/pageFixtures');
const { BASE_URL } = require('../data/constants');

// FULL PAGE HEALTH SWEEP -> page-health.json, rendered to HTML by
// scripts/build-page-report.js
//
// Renders every page in a real browser and records what a shopper would see:
// HTTP status, whether the route resolved or fell through to the 404 shell, how
// much text rendered, broken images, console errors, failed same-origin
// requests, and any loader still on screen IN THE VIEWPORT once the page
// settles.
//
// Loaders are counted two ways on purpose. Skeletons sitting below the fold are
// lazy loading working correctly -- measured 20 Aug 2026, the homepage holds 272
// of them and every one resolves when scrolled to. Only a loader in the viewport
// at rest means a shopper is looking at a spinner, so only that one is a problem.
//
// Logged out on purpose: this is the first-visit experience, and it keeps the
// sweep free of account state.
//
// The product-page count is capped and REPORTED, never silently truncated.
// Override with BYTEPE_PDP_SAMPLE (0 = every product in tests/data/products.json).

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ retries: 0 });

const STATIC_PAGES = [
  ['Home', '/'],
  ['About Us', '/about-us'],
  ['Subscription', '/home/subscription'],
  ['EMI Store', '/home/emi-store'],
  ['Products (PLP)', '/all-products'],
  ['Cart', '/cart'],
  ['Privacy Policy', '/privacy-policy'],
  ['Terms of Use', '/terms-of-use'],
  ['FAQ', '/faq'],
  ['Shipping Policy', '/shipping-policy'],
  ['Payment Policy', '/payment-policy'],
  ['Order Cancellation & Return', '/cancellation-and-return'],
  ['Grievance Redressal', '/grievance-redressal'],
];

const SAMPLE =
  process.env.BYTEPE_PDP_SAMPLE === undefined ? 20 : Number(process.env.BYTEPE_PDP_SAMPLE);

const OUT = path.join(__dirname, '..', '..', 'page-health.json');

// The 404 shell: CLAUDE.md records that a dead product URL answers HTTP 200 with
// a "404 This page could not be found." body and no redirect. A status check
// alone therefore cannot tell a live page from a dead one.
const NOT_FOUND_RE = /this page could not be found/i;

async function inspect(page, name, url, group) {
  const consoleErrors = [];
  const failed = [];
  const siteHost = new URL(BASE_URL).host;

  const onConsole = (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 180));
  };
  const onFailed = (r) => {
    const err = r.failure() ? r.failure().errorText : 'request failed';
    failed.push(`${err} ${r.url().slice(0, 110)}`);
  };
  const onResponse = (r) => {
    if (r.status() < 400) return;
    let host = '';
    try {
      host = new URL(r.url()).host;
    } catch {
      return;
    }
    if (host === siteHost) {
      failed.push(`HTTP ${r.status()} ${r.url().replace(BASE_URL, '').slice(0, 110)}`);
    }
  };

  page.on('console', onConsole);
  page.on('requestfailed', onFailed);
  page.on('response', onResponse);

  const started = Date.now();
  let status = null;
  let navError = null;
  try {
    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    status = res ? res.status() : null;
  } catch (err) {
    navError = String(err.message).split('\n')[0].slice(0, 160);
  }
  await page.waitForTimeout(3500);
  const ms = Date.now() - started;

  let m = {};
  if (!navError) {
    m = await page.evaluate(() => {
      const isVisible = (el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
      };
      const inViewport = (el) => {
        const r = el.getBoundingClientRect();
        return r.bottom > 0 && r.top < window.innerHeight;
      };
      const loaderSel =
        '.MuiCircularProgress-root,.MuiSkeleton-root,.MuiLinearProgress-root,[role="progressbar"]';
      const loaders = [...document.querySelectorAll(loaderSel)].filter(isVisible);
      const imgs = [...document.querySelectorAll('img')];
      const h1 = document.querySelector('h1');
      return {
        title: document.title,
        h1: h1 ? h1.innerText.trim().slice(0, 90) : '',
        text: document.body.innerText.trim().length,
        images: imgs.length,
        brokenImages: imgs
          .filter((i) => i.complete && i.naturalWidth === 0)
          .map((i) => (i.currentSrc || i.src || '(no src)').slice(0, 110)),
        loadersInViewport: loaders.filter(inViewport).length,
        loadersTotal: loaders.length,
        links: document.querySelectorAll('a[href]').length,
        bodySnippet: document.body.innerText.trim().replace(/\s+/g, ' ').slice(0, 200),
      };
    });
  }

  page.off('console', onConsole);
  page.off('requestfailed', onFailed);
  page.off('response', onResponse);

  const notFoundShell = !navError && NOT_FOUND_RE.test(m.bodySnippet || '');

  const problems = [];
  if (navError) problems.push(`navigation failed: ${navError}`);
  if (status && status >= 400) problems.push(`HTTP ${status}`);
  if (notFoundShell) problems.push('renders the 404 shell despite its HTTP status');
  if (!navError && (m.text || 0) < 200) problems.push(`only ${m.text} chars of text rendered`);
  if ((m.brokenImages || []).length) problems.push(`${m.brokenImages.length} broken image(s)`);
  if (m.loadersInViewport) problems.push(`${m.loadersInViewport} loader(s) still on screen`);

  return Object.assign(
    { group, name, url: url.replace(BASE_URL, '') || '/', status, ms, navError, notFoundShell },
    m,
    {
      consoleErrors: [...new Set(consoleErrors)],
      failedRequests: [...new Set(failed)],
      problems,
      ok: problems.length === 0,
    }
  );
}

test('sweep every page and write page-health.json', async ({ page }) => {
  test.setTimeout(45 * 60 * 1000);

  const rows = [];

  for (const [name, p] of STATIC_PAGES) {
    rows.push(await inspect(page, name, BASE_URL + p, 'Site pages'));
  }

  // Sub-home tab views, read from the live nav so the list cannot drift.
  let tabs = [];
  try {
    const res = await page.request.get(`${BASE_URL}/api/home-page-service/apps/home-pages`);
    if (res.ok()) {
      const body = await res.json();
      const d = body.data;
      const pages = (d && (d.items || d.home_pages)) || d || [];
      tabs = (Array.isArray(pages) ? pages : [])
        .flatMap((hp) => hp.tabs || [])
        .map((t) => t.slug || t.name)
        .filter(Boolean)
        .slice(0, 10);
    }
  } catch {
    // The nav endpoint is optional here; its own suite covers it properly.
  }
  for (const t of tabs) {
    rows.push(
      await inspect(
        page,
        `Tab: ${t}`,
        `${BASE_URL}/?sub_home_page=${encodeURIComponent(t)}`,
        'Sub-home tabs'
      )
    );
  }

  // Product pages.
  const catalogue = require('../data/products.json');
  const all = Array.isArray(catalogue) ? catalogue : catalogue.products || [];
  const chosen = SAMPLE === 0 ? all : all.slice(0, SAMPLE);
  for (const prod of chosen) {
    const u = prod.url.startsWith('http') ? prod.url : BASE_URL + prod.url;
    rows.push(await inspect(page, prod.name, u, 'Product pages'));
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    session: 'logged out (empty storageState)',
    productsInFixture: all.length,
    productsChecked: chosen.length,
    productsSkipped: all.length - chosen.length,
    total: rows.length,
    ok: rows.filter((r) => r.ok).length,
    withProblems: rows.filter((r) => !r.ok).length,
  };
  fs.writeFileSync(OUT, JSON.stringify({ summary, rows }, null, 1));

  console.log(`\n${summary.ok}/${summary.total} pages clean`);
  if (summary.productsSkipped > 0) {
    console.log(
      `NOTE: ${summary.productsChecked} of ${summary.productsInFixture} product pages rendered ` +
        `(BYTEPE_PDP_SAMPLE=${SAMPLE}). ${summary.productsSkipped} NOT checked.`
    );
  }
  for (const r of rows.filter((x) => !x.ok)) {
    console.log(`  ${r.name} (${r.url}) -> ${r.problems.join('; ')}`);
  }
  console.log(`\nwrote ${OUT}`);
});
