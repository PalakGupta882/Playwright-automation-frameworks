const { test } = require('../fixtures/pageFixtures');
const { BASE_URL } = require('../data/constants');
test.use({ storageState: { cookies: [], origins: [] } });

const CASES = [
  ['SOLD OUT upfront', 'the-aisle-trunk-cabin', 'MOKLULUGW1IWON'],
  ['SOLD OUT subscription', 'edge-70-fusion', 'MOTSMMOBH1YG73'],
  ['IN STOCK upfront', 'oblique-pro-cabin-hard-luggage-54l-20-inch', null],
];

for (const [label, slug, bpid0] of CASES) {
  test(label, async ({ page }) => {
    test.setTimeout(120000);
    let bpid = bpid0;
    if (!bpid) {
      const res = await page.request.get(
        `${BASE_URL}/api/product-service/apps/products?page=1&limit=1`
      );
      bpid = (await res.json()).data.items[0].variant.bpid;
    }
    await page.goto(`${BASE_URL}/pd/${slug}/${bpid}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(6000);

    const info = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('button').forEach((b, i) => {
        const t = (b.innerText || '').replace(/\s+/g, ' ').trim();
        if (!t) return;
        const r = b.getBoundingClientRect();
        out.push({
          i,
          text: t.slice(0, 40),
          disabled: b.disabled,
          ariaDisabled: b.getAttribute('aria-disabled'),
          y: Math.round(r.top + window.scrollY),
          cls: (b.className || '').toString().slice(0, 70),
          parentCls: (b.parentElement?.className || '').toString().slice(0, 70),
        });
      });
      const carousel = [...document.querySelectorAll('h2,h3,h4,p,span,div')]
        .filter((e) => /you may also like|recommended|similar|related/i.test(e.textContent || ''))
        .map((e) => ({ tag: e.tagName, text: e.textContent.trim().slice(0, 40),
                       y: Math.round(e.getBoundingClientRect().top + window.scrollY) }))
        .slice(0, 3);
      return { buttons: out, carousel };
    });
    console.log(`\n===== ${label} (${slug}) =====`);
    info.buttons.forEach((b) =>
      console.log(`  y=${String(b.y).padStart(5)} disabled=${b.disabled} aria=${b.ariaDisabled} "${b.text}"  cls=${b.cls}`)
    );
    console.log('  carousel markers:', JSON.stringify(info.carousel));
  });
}
