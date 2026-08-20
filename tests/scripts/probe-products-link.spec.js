// tests/scripts/probe-products-link.spec.js
// DIAGNOSTIC. After switching the header locators to .last(), Subscription and
// About Us navigate but Products does not: the click is delivered and the URL
// stays at /. getByRole name matching is a substring match, so enumerate every
// visible link that matches "Products" and see which one .last() resolves to.
const { test } = require('@playwright/test');

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ retries: 0 });

test('which links match "Products" on the homepage?', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto('https://www.bytepe.com/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);

  const matches = await page.getByRole('link', { name: 'Products' }).evaluateAll((els) =>
    els.map((el, i) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        i,
        text: (el.innerText || '').trim(),
        href: el.getAttribute('href'),
        box: `${Math.round(r.width)}x${Math.round(r.height)} @${Math.round(r.left)},${Math.round(r.top)}`,
        visibility: cs.visibility,
        display: cs.display,
        inHeader: !!el.closest('header'),
        inFooter: !!el.closest('footer'),
      };
    })
  );
  console.log(`links matching "Products": ${matches.length}`);
  matches.forEach((m) => console.log(`  [${m.i}] "${m.text}" href=${m.href} ${m.box} header=${m.inHeader} footer=${m.inFooter} ${m.visibility}/${m.display}`));

  const visible = await page
    .getByRole('link', { name: 'Products' })
    .filter({ visible: true })
    .count();
  console.log(`visible-filtered count: ${visible}`);

  const last = page.getByRole('link', { name: 'Products' }).filter({ visible: true }).last();
  console.log(`last() resolves to href=${await last.getAttribute('href')} text="${(await last.innerText()).trim()}"`);

  await last.click();
  await page.waitForTimeout(4000);
  console.log(`after clicking last(): ${page.url()}`);
});
