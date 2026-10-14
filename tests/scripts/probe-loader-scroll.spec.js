const { test } = require('../fixtures/pageFixtures');
const { BASE_URL } = require('../data/constants');

// Does a skeleton that is on the page actually resolve?
//
// probe-loaders.spec.js counts every skeleton in the DOM, which includes ones
// sitting below the fold waiting for an IntersectionObserver -- those are lazy
// loading working correctly, not a bug. This separates the two:
//
//   in-viewport at rest  -> a shopper is looking at a skeleton right now
//   still there after we scroll it into view and wait -> it never resolves
//
// Logged out on purpose: this is the first-visit experience.

test.use({ storageState: { cookies: [], origins: [] } });

const PAGES = [
  ['home', '/'],
  ['subscription', '/home/subscription'],
  ['emi-store', '/home/emi-store'],
];

const SKELETON = '.MuiCircularProgress-root,.MuiSkeleton-root,.MuiLinearProgress-root,[role="progressbar"]';

async function countSkeletons(page, onlyInViewport) {
  return page.evaluate(({ sel, inView }) => {
    const els = [...document.querySelectorAll(sel)].filter((el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      if (!(r.width > 0 && r.height > 0)) return false;
      if (s.visibility === 'hidden' || s.display === 'none') return false;
      if (!inView) return true;
      return r.bottom > 0 && r.top < window.innerHeight;
    });
    return els.length;
  }, { sel: SKELETON, inView: onlyInViewport });
}

test('probe: do skeletons resolve once scrolled into view', async ({ page }) => {
  test.setTimeout(300000);

  for (const [name, path] of PAGES) {
    await page.goto(BASE_URL + path, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(8000);

    const atRestInView = await countSkeletons(page, true);
    const atRestTotal = await countSkeletons(page, false);
    const height = await page.evaluate(() => document.body.scrollHeight);

    // Walk the page a viewport at a time so every lazy region gets its turn.
    const step = await page.evaluate(() => window.innerHeight);
    for (let y = 0; y < height; y += step) {
      await page.evaluate((to) => window.scrollTo(0, to), y);
      await page.waitForTimeout(1200);
    }
    // Back to the top, then give the slowest region a generous last chance.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(8000);

    const afterTotal = await countSkeletons(page, false);
    const afterInView = await countSkeletons(page, true);
    const textAfter = await page.evaluate(() => document.body.innerText.trim().length);

    console.log(`\n--- ${name} (${path})   page height ${height}px`);
    console.log(`    at rest : ${atRestInView} skeleton(s) in viewport, ${atRestTotal} in document`);
    console.log(`    after full scroll + 8s: ${afterInView} in viewport, ${afterTotal} in document`);
    console.log(`    body text chars after: ${textAfter}`);
    console.log(
      afterTotal === 0
        ? '    => all skeletons resolved. Lazy loading works.'
        : `    => ${afterTotal} skeleton(s) NEVER resolved after being scrolled into view.`
    );
  }
});
