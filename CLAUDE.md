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
- **Choose products from the live listing API, never by name or from `products.json`.** `tests/utils/catalogue.js`: `fetchListingRows` (whole catalogue, throws if short of `data.count`), `pickProduct({ mode: 'UPFRONT' | 'BOTH', exclude })` (in stock, not pre-booking), `readBasketIdentities`. Not the `/all-products` UI — it drops whole pages.
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

## How to investigate any pricing discrepancy

Work in this order. Do not skip ahead, and do not start at the bottom.

```
1. Is it the SAME product?
        ↓
2. Is it the SAME variant/SKU?
        ↓
3. What does the API return?
        ↓
4. Which API field is the UI displaying?
        ↓
5. Does that field represent a price, an amount, a discount or a total?
        ↓
6. Compare across Cart → Review → Payment
        ↓
7. Only then investigate arithmetic
```

Steps 1–5 are cheap, need no order to be minted, and **any one of them can
fully explain a difference that looks like broken maths**. Step 7 is the
expensive one and the one most likely to produce a confident, wrong bug report.

This ordering was paid for. The Device Protection ₹1 → ₹2,001 discrepancy was chased
as arithmetic for a long time; the answer was step 4. Both figures were in the
same record — `vas_price: 1` and `vas_amount: 2001` — and the page rendered the
per-unit field where it should have rendered the total. Every page's own sums
were correct throughout, so no amount comparison could ever have found it.

That behaviour is now CONFIRMED EXPECTED (see below); the lesson about the
ordering stands regardless.

Tooling for each step:

| Step | Use |
|---|---|
| 1–2 | `utils/surfaceIdentity.js` — `identitiesFromCart`, `identitiesFromCreateOrder`, `compareIdentities` |
| 3 | the API directly; `GET /api/cart?payment_type=UPFRONT\|SUBSCRIPTION` |
| 4–5 | `utils/pricingDiagnosis.js` — `explainDisplayedField`, `fieldsAreIndistinguishable` |
| 6 | `utils/priceText.js` — `parsePricingBreakdown` per surface, then compare components |
| 7 | `expectedTotalOf` — last, not first |

Two rules that fall out of it:

- **Name the field, not the symptom.** "The page renders `vas_price`" and
  "Device Protection is wrong" are different bugs, fixed by different people.
- **Say when a check cannot distinguish.** If two candidate fields hold the same
  number, an assertion separating them passes by coincidence.
  `fieldsAreIndistinguishable()` exists to report that instead of claiming a
  clean result.

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

The ₹1/₹2,001 rendering itself is confirmed expected. The wrong-product-on-the-
page risk it exposed is not, and is why the identity rule exists.

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
| "Total Discount" · "You'll save up to" | `(MRP − cc.total_amount) + Σ(add-on list − add-on paid)` |
| instalment total | `price − discount + interest`, ±₹1 per instalment |

**The add-on term is a SUM over every bundled row, not one row.** The block sits
**below** the buyback slider and outside the plan box, and as of 23 Aug 2026 it
holds more than one entry:

```
Pixel 11 Pro Fold   12 mo Device Protection  ₹12,999 → ₹1
                    Free Wireless Charger     ₹5,999 → ₹0
```

That term is 22% of the headline saving on a Galaxy Z Fold8 Ultra and **54%** on
the Pixel, so a check that skips it leaves the largest number on the page
unverified — which is exactly what happened when the labels moved.

**Never match these rows on a literal name.** The old parser looked for
`BytePe Secure`; protection is now labelled `12 mo Device Protection` and priced
from ₹12,999 rather than ₹8,000, so the match missed, `parseAddOn` returned
`null`, and the caller read that as "this product bundles nothing". Get the names
from the VAS record instead and look each one up:

