# Product Video feature — automation coverage

Traceability for the 53 E2E cases in
`.claude/BytePe-Video-Feature-E2E-Test-Suite-Full-Coverage (1).xlsx`.

**32 of 53 automated, 21 not automatable from this repo.**

Of the 32, six (VID-42/43/44/45/46/51) describe video-player behaviour and
currently **skip**: the web PDP mounts no player, and that is confirmed
expected as of 20 Aug 2026 rather than a defect. See the section below.

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

## The player on web — CONFIRMED EXPECTED, not a blocker

**Status 20 Aug 2026: the web PDP mounting no player is intended behaviour.**
It was previously recorded here as the feature's blocker and six tests were
written to fail until it was "fixed". Product has confirmed there is nothing
to fix on web. Do not re-report it.

Content is live. As of 11 Aug 2026, **35 of 186 products have a video**
(`tests/data/video-products.json`, from `discover-video-products.spec.js`).
The API side passes in full: VID-24, VID-25 and VID-26 are green.

What the web PDP does, measured on four video-enabled products:

| Product | API | Gallery slots | Thumbnails rendered | Empty slot | `<video>` |
|---|---|---|---|---|---|
| phone-4b | 6 img + 1 video | 7 | 0,1,2,4,5,6 | 3 | 0 |
| edge-70-pro | 10 img + 1 video | 11 | 0,1,2,3,4,6–10 | 5 | 0 |
| kilburn-iii | 8 img + 1 video | 9 | 0,1,2,3,5,6,7,8 | 4 | 0 |
| galaxy-watch-ultra2 | 6 img + 1 video | 7 | 0,1,2,4,5,6 | 3 | 0 |

Slots always equal images + 1: the gallery accounts for the video and renders
nothing into it. `manifest.mpd` is present in the serialised payload, so the
client receives the URL and does not mount a player.

**How this is now tested.** `video-pdp-rendering.spec.js` carries one contract
test that asserts exactly this state — the API serves a video and the PDP
mounts no player. It is non-vacuous: it first proves the product really has a
video, so it cannot pass just because there was nothing to play.

VID-42/43/44/45/46/51 all describe player behaviour, so they **skip** with that
reason rather than failing. If a player ever ships on web, the contract test
fails first and points at the file — un-skip the six and they are ready.

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

### PDP rendering (`tests/regression/video-pdp-rendering.spec.js`)

| TC | Scenario | Status |
|---|---|---|
| — | API serves a video, web PDP mounts no player | **runs** — the standing contract |
| VID-42 | Plays inline, native controls, `playsinline`, currentTime advances | skipped — no player on web |
| VID-43 | Poster attribute set and the poster URL resolves (200) | skipped — no player on web |
| VID-44 | Thumbnail bar stays aligned | skipped — no player on web |
| VID-45 | No audible autoplay on scroll into view | skipped — no player on web |
| VID-46 | Buffers on a throttled connection without a broken tile | skipped — no player on web |
| VID-51 | `preload` is `none`/`metadata`; core PDP content still prompt | skipped — no player on web |

Selectors in `tests/pages/productVideoPage.js` were written against the feature
spec and standard HTML5 media markup and have **never been confirmed against a
rendered player**, because none exists on web. Verify them if a player ships;
every skipped test above routes through that one file.

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

VID-35 and VID-38 remain open bugs in the sheet. Where automated (VID-17 as the
API-level twin of VID-38), they assert the **correct** behaviour and will fail
until fixed, rather than encoding the bug as expected.

VID-44 was previously listed here. It is part of the no-player-on-web state
that is now confirmed expected, so it skips with the rest rather than failing.

## Unblocking the rest

1. **360 Panel** (15 cases) — needs the panel URL, an admin login that can be
   saved as a second storage state, and video fixtures (valid MP4, oversized,
   corrupt, portrait, landscape).
2. **Mobile browsers** (VID-49) — add `webkit` and mobile-Chrome projects to
   `playwright.config.js`; no new credentials needed.
3. **SLA cases** (VID-35, VID-50) — get a threshold from dev/PM, then they
   become assertable.
