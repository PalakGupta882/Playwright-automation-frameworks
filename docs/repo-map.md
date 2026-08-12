# Repo map — what every file is for

Orientation for anyone new to this suite, and a refresher for anyone who has
been away from it. Read it alongside `CLAUDE.md`, which covers *how BytePe
sells* (plans, variants, cardless EMI); this file covers *where the code is*.

## The execution chain

Everything hangs off this. Learn it first.

```
npm test
  → playwright.config.js        what to collect, timeouts, auth.json, chromium
    → tests/<suite>/*.spec.js   the test
      → tests/fixtures/pageFixtures.js   injects page objects as test args
        → tests/pages/*.js               locators + actions
          → tests/data/*.js|json         URLs, constants, fixtures
        → tests/utils/*.js               session guard, write gate, retry
```

A spec never touches a raw URL or a raw selector. It asks a **page object**,
which reads from **data**, and is guarded by **utils**.

## Root files

| File | What it does |
|---|---|
| `playwright.config.js` | The only ESM file in the repo. `testDir: ./tests`, `testMatch: **/*.js` — so **everything under `tests/` is a spec** unless `testIgnore` excludes it (`pages/`, `data/`, `fixtures/`, `utils/`, `wip/`, plus one explicit entry for `api/apiHelper.js`). Also sets `storageState: 'auth.json'`, 2 workers locally (capped on purpose — production rate-limits an uncapped run), a 60s timeout, and traces on first retry. **There is no `baseURL`**, which is why `page.goto('/cart')` does not work. |
| `package.json` | The script names: `test`, `smoke`, `regression`, `api`, `auth`, `discover`, `report`, `lint`. `"type": "commonjs"`. |
| `eslint.config.js` | `eslint-plugin-playwright`. Catches missing `await`s, a stray `.only`, conditionals wrapped around assertions. Carries per-folder relaxations: `scripts/` may branch and log, `video-*` and `api/` may skip (skipping is their safety design), `otpHelper.js` may call `page.pause()`. |
| `auth.json` | A real logged-in session. **Gitignored — never commit it.** Regenerate with `npm run auth`. |
| `.github/workflows/playwright.yml` | Writes an **empty** `auth.json`, then runs only the specs that pass logged out. Adding a login-gated spec to that list breaks the pipeline. |
| `CLAUDE.md` | Domain knowledge: plans vs funding options, cardless EMI's four expected states, why a bpid is not a stable key. Read before writing pricing or payment tests. |
| `CLAUDE.local.md` | Personal working preferences. Gitignored. |

## `tests/fixtures/`

`pageFixtures.js` — extends Playwright's `test` so a spec receives `homePage`,
`productPage`, `productsListPage`, `reviewOrderPage` and `emiStorePage` as
arguments. **Import `test` and `expect` from here, not from
`@playwright/test`.**

## `tests/pages/` — the locators

This is where most of the real work lives. A flaky selector is fixed in one
place here, not across the specs that use it.

| File | Owns |
|---|---|
| `basePage.js` | 20 lines. `goto(path)` prefixes the host; `clickText`, `waitAndClick`. Everything else extends it. |
| `homepage.js` | Navigation to every section, plus the whole login/OTP flow: `openLoginDialog` → `submitMobile` → `enterOtp` → `waitForLoggedIn`, and `describeOtpFailure` for diagnostics. |
| `productPage.js` | The PDP: `getPrice`, `getLowestEffectivePrice`, `selectVariantOption`, `clickSubscribe`, `checkPincode`. |
| `productsListPage.js` | The PLP and the search box: `search` (with retries), `selectAutocompleteSuggestion`, `clickAddToCart`, `clickGoToCart`. |
| `cartPage.js` | 35 lines. `addFirstProductToCart`, `selectBuyUpfrontPlan`. |
| `reviewOrderPage.js` | `applyCoupon`, `getCouponErrorMessage`, `clickContinue`. **`clickContinue` is the click that mints a real order id** — reaching this page is safe, that last click is not. |
| `accountPage.js` | `/my-profile`, My Orders, and Saved Addresses CRUD. Locators are **by placeholder, not by role**: the live address form has no label, `aria-label` or accessible name, so `getByRole('textbox', { name })` resolves nothing. |
| `emiStorePage.js` | `/home/emi-store` and the hop into a product. `whyStuck()` turns a bare locator timeout into an error that says "you are logged out". |
| `productVideoPage.js` | The PDP media gallery, backing VID-42..VID-51. `diagnoseMissingPlayer()` reports the thumbnail slot gap, so a failure reads as the product bug rather than a stale selector. |

## `tests/data/` — facts, no logic

| File | Holds |
|---|---|
| `constants.js` | `BASE_URL`, `BASE_API_URL`, `URLS`, `MESSAGES`, `TEST_ADDRESS`, `TIMEOUTS`. **New URLs, messages and timeouts go here rather than inline in a spec.** |
| `config.js` | `baseURL`, the coupon codes (`BYTE500` valid, `FAKE000` invalid), the manual-OTP timeout. |
| `apiEndpoints.js` | Every API route, read out of the shipped client bundles and then confirmed live. Two facts that surprise people: there is no separate API host (it is same-origin under `/api`), and **auth is a cookie, not a Bearer header**. |
| `emiApi.js` | Parsers for the pricing payload — `cardlessEmiFrom` (`data.nbfc`), `creditCardEmiFrom` (`data.cc`), `cardEmiOptionsFrom` (`data.emi.emi_option[]`). |
| `videoFeature.js` | Video suite configuration: the admin API env vars, the GCS bucket (`bytepestorage-prod`), the skip reasons, `expectedManifestUrl()`. |
| `products.json`, `cardless-emi.json`, `video-products.json` | Generated fixtures. Regenerate them from `tests/scripts/` — slugs and bpids drift on their own, for reasons unrelated to this code. |

