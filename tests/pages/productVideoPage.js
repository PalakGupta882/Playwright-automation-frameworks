// tests/pages/productVideoPage.js
//
// PDP media gallery, video-specific. Backs VID-42..VID-46 and VID-51.
//
// SELECTOR CAVEAT: at the time of writing no product in the catalog had a live
// video (see tests/data/video-products.json), so these locators are derived
// from the feature spec and standard HTML5 media markup, NOT confirmed against
// a rendered player. When the first video goes live, verify each locator here
// — every video rendering test routes through this file, so it is the only
// place that needs correcting.

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
