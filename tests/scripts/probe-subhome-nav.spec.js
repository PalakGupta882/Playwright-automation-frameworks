// tests/scripts/probe-subhome-nav.spec.js
//
// DIAGNOSTIC for the Sub Home Page Tabs suite. The sheet was written against
// localhost fixtures (tabs "Laptop"/"5G Phones", base URL localhost:6009).
// Before writing a line of spec, find out what production actually serves.
const { test } = require('@playwright/test');

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ mode: 'serial', retries: 0 });

const API = 'https://www.bytepe.com/api';

test('does the public nav endpoint exist, and what tabs does it carry?', async ({ request }) => {
  test.setTimeout(90000);

  for (const path of [
    'product-service/apps/home-page/nav',
    'product-service/apps/home-page/nav?page_type=home',
  ]) {
    const res = await request.get(`${API}/${path}`);
    console.log(`\nGET ${path} -> ${res.status()}`);
    if (!res.ok()) {
      console.log(`  body: ${(await res.text()).slice(0, 200)}`);
      continue;
    }
    const body = await res.json();
    const pages = body.data || body;
    console.log(`  home pages: ${Array.isArray(pages) ? pages.length : 'not an array'}`);
    for (const p of Array.isArray(pages) ? pages : []) {
      const tabs = p.sub_home_pages || p.subHomePages;
      console.log(
        `  · ${p.name} (slug=${p.slug}, seq=${p.sequence}) — sub_home_pages: ` +
          (tabs === undefined ? 'FIELD ABSENT' : tabs === null ? 'null' : tabs.length)
      );
      for (const t of tabs || []) {
        console.log(
          `      seq=${t.sequence} name=${t.name} slug=${t.slug} ` +
            `entity_type=${t.entity_type} entity_id=${t.entity_id} icon=${t.icon_url ? 'yes' : 'null'} status=${t.status}`
        );
      }
    }
  }
});

test('does the public sections endpoint accept a sub_home_page_id?', async ({ request }) => {
  test.setTimeout(90000);
  const res = await request.get(`${API}/product-service/apps/home-page/nav`);
  if (!res.ok()) return console.log(`nav unavailable (${res.status()}) — skipping`);
  const pages = (await res.json()).data || [];
  const home = pages.find((p) => (p.slug || '').includes('home')) || pages[0];
  if (!home) return console.log('no home page in the nav response');

  const tabs = home.sub_home_pages || [];
  console.log(`\nhome page: ${home.name} id=${home.id} tabs=${tabs.length}`);

  const calls = [
    `product-service/apps/home-page/sections?home_page_id=${home.id}`,
    tabs[0] && `product-service/apps/home-page/sections?home_page_id=${home.id}&sub_home_page_id=${tabs[0].id}`,
    tabs[1] && `product-service/apps/home-page/sections?home_page_id=${home.id}&sub_home_page_id=${tabs[1].id}`,
    `product-service/apps/home-page/sections?home_page_id=${home.id}&sub_home_page_id=00000000-0000-0000-0000-000000000000`,
  ].filter(Boolean);

  for (const c of calls) {
    const r = await request.get(`${API}/${c}`);
    let count = '?';
    if (r.ok()) {
      const d = (await r.json()).data;
      const list = d && (d.sections || d.collections || d);
      count = Array.isArray(list) ? list.length : JSON.stringify(d).slice(0, 90);
    }
    console.log(`  ${r.status()}  sections=${count}  <- ${c.replace('product-service/apps/home-page/', '')}`);
  }
});

test('how many tabs does each storefront route render?', async ({ page }) => {
  test.setTimeout(120000);
  for (const path of ['/', '/home/subscription', '/home/emi-store', '/?sub_home_page=mobile']) {
    await page.goto(`https://www.bytepe.com${path}`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3500);
    const info = await page.evaluate(() => {
      const tabs = [...document.querySelectorAll('[role="tab"]')];
      return {
        tablists: document.querySelectorAll('[role="tablist"]').length,
        tabs: tabs.map((t) => ({
          label: (t.innerText || '').trim().split('\n')[0],
          selected: t.getAttribute('aria-selected'),
          hasImg: !!t.querySelector('img'),
          alt: (t.querySelector('img') || {}).alt,
        })),
      };
    });
    console.log(`\n${path}  tablists=${info.tablists}  tabs=${info.tabs.length}`);
    info.tabs.forEach((t) =>
      console.log(`   ${t.selected === 'true' ? '▸' : ' '} ${t.label}  aria-selected=${t.selected}  img=${t.hasImg} alt="${t.alt}"`)
    );
  }
});