```
GET /api/apps/product-vas/:slug/:bpid   (public, no auth)

vas: [{ vas_name: "12 mo Device Protection", vas_mrp: 12999, vas_price: 1,
        details: { other_type: "Damage Protection" } },
      { vas_name: "Free Wireless Charger",   vas_mrp:  5999, vas_price: 0,
        details: { other_type: "Freebie" } }]
```

This is **not** part of `variant-pricing` — that response carries
`upfront/cc/cc_y2/nbfc/emi/emi_price/abb` and no `vas` key at all. Helpers:
`productVasPath` / `vasNamesFrom` in `tests/data/emiApi.js`, `parseAddOns` in
`tests/utils/priceText.js`. `parseAddOn` still returns the protection row alone
for the callers that mean protection specifically.

There is no way to find these rows in body text without the names. "A label, then
two amounts, the second no larger" also describes the PDP header (price then
struck MRP) and every adjacent pair in the buyback slider, and the block carries
no heading, role, test id or stable class to scope a search to.

### /all-products drops whole pages of the catalogue — OPEN DEFECT (2 Sep 2026)

**This one is not confirmed-expected. It is a live, shopper-visible bug**, and
unlike the two rulings below it has not been raised with anyone yet.

The listing lazy-loads at `?page=N&limit=12`. Measured on a quiet origin, one
worker, five consecutive loads of `/all-products`:

| Rendered | Missing |
|---|---|
| 217 / 217 | — |
| 217 / 217 | — |
| 205 / 217 | API page 12 |
| 193 / 217 | API pages 5 and 13 |
| 180 / 217 | API pages 3, 5, 12 and the 1-item tail page 19 |

The shortfall is always a **whole page of 12**, never a scattering of tiles.

**The API was ruled out first, and it is clean.** Pages 1–19 at `limit=12` serve
217 unique products, zero duplicates, stable ordering across repeat calls, and
the client is observed *requesting every one of those pages* on every load. The
response arrives and the render discards it — a lost state update in the
infinite scroll, not a missing fetch and not rate limiting.

The 12 products lost on one measured load were `iPhone 17 Pro Max`,
`iPhone 17 Pro`, `iPhone Air`, `iPhone 17`, `iPhone 15`, `Galaxy Z Fold7`,
`Galaxy Z Flip7`, `Pixel 10`, `iPad (A16) 11th Gen`, `AirPods Pro 3rd Gen`,
`AirPods 4 (ANC)`, `AirPods 4` — one page of flagships, unreachable by browsing.
They still resolve by direct URL and by search, which is why nothing else in the
suite can see it: every other spec reaches a product through the API or a known
slug.

`regression/listing-completeness.spec.js` owns it. Three loads per run, failing
if any of them is short, and it groups the misses **by API page** because a
dropped page and a scattering of tiles are different defects with different
fixes. `retries: 0` on purpose — a retry re-rolls the dice and reports the flaky
pass.

**Do not read `pricing-consistency`'s `SHORTFALL_TOLERANCE = 0.85` as evidence
that 89% is healthy.** That constant answers a different question — "is this
scrape complete enough for the sweeps below to mean anything?" — and it exists so
a partial scrape does not fail six pricing tests for a reason that is not
pricing. Reading it as a statement about the site is how this went unnoticed for
a week. Leave it where it is and do not widen it.

### Sold Out: a variant can be listed, priced, and unbuyable

`data.variant.stock` and `data.variant.available` are on the PDP payload and
were unread by anything in this repo until 2 Sep 2026. On that date 2 of 217
listed products came back unavailable — `edge-70-fusion/MOTSMMOBH1YG73` and
`the-aisle-trunk-cabin/MOKLULUGW1IWON`, both `stock: 0, available: false`.

Both are still linked from the live listing, still priced, and still render a
full plan box. The only thing between a shopper and an order for stock that does
not exist is the state of one button.

The page gets it right, and the behaviour is a **substitution, not an overlay**:

| | Buy row |
|---|---|
| in stock | `Add to Cart` (enabled) and `Buy Now` (enabled) |
| sold out | the same slots hold a **disabled** button labelled `Sold Out` |

