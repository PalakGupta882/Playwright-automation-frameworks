// tests/pages/productVideoPage.js
//
// PDP media gallery, video-specific. Backs VID-42..VID-46 and VID-51.
//
// SELECTORS VERIFIED 11 Aug 2026, once 35 of 186 products had live video.
// The caveat that used to sit here — "not confirmed against a rendered player"
// — has been discharged, and the answer was not a selector problem.
//
// THERE IS NO PLAYER TO SELECT. Measured on three video-enabled products:
//
//   product      API                 gallery slots  thumbs rendered   missing  <video>
//   phone-4b     6 images + 1 video  7              0,1,2,4,5,6       3        0
//   edge-70-pro  10 images + 1 video 11             0,1,2,3,4,6..10   5        0
//   kilburn-iii  8 images + 1 video  9              0,1,2,3,5,6,7,8   4        0
//
// In every case the gallery reserves a slot for the video — slots always equal
// images + 1 — and then renders nothing into it. The customer sees a gap in the
// thumbnail strip and has no way to play the video. `manifest.mpd` is present
// in the page's serialised payload, so the client receives the URL and simply
// never mounts a player for it.
//
// So VID-42/43/45/46/51 fail here, and that is correct: they assert the
// behaviour the feature promises, and the feature does not deliver it. Do not
// convert them to skips — a skip would say "we could not check", when what we
// actually know is "we checked, and it is broken".
//
// diagnoseMissingPlayer() below turns the resulting failure from an opaque
// "waiting for locator('video')" into that measurement.

const { BasePage } = require('./basePage');
const { BASE_URL } = require('../data/constants');

class ProductVideoPage extends BasePage {
  constructor(page) {
    super(page);

    // The <video> element itself — the thing that must actually play.
    this.videoElement = page.locator('video').first();

    // Gallery strip of image/video thumbnails beside or below the main media.
    this.mediaThumbnailBar = page
      .locator('[class*="thumb"], [data-testid*="thumb"]')
      .first();

    // Clickable video entry in that strip.
    this.videoThumbnail = page
      .locator('[class*="video"], [data-testid*="video"]')
      .filter({ has: page.locator('img, video, svg') })
      .first();

    // Shown while transcoding hasn't finished (VID-35's known bug surfaces here).
    this.processingNotice = page.getByText(/still processing/i);
  }

  async gotoProduct(slug, bpid) {
    await this.page.goto(`${BASE_URL}/pd/${slug}/${bpid}`, {
      waitUntil: 'domcontentloaded',
    });
  }

  async hasVideo() {
    return (await this.videoElement.count()) > 0;
  }

  // Explains WHY there is no player, so a failure reads as the product bug it
  // is rather than as a broken locator.
  //
  // The gallery numbers its thumbnails "Thumbnail N" and reserves one index per
  // media item, video included. When the video does not render, that index is
  // simply absent from the DOM — so the gap is measurable, and its position
  // tells you the video was accounted for and then dropped.
  async diagnoseMissingPlayer() {
    const alts = await this.page
      .locator('img[alt^="Thumbnail"]')
      .evaluateAll((nodes) => nodes.map((n) => n.alt));

    const indices = [...new Set(alts)]
      .map((alt) => Number(String(alt).replace(/\D/g, '')))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => a - b);

    const slots = indices.length ? Math.max(...indices) + 1 : 0;
    const missing = [];
    for (let i = 0; i < slots; i++) {
      if (!indices.includes(i)) missing.push(i);
    }

    const players = await this.videoElement.count();

    return (
      `No <video> element on the page (found ${players}).\n` +
      `  gallery slots reserved : ${slots}\n` +
      `  thumbnails rendered    : [${indices.join(', ')}]\n` +
      `  slot rendering nothing : [${missing.join(', ')}]\n` +
      'A slot is reserved for the video and left empty — the customer sees a gap\n' +
      'in the thumbnail strip and cannot play the video. The manifest URL IS in\n' +
      "the page payload, so the client has it and never mounts a player."
    );
  }

  async openVideo() {
    if (await this.videoThumbnail.isVisible().catch(() => false)) {
      await this.waitAndClick(this.videoThumbnail);
    }
    await this.videoElement.scrollIntoViewIfNeeded();
  }

  // Read live media state straight off the element — more reliable than
  // asserting on control chrome, which is skinned differently per player.
  async mediaState() {
    return this.videoElement.evaluate((v) => ({
      paused: v.paused,
      muted: v.muted,
      volume: v.volume,
      autoplay: v.autoplay,
      controls: v.controls,
      preload: v.preload,
      poster: v.poster || '',
      readyState: v.readyState,
      networkState: v.networkState,
      currentTime: v.currentTime,
      duration: Number.isFinite(v.duration) ? v.duration : null,
      videoWidth: v.videoWidth,
      videoHeight: v.videoHeight,
    }));
  }

  async play() {
    await this.videoElement.evaluate((v) => v.play().catch(() => {}));
  }

  // Advancing currentTime is the only trustworthy proof that playback started.
  async waitForPlaybackProgress(timeout = 15000) {
    await this.page.waitForFunction(
      () => {
        const v = document.querySelector('video');
        return v && !v.paused && v.currentTime > 0;
      },
      undefined,
      { timeout }
    );
  }

  async throttleNetwork(downloadKbps = 400) {
    const client = await this.page.context().newCDPSession(this.page);
    await client.send('Network.enable');
    await client.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 400,
      downloadThroughput: (downloadKbps * 1024) / 8,
      uploadThroughput: (downloadKbps * 1024) / 8,
    });
    return client;
  }
}

module.exports = { ProductVideoPage };
