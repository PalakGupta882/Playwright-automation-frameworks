const { test } = require('@playwright/test');
test.use({ storageState: { cookies: [], origins: [] } });

test('does the PDP settle on a real price, and what is behind "See Plans"', async ({ page }) => {
  test.setTimeout(180000);
  const slug = 'iphone-17-pro-max', bpid = 'APPSMMOB77U3ZT';
  await page.goto(`https://www.bytepe.com/pd/${slug}/${bpid}`, { waitUntil: 'domcontentloaded' });

  // Poll for the real headline price instead of reading once.
  const settled = await page.waitForFunction(
    () => /₹\s?1,49,900/.test(document.body.innerText),
    null,
    { timeout: 45000 }
  ).then(() => true).catch(() => false);
  console.log('headline ₹1,49,900 appeared:', settled);

  const before = await page.locator('body').innerText();
  console.log('--- buy area text BEFORE See Plans ---');
  console.log(before.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 22).join('\n'));

  const seePlans = page.getByRole('button', { name: /see plans/i }).first();
  const hasSeePlans = await seePlans.waitFor({ state: 'visible', timeout: 10000 })
    .then(() => true).catch(() => false);
  console.log('\n"See Plans" is a button:', hasSeePlans);

  if (!hasSeePlans) {
    const el = page.getByText(/see plans/i).first();
    const ok = await el.waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false);
    console.log('"See Plans" as text:', ok);
    if (ok) await el.click();
  } else {
    await seePlans.click();
  }

  await page.waitForTimeout(4000);
  const after = await page.locator('body').innerText();
  console.log('\n--- keyword scan AFTER clicking See Plans ---');
  for (const k of ['Choose your plan', 'Subscribe', 'Subscription', 'Pay in Full', 'Buy Upfront',
                   'Cardless', 'Pre-Approved', 'Credit Card EMI', 'No Cost EMI', 'Monthly']) {
    console.log(`  ${k}: ${after.includes(k) ? 'PRESENT' : 'absent'}`);
  }
  const added = after.split('\n').filter(l => !before.includes(l.trim()) && l.trim());
  console.log('\n--- lines that appeared after the click ---');
  console.log(added.map(s => s.trim()).slice(0, 40).join('\n'));

  const btns = await page.evaluate(() => [...document.querySelectorAll('button')]
    .filter(b => (b.offsetParent || b.getClientRects().length))
    .map(b => ((b.innerText || '').trim() || (b.getAttribute('aria-label') || '').trim()))
    .filter(t => t && !/^(Apply|\d+|Instant discount on EMI|No Cost EMI discount)$/.test(t)));
  console.log('\n--- visible buttons after click ---');
  console.log([...new Set(btns)].join(' | '));
});
