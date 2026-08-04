// tests/regression/video-pdp-api.spec.js
//
// VID-24, VID-25, VID-26 — the public PDP video surface.
//
// Public endpoint, so this file runs logged out on purpose: the storageState
// from playwright.config.js would otherwise make responses shopper-specific
// and hide a bug where videos leak only for authenticated users.

const { test, expect } = require('../fixtures/pageFixtures');
const {
  pdpApiPath,
  expectedManifestUrl,
  videosFromPdpPayload,
  GCS_BUCKET,
} = require('../data/videoFeature');
const discovered = require('../data/video-products.json');

test.use({ storageState: { cookies: [], origins: [] } });

// A product known to exist, used for contract checks that don't need a video.
const CONTRACT_PRODUCT = { slug: 'iphone-17-pro', bpid: 'APPSMMOBRATANE' };

const videoProduct = discovered.products[0];
const NO_VIDEO_REASON =
  'No product in tests/data/video-products.json has a live video. ' +
  'Re-run: npx playwright test scripts/discover-video-products.spec.js --project=chromium';

test.describe('PDP video surface (public API)', () => {
  // Guards the contract itself: if `videos` ever disappears from the payload,
  // every video assertion below would silently degrade to "no videos found".
  test('PDP payload exposes a videos array on the product', async ({ request }) => {
    test.setTimeout(60000);

    const res = await request.get(pdpApiPath(CONTRACT_PRODUCT.slug, CONTRACT_PRODUCT.bpid), {
      headers: { accept: 'application/json' },
    });
    expect(res.status()).toBe(200);

    const body = await res.json();
    expect(body).toHaveProperty('data.product');
    expect(
      Array.isArray(body.data.product.videos),
      'product.videos must be an array — the PDP video contract is gone if this fails'
    ).toBe(true);
  });

  // VID-24 — active video via active mapping is returned with name + manifest URL.
  test('VID-24: PDP returns an active video with videoName and videoUrl', async ({ request }) => {
    test.skip(!videoProduct, NO_VIDEO_REASON);
    test.setTimeout(60000);

    const res = await request.get(pdpApiPath(videoProduct.slug, videoProduct.bpid), {
      headers: { accept: 'application/json' },
    });
    expect(res.status()).toBe(200);

    const videos = videosFromPdpPayload(await res.json());
    expect(videos.length).toBeGreaterThan(0);

    for (const video of videos) {
      expect(video.videoName, 'every surfaced video needs a name').toBeTruthy();
      expect(video.videoUrl, 'every surfaced video needs a manifest URL').toBeTruthy();
    }
  });

  // VID-25 — the active-only rule. Without admin access we cannot toggle a video
  // to deactive and re-check, so this asserts the invariant that must hold at
  // all times: nothing the PDP surfaces is marked inactive.
  test('VID-25: PDP never surfaces a deactive video or mapping', async ({ request }) => {
    test.skip(!videoProduct, NO_VIDEO_REASON);
    test.setTimeout(60000);

    const res = await request.get(pdpApiPath(videoProduct.slug, videoProduct.bpid), {
      headers: { accept: 'application/json' },
    });
    const videos = videosFromPdpPayload(await res.json());
    expect(videos.length).toBeGreaterThan(0);

    for (const video of videos) {
      // The field is only present on some payload shapes; when it is, it must be active.
      if ('status' in video) expect(video.status).toBe('active');
      if ('mappingStatus' in video) expect(video.mappingStatus).toBe('active');
      if ('deletedAt' in video) expect(video.deletedAt).toBeNull();
    }
  });

  // VID-26 — manifest URL is the GCS .mpd for that videoServiceId.
  test('VID-26: video carries the correct GCS manifest URL', async ({ request }) => {
    test.skip(!videoProduct, NO_VIDEO_REASON);
    test.setTimeout(60000);

    const res = await request.get(pdpApiPath(videoProduct.slug, videoProduct.bpid), {
      headers: { accept: 'application/json' },
    });
    const [video] = videosFromPdpPayload(await res.json());
    expect(video).toBeTruthy();

    expect(video.videoUrl).toMatch(
      new RegExp(`^https://storage\\.googleapis\\.com/${GCS_BUCKET}/videos/.+/manifest\\.mpd$`)
    );

    // When the payload names the service id, pin the URL to it exactly.
    if (video.videoServiceId) {
      expect(video.videoUrl).toBe(expectedManifestUrl(video.videoServiceId));
    }

    // The manifest must actually be fetchable, or the player has nothing to load.
    const manifest = await request.get(video.videoUrl, { failOnStatusCode: false });
    expect(manifest.status(), `manifest not retrievable at ${video.videoUrl}`).toBe(200);
  });
});