An upfront product swaps both buttons; a subscription product swaps its single
Subscribe control. Everything else on the page — price, plan box, EMI ladder,
buyback slider — renders exactly as it does in stock.

`regression/stock-availability.spec.js` holds it, and **anchors on `Buy Now`,
not on `Add to Cart`**, for the reason in the cart section below: the
recommended-products carousel further down the PDP has its own `Add to Cart` and
once put a ₹1,24,999 phone in the live cart. Carousel tiles carry no `Buy Now`.
It carries a control case — an available product must render an enabled
`Buy Now` — so "no buy control here" cannot pass on a page that failed to render.

Availability is transient. The spec finds unavailable variants from the live API
rather than hardcoding those two bpids, and **skips with a reason** when the
whole catalogue is in stock. That skip is not a pass.

### The listing row carries a whole price block, and a copy of the add-on list

Both appeared on `GET /product-service/apps/products?page=N&limit=M` and were
unverified against anything until 2 Sep 2026:

```
price: { mrp: 186999, mop: 178999, minEmi: 8369, discount: 4 }
vas:   ["12 mo Device Protection", "Free Wireless Charger"]
```

**The catalogue is 241 products as of 16 Sep 2026**, up from the 217 recorded
here on 2 Sep. Two more row fields have appeared since, neither asserted by
anything yet:

| Field | Seen on | Shape |
|---|---|---|
| `rating` | 33 / 241 rows | a number, `4` … `5` (e.g. `4.4`, `4.5`) |
| `variant.tags[]` | 8 / 241 rows | `{id, name, bgHexColor, textHexColor, priority}` |

**Re-measured 5 Oct 2026: 300 products**, and the tag set has changed. 24 of 300
rows carry a tag, and **none is `Pre-booking`** — the tags are now `New Launch`
(priority 2, same `#FF5722` badge) and `sale price live`. Treat the 241/8 figures
in this file as history. Read the count from `data.count`, never from here.

`variant.tags[]` carried exactly one tag, `Pre-booking`, on 16 Sep — see the
pre-booking section below, which `regression/prebooking.spec.js` does cover.
`rating` is uncovered: nothing checks that the stars on a tile match the stars on
the PDP, and 208 of 241 rows carry no rating at all.

The listing endpoint returns its rows under **`data.items`**, not `data.products`.

Measured exact across the sampled catalogue — do not re-derive:

| Listing field | Comes from |
|---|---|
| `price.mop` / `price.mrp` | `upfront.price` / `upfront.cut_price` |
| `price.discount` (the "% off" badge) | `upfront.off_on_amount` |
| `price.minEmi` (the "EMI from ₹X/mo" line) | `cc.emi_amount` **when `cc` is populated** — see below |
| `vas[]` | the `vas_name`s from `GET /api/apps/product-vas/:slug/:bpid` |

**`cc` is frequently a block of zeroes, and `minEmi` does NOT come from it then.**
Corrected 16 Sep 2026 — the row above used to say `minEmi` is `cc.emi_amount`
"identical to top-level `emi_price`" with no qualification, and that is wrong for
a large part of the catalogue. On Watch Ultra 4 the whole `cc` object reads
`{emi_amount: 0, MOP: 0, MRP: 0, emi_option: []}` and `emi_price` is `0`, while
the listing tile says **₹5,816/mo** — which is exactly
`emi.emi_option[last].installment_amount` (24 mo). The **PDP renders ₹5,816 too**,
under the "Credit Card EMI / All major cards" label, so the page falls back to the
`emi` ladder and tile and PDP agree.

So the real rule is: **`minEmi` is `cc.emi_amount` when `cc` is populated, and the
longest-tenure `emi.emi_option[].installment_amount` when it is not.** This is not
pre-booking-specific — ordinary products (the Yonex racquets, for instance) have a
zeroed `cc` too.

