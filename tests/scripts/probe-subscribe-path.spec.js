// How does a shopper subscribe now? The "Subscribe" CTA is gone from BOTH-mode
// PDPs. Does selecting the Subscription plan change the buy row?
const { test } = require('@playwright/test');
test.setTimeout(300000);
const HOST = 'https://www.bytepe.com';
test.use({ storageState: { cookies: [], origins: [] } });

const BOTH_PRODUCT = { slug: 'phone-4b', bpid: 'NOTSMMOBK25WT5' };

async function buyRow(page) {
  return page.evaluate(() => {
    const btns = [...document.querySelectorAll('button')];
    const buy = btns.find((b) => /^(buy now|subscribe|pre-?book now)$/i.test((b.innerText || '').trim()));
    if (!buy) return { cta: null };
    let row = buy.parentElement;
    for (let i = 0; i < 2 && row.parentElement; i++) row = row.parentElement;
    return {
      cta: (buy.innerText || '').trim(),
      rowText: (row.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 120),
      controls: [...row.querySelectorAll('button')]
        .map((b) => (b.innerText || '').trim() || `<icon aria="${b.getAttribute('aria-label') || ''}">`)
        .filter((t) => t && !/^Apply$/.test(t))
        .slice(-6),
    };
  });
}

test('subscription path on a BOTH product', async ({ page }) => {
  await page.goto(`${HOST}/pd/${BOTH_PRODUCT.slug}/${BOTH_PRODUCT.bpid}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: /buy now|subscribe/i }).first().waitFor({ state: 'visible', timeout: 40000 });
  await page.waitForTimeout(2000);

  console.log('initial buy row:', JSON.stringify(await buyRow(page), null, 1));

  // What plan rows exist?
  const body = await page.locator('body').innerText();
  const plans = ['Subscription', 'Buy Upfront', 'Pay in Full', 'Credit Card EMI', 'Cardless EMI', 'Monthly Subscription'];
  console.log('plan copy present:', JSON.stringify(plans.filter((p) => body.includes(p))));

  // Click the Subscription plan row if there is one, then re-read the buy row.
  const sub = page.getByText(/^Subscription$/).filter({ visible: true });
  const n = await sub.count();
  console.log(`visible "Subscription" text nodes: ${n}`);
  for (let i = 0; i < n; i++) {
    const el = sub.nth(i);
    const inHeader = await el.evaluate((e) => Boolean(e.closest('header')));
    if (inHeader) continue;
    console.log(`  clicking Subscription node [${i}]`);
    await el.click({ timeout: 10000 }).catch(async () => {
      await el.evaluate((e) => e.closest('div')?.click());
    });
    await page.waitForTimeout(2500);
    console.log('  buy row after:', JSON.stringify(await buyRow(page), null, 1));
    break;
  }
});
