// tests/regression/pdp-gallery-video-order.spec.js
//
// A variant whose images all sort AFTER the product video never clears its
// gallery's loading state: every image slide and thumbnail stays covered by a
// skeleton. The image files themselves download — the placeholder over them
// is never removed.
// OPEN DEFECT, measured 6 Oct 2026, not raised with anyone yet.
//
// HOW IT HAPPENS. `product.videos[]` is shared by every variant and carries a
// `seq` (1 on every product measured). Each variant has its own
// `variant.images[].seq`. The gallery merges the two and sorts by seq:
//
//   sense-2 master FITSMSMAWF4ME4  image first, video tile 2nd, all images load
//   sense-2        FITSMSMA37626C  images 10..19 -> video tile first, then 9
//                                  thumbnails and every slide stuck under skeletons
//   vivo-t5x-5g    VIVSMMOBLHHOPZ  images 1,2,3   -> renders
//   vivo-t5x-5g    VIVSMMOB5JREH2  images 11,12,13 -> video first, 7 skeletons
//
// The web gallery DOES show a video tile now — a black card with a play button
// and the video name, no <video> element until played. docs/video-feature-
// coverage.md still says the web PDP "mounts no player"; that was measured
// 20 Aug 2026 and this tile postdates it.
//
// WHAT IS ASSERTED. Not which slide the gallery opens on — leading with the
// video may well be intended. Only that the gallery settles: no skeleton in view
// at rest, and at least one product image rendered.
//
// The broken numbering is not the trigger on its own. A seq gap (Charge 6
// master: 1,2,3,4,6) and a high start with NO video (Belle tote: 13..18) both
// render fine. Only "has a video AND no image at or below its seq" breaks it.
// Measured across 588 variants of the 99 video products: 11 affected, every one
// a non-master sibling (vivo T5X, Fitbit Versa 4 / Inspire 3 / Charge 6 /
// Sense 2) — so a shopper reaches it by picking a colour or storage option,
// and site-health, which only checks listed URLs are alive, cannot see it.
//
// WHY SIBLINGS ARE SWEPT. The listing links one variant per product, and on the
// day this was found none of the affected variants was the listed one. A sweep
// of listed variants alone passes on a catalogue where this is live.
//
// HOW THE PAGE IS READ. The gallery has no role, test id or stable class — its
// containers are build-hashed MUI boxes. Two things are stable: the
// placeholder is MUI's own `.MuiSkeleton-root`, a component class that is not
// build-hashed, and the gallery's images are served through `/_next/image`
// from the product's storage URL. Alt text was not used: it is the product
// name, which also labels the colour swatches. So the check is: no skeleton
// inside the first viewport, and a loaded gallery-sized (>= 60px) image whose
// src is one of THIS variant's `images[].url`. Matching the payload's own URLs
// is what stops a carousel tile or a bank logo from passing it. The control
// test proves the reading finds a healthy gallery, so a failure below means
// the gallery, not the probe.
//
// Public, logged out, read-only. retries: 0 — this is an open defect and a
// retry would only re-roll a load that is deterministic anyway.

const { test, expect } = require('../fixtures/pageFixtures');
const { BASE_URL, BASE_API_URL } = require('../data/constants');
const { getWithRetry } = require('../utils/apiRetry');
const { fetchListingRows } = require('../utils/catalogue');

test.use({ storageState: { cookies: [], origins: [] } });
test.describe.configure({ retries: 0 });

const API = BASE_API_URL.replace(/\/+$/, '');
const bySlug = (slug, bpid) => `${API}/product-service/apps/products/by-slug/${slug}/${bpid}`;
const pdp = (v) => `${BASE_URL}/pd/${v.slug}/${v.bpid}`;

// Same throttle as stock-availability: ~900 payload reads, and a 429 is not a defect.
const SWEEP_CONCURRENCY = 3;

async function mapWithPool(items, concurrency, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < items.length) {
        const index = next++;
        out[index] = await fn(items[index], index);
      }
    })
  );
  return out;
}

async function readPayload(api, slug, bpid) {
  const res = await getWithRetry(api, bySlug(slug, bpid), { failOnStatusCode: false, timeout: 30000 });
  if (!res.ok()) return null;
  return (await res.json().catch(() => null))?.data || null;
}

// A video with no seq is treated as 1: every video measured carries 1, and
// assuming the value that sorts it first is the pessimistic reading.
const videoSeqOf = (videos) => Math.min(...videos.map((v) => (Number.isFinite(v.seq) ? v.seq : 1)));

function describeVariant(slug, data, videoSeq) {
  const v = data.variant;
  const seqs = (v.images || []).map((i) => i.seq);
  return {
    slug,
    bpid: v.bpid,
    isMaster: Boolean(v.isMaster),
    inStock: Boolean(v.available && v.stock > 0),
    imageUrls: (v.images || []).map((i) => i.url).filter(Boolean),
    imageSeqs: seqs,
    videoSeq,
    // The trigger: no image can sort ahead of (or tie with) the video.
    opensOnVideo: seqs.length > 0 && Math.min(...seqs) > videoSeq,
  };
}

const label = (v) =>
  `/pd/${v.slug}/${v.bpid} master=${v.isMaster} inStock=${v.inStock} ` +
  `imageSeq=[${v.imageSeqs.join(',')}] videoSeq=${v.videoSeq}`;