Do not report a zeroed `cc` alongside a non-zero tile as a pricing mismatch. It
was chased as one on 16 Sep 2026 and the answer was step 4 of the diagnostic
order — which field the UI is displaying — not arithmetic.

`vas[]` is a **second copy** of a list that lives in the VAS record — 30 of 217
rows carry one. A stale copy advertises a free charger on the tile that the
product page then does not offer. `catalogue-integrity.spec.js` compares all
four, and checks a sample of rows claiming *no* add-ons as well: a listing that
under-reports is the direction that costs the shopper a benefit they were
entitled to, and it is invisible if you only check the rows that claim one.

### Pre-booking — LIVE since 16 Sep 2026, and now covered

**Status 5 Oct 2026: no product is pre-booking.** The devices launched; iPhone
18 Pro Max now reads `isPrebookingAllow: false`, `normalOrderAccess: "all"`,
`can_place_normal_order: true`, tagged `New Launch`. Expect
`prebooking.spec.js` to skip and `data-driven-products` to annotate "no
preBooking product" — that skip is not a pass. The contract below stands for the
next pre-booking launch.

This section previously read "**No product enables it** — 0 of 217 on 2 Sep
2026 ... find a product first." **That is out of date.** The catalogue produces
the state now: **8 of 241** products are pre-booking, all Apple, all with
`launchDate` 2026-09-18.

The feature spans three payloads and adds a new key to each:

```
listing row   variant.tags[]  {name:"Pre-booking", bgHexColor:"#FF5722",
                               textHexColor:"#FFFFFF", priority:1}
PDP payload   product.isPrebookingAllow  = true
              product.launchDate         = "2026-09-18T00:00:00.000Z"
              product.normalOrderAccess  = "pre_booked_only"
variant-      data.prebooking            = { amount: 99 }
  pricing     data.normal_order_access   = "pre_booked_only"
              data.can_place_normal_order = false
```

**`can_place_normal_order: false` is the business rule.** These are unreleased
devices, so only a ₹99 reservation may be placed against them. The PDP enforces
it the same way Sold Out does — by **substituting the buy row**: one
`Pre-book Now` button plus a "Pre-booking Price ₹99" line, and **no
`Add to Cart` or `Buy Now` at all**. Verified identical logged in and logged
out; only the "Already pre-booked? Sign in to buy now" prompt differs.

`regression/prebooking.spec.js` owns it, read-only — **it never clicks
`Pre-book Now`**, which takes ₹99 and mints a real pre-booking. It anchors the
absence assertion on `Buy Now` for the carousel reason above, and carries a
control case so "no buy control here" cannot pass on a page that failed to
render. `retries: 0`.

**The ₹99 renders about a second AFTER `Pre-book Now` does.** Measured: at the
instant the button is visible the body contains no `99` at all. Reading the page
text the moment the button resolves reports every product as quoting nothing —
that is the test being early, not the page being wrong. Poll for the amount.

### BytePe Exchange dismisses itself, or nothing else on the page is clickable

Device trade-in shipped between 20 and 26 Aug 2026. On cart and Review Order it
opens a dialog **by itself**, gated on the delivery address being eligible:

```
Exchange is now available!
Your selected delivery address is eligible for BytePe Exchange.
[ Add Exchange ]   [ Not now ]   [ Close ]
```

Left alone it intercepts pointer events, and the failure names the control you
were aiming at rather than the dialog — a `locator.click` timeout on an element
the screenshot plainly shows. It cost `coupon-valid`, `coupon-invalid` and
`checkout-flow` a run each on 26 Aug 2026.

It is handled for every spec by `installExchangeDialogHandler()`
(`tests/utils/exchangeDialog.js`), registered on the `page` fixture in
`tests/fixtures/pageFixtures.js`, so no spec has to remember. It declines via
**Not now** and logs each dismissal. **Never click "Add Exchange" from a test** —
it attaches a trade-in to a real order.

