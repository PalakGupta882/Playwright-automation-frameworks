# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Playwright end-to-end tests for the live BytePe storefront.

## Tests run against production

Every spec hits `https://www.bytepe.com` — the real site, with a real logged-in session. Cart, coupon, EMI, and subscription specs create real state on a real account. **Ask before running any spec**, including smoke tests.

**Order-minting specs are opt-in.** `subscription-e2e` and `subscription-full-flow` press Continue on Review Order, which mints a real order id before any payment step. Both now skip unless `BYTEPE_ALLOW_WRITES=1` is set — the gate lives in `tests/utils/writes.js` and is the same flag the video and API suites use. A routine `npm test` can no longer create an order. Reaching Review Order is safe; only that last click is not.

## Commands

```
npm test          # smoke/ + regression/ (chromium)
npm run smoke     # smoke/ only
npm run regression
npm run auth      # headed re-login; rewrites auth.json
npm run report    # open the last HTML report
npm run lint      # eslint + eslint-plugin-playwright
```

Single test: `npx playwright test regression/cart.spec.js --project=chromium`
Paths are relative to `testDir: ./tests`, so `regression/cart.spec.js`, not `tests/regression/cart.spec.js`.

`npm run lint` is the fast feedback loop — it catches missing awaits, `.only`, and conditionals in tests without touching the live site. There is no formatter.

## Login session

`auth.json` is a saved `storageState` loaded by every test via `playwright.config.js`. It is gitignored and **must never be committed** — it contains a real access token.

Refresh it with `npm run auth`, which needs `BYTEPE_MOBILE` set in the environment (`setx BYTEPE_MOBILE "<number>"`, then a new terminal) and a human to type the OTP in the browser. The placeholder `mobileNumber` in `tests/data/config.js` is not used for login.

Specs behind a login must call `assertFreshSession()` from `tests/utils/session.js` in `test.beforeAll` — it fails fast with the real reason instead of timing out on a button that only renders for a logged-in user. Keep it inert-safe: it deliberately returns early when `auth.json` is missing or has zero cookies, because CI writes an empty session.

CI (`.github/workflows/playwright.yml`) writes an empty `auth.json` and runs only the public specs: `static-pages`, `data-driven-products`, `product-search`, `product-pricing`, `cardless-emi`, `best-price-banner`, plus `api/products-api` and `api/pricing-api`. Adding a login-gated spec to that list will break the pipeline.

The two API specs qualify because they build their request context with no `storageState` and assert catalogue and pricing configuration, which is identical for every shopper. `api/auth-api` and `api/cart-api` are **not** in the list: their anonymous 401 cases would pass, but most of each file gates on a real session and would report as skips, which reads as coverage that is not there.

A spec belongs there only if it passes logged out. `cardless-emi` and `emi-plan-config` qualify because they set `test.use({ storageState: { cookies: [], origins: [] } })` and assert product configuration, which is the same for everyone. Anything asserting per-shopper state does not qualify, whatever its storageState.

## Conventions

- **Tests are CommonJS** (`require` / `module.exports`) — `package.json` sets `"type": "commonjs"`. Only `playwright.config.js` uses ESM `import`/`export default`; Playwright loads it through its own transpiler.
- **Import `test`/`expect` from `../fixtures/pageFixtures`**, not `@playwright/test`. That fixture supplies the page objects (`homePage`, `productPage`, `productsListPage`, `reviewOrderPage`, `emiStorePage`) as test arguments.
- **There is no `baseURL`** in the Playwright config. Navigate through a page object's `goto()` (`BasePage` prefixes the host) or use an absolute URL — `page.goto('/cart')` will not work.
- Put shared URLs, messages, and timeouts in `tests/data/constants.js` rather than inlining them.
- `testMatch` is `**/*.js`, so anything under `tests/` is a spec unless `testIgnore` excludes it. Helper directories (`pages/`, `data/`, `fixtures/`, `utils/`, `wip/`) are excluded. Put new helpers in one of those — a helper elsewhere gets collected as a spec, and a spec importing it fails with `test file X should not import test file Y`.
- Specs set their own `test.setTimeout(...)` when a flow is slow; there is no global test timeout override.
- Assertions should be non-vacuous: before asserting that something is absent (e.g. `toHaveCount(0)`), first prove the element renders at all. See `tests/regression/product-search.spec.js`.

## How BytePe sells (read before writing pricing or payment tests)

**The "Choose your plan" box has two levels: a plan, and how you fund it.**

