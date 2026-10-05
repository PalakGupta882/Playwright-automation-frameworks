const { test, request } = require('@playwright/test');
test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(240000);
const HOST = 'https://www.bytepe.com';

const TARGETS = [
  { slug: 'watch-ultra-4', bpid: 'APPSMSMA5WNTNY', listedMinEmi: 5816 },
  { slug: 'airpods-5', bpid: 'APPWIWIRYJGK6E', listedMinEmi: 694 },
  { slug: 'iphone-18-pro', bpid: 'APPSAMOB6S7QGR', listedMinEmi: 7995 },
];

async function getJson(api, path, tries = 4) {
  for (let i = 0; i < tries; i++) {
    const r = await api.get(path);
    const ct = r.headers()['content-type'] || '';
    if (r.ok() && ct.includes('json')) return await r.json();
    console.log(`  retry ${i + 1}: ${path} -> ${r.status()} ${ct}`);
    await new Promise(s => setTimeout(s, 1500));
  }
  return null;
}

test('minEmi vs cc.emi_amount on prebooking products', async () => {
  const api = await request.newContext({ baseURL: HOST });
  for (const t of TARGETS) {
    const pdp = await getJson(api, `/api/product-service/apps/products/by-slug/${t.slug}/${t.bpid}`);
    const d = pdp?.data;
    if (!d) { console.log(`${t.slug}: PDP payload unavailable`); continue; }
    const pb = (await getJson(api, `/api/apps/variant-pricing/${t.slug}/${d.variant.id}`))?.data;
    if (!pb) { console.log(`${t.slug}: pricing unavailable`); continue; }
    console.log(`\n== ${t.slug} (isMaster=${d.variant.isMaster})`);
    console.log(`   listing minEmi      = ${t.listedMinEmi}`);
    console.log(`   emi_price (top)     = ${JSON.stringify(pb.emi_price)}`);
    console.log(`   cc.emi_amount       = ${pb.cc?.emi_amount}   cc=${JSON.stringify(pb.cc)}`);
    console.log(`   cc_y2.emi_amount    = ${pb.cc_y2?.emi_amount}`);
    console.log(`   nbfc                = ${JSON.stringify(pb.nbfc)}`);
    console.log(`   emi.emi_option      = ${JSON.stringify(pb.emi?.emi_option)}`);
  }
  await api.dispose();
});
