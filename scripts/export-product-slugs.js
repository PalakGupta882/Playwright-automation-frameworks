// Exports every live product slug to a CSV for load testing.
// Read-only: pages through the public listing API, no session, no writes.
//
//   node scripts/export-product-slugs.js [outFile]
//
// Default output: tests/data/product-slugs.csv

const fs = require('fs');
const path = require('path');

const HOST = 'https://www.bytepe.com';
const LIMIT = 50;
const OUT = process.argv[2] || path.join(__dirname, '..', 'tests', 'data', 'product-slugs.csv');

const COLUMNS = [
  'slug', 'bpid', 'name', 'brand', 'category', 'prodPaymentMode',
  'is_prebooking', 'pdp_url', 'pdp_api_path', 'pricing_api_path',
];

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function fetchPage(page) {
  const url = `${HOST}/api/product-service/apps/products?page=${page}&limit=${LIMIT}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  const body = await res.json();
  return { items: body?.data?.items || [], count: body?.data?.count ?? 0 };
}

(async () => {
  const bySlug = new Map();
  let total = 0;
  for (let page = 1; ; page++) {
    const { items, count } = await fetchPage(page);
    total = count;
    for (const p of items) if (p?.slug && !bySlug.has(p.slug)) bySlug.set(p.slug, p);
    if (!items.length || page * LIMIT >= count) break;
  }

  const rows = [...bySlug.values()].map((p) => {
    const bpid = p.variant?.bpid || '';
    const prebooking = (p.variant?.tags || []).some((t) => /pre-?booking/i.test(t?.name || ''));
    return [
      p.slug, bpid, p.name, p.brand?.name, p.category?.name, p.prodPaymentMode,
      prebooking, `${HOST}/pd/${p.slug}/${bpid}`,
      `/api/product-service/apps/products/by-slug/${p.slug}/${bpid}`,
      `/api/apps/variant-pricing/${p.slug}/${p.variant?.id || ''}`,
    ];
  });

  const csv = [COLUMNS, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, csv);

  console.log(`API count: ${total}  unique slugs written: ${rows.length}  -> ${OUT}`);
  if (rows.length !== total) console.warn('WARNING: unique slug count differs from API count');
})().catch((e) => { console.error(e); process.exit(1); });
