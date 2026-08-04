// tests/regression/video-pdp-rendering.spec.js
//
// VID-42..VID-46 and VID-51 — how the video actually renders and behaves on a
// public product page.
//
// Every test here needs a product with a live video. None existed when this was
// written, so they skip with a pointer to the discovery script rather than
// passing against an empty gallery — a green run on a product with no video
// would be worse than no test at all.

const { test, expect } = require('../fixtures/pageFixtures');
const { ProductVideoPage } = require('../pages/productVideoPage');
const discovered = require('../data/video-products.json');

test.use({ storageState: { cookies: [], origins: [] } });

const videoProduct = discovered.products[0];
const NO_VIDEO_REASON =
  'No product in tests/data/video-products.json has a live video. ' +
  'Re-run: npx playwright test scripts/discover-video-products.spec.js --project=chromium';

test.describe('PDP video rendering', () => {
  test.skip(!videoProduct, NO_VIDEO_REASON);

  /** @type {ProductVideoPage} */
  let media;

  test.beforeEach(async ({ page }) => {
    media = new ProductVideoPage(page);
    await media.gotoProduct(videoProduct.slug, videoProduct.bpid);
  });

  // VID-42 — plays inline, controls work.
  test('VID-42: video plays inline with working controls', async () => {
    test.setTimeout(90000);

    await expect(media.videoElement).toBeVisible({ timeout: 20000 });
    await expect(
      media.processingNotice,
      'video is stuck in processing — see VID-35'
    ).toHaveCount(0);

    await media.openVideo();

    const before = await media.mediaState();
    expect(before.controls, 'player must expose native controls').toBe(true);
    // playsinline is what keeps iOS from hijacking into fullscreen.
    await expect(media.videoElement).toHaveAttribute('playsinline', /.*/);

    await media.play();
    await media.waitForPlaybackProgress();

    const after = await media.mediaState();
    expect(after.paused).toBe(false);
    expect(after.currentTime).toBeGreaterThan(0);
  });

  // VID-43 — a real poster frame, not a black rectangle.
  test('VID-43: a meaningful poster frame renders before playback', async () => {
    test.setTimeout(60000);

    await expect(media.videoElement).toBeVisible({ timeout: 20000 });
    const state = await media.mediaState();

    expect(state.paused, 'must not have started playing on its own').toBe(true);
    expect(state.poster, 'video has no poster attribute').not.toBe('');

    // A poster that 404s renders as blank — the exact failure this catches.
    const res = await media.page.request.get(state.poster, { failOnStatusCode: false });
    expect(res.status(), `poster not retrievable at ${state.poster}`).toBe(200);
  });

  // VID-44 — KNOWN BUG: thumbnail bar shifts up once a video joins the gallery.
  // Asserted as the correct behavior so it fails until fixed.
  test('VID-44: media thumbnail bar stays aligned after a video is added', async () => {
    test.setTimeout(60000);

    await expect(media.videoElement).toBeVisible({ timeout: 20000 });
    await expect(media.mediaThumbnailBar).toBeVisible();

    const bar = await media.mediaThumbnailBar.boundingBox();
    const frame = await media.videoElement.boundingBox();
    expect(bar, 'thumbnail bar has no layout box').toBeTruthy();
    expect(frame, 'video has no layout box').toBeTruthy();

    // The strip belongs beside or beneath the media frame. Drifting above the
    // frame's top edge is exactly the reported misalignment.
    expect(
      bar.y,
      'thumbnail bar drifted above the media frame — VID-44 misalignment'
    ).toBeGreaterThanOrEqual(frame.y - 1);
  });

  // VID-45 — no autoplay with sound.
  test('VID-45: video does not autoplay with sound on scroll into view', async () => {
    test.setTimeout(60000);

    await expect(media.videoElement).toBeVisible({ timeout: 20000 });
    await media.videoElement.scrollIntoViewIfNeeded();
    await media.page.waitForTimeout(3000); // give any autoplay a chance to start

    const state = await media.mediaState();
    // Muted autoplay is acceptable; audible autoplay is not.
    if (!state.paused) {
      expect(state.muted, 'video autoplayed with sound').toBe(true);
    } else {
      expect(state.currentTime).toBe(0);
    }
  });

  // VID-46 — buffers gracefully instead of breaking the gallery.
  test('VID-46: video buffers gracefully on a slow connection', async ({ page }) => {
    test.setTimeout(120000);

    await media.throttleNetwork(400);
    await media.gotoProduct(videoProduct.slug, videoProduct.bpid);

    await expect(media.videoElement).toBeVisible({ timeout: 45000 });

    const state = await media.mediaState();
    // NETWORK_NO_SOURCE (3) means the player gave up — a broken media tile.
    expect(state.networkState, 'player reports no usable source').not.toBe(3);
    expect(await page.getByText(/broken|failed to load/i).count()).toBe(0);
  });

  // VID-51 — a large video must not block first render.
  test('VID-51: video does not block PDP initial load', async ({ page }) => {
    test.setTimeout(90000);

    const started = Date.now();
    await media.gotoProduct(videoProduct.slug, videoProduct.bpid);
    await expect(page.getByText(/buy now/i).first()).toBeVisible({ timeout: 20000 });
    const msToInteractiveContent = Date.now() - started;

    const state = await media.mediaState();
    // Deferred loading is the mechanism that keeps video off the critical path.
    expect(
      ['none', 'metadata'],
      `video preload="${state.preload}" pulls the whole file on load`
    ).toContain(state.preload);

    expect(
      msToInteractiveContent,
      'core PDP content took too long with a video present'
    ).toBeLessThan(15000);
  });
});
