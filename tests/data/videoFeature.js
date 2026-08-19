// tests/data/videoFeature.js
//
// Shared configuration for the Product Video feature suite (VID-01..VID-53).
//
// The public storefront API needs no credentials. The admin API does, and its
// host is not committed here — set it in the environment:
//
//   setx BYTEPE_API_URL   "https://<admin-api-host>"
//   setx BYTEPE_ADMIN_JWT "<admin jwt>"
//
// Specs that need those skip themselves with a readable reason when unset,
// rather than failing with a connection error.

// Verified live: this is the origin the PDP itself calls.
const PUBLIC_API = 'https://www.bytepe.com/api/product-service';

// VID-26 pins the manifest URL to this bucket.
// Corrected 11 Aug 2026, once real video content existed to measure against.
// The default was 'bytepestorage', taken from the feature sheet; every live
// videoUrl is served from 'bytepestorage-prod':
//
//   https://storage.googleapis.com/bytepestorage-prod/videos/<uuid>/manifest.mpd
//
// VID-26 failed on that mismatch alone — the URL shape was otherwise exactly
// as specified, down to the .mpd manifest.
const GCS_BUCKET = process.env.BYTEPE_GCS_BUCKET || 'bytepestorage-prod';

const adminApi = {
  baseUrl: process.env.BYTEPE_API_URL || '',
  token: process.env.BYTEPE_ADMIN_JWT || '',

  // VID-01/16/23 create and delete real rows. Requiring an explicit opt-in
  // keeps a stray `npm test` from mutating whatever BYTEPE_API_URL points at.
  writesAllowed: process.env.BYTEPE_ALLOW_WRITES === '1',
};

function adminConfigured() {
  return Boolean(adminApi.baseUrl && adminApi.token);
}

const ADMIN_SKIP_REASON =
  'BYTEPE_API_URL / BYTEPE_ADMIN_JWT are not set — admin video API not reachable';

const WRITE_SKIP_REASON =
  'Set BYTEPE_ALLOW_WRITES=1 to permit tests that create or delete video records';

// GET /apps/products/by-slug/:slug/:bpid  — public, returns data.product.videos[]
function pdpApiPath(slug, bpid) {
  return `${PUBLIC_API}/apps/products/by-slug/${slug}/${bpid}`;
}

// VID-26: https://storage.googleapis.com/<bucket>/videos/<videoServiceId>/manifest.mpd
function expectedManifestUrl(videoServiceId, bucket = GCS_BUCKET) {
  return `https://storage.googleapis.com/${bucket}/videos/${videoServiceId}/manifest.mpd`;
}

// Pull the videos array out of the PDP envelope: { status, message, data: { product } }
function videosFromPdpPayload(body) {
  const product = (body && body.data && body.data.product) || {};
  return Array.isArray(product.videos) ? product.videos : [];
}

module.exports = {
  PUBLIC_API,
  GCS_BUCKET,
  adminApi,
  adminConfigured,
  ADMIN_SKIP_REASON,
  WRITE_SKIP_REASON,
  pdpApiPath,
  expectedManifestUrl,
  videosFromPdpPayload,
};
