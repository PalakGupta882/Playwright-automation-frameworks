# BytePe Playwright automation

End-to-end and API tests for the BytePe storefront, written with
[Playwright Test](https://playwright.dev/).

> ### ⚠️ These tests run against **production**
>
> Every spec hits `https://www.bytepe.com` — the real site. There is no staging
> host configured in this repo. Cart, coupon and subscription specs create real
> state on a real account.
>
> A default `npm test` is **safe**: it cannot create an order. Anything that can
> is behind an explicit opt-in flag — see [The write gate](#the-write-gate)
> before you run anything you have not read.

---

## Quick start

```bash
npm ci                                # exact dependency versions from package-lock.json
npx playwright install --with-deps chrome
npm test                              # smoke + regression, logged out
```

That works on a fresh clone with no further setup. Login-gated specs will fail
fast telling you to sign in — that is expected until you do
[Authenticating](#authenticating).

### Prerequisites

| | |
|---|---|
| **Node.js** | 20 or newer (developed on 24, CI runs 20) |
| **Browser** | Google Chrome, installed via Playwright — the only project configured is desktop `chromium` using `channel: 'chrome'` |
| **OS** | Developed on Windows 11; nothing is OS-specific |

---

## The session, and why a fresh clone still works

`auth.json` is a Playwright `storageState` file holding a **real access token**.
It is gitignored and **must never be committed**.

Because it is gitignored, it does not exist after `git clone`. The config
handles that:

- **`auth.json` present** → it is used, and login-gated specs run.
- **`auth.json` missing** → tests start in a fresh, logged-out context. Public
  specs run normally; login-gated specs fail in about a second with the reason
  and the command to fix it, instead of timing out on a button that only renders
  for a signed-in user.

You do not need to create an empty file by hand. If you want one anyway — to
mirror exactly what CI does — it is:

```bash
echo '{"cookies":[],"origins":[]}' > auth.json
```

### Authenticating

```bash
setx BYTEPE_MOBILE "<your number>"   # once, then open a NEW terminal
npm run auth                         # headed browser; type the OTP yourself
```

`npm run auth` opens a real browser and writes `auth.json`. It tries to reuse
the existing refresh token silently and only asks for an OTP when it cannot.

Two things worth knowing:

- **`access_token` lives 15 minutes**; `refresh_token` lives 7 days. A long
  serial run can outlast the access token, and specs starting after it lapses
  fail with `access_token expired`. Re-run `npm run auth` and re-run those specs.
- **An OTP is a real SMS** to your number. Widen the manual entry window with
  `BYTEPE_OTP_WAIT_MS` (default 120000) if you will not be at the keyboard.
- The `mobileNumber` placeholder in `tests/data/config.js` is **not** used for
  login. Only `BYTEPE_MOBILE` is.

---

## Running tests

```bash
npm test          # smoke/ + regression/   (the default; chromium)
npm run smoke     # smoke/ only
npm run regression
npm run api       # api/ only
npm run lint      # eslint + eslint-plugin-playwright
npm run report    # open the last HTML report
```

A single spec — paths are relative to `testDir: ./tests`, so
`regression/cart.spec.js`, **not** `tests/regression/cart.spec.js`:

```bash
npx playwright test regression/cart.spec.js --project=chromium
```

### Useful flags

```bash
--workers=1     # serial. Use this for catalogue-wide specs: the site rate-limits
                # (HTTP 429) under parallel load and the failures look like bugs
--retries=0     # see true first-attempt results; retries can mask a real flake
--headed        # watch it run
--list          # collect without running
```

`npm run lint` is the fast feedback loop — it catches missing awaits, `.only`
and conditionals in tests without touching the live site. There is no formatter.

### Diagnostic scripts are excluded by default

`tests/scripts/` holds ~24 probes, discovery runs and a full-catalogue page
sweep. A bare `npx playwright test` **skips them** on purpose — collecting them
pointed 352 tests at production, including a 15-minute sweep.

They still run when you ask for them by name:

```bash
npx playwright test scripts/probe-loaders.spec.js --project=chromium
npm run discover            # refresh tests/data/products.json
npm run page-health         # render every page, write page-health.json
npm run page-report         # turn that into page-health-report.html
```

Or opt the whole directory back in with `BYTEPE_INCLUDE_SCRIPTS=1`.

---

## The write gate

> ### 🚨 `BYTEPE_ALLOW_WRITES=1` CAN CREATE REAL ORDERS
>
> Do not set it casually, do not put it in your shell profile, and do not set it
> in CI.

Specs that mint an order, move money, or leave a record a human has to clean up
are gated behind a single environment variable and **skip by default**:

| Spec | What it creates with the flag set |
|---|---|
| `regression/subscription-e2e.spec.js` | a real order |
| `regression/subscription-full-flow.spec.js` | a real order |
| `regression/pricing-checkout-consistency.spec.js` | a real order (to reach Payment Summary) |
| `regression/device-protection-consistency.spec.js` | a real order (to reach Payment Summary) |
| `regression/address-management.spec.js` | a saved address on the account |
| `api/cart-api.spec.js` | every non-GET case |
| the video and sub-home admin suites | video / tab records |

The order id is minted by pressing **Continue on Review Order**, *before* any
payment step. Reaching Review Order is safe; that last click is not. This gate
exists because a routine run once left two real orders behind.

Ordinary cart writes are noisy but reversible and are **not** gated — running
the cart specs will add items to the real cart.

---

## Environment variables

None are required for a default run.

| Variable | Needed for | Notes |
|---|---|---|
| `BYTEPE_MOBILE` | `npm run auth` | Your number. OTP is typed by you. |
| `BYTEPE_OTP` | unattended auth | Only for accounts with a fixed OTP. Leave unset for manual entry. |
| `BYTEPE_OTP_WAIT_MS` | `npm run auth` | Manual OTP window, default `120000`. |
| **`BYTEPE_ALLOW_WRITES`** | order-minting specs | **`1` permits real orders.** See above. |
| `BYTEPE_INCLUDE_SCRIPTS` | diagnostics | `1` collects `tests/scripts/` in a bare run. |
| `BYTEPE_PDP_SAMPLE` | `npm run page-health` | Product pages to render; `0` = all. Default 20. |
| `BYTEPE_API_BASE` | `api/` suite | Overrides the API origin. Default `https://www.bytepe.com/api`. |
| `BYTEPE_API_URL` | video / sub-home admin suites | Admin API origin. Unset → those files skip. |
| `BYTEPE_ADMIN_JWT` | video / sub-home admin suites | Sent as `Authorization: Bearer`. |
| `BYTEPE_TEST_PRODUCT_ID`, `..._ALT` | video mapping cases | Products safe to map. |
| `BYTEPE_DP_PRODUCT` | Device Protection specs | `slug/bpid` to test against. |
| `BYTEPE_GCS_BUCKET` | video manifest check | Defaults to `bytepestorage`. |
| `BYTEPE_SUBHOME_ADMIN_URL`, `BYTEPE_TEST_HOME_PAGE_ID`, `..._ALT`, `BYTEPE_TEST_COLLECTION_ID`, `BYTEPE_TEST_MASTER_CATEGORY_ID` | sub-home admin suite | Unset → skips. |

Skipping is the intended behaviour when these are absent. **Do not "fix" a skip
by weakening the assertion.**

---

## Environments: production is the only one wired up

`tests/data/constants.js` sets `BASE_URL = 'https://www.bytepe.com'` and every
page object and UI spec resolves through it. **There is no environment switch
for the UI suite** — you cannot point these tests at dev by setting a variable.

What *can* be redirected:

- `BYTEPE_API_BASE` — the HTTP API origin used by `tests/api/`.
- `BYTEPE_API_URL` — the admin API origin for the video and sub-home suites.

If you need to run against a dev environment safely, the rules are:

1. **Never point a dev run at `auth.json`.** That file holds a production token.
   A separate `auth.dev.json` name is reserved and gitignored precisely so a dev
   token can never be mistaken for the production one, or vice versa.
2. Override the API origin explicitly per run; do not edit `constants.js` and
   risk committing it.
3. Treat a dev environment as having its own, unrelated breakage — do not report
   dev noise as a production bug.

Wiring a full dev switch for the UI suite is not done yet and is the honest gap
here.

---

## Layout

```
tests/
  smoke/        fast sanity checks
  regression/   the real suite
  api/          HTTP-level tests (no browser)
  scripts/      probes, discovery, page-health — NOT run by default
  pages/        page objects: locators + actions
  fixtures/     pageFixtures.js — injects page objects as test args
  data/         URLs, constants, fixtures, endpoint map
  utils/        session guard, write gate, retry, price parsers
docs/           coverage maps and analysis
scripts/        node utilities (not Playwright specs)
```

`docs/repo-map.md` explains what every file is for. `CLAUDE.md` documents **how
BytePe sells** — plans, variants, cardless EMI, and the pricing rules the specs
encode. Read it before writing a pricing or payment test.

### Conventions

- **CommonJS** (`require` / `module.exports`). Only `playwright.config.js` is
  ESM, loaded through Playwright's own transpiler.
- **Import `test`/`expect` from `../fixtures/pageFixtures`**, not
  `@playwright/test` — that fixture supplies the page objects.
- **There is no `baseURL`.** Navigate via a page object's `goto()` or an
  absolute URL. `page.goto('/cart')` will not work.
- Put shared URLs, messages and timeouts in `tests/data/constants.js`.
- `testMatch` is `**/*.js`, so anything under `tests/` is a spec unless
  `testIgnore` excludes it. New helpers belong in `pages/`, `data/`, `fixtures/`
  or `utils/`.
- Specs behind a login must call `assertFreshSession()` from
  `tests/utils/session.js` in `test.beforeAll`.
- Assertions must be non-vacuous: before asserting something is absent, prove it
  renders at all.

---

## CI

`.github/workflows/playwright.yml` runs on pushes to `main`, on PRs targeting
`main`, daily at 03:00 UTC, and on demand.

It writes an **empty** `auth.json` and runs only the specs that pass logged out:
`static-pages`, `data-driven-products`, `product-search`, `product-pricing`,
`cardless-emi`, `best-price-banner`, `api/products-api`, `api/pricing-api`.

`BYTEPE_ALLOW_WRITES` is never set in CI, so **CI cannot create an order**.

A spec belongs in that list only if it passes logged out. Adding a login-gated
spec will break the pipeline. The HTML report is uploaded as an artifact and
kept 7 days.

---

## Debugging failures

Failures leave a screenshot and video in `test-results/` and in the HTML report;
traces are captured on first retry. Retries are 1 locally and 2 in CI, so a
"passing" run may still have been flaky — check the report.

Two failure modes that are **not** bugs in the site:

- **`HTTP 429` / empty search results** under parallel load. The site rate-limits
  this suite. Re-run the spec with `--workers=1` before believing it.
- **`access_token expired`** part-way through a long run. Re-run `npm run auth`.

## Known failing tests

Seven tests fail today and reproduce standalone. They are **not** flakes and
should not be "fixed" by weakening them:

| Tests | Status |
|---|---|
| `emi-checkout-flow` — 4 tenure-ladder tests | Instalment totals differ from `price − discount + interest` by ₹1–₹8. The spec asserts exact equality; `CLAUDE.md` documents the same formula with a ±₹1-per-instalment tolerance. **Awaiting a product decision** on which is right. |
| `subhome-tabs-ui` — TCB-005, TCB-007 | Tab-strip divider and dimensions differ from the design sheet, which was written against localhost fixtures. **Awaiting design confirmation.** |
| `subhome-tabs-ui` — TCB-016/018/020 | The active-tab underline renders transparent instead of the brand colour, so no tab looks selected. **Likely a real defect.** |

Behaviours confirmed as **expected** (do not re-report): the PDP mounting no
video player on web, the duplicate header, `/all-products?category=` returning
an empty listing, Device Protection rendering `vas_price`, and
`variant-pricing` answering `200` for an unknown variant.
