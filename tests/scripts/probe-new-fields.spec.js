const { test, request } = require('@playwright/test');
test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(240000);
const HOST = 'https://www.bytepe.com';

test('new listing fields: tags + rating', async () => {
  const api = await request.newContext({ baseURL: HOST });
  const rows = [];
  for (let p = 1; p <= 30; p++) {
    const r = await api.get(`/api/product-service/apps/products?page=${p}&limit=12`);
    if (!r.ok()) break;
    const arr = (await r.json()).data?.items || [];
    if (!arr.length) break;
    rows.push(...arr);
  }
  console.log(`rows=${rows.length} unique=${new Set(rows.map(r => r.variant?.bpid)).size}`);

  // tags
  const tagCounts = {};
  const tagShape = {};
  rows.forEach(r => (r.variant?.tags || []).forEach(t => {
    tagCounts[t.name] = (tagCounts[t.name] || 0) + 1;
    tagShape[t.name] = t;
  }));
  console.log('TAGS:', JSON.stringify(tagCounts));
  console.log('TAG SHAPE:', JSON.stringify(tagShape, null, 1));

  const tagged = rows.filter(r => (r.variant?.tags || []).length);
  console.log(`rows with >=1 tag: ${tagged.length}/${rows.length}`);
  tagged.slice(0, 25).forEach(r => console.log(`  ${(r.variant.tags || []).map(t => t.name).join(',')} | ${r.name} | ${r.slug}/${r.variant.bpid} | price=${JSON.stringify(r.price)}`));

  // rating
  const rated = rows.filter(r => r.rating != null);
  console.log(`rating present: ${rated.length}/${rows.length}`);
  console.log('rating samples:', JSON.stringify(rated.slice(0, 6).map(r => ({ n: r.name, rating: r.rating }))));

  await api.dispose();
});
