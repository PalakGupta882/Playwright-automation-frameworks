# Operations

Running it, gating it, shipping it, and reading a failure.

> ### ⚠️ Every spec hits production
> `https://www.bytepe.com`, the real site, with a real account. There is no
> staging host wired up for the UI suite. **Ask before running any spec**,
> including smoke tests.

---

## Commands

```bash
npm ci                                  # exact versions from package-lock.json
npx playwright install --with-deps chrome

npm test          # smoke/ + regression/   (the default; 262 tests, chromium)
npm run smoke     # smoke/ only
npm run regression
npm run api       # api/ only
npm run auth      # headed re-login; rewrites auth.json
npm run lint      # eslint + eslint-plugin-playwright
npm run report    # open the last HTML report
npm run discover  # refresh tests/data/products.json
npm run page-health   # render every page -> page-health.json
npm run page-report   # -> page-health-report.html
```

A single spec — paths are relative to `testDir: ./tests`:

```bash
npx playwright test regression/cart.spec.js --project=chromium
```

### Useful flags

| Flag | When |
|---|---|
| `--workers=1` | Catalogue-wide specs. The site rate-limits (HTTP 429) under parallel load and the failures look like bugs |
| `--retries=0` | See true first-attempt results; retries mask a real flake |
| `--headed` | Watch it run |
| `--list` | Collect without running — no network |

`npm run lint` is the fast feedback loop. It catches missing awaits, `.only`, and
conditionals in tests without touching the live site. There is no formatter.

### Diagnostic scripts are excluded by default

`tests/scripts/` holds 28 probes, discovery runs and a full-catalogue page sweep.
A bare `npx playwright test` **skips them** on purpose — collecting them pointed
352 tests at production, including a 15-minute sweep.

They still run when you ask for them by name, or opt the whole directory back in
with `BYTEPE_INCLUDE_SCRIPTS=1`.

---

## The session

`auth.json` is a Playwright `storageState` file holding a **real access token**.
It is gitignored and **must never be committed**.

Because it is gitignored it does not exist after `git clone`, and the config
handles that: present → used; missing → tests start logged out. Public specs run
normally; login-gated specs fail in about a second via `assertFreshSession()`
with the reason and the fix.

### Token lifetimes

| Token | Lives |
|---|---|
| `access_token` | **15 minutes** |
| `refresh_token` | **7 days** |

A long serial run can outlast the access token, and specs starting after it
lapses fail with `access_token expired`. Re-run `npm run auth` and re-run those
specs.

### Refreshing

```bash
setx BYTEPE_MOBILE "<your number>"   # once, then open a NEW terminal
npm run auth                         # headed browser; type the OTP yourself
```

`npm run auth` reuses the refresh token silently and only prompts for an OTP when
that has also expired — or when the refresh attempt fails, in which case it
clears the session and does a full OTP login.

It **refuses to short-circuit on a token with under 5 minutes left**. It used to
save one seconds from expiry and report success, and the next command failed
`assertFreshSession()`.

Two things worth knowing:

- **An OTP is a real SMS.** Widen the manual entry window with
  `BYTEPE_OTP_WAIT_MS` (default 120000) if you will not be at the keyboard.
  Measured 14 Aug 2026: a run launched from a tool call burned both attempts —
  120s each, then a retry that sent a **second real SMS**.
- The `mobileNumber` placeholder in `tests/data/config.js` is **not** used for
  login. Only `BYTEPE_MOBILE` is.

### Checking it without running anything

```bash
node -e "const s=require('./auth.json');const c=s.cookies||[];console.log('cookies',c.length);const now=Date.now()/1000;c.filter(x=>/token/i.test(x.name)).forEach(x=>console.log(x.name,((x.expires-now)/60).toFixed(1)+' min left'));"
```

---

## The write gate

> ### 🚨 `BYTEPE_ALLOW_WRITES=1` CAN CREATE REAL ORDERS
> Do not set it casually, do not put it in your shell profile, and **do not set
> it in CI**.

Specs that mint an order, move money, or leave a record a human has to clean up
skip by default:

| Spec | What it creates with the flag set |
|---|---|
| `regression/subscription-e2e.spec.js` | a real order |
| `regression/subscription-full-flow.spec.js` | a real order |
| `regression/pricing-checkout-consistency.spec.js` | a real order (to reach Payment Summary) |
| `regression/device-protection-consistency.spec.js` | a real order (to reach Payment Summary) |
| `regression/address-management.spec.js` | a saved address on the account |
| `api/cart-api.spec.js` | every non-GET case |
| `regression/video-admin-api.spec.js` | video / mapping records |
| `regression/subhome-admin-api.spec.js` | tab records |

