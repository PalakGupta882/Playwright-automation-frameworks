# Product Video feature — automation coverage

Traceability for the 53 E2E cases in
`.claude/BytePe-Video-Feature-E2E-Test-Suite-Full-Coverage (1).xlsx`.

**32 of 53 automated, 21 not automatable from this repo.**

## Run it

```
npx playwright test regression/video-pdp-api.spec.js --project=chromium        # public, runs today
npx playwright test regression/video-pdp-rendering.spec.js --project=chromium  # needs a video-enabled product
npx playwright test regression/video-admin-api.spec.js --project=chromium      # needs admin creds
npx playwright test scripts/discover-video-products.spec.js --project=chromium # refresh video-products.json
```

## Environment

| Variable | Needed for | Notes |
|---|---|---|
| `BYTEPE_API_URL` | VID-01–23 | Admin API origin. Unset → whole file skips. |
| `BYTEPE_ADMIN_JWT` | VID-01–23 | Sent as `Authorization: Bearer`. |
| `BYTEPE_ALLOW_WRITES=1` | the write cases | Second gate so a plain `npm test` can never create or delete video rows. |
| `BYTEPE_TEST_PRODUCT_ID` | VID-16–22 | A product safe to map. |
| `BYTEPE_TEST_PRODUCT_ID_ALT` | VID-21 | Second product, for repointing. |
| `BYTEPE_GCS_BUCKET` | VID-26 | Defaults to `bytepestorage`. |

## Current blocker

As of the last catalog scan, **0 of 173 products had a live video**
(`tests/data/video-products.json`). The `product.videos` field is present and
returns `[]`, so the API contract is deployed — there is simply no content yet.

Until a video is published, VID-24/25/26 and VID-42–46/51 skip rather than pass.
That is deliberate: a green run against an empty gallery would assert nothing.
Re-run the discovery script once content exists.

## Coverage

### Automated — admin API (`tests/regression/video-admin-api.spec.js`)

| TC | Scenario | Gate |
|---|---|---|
| VID-01 | Create with valid videoServiceId + videoName | writes |
| VID-02 | Create without videoName → 400 | writes |
| VID-03 | Duplicate videoServiceId → 409 | writes |
| VID-04 | Create without admin token → 401/403 | creds |
| VID-05 | List paginated, newest first, soft-deleted excluded | creds |
| VID-06 | Get one by internal id | creds |
| VID-07 | Get non-existent → 404 | creds |
| VID-08 | Update videoName | writes |
| VID-09 | videoName optional on PUT (partial update) | writes |
| VID-10 | Update to duplicate videoServiceId → 409 | writes |
| VID-11, VID-12 | Status toggle both directions (one round trip) | writes |
| VID-13 | Search by name substring | creds |
| VID-14 | Search case-insensitive | creds |
| VID-15 | Search no longer matches videoServiceId | creds |
| VID-16 | Add product mapping | writes + product |
| VID-17 | Duplicate mapping → 409 | writes + product |
| VID-18 | Mapping non-existent product → 404 | writes |
| VID-19 | List mappings, oldest first, product resolved | writes + product |
| VID-20 | Filter mappings by status | writes + product |
| VID-21 | Repoint mapping to another product | writes + 2 products |
| VID-22 | Toggle mapping status | writes + product |
| VID-23 | Soft delete releases the videoServiceId | writes |

Routes and status codes come from the sheet and have **not** been executed
against a live API. Expect to adjust response envelope field names on first run.

### Automated — public PDP API (`tests/regression/video-pdp-api.spec.js`)

| TC | Scenario | Note |
|---|---|---|
| — | `product.videos` exists on the payload | Contract guard; runs today, no video needed |
| VID-24 | Active video surfaced with videoName + videoUrl | needs a video-enabled product |
| VID-25 | Deactive video/mapping excluded | **partial** — see below |
| VID-26 | Manifest URL is the GCS `.mpd`, and fetchable | needs a video-enabled product |

VID-25 is only partially verifiable here. Proving *exclusion* means toggling a
video to `deactive` and re-reading the PDP, which needs admin access. What this
asserts instead is the standing invariant: nothing the PDP surfaces carries an
inactive marker. Full verification belongs with the admin credentials.

### Automated — PDP rendering (`tests/regression/video-pdp-rendering.spec.js`)

| TC | Scenario |
|---|---|
| VID-42 | Plays inline, native controls, `playsinline`, currentTime advances |
| VID-43 | Poster attribute set and the poster URL actually resolves (200) |
| VID-44 | Thumbnail bar stays aligned — **known bug, asserted as correct** |
| VID-45 | No audible autoplay on scroll into view |
| VID-46 | Buffers on a throttled connection without a broken media tile |
| VID-51 | `preload` is `none`/`metadata`; core PDP content still renders promptly |

All gated on a video-enabled product. Selectors in
`tests/pages/productVideoPage.js` were written against the feature spec and
standard HTML5 media markup — **not confirmed against a rendered player**,
because none existed. Verify them when the first video goes live; every test
above routes through that one file.

### Not automatable from this repo

| TC | Scenario | Why |
|---|---|---|
| VID-27 | Upload valid video via Add Video modal | 360 Panel app — URL and admin login not configured here |
| VID-28 | Unsupported format rejected | 360 Panel + real file fixtures |
| VID-29 | Oversized file rejected | 360 Panel + a large fixture |
| VID-30 | Corrupt file handled gracefully | 360 Panel + a corrupt fixture |
| VID-31 | Blocked when Video Name empty | 360 Panel |
| VID-32 | Cancel mid-upload leaves no orphan | 360 Panel |
| VID-33 | Replace video via Edit Video | 360 Panel |
| VID-34 | Upload doesn't overwrite product images | 360 Panel |
| VID-35 | Long video completes within SLA | 360 Panel upload + no agreed SLA (**known bug**) |
| VID-36 | Upload on throttled network | 360 Panel |
| VID-37 | Map product via Manage Products search | 360 Panel |
| VID-38 | Duplicate mapping rejected in UI | 360 Panel (**known bug**; API equivalent covered by VID-17) |
| VID-39 | Unmap a product | 360 Panel |
| VID-40 | Product search suggestions | 360 Panel |
| VID-41 | Repoint mapping via UI | 360 Panel (API equivalent covered by VID-21) |
| VID-47 | Renders consistently on web, iOS, Android | Native apps — outside Playwright |
| VID-48 | Portrait and landscape aspect ratios | Needs both orientations uploaded first |
| VID-49 | Safari (iOS) and Chrome (Android) mobile | Config has only a desktop `chromium` project |
| VID-50 | Processing completes within SLA | No agreed SLA threshold; sheet says confirm with dev/PM |
| VID-52 | Non-admin blocked from video management UI | 360 Panel (API equivalent covered by VID-04) |
| VID-53 | Deleting a product cleans up mappings | Requires deleting a catalog product — too destructive to automate against production |

### Known bugs

VID-35, VID-38 and VID-44 are open bugs in the sheet. Where automated (VID-44,
and VID-17 as the API-level twin of VID-38), they assert the **correct**
behavior and will fail until fixed, rather than encoding the bug as expected.

## Unblocking the rest

1. **360 Panel** (15 cases) — needs the panel URL, an admin login that can be
   saved as a second storage state, and video fixtures (valid MP4, oversized,
   corrupt, portrait, landscape).
2. **Mobile browsers** (VID-49) — add `webkit` and mobile-Chrome projects to
   `playwright.config.js`; no new credentials needed.
3. **SLA cases** (VID-35, VID-50) — get a threshold from dev/PM, then they
   become assertable.
