const { test } = require('../fixtures/pageFixtures');
const { BASE_URL } = require('../data/constants');

// Read-only diagnostic. Visits the main public surfaces and reports, per page:
// spinners/skeletons still on screen after the network settles, broken images,
// console errors, and failed requests. No login, no writes.
//
// Loaders are not covered by any spec today, so this measures before asserting.

const PAGES = [
  ['home', '/'],
  ['all-products', '/all-products'],
  ['subscription', '/home/subscription'],
  ['emi-store', '/home/emi-store'],
  ['about-us', '/about-us'],
];

async function runProbe(page, test, label) {
  test.setTimeout(300000);

  const report = [];

  for (const [name, path] of PAGES) {
    const consoleErrors = [];
    const failedRequests = [];
    const onConsole = (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200));
    };
    const onFailed = (r) => failedRequests.push(`${r.failure()?.errorText} ${r.url().slice(0, 120)}`);
    const onResponse = (r) => {
      if (r.status() >= 400) failedRequests.push(`HTTP ${r.status()} ${r.url().slice(0, 120)}`);
    };
    page.on('console', onConsole);
    page.on('requestfailed', onFailed);
    page.on('response', onResponse);

    // Settle by hand rather than waitForLoadState('networkidle'): the lint
    // config bans it, and counting in-flight requests also tells us WHICH
    // request never finished, which is the interesting half for a loader bug.
    let inflight = 0;
    let lastActivity = 0;
    const bump = () => { lastActivity = tick; };
    const onReq = () => { inflight++; bump(); };
    const onDone = () => { inflight--; bump(); };
    page.on('request', onReq);
    page.on('requestfinished', onDone);
    page.on('requestfailed', onDone);

    let tick = 0;
    await page.goto(BASE_URL + path, { waitUntil: 'domcontentloaded' });

    // Quiet period: 2s with no request start/finish, or give up at 30s.
    let settled = false;
    for (tick = 0; tick < 60; tick++) {
      await page.waitForTimeout(500);
      if (tick - lastActivity >= 4 && inflight <= 0) { settled = true; break; }
    }
    page.off('request', onReq);
    page.off('requestfinished', onDone);
    page.off('requestfailed', onDone);

    const settleNote = settled
      ? null
      : `network NEVER went quiet in 30s (${inflight} request(s) still in flight)`;

    // Give any post-settle render a beat, then look for loaders that survived it.
    await page.waitForTimeout(3000);

    const state = await page.evaluate(() => {
      const vis = (el) => {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
      };
      const sel = '.MuiCircularProgress-root,.MuiSkeleton-root,.MuiLinearProgress-root,' +
        '[class*="loader" i],[class*="spinner" i],[class*="skeleton" i],[role="progressbar"]';
      const loaders = [...document.querySelectorAll(sel)].filter(vis).map((el) => ({
        cls: (el.className || '').toString().slice(0, 70),
        role: el.getAttribute('role'),
        rect: (() => { const r = el.getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)}`; })(),
      }));

      const imgs = [...document.querySelectorAll('img')];
      const broken = imgs
        .filter((i) => i.complete && i.naturalWidth === 0)
        .map((i) => (i.currentSrc || i.src || '(no src)').slice(0, 120));

      return {
        loaders,
        imgTotal: imgs.length,
        broken,
        bodyChars: document.body.innerText.trim().length,
      };
    });

    report.push({ name, path, note: settleNote, ...state, consoleErrors, failedRequests });

    page.off('console', onConsole);
    page.off('requestfailed', onFailed);
    page.off('response', onResponse);
  }

  console.log('\n================ LOADER / RENDER PROBE ================');
  for (const r of report) {
    console.log(`\n--- ${r.name}  (${r.path})`);
    if (r.note) console.log(`    NOTE: ${r.note}`);
    if (r.bodyChars !== undefined) console.log(`    body text chars: ${r.bodyChars}`);
    if (r.loaders) {
      console.log(`    loaders still visible after settle: ${r.loaders.length}`);
      const byCls = new Map();
      for (const l of r.loaders) {
        const k = `${l.rect} ${l.cls}`;
        byCls.set(k, (byCls.get(k) || 0) + 1);
      }
      for (const [k, n] of [...byCls.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
        console.log(`      - x${n}  ${k}`);
      }
    }
    if (r.broken) {
      console.log(`    images: ${r.imgTotal}, broken: ${r.broken.length}`);
      for (const b of r.broken.slice(0, 12)) console.log(`      - ${b}`);
    }
    if (r.consoleErrors && r.consoleErrors.length) {
      console.log(`    console errors: ${r.consoleErrors.length}`);
      for (const e of [...new Set(r.consoleErrors)].slice(0, 8)) console.log(`      - ${e}`);
    }
    if (r.failedRequests && r.failedRequests.length) {
      console.log(`    failed requests: ${r.failedRequests.length}`);
      for (const f of [...new Set(r.failedRequests)].slice(0, 12)) console.log(`      - ${f}`);
    }
  }
}

test.describe('with the repo auth.json (currently expired)', () => {
  test('probe: loaders and render state', async ({ page }) => {
    test.setTimeout(300000);
    await runProbe(page, test, 'SAVED SESSION (expired token)');
  });
});

test.describe('genuinely logged out', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('probe: loaders and render state', async ({ page }) => {
    test.setTimeout(300000);
    await runProbe(page, test, 'EMPTY SESSION (true logged-out shopper)');
  });
});
