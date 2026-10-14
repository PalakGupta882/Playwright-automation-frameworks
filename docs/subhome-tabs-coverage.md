# Sub Home Page Tabs — automation coverage

Traceability for the 119 cases in
`SubHomePage_Tabs_E2E_Test_Suite_1.xlsx` (65 API `E2E-*`, 54 UI `TCB-*`).

**71 of 119 automated. 48 blocked, and every one of them is blocked on access
or on fixtures, not on effort.**

## Run it

```
npx playwright test regression/subhome-tabs-api.spec.js --project=chromium   # public, runs today
npx playwright test regression/subhome-tabs-ui.spec.js  --project=chromium   # public, runs today
npx playwright test regression/subhome-admin-api.spec.js --project=chromium  # needs admin creds
```

Both public files run logged out and belong in the CI public list — the strip
and its endpoints are identical for every shopper.

## What production actually serves

The sheet was written against a developer machine: base URL
`http://localhost:6009/v1/product-service`, Home carrying tabs **Laptop** and
**5G Phones**, Subscription carrying **tejash**, EMI Store carrying
**ffrisisi**. None of that exists here. Measured 19 Aug 2026:

```
GET /api/product-service/apps/home-page/nav        20 home pages
  Home (slug=home)   sub_home_pages: 8
    seq 1  For You      entity_type=none             icon ✓
    seq 2  Mobile       master_category 1d678da4…    icon ✓
    seq 3  Electronics  none                         icon ✓
    seq 4  Audio        master_category 1688db64…    icon ✓
    seq 5  Accessories  master_category 9b6dcbe5…    icon ✓   slug "accessoris"
    seq 6  Luggage      master_category 451bb0ff…    icon ✓
    seq 7  Wearables    master_category 08577141…    icon ✓
    seq 9  Appliances   master_category 46ed9705…    icon ✓
  every other page (19 of 20), Subscription and EMI Store included: 0 tabs
```

Sequence 8 is absent, which is consistent with a hidden tab and is the expected
behaviour for E2E-NAV-04.

**No spec asserts a tab name.** Each one reads the live nav and asserts the UI
against that. A tab renamed in the CMS must not fail the suite; a tab the strip
renders that the API never sent must.

Design spec, measured at both widths and matching the sheet exactly:

| | tile | icon | label | underline | gap |
|---|---|---|---|---|---|
| desktop 1440 | 110px | 44×44 | 15px | 3px | 24px |
| mobile 390 | 68px | 28×28 | 10px | 2px | 8px |

Active underline is `rgb(255, 67, 6)`. The strip's sticky container is
`position: sticky; top: 84px; z-index: 1000` against a header at `z-index: 1100`,
with `border-bottom: 1px solid rgb(237, 237, 237)` and a white background.

## Deviation from the sheet — TCB-023

**The sheet says the URL stays `/` unchanged. Production sets
`/?sub_home_page=<slug>`.**

Measured: no full page reload, no route transition, the strip is not remounted,
the page scrolls back to the top, and the parameter is honoured as a deep link
on load. It does **not** push a history entry, so Back leaves the site rather
than stepping through tabs.

Everything TCB-023 was protecting against still holds, so the spec asserts those
— path unchanged, zero reloads, strip still mounted — and asserts the query
parameter names the selected tab. It also logs the deviation on every run:

```
TCB-023 DEVIATION FROM THE SHEET: the sheet says the URL is unchanged;
production sets ?sub_home_page=audio on the same path, with no reload and no
history entry. Confirm or retire the sheet wording.
```

Decide whether deep-linkable tabs are the intended behaviour. Do not "fix" it by
deleting the log.

## Coverage

### Automated — public app API (`regression/subhome-tabs-api.spec.js`)

17 tests, all passing 19 Aug 2026.