The order id is minted by pressing **Continue on Review Order**, *before* any
payment step. **Reaching Review Order is safe; that last click is not.**

This gate exists because a routine run once left two real orders behind. Nothing
malfunctioned — a stale `auth.json` had been the only thing failing those specs
fast, and refreshing the session to make the run meaningful removed it.

**Ordinary cart writes are not gated.** Running the cart, checkout and pricing
specs adds real items to the real cart, and leaves them there — there is no
add-to-cart endpoint to seed or clean up with.

---

## Environment variables

None are required for a default run.

| Variable | Needed for | Notes |
|---|---|---|
| `BYTEPE_MOBILE` | `npm run auth` | Your number. OTP typed by you |
| `BYTEPE_OTP` | unattended auth | Only for accounts with a fixed OTP. Leave unset for manual entry |
| `BYTEPE_OTP_WAIT_MS` | `npm run auth` | Manual OTP window, default `120000`. `auth-setup` derives its test timeout from this |
| **`BYTEPE_ALLOW_WRITES`** | order-minting specs | **`1` permits real orders** |
| `BYTEPE_INCLUDE_SCRIPTS` | diagnostics | `1` collects `tests/scripts/` in a bare run |
| `BYTEPE_PDP_SAMPLE` | `npm run page-health` | Product pages to render; `0` = all. Default 20 |
| `BYTEPE_API_BASE` | `api/` suite | Overrides the API origin. Default `https://www.bytepe.com/api` |
| `BYTEPE_API_OTP_LOGIN` | `api/auth-api` | `1` runs the full OTP round trip — **sends a real SMS** |
| `BYTEPE_API_URL` | video admin suite | Admin API origin. Unset → the file skips |
| `BYTEPE_ADMIN_JWT` | video + sub-home admin suites | Sent as `Authorization: Bearer` |
| `BYTEPE_TEST_PRODUCT_ID`, `..._ALT` | video mapping cases | Products safe to map |
| `BYTEPE_GCS_BUCKET` | video manifest check | Default `bytepestorage-prod` |
| `BYTEPE_DP_PRODUCT` | Device Protection specs | `slug/bpid` to test against |
| `BYTEPE_SUBHOME_ADMIN_URL` | sub-home admin suite | Unset → skips. Pointing it at production is an **error**, not a skip |
| `BYTEPE_TEST_HOME_PAGE_ID`, `..._ALT`, `BYTEPE_TEST_COLLECTION_ID`, `BYTEPE_TEST_MASTER_CATEGORY_ID` | sub-home admin suite | |

Skipping is the intended behaviour when these are absent. **Do not "fix" a skip
by weakening the assertion.**

---

## Environments: production is the only one wired up

`tests/data/constants.js` sets `BASE_URL = 'https://www.bytepe.com'` and every
page object and UI spec resolves through it. **There is no environment switch for
the UI suite.**

What *can* be redirected:

- `BYTEPE_API_BASE` — the HTTP API origin used by `tests/api/`
- `BYTEPE_API_URL` / `BYTEPE_SUBHOME_ADMIN_URL` — the admin API origins

If you need to run against dev:

1. **Never point a dev run at `auth.json`.** That file holds a production token.
   `auth.dev.json` is reserved and gitignored precisely so a dev token can never
   be mistaken for the production one, or vice versa.
2. Override the API origin explicitly per run; do not edit `constants.js` and
   risk committing it.
3. Treat a dev environment as having its own, unrelated breakage — **do not
   report dev noise as a production bug**.

Wiring a full dev switch for the UI suite is not done, and is the honest gap
here.

---

## CI

`.github/workflows/playwright.yml` runs on pushes to `main`, PRs targeting
`main`, daily at 03:00 UTC, and on demand. Node 20, `ubuntu-latest`, 1 worker,
2 retries.

It writes an **empty** `auth.json` and runs only the specs that pass logged out:

```
regression/static-pages           regression/product-pricing
regression/data-driven-products   regression/cardless-emi
regression/product-search         regression/best-price-banner
api/products-api                  api/pricing-api
```

`BYTEPE_ALLOW_WRITES` is never set, so **CI cannot create an order**.

A spec belongs in that list only if it passes logged out. Adding a login-gated
spec will break the pipeline. The HTML report is uploaded as an artifact and kept
7 days.

---

## Debugging failures

Failures leave a screenshot and video in `test-results/` and in the HTML report;
traces are captured on first retry.

```bash
npm run report
```

Retries are **1 locally and 2 in CI**, so a "passing" run may still have been
flaky — check the report.

### Failure modes that are not bugs in the site