Plans (the radio options):

| Plan | Where it appears |
|---|---|
| Subscription | only where `prodPaymentMode` is `BOTH` |
| No Cost EMI / Low Cost EMI / Standard EMI | upfront products; the tenure choices |
| Pay in Full / Buy Upfront | everywhere |
| Pre-Approved Offers | a **separate** plan with its own eligibility, not cardless EMI |

Funding options inside an EMI or subscription plan:

- **Credit Card EMI** — requires a card
- **Cardless EMI** — no card, credit-score based

**Cardless EMI is offered on BOTH upfront EMI and subscription.** It is not
subscription-only. Do not report it as missing on an `UPFRONT` product.

**Cardless EMI eligibility is per shopper, not per product.** The row has four
states, all expected:

1. Logged out — "Credit score based · **Check Eligibility**"
2. Logged in, not eligible — "😔 Sorry you are currently not eligible for this plan"
3. Logged in, eligible — a **Pre-approved** badge
4. Logged in, no verdict — "Credit score based" and nothing else

The state can differ between page loads for the same user and product. This is
expected and must never be asserted in a test.

**`nbfc` is subscription pricing, not an availability switch.** `data.nbfc` in the
pricing API is the pre-computed cardless figure for the *subscription* plan.
`nbfc.emi_amount === 0` means "not pre-priced" — it does **not** mean cardless EMI
is unavailable. On upfront products the amount is settled at eligibility time and
is 0 here regardless.

**Which layer to test:**

- **Logged out** — product configuration: which plans exist, what they cost.
  Stable, safe to assert.
- **Logged in** — that account's credit eligibility. Varies by user, changes
  between loads. Never assert it.

**Every product has many variants, and price is per variant.** A product page URL
is `/pd/<slug>/<bpid>` where the bpid identifies **one configuration**, not the
product. Macbook Pro M5 Pro has 47 variants ranging ₹2,84,900 to ₹6,26,900.

- `data.variant.isMaster` marks the default configuration — that is the price a
  shopper sees on landing.
- `data.siblingVariants` lists the rest.
- Pricing is fetched per variant: `/api/apps/variant-pricing/:slug/:variantId`.

The bpids in `tests/data/products.json` are whatever was linked from the listing
page and are **not necessarily the master variant**. Before quoting a price as
"the" price of a product, check `isMaster` — otherwise you will report a figure
nobody sees in production.

**Neither the slug nor the listing bpid is a stable key.** Both move on their own:

- Slugs are derived from the product name, so a rename changes the URL. Between
  two scrapes, `tufton-bluetooth-portable-speaker` became
  `tufton-80-watt-wireless-bluetooth-portable-speaker` with the same bpid.
- The listing links whichever variant is currently featured, so the bpid changes
  too. Phone (4b) moved from `NOTSMMOBU2KQEB` (₹36,999, not master) to
  `NOTSMMOBK25WT5` (₹32,299, master). Both still resolve.

Old product URLs return **HTTP 200 with a "404 This page could not be found."
body** and no redirect. This is expected — do not report it.

Practical consequence: re-run `scripts/discover-products.spec.js` before any
catalogue-wide work, and expect a spec that hardcodes a slug or bpid to drift for
reasons unrelated to the code.

## Identity before arithmetic — required in every regression

**Every regression must assert WHICH item a surface is showing, not only that
its numbers add up.** Capture an identity tuple at each hop — bpid, sku,
variant id, product id, item count — and assert it did not change. Helpers:
`tests/utils/surfaceIdentity.js`.

This is not optional polish. On 14 Aug 2026 a Device Protection charge read ₹1
on Review Order and ₹2,001 on Payment Summary. **Every amount check passed at
every hop**, because each page was internally consistent — the pages were
showing *different products*. No arithmetic assertion can see that, and it is
the worst failure this storefront can produce: the shopper is charged for
something they never reviewed.

Two measured facts make it easy to reach:

- The **subscription basket holds exactly one line**, and subscribing to a
  product silently replaces whatever was in it. Review one product, subscribe to
  another, and the basket has swapped underneath.
- The same product exists under **different bpids** in the two baskets —
  MacBook Air M5 as `APPLALAPO1IYU3` (vas 0) and `APPLALAPO55QSK` (vas 1). Same
  name on screen, different variant, different price, different add-ons.

A `/pd/` URL names one *variant*, not a product, and variants differ in price —
so "a line appeared and the total moved by the right amount" is never proof the
right thing was added. Only the bpid is.

