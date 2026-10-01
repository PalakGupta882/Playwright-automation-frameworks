// Which field is `price.minEmi` actually equal to, across the products
// catalogue-integrity flagged?
const { test, request } = require('@playwright/test');
test.use({ storageState: { cookies: [], origins: [] } });
test.setTimeout(240000);
const HOST = 'https://www.bytepe.com';

const FLAGGED = new Set([
  'SAMSAMOB10ZXEG', 'SAMSAMOBU4UI0G', 'SAMSAMOBQAAFGN', 'NOTSMMOBK25WT5', 'SAMSMMOBMT0HRU',
]);

test('minEmi vs cc.emi_amount vs the emi ladder', async () => {
  const api = await request.newContext({ baseURL: HOST });
  const rows = [];
  for (let p = 1; p <= 30; p++) {
    const r = await api.get(`/api/product-service/apps/products?page=${p}&limit=12`);
    if (!r.ok()) break;
    const arr = (await r.json()).data?.items || [];
    if (!arr.length) break;
    rows.push(...arr);
  }

  let agreeCc = 0, agreeLadder = 0, agreeBoth = 0, agreeNeither = 0;
  const detail = [];

  for (const row of rows) {
    const bpid = row.variant?.bpid;
    const sample = FLAGGED.has(bpid) || Math.random() < 0.12;
    if (!sample) continue;

    const pdp = await api.get(`/api/product-service/apps/products/by-slug/${row.slug}/${bpid}`);
    if (!pdp.ok()) continue;
    const d = (await pdp.json().catch(() => ({}))).data;
    if (!d?.variant) continue;
    const pr = await api.get(`/api/apps/variant-pricing/${row.slug}/${d.variant.id}`);
    if (!pr.ok()) continue;
    const pb = (await pr.json().catch(() => ({}))).data;
    if (!pb) continue;

    const minEmi = row.price?.minEmi;
    const cc = pb.cc?.emi_amount;
    const opts = pb.emi?.emi_option || [];
    const ladder = opts.length ? opts[opts.length - 1].installment_amount : null;
    const ladderMin = opts.length ? Math.min(...opts.map(o => o.installment_amount)) : null;

    const okCc = minEmi === cc;
    const okLadder = minEmi === ladder || minEmi === ladderMin;
    if (okCc && okLadder) agreeBoth++;
    else if (okCc) agreeCc++;
    else if (okLadder) agreeLadder++;
    else agreeNeither++;

    if (FLAGGED.has(bpid) || (!okCc && !okLadder)) {
      detail.push(`${FLAGGED.has(bpid) ? 'FLAGGED ' : 'NEITHER '}${row.name} | minEmi=${minEmi} cc=${cc} ladder24=${ladder} ladderMin=${ladderMin} | ${row.slug}/${bpid}`);
    }
  }

  console.log(`sampled: both=${agreeBoth} ccOnly=${agreeCc} ladderOnly=${agreeLadder} neither=${agreeNeither}`);
  detail.forEach(d => console.log('  ' + d));
  await api.dispose();
});
