# Full-site regression — 5 Aug 2026

Record of a whole-site check: does anything on BytePe crash, and does the suite
still pass end to end.

**Verdict: the site is healthy.** 186/186 product pages live, every core page
responds, no broken internal links. The failures found were in the test suite,
not the product.

## Results

| Check | Result |
|---|---|
| `smoke/` + `regression/` | 90 passed, 0 failed, 31 skipped, 2 flaky on retry (3.2m) |
| Product pages | 186/186 live, 0 dead |
| Core pages | 6/6 respond |
| Internal links on the homepage | 5 found, 0 broken |
| `npm run lint` | 0 errors |

Now guarded by `tests/regression/site-health.spec.js` — public, logged out,
API-level, whole catalogue in ~17s.

```
npx playwright test regression/site-health.spec.js --project=chromium
```

## The one real bug, and it was ours

The first full run failed 10 specs. Seven were:

```
Saved login session is unusable — no access_token cookie for www.bytepe.com
```

Cause: the `auth-setup` fast path added earlier that day detects "already logged
in" from the rendered header. The app renders that header off `refresh_token`,
which outlives `access_token` by days — so the check can be true while no
`access_token` cookie exists yet. `storageState` was captured in that window and
wrote an `auth.json` containing `refresh_token` but **no `access_token`**:

```
cookies: 29
  access_token:  ABSENT
  refresh_token: 2026-08-12T08:02:23Z
```

`assertFreshSession()` then correctly rejected it, and every login-gated spec
failed with what looks like a broken selector. An earlier run had happened to
win the race, which is why it passed when first written.

Fixed in `tests/auth-setup.spec.js` with three guards: poll for the cookie,
reload to prod the refresh, fall back to a full login if it never appears, and
**refuse to save at all** rather than write an `auth.json` the guard will reject.

The remaining three failures (`coupon-invalid`, `pincode-invalid`,
`pincode-valid`) were load flake and passed on the clean run.

## Two false alarms — do not repeat these

**A body-text marker is not a 404 detector.** The first sweep flagged all 196
pages as broken, including the homepage, because it matched
`/could not be found/` and that string sits in the JS bundle of every page.

The reliable discriminator is `<title>`. A dead product URL returns **HTTP 200**
with the generic site shell, no redirect:

```
/pd/phone-4b/NOTSMMOBK25WT5        -> 200, 278,884 bytes, "Buy Phone (4b) from BytePe…"
/pd/this-slug-does-not-exist/ZZZZ  -> 200,  81,371 bytes, "BytePe - India's First Phone…"
```

`site-health.spec.js` carries a **control test** that asserts a known-dead URL is
still recognised as dead. Without it the catalogue test is unfalsifiable — a rule
that is wrong in the lenient direction would report a totally broken site as
healthy.

**A URL you invented 404ing is not a bug.** `/faqs`, `/contact-us` and
`/refund-policy` returned 404 in an early sweep. Those paths were guesses;
`/faq`, `/shipping-policy` and `/grievance-redressal` all resolve. Only a link
the site actually publishes counts as evidence.

## Open

- **Footer links do not render as anchors.** `getByRole('link', { name })` for
  FAQs / Contact Us / Privacy Policy / Terms of Use returns 0 on the homepage
  even after scrolling to the bottom, and only 5 internal links exist in the DOM.
  `tests/pages/homepage.js` defines locators for all four. `static-pages` passes,
  so those pages are reachable another way — but the footer locators look
  unusable and are worth confirming before anything relies on them.
- **Access token TTL is ~15 minutes**, where one earlier in the day lasted ~12
  hours. Login-gated runs need re-auth most sessions. Worth a backend question.
- **Link checking stops at the homepage.** A crawl of listing and product pages
  would cover more, at the cost of a much longer run.