**`best_price` is intentionally disabled** — the offer behind it ended. It is
absent from `variant-pricing` on every sampled product, which turns 20 of the 21
tests in `api/pricing-api.spec.js` into skips with a reason.

That is the correct outcome, and this file previously said the opposite. A
coverage guard briefly asserted the field was present; it was deliberately
removed, and `api/pricing-api.spec.js` now carries an explicit "do not re-add a
guard here" note at that spot. The per-fixture `test.skip(!best, ...)` calls are
the intended behaviour. Nothing in the checkout pricing suite reads `best_price`,
and it must never fail a run or be reported as a pricing defect.

### A PDP that cannot price shows ₹0 and proceeds — CONFIRMED EXPECTED (27 Aug 2026)

**Do not re-file this as a blocker.** It was raised as one and DevOps have ruled
on it, and the ruling is now measured to be correct.

When `variant-pricing` does not return a usable body, an **upfront** PDP renders
no headline price, `EMI From /mo` with no amount, and

```
₹0 x undefinedmo
```

in the pre-selected plan, with **Add to Cart and Buy Now still enabled**. All of
that is intended: the fallback is ₹0 and the flow is meant to go ahead, because
nothing downstream trusts the PDP for price.

**The zero does not carry, and that is the whole basis of the ruling.** Measured
end to end with the pricing call blocked for the *entire* journey and the cart
API left alone (Odyssey Large Hard Luggage 110L, true `upfront.price` ₹6,399;
re-confirmed on Rover Pro Cabin Hard Luggage at ₹5,899):

| Hop | What it shows |
|---|---|
| PDP | `₹0 x undefinedmo`, no price, buy controls live |
| `POST /api/cart` | 200, `purchase_mode: CC_EMI` |
| cart API line | `MOP` ₹6,399 — **correct** |
| cart page total | moved by exactly ₹6,399 |
| Review Order | identical to cart, no placeholder anywhere |

Cart and Review Order re-price **server-side from `/api/cart`** and never call
`variant-pricing` — it stayed blocked throughout and neither page needed it.

Four failure modes reproduce it identically — 429, 500, a network abort, and a
clean **200 with `data: {}`**. That last one is why "it is just rate limiting" is
wrong: the client has no unpriced state at all and formats whatever it got.

Scope is **upfront-layout products only** — 16 of 16 sampled. Subscription-layout
products still price and render no placeholder. Do not report it as
catalogue-wide.

`regression/pdp-pricing-failure.spec.js` holds the guard that keeps this
non-blocking: *the price the PDP could not show is still the price cart and
Review Order ask for*. **If that test ever fails, this stops being cosmetic.**
Nothing else in the suite proves it — every other pricing spec compares surfaces
that were all priced normally. It adds one real cart line per run and pins
`retries: 0` so a retry cannot add a second.

**The literal `undefined` in the tenure is accepted too**, ruled the same day.
Nothing asserts its absence. What the suite still holds the page to is that an
unpriced plan box quotes **zero and never a number** — ₹0 is acceptable because
it is visibly empty, whereas a stale or invented instalment (`₹276 x 24mo` on a
page whose pricing call just died) is a figure the shopper was quoted that
nothing substantiates, and that would be a defect under the same reasoning that
cleared the ₹0.

Two assertions were written here and removed, both because they argued with a
decision that had been taken. Do **not** re-add either:

- that the buy controls must be disabled while the page is unpriced
- that no `undefined` may reach the copy

### Device Protection: ₹1 vs ₹2,001 — CONFIRMED EXPECTED (20 Aug 2026)

**This is not a defect.** It was filed as one and chased as one; product has
since confirmed the behaviour is intended. Do not re-report it.

