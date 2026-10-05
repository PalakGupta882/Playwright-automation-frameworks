// tests/scripts/extract-video-frames.spec.js
//
// Pulls still frames out of a local screen recording so they can be read.
//
// Playwright ships an ffmpeg, but it is a stripped build for its own WebM/VP8
// recording and cannot demux an H.264 MP4 — it fails with "Invalid data found
// when processing input" on a perfectly valid file. Chrome decodes H.264
// natively, so the browser is the decoder: load the file in a <video>, seek, and
// screenshot each frame.
//
// Local file only. No network, no site, no session.

const fs = require('fs');
const path = require('path');
const { test } = require('@playwright/test');

const VIDEO = process.env.VIDEO_PATH;
const OUT_DIR = process.env.FRAME_DIR;
// Frames are for reading price panels, so default to a slow sweep.
const EVERY_SECONDS = Number(process.env.FRAME_INTERVAL || 3);

test('extract frames from a local recording', async ({ page }) => {
  test.setTimeout(600000);
  test.skip(!VIDEO || !OUT_DIR, 'set VIDEO_PATH and FRAME_DIR');

  fs.mkdirSync(OUT_DIR, { recursive: true });

  // The page must be SERVED FROM file://, and from the video's own directory.
  //
  // page.setContent() produces an about:blank document, and Chrome refuses to
  // load a file:// media resource from that origin — measured: readyState stayed
  // 0 for twenty seconds with no error event, which reads like a codec problem
  // and is not one. Copying the recording next to a generated player and
  // navigating to the player makes both same-origin, and a relative src sidesteps
  // path-encoding trouble with spaces in the filename.
  const localName = 'recording' + path.extname(VIDEO);
  fs.copyFileSync(path.resolve(VIDEO), path.join(OUT_DIR, localName));

  const playerPath = path.join(OUT_DIR, 'player.html');
  fs.writeFileSync(
    playerPath,
    `<body style="margin:0;background:#000">
       <video id="v" src="${localName}" style="width:1600px;display:block"></video>
     </body>`
  );

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.goto('file:///' + playerPath.replace(/\\/g, '/'));

  const video = page.locator('#v');
  await video.waitFor({ state: 'attached' });

  // Bounded. Without a timeout this hangs forever when the file never reaches
  // readyState 1 — measured: a run sat for ten minutes producing nothing,
  // because neither loadedmetadata nor error ever fired. A stall has to be
  // reportable, not indefinite.
  const meta = await page.evaluate(
    () =>
      new Promise((resolve) => {
        const v = document.getElementById('v');
        const done = (result) => resolve(result);
        if (v.readyState >= 1) return done({ duration: v.duration, why: 'ready' });
        v.onloadedmetadata = () => done({ duration: v.duration, why: 'loadedmetadata' });
        v.onerror = () =>
          done({
            duration: -1,
            why: `error code ${v.error && v.error.code}: ${v.error && v.error.message}`,
          });
        setTimeout(
          () => done({ duration: -1, why: `timed out at readyState ${v.readyState}` }),
          20000
        );
      })
  );

  const duration = meta.duration;
  if (!(duration > 0)) {
    console.log(
      `Chrome could not decode the video: ${meta.why}.\n` +
        'If this is an H.264 MP4, headless Chromium lacks the codec — the config uses ' +
        'channel "chrome", which normally has it. Try --headed, or convert the file.'
    );
    return;
  }
  console.log(`duration ${duration.toFixed(1)}s — sampling every ${EVERY_SECONDS}s`);

  let index = 0;
  for (let t = 0; t < duration; t += EVERY_SECONDS) {
    const ok = await page.evaluate(
      (time) =>
        new Promise((resolve) => {
          const v = document.getElementById('v');
          v.onseeked = () => resolve(true);
          v.currentTime = time;
          setTimeout(() => resolve(false), 5000);
        }),
      t
    );
    if (!ok) continue;

    index += 1;
    const file = path.join(OUT_DIR, `f_${String(index).padStart(3, '0')}_t${Math.round(t)}s.png`);
    await video.screenshot({ path: file });
  }

  console.log(`wrote ${index} frames to ${OUT_DIR}`);
});
