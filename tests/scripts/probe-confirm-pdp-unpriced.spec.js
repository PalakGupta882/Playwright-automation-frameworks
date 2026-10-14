// tests/scripts/probe-confirm-pdp-unpriced.spec.js
//
// Confirmation pass for BUG-A. Written to attack the finding, not to restate
// it. Four questions a skeptic would ask:
//
//   Q1  Is `.first()` even the PDP's own Add to Cart? CLAUDE.md records that
//       getByRole('button',{name:'Add to Cart'}).first() reached the
//       recommended-products carousel and put a Rs.1,24,999 phone in a live
//       cart. If that still holds, the enabled-state read in
//       regression/pdp-pricing-failure.spec.js answers about the WRONG product
//       and that half of the finding is unproven.
//   Q2  Is "undefined" actually VISIBLE, or is it in a hidden node that only
//       innerText scraping ever sees?
//   Q3  Is "enabled" real? A MUI button can be visually dead via aria-disabled
//       or pointer-events while isEnabled() still returns true.
//   Q4  Does clicking it actually attempt a purchase? Read with POST /api/cart
//       INTERCEPTED AND ABORTED, so nothing is written to the live cart.
const { test, expect } = require('@playwright/test');
const { BASE_URL, BASE_API_URL } = require('../data/constants');

test.use({ storageState: { cookies: [], origins: [] } });

// Screenshots land outside test-results/, which Playwright wipes at the start of
// every run — the first capture of this bug was gone before it could be looked
// at. Override with BYTEPE_SHOT_DIR.
const SHOT_DIR = process.env.BYTEPE_SHOT_DIR || 'bug-evidence';

const EMPTY_PRICING = (route) =>
  route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: '{"status":true,"message":"ok","data":{}}',
  });

async function someProducts(request, n) {
  const res = await request.get(
    `${BASE_API_URL.replace(/\/+$/, '')}/product-service/apps/products?page=1&limit=40`,
    { headers: { accept: 'application/json' } }
  );
  const items = (await res.json())?.data?.items || [];
  return items.filter((p) => p?.slug && p?.variant?.bpid).slice(0, n);
}

// Structural anchor, the rule CLAUDE.md sets: find Buy Now, take the Add to
// Cart before it. Carousel tiles have no Buy Now, so this cannot stray into one.
async function buyControls(page) {
  return page.evaluate(() => {
    const buttons = [...document.querySelectorAll('button')];
    const label = (b) => (b.innerText || '').trim();
    const buyNowIndex = buttons.findIndex((b) => /^buy now$/i.test(label(b)));
    const addIndexes = buttons
      .map((b, i) => (/^add to cart$/i.test(label(b)) ? i : -1))
      .filter((i) => i >= 0);
    const pdpAddIndex = [...addIndexes].reverse().find((i) => i < buyNowIndex);

    const describeButton = (b) => {
      if (!b) return null;
      const cs = getComputedStyle(b);
      const r = b.getBoundingClientRect();
      return {
        disabledAttr: b.hasAttribute('disabled'),
        ariaDisabled: b.getAttribute('aria-disabled'),
        pointerEvents: cs.pointerEvents,
        opacity: cs.opacity,
        cursor: cs.cursor,
        box: `${Math.round(r.width)}x${Math.round(r.height)}`,
      };
    };

    return {
      totalAddToCartButtons: addIndexes.length,
      firstAddToCartIndex: addIndexes.length ? addIndexes[0] : null,
      buyNowIndex,
      pdpAddIndex: pdpAddIndex === undefined ? null : pdpAddIndex,
      firstIsThePdpOne: addIndexes.length > 0 && addIndexes[0] === pdpAddIndex,
      pdpAdd: describeButton(buttons[pdpAddIndex]),
      buyNow: describeButton(buttons[buyNowIndex]),
    };
  });
}

// Q2: visibility of the literal placeholder, at element level rather than by
// scraping body text.
async function visiblePlaceholders(page) {
  return page.evaluate(() => {
    const out = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = (n.nodeValue || '').trim();
      if (!/undefined|NaN/i.test(text)) continue;
      const el = n.parentElement;
      if (!el) continue;
      // Next.js serialises its RSC payload into self.__next_f.push(...) inline
      // scripts, and that payload is dense with "$undefined" markers. None of it
      // is rendered. Without this the output is thousands of characters of
      // framework noise around the one line that matters.
      if (/^(script|style|noscript|template)$/i.test(el.tagName)) continue;
      if (text.length > 80) continue;
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const visible =
        r.width > 0 &&
        r.height > 0 &&
        cs.visibility !== 'hidden' &&
        cs.display !== 'none' &&
        cs.opacity !== '0';
      out.push({
        text,
        tag: el.tagName.toLowerCase(),
        visible,
        fontSize: cs.fontSize,
        color: cs.color,
      });
    }
    return out;
  });
}