**The ₹1 price is also intentional — confirmed 21 Aug 2026.** This is a second,
separate question from the rendering above, and it has now been answered too.
The base VAS record in the 360 Admin Panel (`360.bytepe.com/vas` → Edit VAS,
"12 mo Device Protection") carries `Price: 1.00`, and per-product figures come
from the **Upload VAS Pricing** flow on the same screen. So a product showing
`BytePe Secure ₹8,000 → ₹1` — Macbook Pro M5 and iPhone 17e both do, while
Galaxy Z Fold8 Ultra shows ₹1,999 — is **priced as intended**, not a product
missing its row and falling through to the default. Do not raise it as a revenue
exposure; that question was asked and closed.

The label and the list price have both moved since: the same record was updated
23 Aug 2026 and now reads `12 mo Device Protection ₹12,999 → ₹1`. Treat the
figures above as measurements of that date, not as constants — and read the row
by the name the VAS record gives it, per the add-on section above.

The same admin record is the source for the subscription-only rule below:

```
VAS enable for Subscription : true
VAS enable for Upfront      : false
```

Review Order renders `vas_price` (per unit); Payment Summary charges
`vas_amount` (the total). Both fields sit in the same VAS record in the same
response:

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

`₹1,999 + ₹1 + ₹1` across the three items is the ₹2,001 — it is a **sum**,
exposed as a second field rather than as extra rows, which is why looking for
multiple protected lines in the cart found nothing.

Two further facts, both measured, that decide whether you can even see this:

- Device Protection attaches on **subscription** purchases only — the VAS record
  carries `is_default_subscription: true, is_default_upfront: false`. Adding a
  product upfront attaches ₹0, and that is correct.
- With a single protected line `vas_price == vas_amount`, so the two figures are
  indistinguishable and no check can separate them. You need **two or more
  protected lines** before they diverge at all.

`regression/device-protection-consistency.spec.js` no longer asserts that Review
Order renders `vas_amount`. What it still asserts is that the rendered figure is
**one of the two fields the response carries** — a third value would be a number
with no source the shopper could have seen, and that would be a real bug. It
reports plainly when `vas_price == vas_amount`, since the check then proves
nothing.

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
Only the cross-page comparison of the named component finds one.

The ₹1/₹2,001 case is confirmed expected and no longer fails the suite. The
component comparison stays because it is what would catch a charge that moved
for a reason nobody intended.

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

### The PDP buy row was redesigned — "Add to Cart" is now an icon (16 Sep 2026)

**Confirmed intentional.** Not a defect — but it broke every spec that added a
product, so the measured contract is recorded here. Helpers: `utils/buyRow.js`.

The buy row is a bar holding the selected plan's figure and, on the right, up to
two controls:

```
[ EMI  ₹1,770 x 24mo ]                     [ 🛒 ]  [ Buy Now ]
```

The cart control is **icon-only** — 44×44, no text at all:

```html
<button aria-label="Add to cart"><svg data-testid="AddShoppingCartIcon"></button>
```

So every `getByRole('button', { name: 'Add to Cart' })` in this repo stopped
matching, and the failures all read as a timeout on a control that is plainly on
screen. Note the lower-case **c** in `Add to cart` — the old title-case name
matches nothing now, so asserting its ABSENCE passes vacuously on every product.

**Which products carry it.** Measured across the catalogue, logged out:

| `prodPaymentMode` | pre-booking | Add to cart | Buy Now | Pre-book Now |
|---|---|---|---|---|
| `UPFRONT` | no | **1** | 1 | 0 |
| `BOTH` | no | **0** | 1 | 0 |
| `UPFRONT` | yes | 0 | 0 | 1 |

The cart icon is an **UPFRONT-only** affordance. A subscription-capable (`BOTH`)
product offers Buy Now alone, and a pre-booking product offers neither. So
**"the first product on `/all-products`" is no longer addable** — the listing
now sorts pre-booking Apple devices to the front. Pick by payment mode from the
API instead: `rowOffersAddToCart(row)` in `utils/buyRow.js`.