| Symptom | Reality |
|---|---|
| `HTTP 429`, empty search results, "the site refused the add — 429 Too Many Requests" | The site rate-limits this suite. Re-run with `--workers=1` before believing it. It throttles a **single** ordinary visitor too — `probe-rate-limit.spec.js` measured 429s from one browser doing one page load |
| `access_token expired` part-way through a long run | 15-minute token. Re-run `npm run auth`, re-run those specs |
| `cart load 1/4 hit the nitro crash — reloading` | Known accepted production bug: `window?.nitro?.updatecart is not a function`. `utils/cartNav.js` reloads past it. 7 of 9 loads with a populated cart, 0 of 6 with an empty one |
| A click times out on a control that looks fine in the screenshot | Usually the duplicated header (use `.last()`). The "Exchange is now available!" dialog caused this too until 26 Aug 2026; the `page` fixture now declines it automatically and logs `exchange dialog dismissed via "Not now"` each time it fires |
| `Error reading storage state from auth.json: ENOENT` | Should not happen — the config resolves this. If it does, someone hard-coded `storageState` |
| `test file X should not import test file Y` | A helper is living somewhere `testIgnore` does not cover |
| A 404 on an API path you know exists | The leading-slash trap: `new URL('/cart', '…/api')` drops `/api`. Cost a full run of 15 false failures |

### Behaviours confirmed EXPECTED — do not re-report

- The PDP mounts **no video player** on web (20 Aug 2026).
- The homepage renders its **header twice** (20 Aug 2026).
- `/all-products?category=` returns an **empty listing**.
- Device Protection renders `vas_price` on Review Order and charges `vas_amount`
  on Payment Summary — ₹1 vs ₹2,001 (20 Aug 2026).
- `variant-pricing` answers **200** for an unknown variant — it validates the
  slug, not the variant.
- Old product URLs return **200 with a "404 This page could not be found." body**
  and no redirect.
- `best_price` is **intentionally disabled** — the offer ended. It is absent from
  `variant-pricing` on every sampled product, which turns 20 of the 21 tests in
  `api/pricing-api.spec.js` into skips with a reason. **That is correct.** A
  coverage guard asserting the field was present was added once and deliberately
  removed; the spec carries a "do not re-add a guard here" note at that spot.

---

## Known failing tests

These reproduce standalone. They are **not** flakes and must not be "fixed" by
weakening them.

| Tests | Status |
|---|---|
| `emi-checkout-flow` — tenure-ladder tests | Instalment totals differ from `price − discount + interest` by ₹1–₹8 on some products (observed on Galaxy Z Fold8 5G and Pixel 11 Pro Fold). The spec asserts exact equality; `CLAUDE.md` documents the same formula with a **±₹1-per-instalment tolerance**. **Awaiting a product decision** on which is right |
| `subhome-tabs-ui` — TCB-005, TCB-007 | Tab-strip divider and dimensions differ from the design sheet, which was written against localhost fixtures. **Awaiting design confirmation** |
| `device-protection-multi-product` — the cart DP line, and DP survives cart → Review Order | **Test defect, not a site defect.** The upfront basket legitimately carries `vas: 0` and the page renders no Device Protection line, so `parseOrderSummary` returns `null` and the spec asserts `expect(null).toBe(0)`. `CLAUDE.md` already records that Device Protection is subscription-only and an upfront add attaches ₹0. The check is also vacuous at `vas: 0` — there is nothing to compare — so it should skip with a reason rather than assert |

**No longer failing:** `subhome-tabs-ui` TCB-016/018/020 (the transparent
active-tab underline) **passed** on the 21 Aug 2026 run. It was previously
recorded here as "likely a real defect". Commits `fe67be0` ("Find the tab
underline where it actually lives") and `9d9dab2` ("Wait for the tab strip to be
interactive, not merely visible") are the likely cause — that is, the spec was
looking in the wrong place, not the site rendering the wrong colour. Confirm
before closing anything raised against the site.

---

## Housekeeping

Regenerate rather than hand-edit:

| Fixture | Command |
|---|---|
| `tests/data/products.json` | `npm run discover` |
| `tests/data/cardless-emi.json` | `npx playwright test scripts/discover-cardless-emi.spec.js --project=chromium` |
| `tests/data/video-products.json` | `npx playwright test scripts/discover-video-products.spec.js --project=chromium` |
| `tests/data/device-protection.json` | `npx playwright test scripts/discover-device-protection.spec.js --project=chromium` |

**Re-run `discover-products.spec.js` before any catalogue-wide work.** Slugs and
bpids drift on their own, and a spec that hardcodes one will fail for reasons
unrelated to the code.