## `tests/utils/` — the guards

| File | Job |
|---|---|
| `session.js` | `assertFreshSession()` — a pure file read of `auth.json`, no network. Fails a login-gated spec immediately with "token expired, run `npm run auth`" instead of timing out on a button that only renders for a logged-in user. **Deliberately inert when `auth.json` is missing or has zero cookies**, because CI writes an empty session. Call it in `test.beforeAll`. |
| `writes.js` | `writesAllowed()` / `writeSkipReason()` — the `BYTEPE_ALLOW_WRITES=1` gate. It exists because a routine `npm test` once left two real orders on the production account. Guards anything that mints an order, moves money, or leaves a record a human has to clean up. |
| `apiRetry.js` | `getWithRetry()` — retries only 429/502/503/504, with backoff and `Retry-After` support. A 404 or a 500 is a real answer and is returned untouched, so a genuine failure still fails. |
| `domProbe.js` | Describes the inputs, buttons and frames on screen, for diagnostics. **Never reports input values** — these screens carry a phone number and a one-time code, and this output lands in reports and CI logs. |
| `otpHelper.js` | `waitForManualOtp` (a deliberate `page.pause()` so a human can type the code) and `isOtpScreenVisible`. |

## The suites

### `tests/smoke/` — 2 files

Does the site stand up at all. `homepage.spec.js` (navigation to each section)
and `core-pages.spec.js` (PLP, PDP and cart load).

### `tests/regression/` — 27 files

Grouped by what they cover:

- **Pricing** — `product-pricing`, `pincode-based-pricing`, `best-price-banner`,
  `emi-plan-config`, `emi-checkout-flow`, `cardless-emi`
- **Search and browse** — `search`, `product-search`, `category-browsing`,
  `data-driven-products`, `static-pages`, `site-health`
- **Cart through to order** — `cart`, `coupon-valid`, `coupon-invalid`,
  `pincode-valid`, `pincode-invalid`, `checkout-flow`, `emi-store-flow`
- **Order-minting, write-gated** — `subscription-e2e`,
  `subscription-full-flow`. Both skip unless `BYTEPE_ALLOW_WRITES=1`.
- **Account** — `account`, `address-management` (the largest spec in the repo:
  TC-ADDR-001..013), `order-history`
- **Video** — `video-pdp-api` (public, runs today), `video-admin-api` (needs an
  admin JWT), `video-pdp-rendering` (currently failing on purpose — the PDP
  does not mount a player; see `docs/video-feature-coverage.md`)

### `tests/api/` — 4 specs and 1 helper

HTTP only: a `request` context, no browser and no page objects.
`apiHelper.js` is the shared plumbing and is **excluded from collection by an
explicit `testIgnore` entry** — any further helper added here needs its own
entry, or it belongs in `data/` or `utils/` instead.

`products-api` and `pricing-api` are public and run in CI. `auth-api` and
`cart-api` gate on a real session, so they are deliberately kept out of the CI
list: their anonymous cases would pass, but the rest would report as skips,
which reads as coverage that is not there.

### `tests/scripts/` — 5 files

One-off discovery utilities that happen to run on the Playwright runner and
regenerate the JSON fixtures: `discover-products`, `discover-cardless-emi`,
`discover-video-products`, `crawl-site`, `probe-login-screens`. They log rather
than assert, which is why eslint relaxes several rules for this folder.

Re-run `discover-products.spec.js` before any catalogue-wide work.

### `tests/auth-setup.spec.js`

Headed one-time login that writes `auth.json`. Run it via `npm run auth`; it
needs `BYTEPE_MOBILE` set and a human to type the OTP.

### `tests/demos/full-demo-flow.spec.js`

A scripted walkthrough for demonstrating the suite to someone.

## `docs/` and `test-cases/`

`video-feature-coverage.md` (VID-01..53 traceability and env vars),
`cardless-emi.md` and `cardless-emi-bugs.md`, `site-health.md`,
`BUG-02-address-delete-no-confirmation.md`, plus the generated
`regression-report.*` and `search-test-cases.*` outputs.
`test-cases/address-management.md` is the manual test-case source behind the
address spec.

## The four rules that catch people out

1. Import `test` and `expect` from `../fixtures/pageFixtures`, not from
   `@playwright/test`.
2. There is no `baseURL`. Navigate through a page object's `goto()` or use an
   absolute URL.
3. A new helper must live in `pages/`, `data/`, `fixtures/` or `utils/`.
   Anywhere else under `tests/` and it gets collected as a spec, and a spec
   importing it fails with `test file X should not import test file Y`.
4. Paths are relative to `testDir: ./tests` — `regression/cart.spec.js`, not
   `tests/regression/cart.spec.js`.
