// tests/scripts/probe-subhome-sections.spec.js
// DIAGNOSTIC. Shape of the public sections endpoint under the query params the
// sheet exercises: eager, platform, home_page_slug, delivery pincode.
const { test } = require('@playwright/test');

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ retries: 0 });

const API = 'https://www.bytepe.com/api/product-service/apps/home-page';

test('sections response shape under each query param', async ({ request }) => {
  test.setTimeout(120000);
  const nav = await (await request.get(`${API}/nav`)).json();
  const home = (nav.data || []).find((p) => (p.sub_home_pages || []).length > 0);
  const tab = home.sub_home_pages[0];
  console.log(`home=${home.name} id=${home.id} slug=${home.slug} tab=${tab.name} id=${tab.id}`);

  const summarise = (d) => {
    if (!d) return 'no data';
    const keys = Object.keys(d);
    const shape = keys
      .map((k) => `${k}:${Array.isArray(d[k]) ? `array(${d[k].length})` : typeof d[k]}`)
      .join(' ');
    return shape;
  };

  const call = async (label, qs, headers) => {
    const res = await request.get(`${API}/sections?${qs}`, headers ? { headers } : undefined);
    let out = `${res.status()}`;
    if (res.ok()) {
      const d = (await res.json()).data;
      out += `  ${summarise(d)}`;
      const list = d && (d.sections || d.collections);
      if (Array.isArray(list) && list[0]) {
        const withItems = list.filter((s) => Array.isArray(s.items || s.tiles || s.products) && (s.items || s.tiles || s.products).length);
        out += `  | first section keys: ${Object.keys(list[0]).slice(0, 10).join(',')}`;
        out += `  | sections carrying items: ${withItems.length}`;
      }
    }
    console.log(`  ${label.padEnd(28)} ${out}`);
  };

  const base = `home_page_id=${home.id}&sub_home_page_id=${tab.id}`;
  console.log('\n--- eager (E2E-SEC-04) ---');
  await call('eager omitted', base);
  await call('eager=0', `${base}&eager=0`);
  await call('eager=5', `${base}&eager=5`);
  await call('eager=99', `${base}&eager=99`);

  console.log('\n--- platform (E2E-SEC-07) ---');
  await call('platform=mobile', `${base}&platform=mobile`);
  await call('platform=desktop', `${base}&platform=desktop`);

  console.log('\n--- slug (E2E-SEC-08) ---');
  await call('by id', base);
  await call('by home_page_slug', `home_page_slug=${home.slug}&sub_home_page_id=${tab.id}`);

  console.log('\n--- pincode (E2E-SEC-09) ---');
  await call('pincode 110001', `${base}&eager=5`, { 'x-delivery-pincode': '110001' });
  await call('pincode 560001', `${base}&eager=5`, { 'x-delivery-pincode': '560001' });

  console.log('\n--- negatives ---');
  await call('bogus sub_home_page_id', `home_page_id=${home.id}&sub_home_page_id=00000000-0000-0000-0000-000000000000`);
  await call('malformed uuid', `home_page_id=abc`);
  await call('no params', '');
});