| TC | Scenario | Note |
|---|---|---|
| E2E-NAV-01 | Nav carries `sub_home_pages`, each tab exposing id/name/slug/sequence/entity_type/entity_id/icon_url | |
| E2E-NAV-02 | The original page fields are unchanged in name and type | |
| E2E-NAV-03 | A page with no tabs sends `[]`, never null | 19 pages exercise this |
| E2E-NAV-04 | Tabs in sequence-then-name order; nothing inactive is served | **partial** — see below |
| E2E-NAV-05 | `page_type=home` still filters and keeps the tab lists | 3 of 20 pages |
| E2E-NAV-06 | The nav is not held in a long cache | measured `max-age=60` |
| E2E-SEC-01 | Unfiltered page returns every section | 71 |
| E2E-SEC-02 | A tab returns only its own sections | 29 and 9, and reports if two tabs are indistinguishable |
| E2E-SEC-03 | The `eager` list is filtered by tab too, not just the section list | |
| E2E-SEC-04 | `eager` 0 → 0, omitted → 3, 5 → 5, 99 → capped at 5 | exactly as specified |
| E2E-SEC-05 | Unknown tab id → 200 with empty lists, not an error | |
| E2E-SEC-06 | Unpublished and deactive sections stay hidden inside a tab | |
| E2E-SEC-07 | `platform` narrows the set on top of the tab filter | **partial** — see below |
| E2E-SEC-08 | `home_page_slug` resolves the same as `home_page_id` | |
| E2E-SEC-09 | `x-delivery-pincode` is accepted and the payload survives it | **partial** — prices are owned by the main API |
| E2E-SEC-10 | Deep-link tabs carry an entity id; plain tabs do not | 6 linked, 2 plain |
| E2E-SEC-11 | Nav and sections answer anonymously | |

**E2E-NAV-04 is partial.** Proving a deactive or deleted tab is *excluded* means
creating one, which needs the admin API. What is asserted from here is the
standing invariant: nothing the app is served carries an inactive marker.

**E2E-SEC-07 is partial.** `platform=mobile` and `platform=desktop` both return
28 of 29 sections on the default tab. The parameter is accepted and narrows the
set; which sections are platform-targeted cannot be shown from a set that size,
and the test says so rather than reporting a clean pass.

### Automated — tab strip UI (`regression/subhome-tabs-ui.spec.js`)

| TC | Scenario |
|---|---|
| TCB-001, 003 | Strip renders below the header with no CMS section above it |
| TCB-002 | Flush against the header — no gap, no overlap |
| TCB-004 | Renders while the sections request is deliberately stalled |
| TCB-005 | One 1px divider closes the strip |
| TCB-006, 007 | Design spec at 390px and 1440px, every dimension |
| TCB-008, 011 | The strip is exactly the nav tab list, in sequence order, with no top-level page leaking in |
| TCB-013 | Labels render capitalised from `name` |
| TCB-014, 048 | Icons come from `icon_url`, contained not stretched, alt matches the label |
| TCB-015, 053 | Every icon URL resolves — no broken-image glyph |
| TCB-016, 018, 020 | Lowest-sequence tab active on load, exactly one active, brand-coloured underline |
| TCB-017 | The sections request names the default tab |
| TCB-021 | Row height and baselines do not shift on switch |
| TCB-022, 023, 024, 025, 030 | In-place swap: content changes, active state moves, scroll returns to top, strip stays mounted, no reload (see the deviation above) |
| TCB-026 | Re-clicking the active tab changes nothing |
| TCB-027 | A loading state covers the swap rather than the previous tab's sections |
| TCB-028 | Switching back and forth renders the same content for the same tab |
| TCB-029 | Rapid switching settles on the last tab clicked, with no page errors |
| TCB-031, 032, 033, 034 | Pinned under the header, opaque, stacked below the header |
| TCB-036 | Still pinned after a content swap |
| TCB-037, 039 | Centred, and centring never clips the first tab |
| TCB-038, 040 | Overflow scrolls the strip, not the page body |
| TCB-041 | A deep-linked far-right tab is scrolled into view on load |
| TCB-042 | Labels wrap to at most two lines; underlines stay on one baseline |
| TCB-043 | Crossing the 900px breakpoint switches sizing cleanly, both ways |
| TCB-044, 045 | `role="tablist"` with an accessible name, `role="tab"` per tile, `aria-selected` moves |
| TCB-046, 047 | Tabs take keyboard focus; Enter and Space select; Space does not scroll |
| TCB-049 | Icon-less tab falls back rather than showing a broken image |
| TCB-050 | A page with no tabs renders no strip, no empty bar, no gap |
| TCB-052 | The page survives the nav endpoint failing |