Where to anchor it:

| Hop | Compare |
|---|---|
| PDP → cart | the added bpid appears in `GET /cart?payment_type=UPFRONT` |
| cart → Review Order | `compareIdentities()` over both baskets |
| Review Order → order | reviewed bpids vs `create-order` response `orders[].bpid` / `sku` |

`POST /customer-order/v2/create-order` is the one authoritative record in the
flow — everything before it is a rendering. When a figure differs between two
surfaces, **check identity first**: a changed item explains it more often than
broken maths, and reporting "Device Protection mismatch" on a
wrong-product-on-the-page bug names the wrong culprit.

## Pricing regression: the price must be the same on every surface

Every pricing check written before 14 Aug 2026 was self-consistent within **one**
layer — `pricing-api` reconciles `best_price` against its own competitors,
`emi-checkout-flow` reconciles the EMI ladder against its own price. None
compared a figure on one surface against the same figure on another, so a
product priced differently on the listing and the PDP passed the whole suite.

Two specs close that:

- `regression/pricing-consistency.spec.js` — public, logged out.
  pricing API → PLP tile → PDP header → PDP plan box, per plan. Sweeps the
  **live** listing (~209 products), not `products.json`, which drifts.
- `regression/pricing-checkout-consistency.spec.js` — login-gated.
  PDP → cart line → cart summary → Review Order → Payment Summary.

Shared parsers are in `tests/utils/priceText.js`. They parse **text, not
locators**, on purpose: the plan box container is `div.MuiBox-root.mui-zv7ju9`,
build-hashed, and its rows carry no role, test id or stable class. What is stable
is the copy beside each figure, so every reader anchors on the amount and its
label together.

Measured formulas, all exact — do not re-derive them:

| Figure on the page | Comes from |
|---|---|
| headline price / MRP / % off | `upfront.price` / `upfront.cut_price` / `upfront.off_on_amount` |
| "Pay in Full" · "Buy Upfront" | `upfront.price` |
| "Credit Card EMI ₹X/mo" · "Monthly Subscription" · "Subscription from" | `cc.emi_amount` |
| "Cardless EMI ₹X/mo + ₹Y Now" | `nbfc.emi_amount` + `nbfc.downpay` |
| "₹X x N mo" ladder rows | `emi.emi_option[]` — `installment_amount` × `tenure` |
| "Total Discount" · "You'll save up to" | `(MRP − cc.total_amount) + (add-on list − add-on paid)` |
| instalment total | `price − discount + interest`, ±₹1 per instalment |

The add-on term is `BytePe Secure ₹8,000 → ₹1,999`, which sits **below** the
buyback slider and outside the plan box. It is 22% of the headline saving on a
Galaxy Z Fold8 Ultra, so a check that skips it leaves the largest number on the
page unverified.

**`best_price` is currently absent from `variant-pricing` on every sampled
product** (14 Aug 2026), though the header of `api/pricing-api.spec.js` records
it live and fully populated on 10 Aug. That silently turns 20 of that file's 21
tests into skips while the run stays green — and it is in the CI public list. A
coverage guard now fails instead. Decide whether the field moved or the feature
was withdrawn; do not "fix" it by deleting the guard.

### Device Protection: ₹1 vs ₹2,001 — root cause

**Review Order renders `vas_price` (per unit) where it should render
`vas_amount` (the total charged).** Both fields sit in the same VAS record in
the same response:

```
vas: [{ vas_name: "12 mo Device Protection",
        vas_price:  1,      <- Review Order displays this
        vas_amount: 2001 }] <- Payment Summary charges this
```

Measured on a 3-item upfront order (screen recording, 14 Aug 2026):

| | Review Order | Payment Summary |
|---|---|---|
| Price (3 items) | ₹4,02,799 | ₹4,02,799 |
| Device Protection | **₹1** | **₹2,001** |
| Discount | −₹17,000 | −₹17,000 |
| Total | **₹3,85,800** | **₹3,87,800** |

The shopper approves ₹3,85,800 and is charged ₹2,000 more. `₹1,999 + ₹1 + ₹1`
across the three items is the ₹2,001 — it is a **sum**, exposed as a second
field rather than as extra rows, which is why looking for multiple protected
lines in the cart found nothing.