**Keep the structural anchor.** `clickAddToCart(page)` takes the cart control
that appears BEFORE `Buy Now` in document order, not the first match by name.
The aria-label looked unique on every product sampled, but those pages had no
recommended-products carousel mounted (`a[href*="/pd/"]` count 0 at the bottom),
so that is **not** evidence the name is unique in general — and CLAUDE.md
already records what a carousel mis-match cost: a ₹1,24,999 phone in a live cart.

Why `aria-label` over `svg[data-testid="AddShoppingCartIcon"]`: the testid is
MUI's own and tied to the glyph, so swapping the icon silently breaks it. The
aria-label is the name published to assistive technology.

Do not confuse it with the **header** cart control, which is a different button
carrying the text `Cart` and a `ShoppingCartOutlinedIcon`. `getByRole('button',
{ name: /cart/i })` matches both.

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

### The header renders twice on Sub Home routes — OPEN DEFECT (16 Sep 2026)

**Not confirmed-expected. Not raised with anyone yet.** It broke `npm run auth`
outright, which is how it was found.

Measured logged out, five routes:

| Route | `<header>` | `<nav>` | header buttons |
|---|---|---|---|
| `/` | **2** | **2** | **12** |
| `/home/subscription` | **2** | **2** | **12** |
| `/home/emi-store` | **2** | **2** | **12** |
| `/all-products` | 1 | 0 | 5 |
| `/about-us` | 1 | 1 | 6 |
| `/pd/<slug>/<bpid>` | 1 | 0 | 5 |

It is the three **Sub Home** routes, the ones carrying the CMS tab strip. Both
copies are real and reachable: same parent, `position: fixed`, `z-index: 1100`,
identical `0,0 1280x77` rects, identical text, **neither `aria-hidden` nor
`inert`**, both `pointer-events: auto`. The accessibility tree exposes **2 banner
landmarks and 2 navigation landmarks**.

Visually they stack exactly, so a sighted shopper sees one header and their click
lands on the copy on top. The cost falls on assistive technology — the whole
primary navigation is announced twice — and on anything driving the page.

**This is why `homePage.loginLink` is `.last()` and not `.first()`.** `.first()`
resolves the copy UNDERNEATH, and every click on it is swallowed by its own twin:
Playwright reports `<span>Login</span> ... subtree intercepts pointer events` on
an element the screenshot plainly shows. **`force: true` does not fix it** — it
skips the actionability check, not the browser's hit-testing, so the click still
lands on the copy above. `.last()` stays correct once the duplication is gone,
because it is then the only match.

`regression/header-duplication.spec.js` owns it. It asserts the **correct**
behaviour and therefore **fails today** — that is deliberate, not a broken test.
It proves each route rendered a header at all before checking there is only one,
so it cannot pass on a page that failed to load. `retries: 0`.

### Login is a right-anchored Drawer, not a Dialog

Changed by 16 Sep 2026. `getByRole('dialog')` finds **nothing** — the panel is a
`MuiDrawer-paperAnchorRight` and carries no `dialog` role. Its contents:

```
Enter mobile number to continue / Pay Less, Flex more!
[ +91 ] [ Mobile Number* ]        <- maxlength 10, inputmode numeric
By continuing, I agree to the Terms of Use & Privacy Policy
[ CONTINUE ]                      <- type=submit, inside a <form>
```

The field **does** have a proper `<label for>`, so
`getByRole('textbox', { name: 'Mobile Number*' })` still resolves it and needed no
change. When that locator times out, the drawer never opened — look at the click,
not the field.

**It also opens by itself on a stale session** — measured 5 Oct 2026 on PDPs
loaded with an expired `auth.json` (header reads `Login`). Not on every load,
and not on a clean logged-out context. The Drawer is modal: the rest of the page
leaves the accessibility tree, so every `getByRole` fails with `element(s) not
found` on a control the screenshot plainly shows, and which product fails moves
between runs. Read `error-context.md` — the snapshot is just the drawer. A public
spec must set `test.use({ storageState: { cookies: [], origins: [] } })` rather
than inherit `auth.json`; a login-gated one has `assertFreshSession()`.

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
