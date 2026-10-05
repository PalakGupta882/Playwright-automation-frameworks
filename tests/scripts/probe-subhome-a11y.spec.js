// tests/scripts/probe-subhome-a11y.spec.js
// DIAGNOSTIC. Keyboard reachability of the tab strip (TCB-046/047) and what
// the page does when the nav endpoint fails (TCB-052). Read-only.
const { test } = require('@playwright/test');

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ mode: 'serial', retries: 0 });

const SITE = 'https://www.bytepe.com';

test('keyboard: are tabs focusable and do Enter/Space select?', async ({ page }) => {
  test.setTimeout(120000);
  await page.goto(`${SITE}/`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('tab').first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(2500);

  const attrs = await page.evaluate(() =>
    [...document.querySelectorAll('[role="tab"]')].slice(0, 3).map((t) => ({
      label: (t.innerText || '').trim().split('\n')[0],
      tag: t.tagName,
      tabindex: t.getAttribute('tabindex'),
      ariaSelected: t.getAttribute('aria-selected'),
      ariaControls: t.getAttribute('aria-controls'),
      id: t.id || null,
    }))
  );
  console.log(`tab attributes: ${JSON.stringify(attrs, null, 1)}`);

  const listName = await page.evaluate(() => {
    const l = document.querySelector('[role="tablist"]');
    return l ? { label: l.getAttribute('aria-label'), labelledby: l.getAttribute('aria-labelledby') } : null;
  });
  console.log(`tablist accessible name: ${JSON.stringify(listName)}`);

  const target = page.getByRole('tab', { name: /^Luggage/i }).first();
  await target.focus().catch((e) => console.log(`focus() threw: ${e.message.split('\n')[0]}`));
  console.log(
    `activeElement after focus(): ${await page.evaluate(() => {
      const el = document.activeElement;
      return el ? `${el.tagName} role=${el.getAttribute('role')} "${(el.innerText || '').trim().split('\n')[0]}"` : 'none';
    })}`
  );

  await page.keyboard.press('Enter');
  await page.waitForTimeout(3000);
  console.log(`after Enter -> url=${page.url()} active=${await page.evaluate(() =>
    [...document.querySelectorAll('[role="tab"]')].filter(t => t.getAttribute('aria-selected') === 'true').map(t => (t.innerText||'').trim().split('\n')[0]).join(',')
  )}`);

  // How many Tab presses from the top before a tab strip tile takes focus?
  await page.goto(`${SITE}/`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('tab').first().waitFor({ timeout: 20000 });
  await page.waitForTimeout(2000);
  let reached = -1;
  for (let i = 1; i <= 25; i++) {
    await page.keyboard.press('Tab');
    const isTab = await page.evaluate(() => document.activeElement && document.activeElement.closest('[role="tab"]') !== null);
    if (isTab) { reached = i; break; }
  }
  console.log(`Tab presses from page load before a [role=tab] takes focus: ${reached === -1 ? 'never in 25' : reached}`);
});

test('what renders when the nav endpoint fails?', async ({ page }) => {
  test.setTimeout(120000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message).split('\n')[0]));

  await page.route('**/apps/home-page/nav*', (route) => route.abort('failed'));
  await page.goto(`${SITE}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);

  const state = await page.evaluate(() => ({
    tablists: document.querySelectorAll('[role="tablist"]').length,
    tabs: document.querySelectorAll('[role="tab"]').length,
    bodyLen: document.body.innerText.length,
    crash: /Application error|client-side exception/i.test(document.body.innerText),
    firstWords: document.body.innerText.trim().slice(0, 90).replace(/\n/g, ' / '),
  }));
  console.log(`nav blocked -> ${JSON.stringify(state)}`);
  console.log(`page errors: ${errors.length ? errors.join(' | ') : 'none'}`);
});