`regression/device-protection-consistency.spec.js` catches this at Review Order
with **no order minted**: it reads `vas_items[].vas_price` and the line's
`vas_amount` from the cart API and asserts the rendered figure is the charged
one. It reports plainly when `vas_price == vas_amount`, since the two figures
are then indistinguishable and the check proves nothing.

To read a bug recording, `scripts/extract-video-frames.spec.js` pulls stills out
of an MP4 — Playwright's bundled ffmpeg is a WebM-only build and cannot demux
H.264, so Chrome does the decoding. The player must be served from the video's
own directory: `setContent` produces an `about:blank` origin and Chrome silently
refuses to load `file://` media into it (readyState stays 0, no error fires).

### Device Protection through checkout

`regression/device-protection-consistency.spec.js` walks Cart → Review Order →
Payment Summary and compares pricing **component by component** — product
amount, discount, Device Protection, shipping, other charges, total — so a
mismatch names the charge that moved instead of reporting a bare total
difference.

That distinction is the whole point. With Device Protection at ₹2,001 instead of
₹1, Payment Summary's *own* arithmetic still balances perfectly, so a
"does this page add up" check passes on both pages and the defect is invisible.
Only the cross-page comparison of the named component finds it.

```
BYTEPE_ALLOW_WRITES=1   # required — reaching Payment Summary mints a real order
```

The Payment Summary test sets `test.describe.configure({ retries: 0 })`. Do not
remove it: the config retries once locally and twice in CI, and a retry here
mints another real order. Refresh and back/forward checks are folded into the
same test for the same reason — separate tests would each mint their own order.

Its Payment Summary parsers were written against the feature description, **not
against a rendered page** — nothing in this repo had reached it, because getting
there costs an order. They fail loudly with the full page text rather than
mis-parsing quietly. Expect to name real labels in `COMPONENT_PATTERNS` in
`utils/priceText.js` on the first run.

`best_price` is **intentionally disabled** (the offer ended). Nothing in the
checkout pricing suite reads it, and it must never fail a run or be reported as
a pricing defect.

### Cart facts that cost a run each

- **"Price (N Items)" is a sum of MRPs, not selling prices.** Adding a ₹1,575
  item with a ₹3,499 MRP moves Price by 3,499, Discount by 1,924, and **Total by
  1,575**. Hold the PDP price to the **Total**, never to the Price line.
- **Re-adding a product already in the cart is a no-op.** `POST /api/cart`
  returns 200 with "Your Item has been successfully added in Cart" and nothing
  moves — not even the quantity. A spec that adds "the cheapest product" every
  run silently stops testing anything on its second run. Pick a product the cart
  does not already hold.
- **The PDP shows "Add to Cart" whether or not the item is in the cart.** It
  flips to "Go to Cart" only transiently, in the same session, right after a
  click. It is not a reliable "is this in my basket" signal.
- **Never locate the buy CTA by name.** `getByRole('button', {name:'Add to
  Cart'}).first()` reaches the recommended-products carousel further down the
  PDP, and on 14 Aug 2026 it **added a ₹1,24,999 phone to the live cart** instead
  of a ₹1,200 powerbank. Anchor on `Buy Now` and take the button before it —
  carousel tiles have no Buy Now.
- **Confirm an add by its request, not its button.** `POST /api/cart` carries the
  site's own verdict; a label can flip for reasons unrelated to your click, and
  an early click is silently inert because the button renders before its handler
  is bound.

### Session lifetime

`access_token` lasts **15 minutes**; `refresh_token` lasts 7 days. `npm run auth`
reuses the refresh token silently and only prompts for an OTP when that has also
expired. It now refuses to short-circuit on a token with under 5 minutes left —
it used to save one seconds from expiry and report success, and the next command
failed `assertFreshSession()`. `BYTEPE_OTP_WAIT_MS` widens the manual OTP window
(default 120000); the spec timeout derives from it.

## Product Video suite

`video-*.spec.js` cover the Product Video feature (VID-01..VID-53). They gate
themselves on `BYTEPE_API_URL` / `BYTEPE_ADMIN_JWT`, on `BYTEPE_ALLOW_WRITES=1`
for anything that creates or deletes records, and on a product that actually has
a live video. Skipping is the intended behavior when those are absent — do not
"fix" a skip by weakening the assertion. Coverage map and env vars:
@docs/video-feature-coverage.md

## Debugging failures

Failures leave a screenshot and video in `test-results/` and in the HTML report; traces are captured on first retry. Retries are 1 locally and 2 in CI, so a "passing" run may still have been flaky — check the report.
