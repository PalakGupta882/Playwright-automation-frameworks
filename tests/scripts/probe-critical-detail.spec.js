// tests/scripts/probe-critical-detail.spec.js
//
// DIAGNOSTIC. Pulls the ticket-ready detail behind the three critical findings
// of the 19 Aug run: the crossed SKU, the duplicated product name, and the
// video that has no player. Public API + public PDP, logged out, read-only.
const { test } = require('@playwright/test');

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ mode: 'serial', retries: 0 });

const API = 'https://www.bytepe.com/api';

async function catalogue(request) {
  const all = [];
  for (let page = 1; page <= 5; page++) {
    const res = await request.get(`${API}/product-service/apps/products?page=${page}&limit=100`);
    const items = (await res.json()).data.items || [];
    all.push(...items);
    if (items.length < 100) break;
  }
  return all;
}

const line = (p) =>
  `  name   : ${p.name}\n` +
  `  brand  : ${(p.brand && (p.brand.name || p.brand.slug)) || '?'}\n` +
  `  slug   : ${p.slug}\n` +
  `  bpid   : ${p.variant && p.variant.bpid}\n` +
  `  sku    : ${p.variant && p.variant.sku}\n` +
  `  price  : mop ${p.price && p.price.mop} / mrp ${p.price && p.price.mrp}\n` +
  `  url    : https://www.bytepe.com/pd/${p.slug}/${p.variant && p.variant.bpid}`;

test('crossed SKU + duplicated name: the live records', async ({ request }) => {
  test.setTimeout(120000);
  const all = await catalogue(request);
  console.log(`live catalogue size: ${all.length}`);

  console.log('\n--- FINDING 1: SKU names another product ---');
  for (const slug of ['pixel-11-pro-fold', 'pixel-11-pro-xl']) {
    const p = all.find((x) => x.slug === slug);
    console.log(`\n${slug}:\n${p ? line(p) : '  NOT IN THE LIVE LISTING'}`);
  }

  console.log('\n--- FINDING 2: two products, one display name ---');
  for (const p of all.filter((x) => /^buds 2 plus$/i.test((x.name || '').trim()))) {
    console.log(`\n${line(p)}`);
  }
});

test('the video the PDP will not play', async ({ request }) => {
  test.setTimeout(120000);
  const products = require('../data/video-products.json');
  const list = (products.products || products).slice(0, 4);

  for (const v of list) {
    const res = await request.get(
      `${API}/product-service/apps/products/by-slug/${v.slug}/${v.bpid}`
    );
    const data = (await res.json()).data || {};
    const videos = data.videos || (data.product && data.product.videos) || [];
    console.log(`\n${v.slug} (${v.bpid})`);
    console.log(`  images in gallery : ${(data.images || data.product?.images || []).length}`);
    console.log(`  videos on payload : ${videos.length}`);
    for (const vid of videos) {
      console.log(
        `    videoName=${vid.videoName || vid.video_name} status=${vid.status || vid.videoStatus}`
      );
      console.log(`    url=${vid.videoUrl || vid.video_url}`);
    }
  }
});
