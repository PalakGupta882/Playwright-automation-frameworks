# Repo map — what every file is for

Where the code is. Read it alongside `CLAUDE.md`, which covers *how BytePe
sells*.

This file is the **index**. The detail lives in:

- [architecture.md](architecture.md) — the execution chain and every config decision
- [api-reference.md](api-reference.md) — every exported function, and why each locator
- [test-inventory.md](test-inventory.md) — what each spec covers
- [authoring-guide.md](authoring-guide.md) — how to add one
- [operations.md](operations.md) — running, gating, CI, troubleshooting

## The execution chain

```
npm test
  → playwright.config.js        what to collect, timeouts, auth.json, chromium
    → tests/<suite>/*.spec.js   the test
      → tests/fixtures/pageFixtures.js   injects page objects as test args
        → tests/pages/*.js               locators + actions
          → tests/data/*.js|json         URLs, constants, fixtures
        → tests/utils/*.js               session guard, write gate, retry, parsers
```

A spec never touches a raw URL or a raw selector. It asks a **page object**,
which reads from **data**, and is guarded by **utils**.

## Root files

| File | What it does |
|---|---|
| `playwright.config.js` | The only ESM file in the repo. `testDir: ./tests`, `testMatch: **/*.js` — so **everything under `tests/` is a spec** unless `testIgnore` excludes it (`pages/`, `data/`, `fixtures/`, `utils/`, `wip/`, `scripts/` unless asked for, plus one explicit entry for `api/apiHelper.js`). Resolves `storageState` to `auth.json` only when it exists, caps workers at 2 locally, 60s timeout, 30s action/navigation timeouts, traces on first retry. **There is no `baseURL`.** [Full rationale](architecture.md#playwrightconfigjs--the-decisions) |
| `package.json` | Script names: `test`, `smoke`, `regression`, `api`, `auth`, `discover`, `report`, `lint`, `page-health`, `page-report`. `"type": "commonjs"` |
| `eslint.config.js` | `eslint-plugin-playwright`. Catches missing `await`s, a stray `.only`, conditionals around assertions. Per-folder relaxations: `scripts/` may branch and log, `video-*`, `exchange-*` and `api/` may skip, `otpHelper.js` may call `page.pause()` |
| `auth.json` | A real logged-in session. **Gitignored — never commit it.** Regenerate with `npm run auth` |
| `auth.dev.json` | Reserved, gitignored name for a dev session, so a dev token can never be mistaken for the production one |
| `.github/workflows/playwright.yml` | Writes an **empty** `auth.json`, then runs only the 8 specs that pass logged out |
| `CLAUDE.md` | Domain knowledge: plans vs funding options, cardless EMI's four expected states, why a bpid is not a stable key. Read before writing pricing or payment tests |
| `CLAUDE.local.md` | Personal working preferences. Gitignored |
| `README.md` | Clone-to-green-run |

## `tests/fixtures/`

`pageFixtures.js` — extends Playwright's `test` so a spec receives `homePage`,
`productPage`, `productsListPage`, `reviewOrderPage`, `emiStorePage` and
`subHomeTabsPage` as arguments, and overrides `page` to install the BytePe
Exchange dialog handler. **Import `test` and `expect` from here, not from
`@playwright/test`** — a spec that does not will time out on cart and Review
Order clicks the moment that dialog opens.

`cartPage`, `accountPage` and `productVideoPage` are **not** registered — the
specs that need them construct them directly.

## `tests/pages/` — the locators

Most of the real work. A flaky selector is fixed in one place here, not across
the specs that use it. Method tables and locator rationale:
[api-reference.md](api-reference.md#testspages--locators-and-actions).

| File | Owns |
|---|---|
| `basePage.js` | 20 lines. `goto(path)` prefixes the host; `clickText`, `waitAndClick` |
| `homepage.js` | Navigation to every section, plus the whole login/OTP flow. Uses `.last()` on header links — the homepage renders its header **twice**, confirmed expected |
| `productPage.js` | The PDP: `getPrice`, `getLowestEffectivePrice`, `selectVariantOption`, `clickSubscribe`, `checkPincode` |
| `productsListPage.js` | The PLP and the search box: `search` (with retries), `selectAutocompleteSuggestion`, `clickAddToCart`, `clickGoToCart` |
| `cartPage.js` | 35 lines. `addFirstProductToCart`, `selectBuyUpfrontPlan` |
| `reviewOrderPage.js` | `applyCoupon`, `getCouponErrorMessage`, `clickContinue`. **`clickContinue` is the click that mints a real order id** |
| `accountPage.js` | `/my-profile`, My Orders, and Saved Addresses CRUD. Locators are **by placeholder, not by role** — the live address form has no accessible name |
| `emiStorePage.js` | `/home/emi-store` and the hop into a product. `whyStuck()` turns a bare locator timeout into "you are logged out" |
| `subHomeTabsPage.js` | The Sub Home Page tab strip, backing TCB-001..054. Anchors on **ARIA** — the only authored thing on the strip |
| `productVideoPage.js` | The PDP media gallery, backing VID-42..VID-51. `diagnoseMissingPlayer()` reports the thumbnail slot gap |

## `tests/data/` — facts, no logic

| File | Holds |
|---|---|
| `constants.js` | `BASE_URL`, `BASE_API_URL`, `URLS`, `MESSAGES`, `TEST_ADDRESS`, `TIMEOUTS`. **New URLs, messages and timeouts go here** |
| `config.js` | `baseURL`, the coupon codes (`BYTE500` valid, `FAKE000` invalid), the manual-OTP timeout |
| `apiEndpoints.js` | Every API route, read out of the shipped client bundles and then confirmed live, plus a `FORBIDDEN` list of routes never to call. Two surprises: there is no separate API host, and **auth is a cookie, not a Bearer header** |
| `emiApi.js` | Parsers for the pricing payload — `cardlessEmiFrom` (`data.nbfc`), `creditCardEmiFrom` (`data.cc`), `cardEmiOptionsFrom` (`data.emi.emi_option[]`) |
| `videoFeature.js` | Video suite config: admin env vars, the GCS bucket, skip reasons, `expectedManifestUrl()` |
| `subHomeFeature.js` | Sub-home config: the public API, `sectionsPath()`, `ACTIVE_UNDERLINE_RGB`, `TABLIST_LABEL`, skip reasons, and **`productionGuard()`** |
| `products.json`, `cardless-emi.json`, `video-products.json`, `device-protection.json` | Generated fixtures. Regenerate from `tests/scripts/` — slugs and bpids drift on their own |

## `tests/utils/` — the guards

| File | Job |
|---|---|
| `session.js` | `assertFreshSession()` — a pure file read of `auth.json`, no network. **Deliberately inert** when the file is missing or empty, because CI writes an empty session |
| `writes.js` | `writesAllowed()` / `writeSkipReason()` — the `BYTEPE_ALLOW_WRITES=1` gate. Exists because a routine `npm test` once left two real orders behind |
| `apiRetry.js` | `getWithRetry()` — retries only 429/502/503/504, with backoff and `Retry-After`. A 404 or 500 is a real answer and is returned untouched |
| `cartNav.js` | `openCart()` reloads past the known nitro crash. Its `dismissExchangeDialog()` is superseded by `exchangeDialog.js` — it uses `isVisible()`, so it fires only when the timing happens to suit |
| `exchangeDialog.js` | `installExchangeDialogHandler()` — declines the BytePe Exchange dialog via "Not now", registered on the `page` fixture so every spec is covered. Anchored on the dialog holding an **Add Exchange** button, not on a build-hashed class or on marketing copy |
| `priceText.js` | The cross-surface price parsers. Parses **text, not locators**, because the plan box has build-hashed classes and no stable rows |
| `surfaceIdentity.js` | Identity tuples per surface, and `compareIdentities()`. **Identity before arithmetic** |
| `pricingDiagnosis.js` | The fixed 7-step diagnostic order, `explainDisplayedField()`, and `fieldsAreIndistinguishable()` |
| `domProbe.js` | Describes inputs, buttons and frames on screen. **Never reports input values** — these screens carry a phone number and a one-time code |
| `otpHelper.js` | `waitForManualOtp` (a deliberate `page.pause()`) and `isOtpScreenVisible` |

## The suites

Full per-spec detail: [test-inventory.md](test-inventory.md). **312 tests in 40
spec files.**

| Directory | Files | Runs by default |
|---|---|---|
| `tests/smoke/` | 2 | ✅ |
| `tests/regression/` | 34 | ✅ |
| `tests/api/` | 4 specs + `apiHelper.js` | `npm run api` |
| `tests/scripts/` | 28 probes, discovery and reporting | ❌ — by name, or `BYTEPE_INCLUDE_SCRIPTS=1` |
| `tests/demos/` | 1 walkthrough | ✅ (collected, but a demo) |
| `tests/auth-setup.spec.js` | headed one-time login → `auth.json` | `npm run auth` |

`tests/regression/` groups as: **pricing** · **search and browse** · **sub-home
tabs** · **cart through to order** · **order-minting (write-gated)** ·
**account** · **cross-surface consistency** · **video**.

## `docs/`, `scripts/` and `test-cases/`

| Path | Holds |
|---|---|
| `docs/index.md` | The documentation map |
| `docs/video-feature-coverage.md` | VID-01..53 traceability and env vars |
| `docs/subhome-tabs-coverage.md` | TCB and E2E-SHP traceability |
| `docs/cardless-emi.md`, `docs/cardless-emi-bugs.md` | How cardless EMI works; investigation closed, **no defects** |
| `docs/site-health.md` | The 5 Aug 2026 full-site run |
| `docs/BUG-02-address-delete-no-confirmation.md` | Open bug record |
| `docs/regression-report.*`, `docs/search-test-cases.*` | Generated output |
| `scripts/build-page-report.js` | Turns `page-health.json` into a self-contained HTML report (no CDN, no external CSS) |
| `test-cases/address-management.md` | The manual test-case source behind the address spec |

## `.claude/`

| Path | Holds |
|---|---|
| `agents/spec-writer.md` | UI spec author |
| `agents/api-tester.md` | HTTP-layer test author |
| `skills/new-spec/SKILL.md` | Scaffolds a spec to these conventions |
| `skills/refresh-session/SKILL.md` | Headed re-auth; `disable-model-invocation: true` |
| `hooks/check-spec-syntax.js` | `PostToolUse` `node --check` on edited files under `tests/`. Parse-only |
| `settings.local.json` | Wires the hook and a small permission allowlist |

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
