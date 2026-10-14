// tests/scripts/probe-unpriced-breadth.spec.js
//
// How WIDE is BUG-A? The confirmation pass showed the unpriced render on an
// upfront product (Oblique Pro Cabin Hard Luggage) and NOT on four subscription
// products (the Pixel range), which still priced themselves with variant-pricing
// forced to an empty body. So the blast radius is a real question, not a detail.
//
// Samples across the catalogue rather than the first N — the first page of the
// listing is one brand, which is how the four Pixels came to stand in for
// "several products" in the first place.
const { test } = require('@playwright/test');
const { BASE_URL, BASE_API_URL } = require('../data/constants');

test.use({ storageState: { cookies: [], origins: [] } });

const SAMPLE = 16;

test('which products render the unpriced state', async ({ page, request }) => {
  test.setTimeout(900000);

  await page.route('**/apps/variant-pricing/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{"status":true,"message":"ok","data":{}}',
    })
  );

  const res = await request.get(
    `${BASE_API_URL.replace(/\/+$/, '')}/product-service/apps/products?page=1&limit=100`,
    { headers: { accept: 'application/json' } }
  );
  const all = ((await res.json())?.data?.items || []).filter((p) => p?.slug && p?.variant?.bpid);
  const step = Math.max(1, Math.floor(all.length / SAMPLE));
  const sample = all.filter((_, i) => i % step === 0).slice(0, SAMPLE);

  const rows = [];
  for (const p of sample) {
    await page.goto(`${BASE_URL}/pd/${p.slug}/${p.variant.bpid}`, {
      waitUntil: 'domcontentloaded',
    });
    await page.keyboard.press('Escape').catch(() => {});
    await page
      .getByText(/choose your plan/i)
      .first()
      .waitFor({ state: 'visible', timeout: 20000 })
      .catch(() => {});
    await page.waitForTimeout(2000);

    const r = await page.evaluate(() => {
      // SKIP SCRIPT/STYLE/NOSCRIPT. Next.js serialises its RSC payload into
      // self.__next_f.push(...) inline scripts, and that payload is full of
      // "$undefined" markers. They are never rendered, and counting them was
      // reporting a placeholder on pages that show none.
      const RENDERED = (el) => {
        if (!el) return false;
        if (/^(script|style|noscript|template)$/i.test(el.tagName)) return false;
        const rect = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          cs.visibility !== 'hidden' &&
          cs.display !== 'none' &&
          cs.opacity !== '0'
        );
      };

      const placeholders = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const text = (n.nodeValue || '').trim();
        if (!/undefined|NaN/i.test(text)) continue;
        if (text.length > 80) continue; // serialised payloads, not copy
        if (RENDERED(n.parentElement)) placeholders.push(text);
      }

      const buttons = [...document.querySelectorAll('button')];
      const label = (b) => (b.innerText || '').trim();
      const hasBuyNow = buttons.some((b) => /^buy now$/i.test(label(b)));
      const hasAddToCart = buttons.some((b) => /^add to cart$/i.test(label(b)));
      const ctas = buttons.map(label).filter((t) => t && t.length < 30);

      // The headline price node, same anchor the specs use.
      const priced = [...document.querySelectorAll('p,span,h1,h2,h3,h4,h5,h6,div')].some(
        (el) => /^₹[\d,]+$/.test((el.textContent || '').trim()) && RENDERED(el)
      );

      return { placeholders: [...new Set(placeholders)], hasBuyNow, hasAddToCart, priced, ctas };
    });

    rows.push({ slug: p.slug, name: p.name, ...r });
    console.log(
      `${r.placeholders.length ? 'AFFECTED  ' : 'ok        '}${(p.name || '').slice(0, 34).padEnd(35)} ` +
        `priced=${String(r.priced).padEnd(5)} addToCart=${String(r.hasAddToCart).padEnd(5)} ` +
        `buyNow=${String(r.hasBuyNow).padEnd(5)} placeholders=${JSON.stringify(r.placeholders)}`
    );
  }

  const affected = rows.filter((r) => r.placeholders.length > 0);
  const upfrontLayout = rows.filter((r) => r.hasAddToCart && r.hasBuyNow);

  console.log(
    `\n${affected.length} of ${rows.length} sampled products render a placeholder when pricing fails.\n` +
      `${upfrontLayout.length} of ${rows.length} render the upfront Add to Cart / Buy Now layout.\n` +
      `of those upfront-layout products, ${
        upfrontLayout.filter((r) => r.placeholders.length > 0).length
      } are affected.\n` +
      `affected: ${affected.map((r) => r.slug).join(', ') || 'none'}`
  );
});