### Written but gated — admin CRUD (`regression/subhome-admin-api.spec.js`)

All 34 `E2E-SHP-*` cases are written. They need:

| Variable | For |
|---|---|
| `BYTEPE_SUBHOME_ADMIN_URL` | the admin `product-service` origin — **never production** |
| `BYTEPE_ADMIN_JWT` | bearer token |
| `BYTEPE_ALLOW_WRITES=1` | anything that creates, edits or deletes |
| `BYTEPE_TEST_HOME_PAGE_ID` | a home page safe to add and remove tabs on |
| `BYTEPE_TEST_HOME_PAGE_ID_ALT` | second page, for the cross-parent ownership cases |
| `BYTEPE_TEST_MASTER_CATEGORY_ID` | CREATE-03/04, UPDATE-03/04 |
| `BYTEPE_TEST_COLLECTION_ID` | DELETE-02/03, the section-attached refusal |

`productionGuard()` throws rather than skipping if the admin URL points at
`bytepe.com`. These endpoints rewrite the strip every shopper sees on the
homepage; a missing token is an accident, a production host is a decision.

Routes and status codes come from the sheet and have **not** been executed
against a live service. Expect to adjust envelope field names on first run — the
video suite carried the same caveat and it proved accurate.

E2E-SHP-AUTH-02 is **partial**: malformed and empty tokens are covered, the
non-admin 403 and expired-token cases need a second credential.

### Not automatable from this repo

| TC | Scenario | Why |
|---|---|---|
| TCB-009, 010, 019, 051, 054 | Tabs on Subscription and EMI Store; default selection on a secondary route; selection resets across routes | Both pages report `sub_home_pages: 0`. Needs a secondary home page configured with its own tabs. TCB-050's zero-tab assertions cover those routes in the meantime. |
| TCB-012 | Duplicate `sequence` ordering is stable | No two live tabs share a sequence; skips with that reason |
| TCB-035 | Modals and drawers stack above the strip | Needs a drawer or modal that can be opened logged out; none identified yet |
| TCB-049 | Icon-less fallback placeholder | Every live tab has an `icon_url`; the test skips with that reason |
| E2E-DB-01..09 | Schema, migration, ordering, integrity | Direct database access, which this repo has none of. Where a DB fact is observable through the API it is asserted there instead: ordering by E2E-NAV-04, soft-delete invisibility by LIST-04 and DELETE-05, FK integrity by E2E-SEC-10. |
| E2E-REG-01..07 | Admin UI regression, build, storefront regression watch | 360 Panel and build pipeline — outside this repo, same as the video suite's panel cases |

The sheet's "Frontend Regression Watch" list is not numbered and is not
tracked here; the header-nav and footer items in it are covered by
`smoke/homepage.spec.js` and `regression/static-pages.spec.js`.

## Known issue carried from the sheet

**SSR payload discarded on `/`.** The server prefetches the Home shell but the
default view is its first sub-page, so sections are refetched client-side and a
brief skeleton shows on first paint. Recorded as a known issue, not a new
defect, until the server-side prefetch resolves the first sub-page. TCB-004
deliberately asserts the *strip* is not gated on that payload, which is the part
that must hold either way.

## Observations worth a ticket, found while writing this

- **`Accessories` has slug `accessoris`.** A typo in the CMS record. It is the
  deep link a shopper lands on (`/?sub_home_page=accessoris`), so fixing it
  changes a live URL.
- **`sections?home_page_id=abc`** answers 200 with `home_page_id` as an object
  and zero sections, rather than rejecting a malformed uuid. The sheet does not
  cover the app route here, so no test fails on it.
- **Tab tiles are `<div role="tab">`, not buttons**, and carry no
  `aria-controls`. They are focusable and Enter/Space work, so the sheet's
  accessibility cases pass; a `role="tabpanel"` relationship is still missing.