test('Q1: which Add to Cart does .first() actually reach, on a healthy PDP', async ({
  page,
  request,
}) => {
  test.setTimeout(180000);
  const products = await someProducts(request, 3);
  for (const p of products) {
    await page.goto(`${BASE_URL}/pd/${p.slug}/${p.variant.bpid}`, {
      waitUntil: 'domcontentloaded',
    });
    await page.keyboard.press('Escape').catch(() => {});
    await page
      .getByText(/^₹[\d,]+$/)
      .first()
      .waitFor({ state: 'visible', timeout: 20000 })
      .catch(() => {});
    // Let the recommended-products carousel mount — it is the whole risk.
    await page.waitForTimeout(4000);
    const c = await buyControls(page);
    console.log(
      `${p.slug}\n  Add to Cart buttons on page: ${c.totalAddToCartButtons} | ` +
        `first at index ${c.firstAddToCartIndex}, Buy Now at ${c.buyNowIndex}, ` +
        `PDP's own at ${c.pdpAddIndex}\n` +
        `  .first() IS the PDP's own button: ${c.firstIsThePdpOne}`
    );
  }
});

test('Q2+Q3: the defect, measured at element level across several products', async ({
  page,
  request,
}) => {
  test.setTimeout(300000);
  await page.route('**/apps/variant-pricing/**', EMPTY_PRICING);

  const products = await someProducts(request, 5);
  for (const p of products) {
    await page.goto(`${BASE_URL}/pd/${p.slug}/${p.variant.bpid}`, {
      waitUntil: 'domcontentloaded',
    });
    await page.keyboard.press('Escape').catch(() => {});
    await page
      .getByText(/choose your plan/i)
      .first()
      .waitFor({ state: 'visible', timeout: 20000 })
      .catch(() => {});
    await page.waitForTimeout(2500);

    const placeholders = await visiblePlaceholders(page);
    const c = await buyControls(page);
    const headline = await page
      .getByText(/^₹[\d,]+$/)
      .first()
      .isVisible()
      .catch(() => false);

    console.log(
      `\n${p.name} (${p.slug})\n` +
        `  headline price visible : ${headline}\n` +
        `  placeholder text nodes : ${
          placeholders.length
            ? placeholders
                .map((x) => `"${x.text}" <${x.tag}> visible=${x.visible} ${x.fontSize}`)
                .join(' ; ')
            : 'none'
        }\n` +
        `  PDP Add to Cart        : ${JSON.stringify(c.pdpAdd)}\n` +
        `  PDP Buy Now            : ${JSON.stringify(c.buyNow)}`
    );

    // Screenshot the AFFECTED page, not whichever product the loop ends on.
    // The first pass captured the last iteration — a Pixel, which prices
    // normally — and so produced a picture of the bug not happening.
    if (placeholders.some((x) => x.visible)) {
      const file = `${SHOT_DIR}/BUG-A-${p.slug.slice(0, 40)}.png`;
      await page.screenshot({ path: file });
      console.log(`  screenshot            : ${file}`);
    }
  }

});

test('Q4: clicking Add to Cart on an unpriced PDP attempts a real cart write', async ({
  page,
  request,
}) => {
  test.setTimeout(180000);

  // NOTHING IS WRITTEN. Every cart POST is aborted at the network before it
  // leaves the browser; what is recorded is only that the page tried.
  const attempts = [];
  await page.route('**/api/cart**', async (route) => {
    const req = route.request();
    if (req.method() === 'POST') {
      attempts.push({ method: req.method(), url: req.url(), body: req.postData() });
      return route.abort('failed');
    }
    return route.continue();
  });
  await page.route('**/apps/variant-pricing/**', EMPTY_PRICING);

  const [p] = await someProducts(request, 1);
  await page.goto(`${BASE_URL}/pd/${p.slug}/${p.variant.bpid}`, {
    waitUntil: 'domcontentloaded',
  });
  await page.keyboard.press('Escape').catch(() => {});
  await page
    .getByText(/choose your plan/i)
    .first()
    .waitFor({ state: 'visible', timeout: 20000 })
    .catch(() => {});
  await page.waitForTimeout(2500);

  const before = await buyControls(page);
  expect(before.pdpAddIndex, 'no PDP-own Add to Cart found to click').not.toBeNull();

  // Click the structurally-anchored one, never .first() by name.
  await page.evaluate((index) => {
    const buttons = [...document.querySelectorAll('button')];
    buttons[index].click();
  }, before.pdpAddIndex);
  await page.waitForTimeout(4000);

  console.log(
    `${p.slug}: cart POST attempts while unpriced = ${attempts.length}\n` +
      attempts.map((a) => `  ${a.method} ${a.url}\n    payload: ${a.body}`).join('\n')
  );
});