// Polled, because the gallery hydrates after domcontentloaded and the images
// land a few seconds later on a slow origin.
async function readGallery(page, imageUrls) {
  return page.evaluate((urls) => {
    const inView = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight && r.left < window.innerWidth && r.right > 0;
    };
    // `/_next/image?url=<encoded>&w=…` — decode back to the storage URL.
    const sourceOf = (img) => {
      const src = img.currentSrc || img.src || '';
      try {
        return new URL(src).searchParams.get('url') || src;
      } catch {
        return src;
      }
    };
    const productImagesLoaded = [...document.querySelectorAll('img')].filter(
      (img) =>
        img.complete &&
        img.naturalWidth > 0 &&
        img.getBoundingClientRect().width >= 60 &&
        urls.includes(sourceOf(img))
    ).length;
    const skeletonsInView = [...document.querySelectorAll('.MuiSkeleton-root')].filter(inView).length;
    return { imagesRendered: productImagesLoaded > 0, skeletonsInView };
  }, imageUrls);
}

test.describe('PDP gallery settles when the video sorts first', () => {
  /** @type {import('@playwright/test').APIRequestContext} */
  let api;
  /** @type {ReturnType<typeof describeVariant>[]} */
  const variants = [];
  let videoProducts = 0;
  let listed = 0;

  test.beforeAll(async ({ playwright }) => {
    test.setTimeout(10 * 60 * 1000);
    api = await playwright.request.newContext({ storageState: { cookies: [], origins: [] } });

    const rows = await fetchListingRows(api);
    listed = rows.length;

    // Pass 1: the listed variant tells us whether the product has a video and
    // which siblings exist. Only video products need their siblings read.
    const firstPass = await mapWithPool(rows, SWEEP_CONCURRENCY, async (row) => ({
      row,
      data: await readPayload(api, row.slug, row.variant.bpid),
    }));

    const siblingJobs = [];
    for (const { row, data } of firstPass) {
      const videos = data?.product?.videos || [];
      if (!data?.variant || videos.length === 0) continue;
      videoProducts++;
      const videoSeq = videoSeqOf(videos);
      variants.push(describeVariant(row.slug, data, videoSeq));
      for (const sib of data.siblingVariants || []) {
        if (sib.bpid && sib.bpid !== row.variant.bpid) siblingJobs.push({ slug: row.slug, bpid: sib.bpid, videoSeq });
      }
    }

    // Pass 2: every sibling of a video product.
    const siblings = await mapWithPool(siblingJobs, SWEEP_CONCURRENCY, async (job) => ({
      job,
      data: await readPayload(api, job.slug, job.bpid),
    }));
    for (const { job, data } of siblings) {
      if (data?.variant) variants.push(describeVariant(job.slug, data, job.videoSeq));
    }

    const affected = variants.filter((v) => v.opensOnVideo);
    console.log(
      `gallery sweep: ${videoProducts}/${listed} products have a video; ` +
        `${variants.length} variants read; ${affected.length} sort every image after the video`
    );
    affected.forEach((v) => console.log(`  ${label(v)}`));
  });

  test.afterAll(async () => {
    await api?.dispose();
  });

  test('no variant sorts every image after the product video', () => {
    // Non-vacuous: 99 of 335 products carried a video on 6 Oct 2026. A sweep
    // that found none read nothing, and would pass on any catalogue.
    expect(videoProducts, 'no listed product has a video — the sweep read nothing').toBeGreaterThan(10);
    expect(variants.length, 'sibling variants were not read').toBeGreaterThan(videoProducts);

    expect(
      variants.filter((v) => v.opensOnVideo).map(label),
      'these variants have a video and no image at or below its seq. Their PDP gallery leads with ' +
        'the video tile and every image slide and thumbnail stays a skeleton. Fix in data (renumber ' +
        'images from 1) or in the gallery (clear the loading state when the first slide is a video).'
    ).toEqual([]);
  });

  // THE CONTROL CASE. "Skeletons in view" is also what a page that failed to
  // load looks like, and what this probe would report if the gallery's markup
  // changed under it. This proves the same reading finds a settled gallery on a
  // video product whose images sort first.
  test('a video product whose images sort first settles its gallery', async ({ page }) => {
    test.setTimeout(90000);
    const control = variants.find((v) => v.isMaster && v.inStock && !v.opensOnVideo);
    expect(control, 'no healthy master variant of a video product to use as a control').toBeTruthy();

    await page.goto(pdp(control), { waitUntil: 'domcontentloaded' });
    await expect
      .poll(() => readGallery(page, control.imageUrls), {
        message: `${label(control)} — a healthy gallery did not read as healthy, so the next test proves nothing`,
        timeout: 30000,
      })
      .toEqual({ imagesRendered: true, skeletonsInView: 0 });
  });

  test('a variant that sorts its images after the video still settles its gallery', async ({ page }) => {
    test.setTimeout(90000);
    const affected = variants.filter((v) => v.opensOnVideo);
    test.skip(affected.length === 0, 'no variant sorts every image after the video today — not a pass, nothing to render');

    // Prefer an in-stock variant: that is the one a shopper can actually buy.
    const target = affected.find((v) => v.inStock) || affected[0];

    await page.goto(pdp(target), { waitUntil: 'domcontentloaded' });
    await expect
      .poll(() => readGallery(page, target.imageUrls), {
        message: `${label(target)} — gallery led with the video and its image skeletons never cleared`,
        timeout: 30000,
      })
      .toEqual({ imagesRendered: true, skeletonsInView: 0 });
  });
});
