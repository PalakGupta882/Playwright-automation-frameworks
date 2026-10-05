# API reference

Every module a spec can import: what it exports, what it does, and — for
locators — **why that locator and not the obvious alternative**. Selector choice
is most of the work in this suite, so the rationale is part of the contract.

Layering rules and the config are in [architecture.md](architecture.md).

---

## `tests/fixtures/pageFixtures.js`

The only place a spec should import `test` and `expect` from.

```js
const { test, expect } = require('../fixtures/pageFixtures');
```

It extends Playwright's `test` with **six** page-object fixtures, constructed per
test against that test's `page`:

| Fixture | Class | File |
|---|---|---|
| `homePage` | `HomePage` | `pages/homepage.js` |
| `productPage` | `ProductPage` | `pages/productPage.js` |
| `productsListPage` | `ProductsListPage` | `pages/productsListPage.js` |
| `reviewOrderPage` | `ReviewOrderPage` | `pages/reviewOrderPage.js` |
| `emiStorePage` | `EmiStorePage` | `pages/emiStorePage.js` |
| `subHomeTabsPage` | `SubHomeTabsPage` | `pages/subHomeTabsPage.js` |

It also **overrides `page`** to register the BytePe Exchange dialog handler
(`utils/exchangeDialog.js`) before the test body runs. That is why no spec has to
dismiss the dialog itself, and why a spec importing `test` from
`@playwright/test` will start timing out on cart and Review Order clicks.

Page objects not in this list (`cartPage`, `accountPage`, `productVideoPage`) are
constructed by hand in the specs that need them — they are not wanted on every
test.

`expect` is re-exported unchanged from `@playwright/test`.

---

## `tests/pages/` — locators and actions

Page objects hold locators and actions. **They do not call `expect`.**

### `basePage.js`

20 lines. Everything else extends it.

| Method | Notes |
|---|---|
| `goto(path)` | Prefixes `https://www.bytepe.com`. **This is why there is no `baseURL`** — navigation goes through here or through an absolute URL. |
| `clickText(text)` | `getByText(text, { exact: true }).first().click()` |
| `waitAndClick(locator)` | `scrollIntoViewIfNeeded()` then `click()` |

### `homepage.js`

Navigation to every section, plus the whole login/OTP flow.

| Method | Notes |
|---|---|
| `goto()` | Homepage |
| `isLoaded()` | Boolean health check |
| `clickHeaderLink(key, urlPattern)` | Walks **both** header copies — see below |
| `goToSubscription()` `goToEmiStore()` `goToProducts()` `goToAboutUs()` `goToCart()` `goToLogin()` | Thin wrappers |
| `selectCategory(name)` | Legacy; the category strip is now the tab bar — use `subHomeTabsPage` |
| `login(mobileNumber, otp)` | Full flow |
| `openLoginDialog()` → `submitMobile(mobile)` → `enterOtp(otp)` → `waitForLoggedIn({ timeout })` | The flow in stages |
| `logout()` | |
| `describeOtpFailure(candidates)` | Diagnostics for a failed OTP step |

**Locator rationale — `.last()`, not `.first()`.** The homepage renders its
`<header>` **twice**, and that is *confirmed expected* (20 Aug 2026), not a defect
awaiting a fix. Measured on `/` and `/home/subscription`:

```
<header> elements: 2
  header[0] 1280x77 @0,0 pos=fixed z=1100 vis=visible
  header[1] 1280x77 @0,0 pos=fixed z=1100 vis=visible
  a[href="/home/subscription"]: 2, both 86x18 @805,29
```

Two identical copies, both visible, stacked exactly. At equal z-index the later
element paints on top, so `.last()` is the copy a real mouse click reaches and
`.first()` is permanently covered:

```
first() copy: blocked: locator.click: Timeout 6000ms exceeded
last()  copy: clicked -> https://www.bytepe.com/home/subscription
```

**Do not "simplify" this back to `.first()`** — that took down three smoke tests
on 19 Aug. And `.last()` is right *most* of the time but not always: which copy
paints on top is decided per render, which is why `clickHeaderLink()` keeps both
copies unresolved and walks them.

`profileLink` (`My Profile`) is the **positive** logged-in signal. "Login is
gone" is not equivalent — the header paints its logged-out state first and swaps
once the app resolves the session.

### `productPage.js`

| Method | Notes |
|---|---|
| `getPrice()` | The headline price as a number. **Throws** rather than returning `NaN` or `0` |
| `getLowestEffectivePrice()` | The banner amount as a number. Also throws |
| `selectVariantOption(value)` | |
| `selectProductByImageName(name)` | |
| `clickSubscribe()` | |
| `enterMobileNumberAndSendOtp(mobile)` / `waitForManualOtpEntry()` | |
| `checkPincode(pincode)` | |

**Locator rationale — the price.** The PDP renders **14** nodes matching
`/^₹[\d,]+$/`: struck-through MRP, EMI instalments, total discount, assured
buyback and exchange values are all in there. The one a shopper reads as "the
price" is first in DOM order — 20px, weight 600, no line-through — and was
verified against the API to equal `data.upfront.price` from
`/api/apps/variant-pricing` for the same variant.

`.first()` is DOM-order dependent, which is not ideal, but the PDP offers no
heading, test id or stable class to anchor to (the plan boxes are MUI with
build-hashed class names). If the layout reorders, this is where it breaks — and
`getPrice()` throws with the text it actually found rather than returning a wrong
number quietly.

**Locator rationale — the "Lowest Effective Price" banner.** The amount is
matched *together with its caption* in one expression:

```js
page.getByText(/^₹[\d,]+\s*with Discount & Coupon$/i).first()
```

Three alternatives measured worse:

- the MUI container class (`mui-1ll6jj1`) is build-hashed and changes every deploy;
- `getByText(/^₹[\d,]+$/).first()` is already taken by the headline price;
- anchoring on the caption and walking up with `xpath=..` couples the locator to
  DOM nesting, which is exactly what the banner's own re-render changes.

Binding both halves into one regex means the locator fails loudly if either
disappears, instead of silently matching a different rupee figure. Measured
`count=1` on a live PDP.

The pincode widget is filtered to `{ visible: true }` because the page renders
desktop **and** mobile variants — `.first()` could resolve to a hidden one, and
clicking that never succeeds.

### `productsListPage.js`

| Method | Notes |
|---|---|
| `goto()` | `/all-products` |
| `search(term, { retries = 2 })` | Preferred. Retries because the site rate-limits |
| `searchFor(name)` | Lower level |
| `selectAutocompleteSuggestion(text)` | |
| `selectBuyUpfrontPlan()` | |
| `clickAddToCart()` / `clickGoToCart()` | |

**Locator rationale — the search box.** The header renders **four** inputs with
the accessible name "search", two of them hidden:

```
[0] placeholder="Search for Products..."          HIDDEN
[1] placeholder="Search for Products, brands..."
[2] placeholder="Search for Products..."          HIDDEN
[3] placeholder="Search for Products, brands..."
```

`.first()` resolved to a hidden input — which is what a `force: true` on the
click was compensating for. Typing into a hidden box does nothing useful, and the
click intermittently timed out on an element that was never going to stabilise.
Hence `.filter({ visible: true }).first()`.

### `cartPage.js`

35 lines. `addFirstProductToCart()`, `selectBuyUpfrontPlan()`.

> **Never locate the buy CTA by name.**
> `getByRole('button', { name: 'Add to Cart' }).first()` reaches the
> recommended-products carousel further down the PDP, and on 14 Aug 2026 it
> **added a ₹1,24,999 phone to the live cart** instead of a ₹1,200 powerbank.
> Anchor on `Buy Now` and take the button before it — carousel tiles have no
> Buy Now.

### `reviewOrderPage.js`

| Method | Notes |
|---|---|
| `isLoaded()` | |
| `applyCoupon(code)` | |
| `getCouponErrorMessage()` | |
| **`clickContinue()`** | **This is the click that mints a real order id.** Reaching the page is safe; this is not. Every caller must be behind the write gate |

### `accountPage.js`

`/my-profile`, My Orders, and Saved Addresses CRUD.

| Method | Notes |
|---|---|
| `gotoProfile()` `navigateToMyOrders()` `clickOrderDetail(i = 0)` | |
| `gotoAddresses()` `addressListText()` `hasAddressMatching(marker)` `addressCount()` | |
| `openAddForm()` `fillAddressForm(data, { mobile })` `submitAddress()` `readFormValues()` | |
| `openEditFor(marker)` | |
| `createAddress(data, { mobile })` `addAddressIfMissing(data, { mobile, marker })` `removeIfPresent(marker)` | Self-cleaning helpers |
| `deleteAddressReportingConfirmation(marker)` | Returns what confirmation (if any) appeared — see [BUG-02](BUG-02-address-delete-no-confirmation.md) |
| `cardFor(marker)` | |

**Locator rationale — placeholder, not role.** Measured on the live form: none of
the address inputs carry a label, `aria-label` or accessible name, so
`getByRole('textbox', { name })` **resolves nothing**. The only stable handles are
the placeholder text and the `name` attribute; placeholder is preferred because
it is what a shopper actually reads.

**Edit and Delete do exist** — corrected 11 Aug 2026. This file previously
recorded "zero matches for /edit/i and /delete|remove/i". The counts were
accurate and the conclusion was wrong: every address card carries two MUI
`IconButton`s with **no text, no aria-label and no title**, so no name-based
locator can ever see them. The locators key off `data-testid` (`EditIcon`,
`DeleteIcon`).

### `emiStorePage.js`

| Method | Notes |
|---|---|
| `goto()` | `/home/emi-store` |
| `categoryTile(category)` / `openCategory(category)` | |
| `openFirstProduct()` | |
| `clickPurchaseControl()` | |
| `whyStuck(what)` | Turns a bare locator timeout into an error that says **"you are logged out"** |

This file used to call `page.pause()` in two places. `page.pause()` only does
anything under `--headed` with the Inspector open; in a normal `npm test` run it
**blocks until the test times out**, and both call sites were reachable in a
normal run. They are gone. `whyStuck()` replaced the first; manual OTP entry
belongs in `auth-setup.spec.js`, not in a regression page object.

### `subHomeTabsPage.js`

Backs TCB-001..054.

| Method | Notes |
|---|---|
| `open(path = '/')` | |
| `stripReady(timeout = 8000)` | Waits for the strip to be **interactive**, not merely visible |
| `tab(name)` `labels()` `activeLabels()` `select(name)` `waitForActive(name, timeout)` | |
| `measure()` | Dimensions, divider, underline colour |
| `settle(timeoutMs = 15000)` | |
| `selectedFromUrl()` `pathOf()` `useViewport(which)` | |
| `diagnose(what)` | |

**Locator rationale — ARIA, and why not the alternatives.**

| Candidate | Verdict |
|---|---|
| `role=tablist` / `role=tab` | **Used.** The site sets both, plus `aria-selected` and `aria-label="Home page categories"`. Verified live 19 Aug 2026. ARIA is the only thing on this strip that is *authored* rather than generated |
| `.mui-*` class names | **Rejected** — build-hashed. The container is `div.MuiBox-root.mui-1kfg1nu` today and something else after the next deploy |
| text / `alt="Mobile"` | **Rejected as an anchor** — CMS values. The tabs were nine lowercase names in the previous design and are eight Title-Case now; a spec anchored on a label fails on a rename that harms nobody. Labels are still *asserted*, against the live nav response |

### `productVideoPage.js`

| Method | Notes |
|---|---|
| `gotoProduct(slug, bpid)` | |
| `hasVideo()` | |
| `openVideo()` `play()` `mediaState()` `waitForPlaybackProgress(timeout = 15000)` | |
| `throttleNetwork(downloadKbps = 400)` | |
| `diagnoseMissingPlayer()` | Reports the thumbnail slot gap, so a failure reads as the product behaviour rather than a stale selector |

**There is no player to select.** Measured across video-enabled products, the
gallery reserves a slot for the video — slots always equal images + 1 — and
renders nothing into it. `manifest.mpd` is present in the serialised payload, so
the client receives the URL and never mounts a player.

> The file's own header still describes VID-42/43/45/46/51 as *failing here, and
> that is correct*. That predates the 20 Aug 2026 confirmation that no player on
> web is **expected**; the specs now skip rather than fail. See
> [video-feature-coverage.md](video-feature-coverage.md).

---

## `tests/utils/` — the guards

### `session.js`

```js
const { assertFreshSession } = require('../utils/session');
test.beforeAll(() => assertFreshSession());
```

`assertFreshSession()` — a **pure file read** of `auth.json`. No network. Fails a
login-gated spec in about a second with the real reason and a pointer to
`npm run auth`, instead of timing out on a button that only renders for a
logged-in user.

**Deliberately inert** when `auth.json` is missing or has zero cookies, because CI
writes an empty session. Keep it that way.

### `writes.js`

| Export | Notes |
|---|---|
| `writesAllowed()` | `process.env.BYTEPE_ALLOW_WRITES === '1'` |
| `writeSkipReason(whatItCreates)` | Skip text that names the **consequence**, not just the flag |
| `ENV_VAR` | `'BYTEPE_ALLOW_WRITES'` |

```js
test.skip(!writesAllowed(), writeSkipReason('Mints a real order'));
```

Why it exists: on 10 Aug 2026 a routine `npm test` left two real orders behind.
Nothing malfunctioned — the subscription specs press Continue on Review Order,
and that is when the order id is minted. They had been running that way for as
long as a stale `auth.json` happened to be failing them fast. **The expired token
was the only thing standing between the default command and a real order.**
Refreshing the session to make the run meaningful removed it — so the gate cannot
be "the session happens to be broken". It has to be explicit.

### `apiRetry.js`

`getWithRetry(request, url, options = {}, retry = {})` — defaults
`{ attempts: 5, baseDelayMs: 2000 }`.

Retries **only** `429, 502, 503, 504`, with backoff and `Retry-After` support. A
404 or a 500 is a real answer and is returned untouched, so a genuine failure
still fails.

### `cartNav.js`

| Export | Notes |
|---|---|
| `openCart(page, attempts = 4)` | Opens `/cart?flow=shopping`, reloading past a known crash. Throws with a message that names the bug if all attempts fail |
| `dismissExchangeDialog(page)` | Clicks "Not now" **if the dialog happens to be visible at that instant**. Superseded — see below |
| `CLIENT_SIDE_CRASH` | The regex |

**Do not reach for `dismissExchangeDialog` in new specs.** It uses `isVisible()`,
which answers from the DOM as it stands and does not wait — the same trap
recorded on `getCouponErrorMessage` — so it clears the dialog only when the
timing happens to suit, which is why the specs calling it dismissed the overlay
on some runs and not others. `utils/exchangeDialog.js` replaces it; the calls
that remain are harmless no-ops.

### `exchangeDialog.js`

| Export | Notes |
|---|---|
| `installExchangeDialogHandler(page)` | Registers a Playwright locator handler that declines the dialog via **Not now**, re-checked before every action |
| `exchangeDialog(page)` | The locator, for a spec that needs to assert on the dialog itself |

Registered on the `page` fixture in `fixtures/pageFixtures.js`, so every spec is
covered rather than the ones that remembered to ask — the dialog is
address-gated and arrives mid-flow, at no point a spec could `await`.

Anchored on **the dialog containing an "Add Exchange" button**, not on the MUI
class (build-hashed), not on the headline copy (marketing text, will be
reworded), and not on a bare `getByRole('dialog')` — the login modal and the
cart's Nitro crash dialog both match that, and neither may be dismissed here.

It logs `exchange dialog dismissed via "Not now"` on every firing, because a
silently swallowed overlay looks identical to a run where none appeared. **Never
click "Add Exchange" from a test** — it attaches a trade-in to a real order.

**Known production bug, accepted.** Loading `/cart` throws
`window?.nitro?.updatecart is not a function` and Next.js replaces the page with
"Application error: a client-side exception has occurred" — measured **7 of 9**
loads with a populated cart, **0 of 6** with an empty one. Raised and accepted as
expected behaviour, so the suite does not fail on it. Full analysis in
`docs/BUG-01-cart-nitro-crash.pdf` (gitignored).

Ignoring it here is a deliberate choice, not an oversight: the callers are about
pricing and checkout, and letting an intermittent third-party race mask their
assertions would make them useless. If the bug's accepted status changes, the
guard belongs in a test of its own.

The exchange dialog matters for the same reason — left alone it intercepts
pointer events, which is how a click times out against a control that is plainly
visible in the screenshot.

### `priceText.js`

The cross-surface price parsers.

| Export | Reads |
|---|---|
| `toRupees(text)` | `"₹1,99,999"` → `199999`. **Returns `null`, not `NaN` or `0`** |
| `flatten(text)` | Collapses `/\s+/g` to single spaces |
| `parsePlpTile(tileText)` | A listing tile |
| `parsePdpHeader(bodyText)` | Headline price / MRP / % off |
| `parsePlanBox(bodyText)` | The "Choose your plan" rows, per plan |
| `parseAddOns(bodyText, names)` | **Every** bundled row below the buyback slider → `{ rows, totalSaving, missing, namesFrom }`. `names` are `vas_name` values from `/api/apps/product-vas/:slug/:bpid` |
| `parseAddOn(bodyText, names)` | The protection row alone, for callers that mean Device Protection specifically |
| `parseOrderSummary(bodyText)` | Cart and Review Order summaries |
| `parsePricingBreakdown(bodyText, { label })` | Component-wise breakdown |
| `expectedTotalOf(breakdown)` | Arithmetic — **use last, not first** |
| `formatBreakdown(breakdown)` | Human-readable dump for a failure message |
| `COMPONENT_PATTERNS` (internal) | The label patterns; expect to name real ones on a first Payment Summary run |

**Why text parsing and not locators.** The plan box container is
`div.MuiBox-root.mui-zv7ju9` — build-hashed, changes every deploy. Its rows carry
no role, no test id, no stable class. Measured on a live PDP the page renders
**17** rupee-shaped text nodes and nothing distinguishes them structurally. What
*is* stable is the copy next to each figure — "Pay in Full", "Cardless EMI",
"₹164 x 24mo" — so every reader anchors on the copy and the amount **together**.
A row that loses either half returns `null` and the caller reports it missing,
rather than silently matching a different figure.

Every reader takes **flattened** text: `page.locator('body').innerText()` with
`/\s+/g` collapsed. `innerText` (not `textContent`) matters — it respects
visibility, so hidden pre-rendered plan panels are excluded.

**The add-on readers are the exception that proves it.** Copy alone is not enough
there, because "a label then two amounts, the second no larger" also describes
the PDP header (price then struck MRP) and every adjacent pair in the buyback
slider, and the block carries no heading, role, test id or stable class to scope
a search to. So `parseAddOns` is told the names and looks each one up:

```js
const vas = await getWithRetry(request, productVasPath(slug, bpid));
const addOns = parseAddOns(body, vasNamesFrom(await vas.json()));
addOns.totalSaving   // the add-on term in "You'll save up to"
addOns.missing       // named by the record, not found on the page — a finding
addOns.namesFrom     // 'api' | 'fallback'
```

Matching a literal name is what broke on 23 Aug 2026: protection was relabelled
`BytePe Secure` → `12 mo Device Protection`, a `Free Wireless Charger ₹5,999 → ₹0`
row appeared beside it, and the old single-row parser returned `null` — read by
its caller as "this product bundles nothing". Assert `missing` empty whenever
`namesFrom === 'api'`, so the next rename fails loudly instead of going quiet.

`toRupees` returning `null` is load-bearing: a parser that returns `0` makes two
broken pages compare equal.

#### Measured formulas — do not re-derive

| Figure on the page | Comes from |
|---|---|
| headline price / MRP / % off | `upfront.price` / `upfront.cut_price` / `upfront.off_on_amount` |
| "Pay in Full" · "Buy Upfront" | `upfront.price` |
| "Credit Card EMI ₹X/mo" · "Monthly Subscription" | `cc.emi_amount` |
| "Cardless EMI ₹X/mo + ₹Y Now" | `nbfc.emi_amount` + `nbfc.downpay` |
| "₹X x N mo" ladder rows | `emi.emi_option[]` — `installment_amount` × `tenure` |
| "Total Discount" · "You'll save up to" | `(MRP − cc.total_amount) + (add-on list − add-on paid)` |
| instalment total | `price − discount + interest`, ±₹1 per instalment |

### `surfaceIdentity.js`

**Identity before arithmetic.** Every regression must assert *which* item a
surface is showing, not only that its numbers add up.

| Export | Notes |
|---|---|
| `identityOf(source)` | Normalises one record into an identity tuple |
| `identitiesFromCart(cartData)` | From `GET /cart` |
| `identitiesFromCreateOrder(body)` | From `POST /customer-order/v2/create-order` — the one **authoritative** record in the flow |
| `compareIdentities(before, after, { beforeLabel, afterLabel })` | |
| `keyOf(identity)` / `formatIdentities(identities, label)` | |

Why: on 14 Aug 2026 a Device Protection charge read ₹1 on Review Order and ₹2,001
on Payment Summary. **Every amount check passed at every hop**, because each page
was internally consistent — the pages were showing *different products*. No
arithmetic assertion can see that.

Two measured facts make it easy to reach:

- The **subscription basket holds exactly one line**, and subscribing to a
  product silently replaces whatever was in it.
- The same product exists under **different bpids** in the two baskets — MacBook
  Air M5 as `APPLALAPO1IYU3` (vas 0) and `APPLALAPO55QSK` (vas 1). Same name on
  screen, different variant, different price, different add-ons.

Anchor points:

| Hop | Compare |
|---|---|
| PDP → cart | the added bpid appears in `GET /cart?payment_type=UPFRONT` |
| cart → Review Order | `compareIdentities()` over both baskets |
| Review Order → order | reviewed bpids vs `create-order` response `orders[].bpid` / `sku` |

### `pricingDiagnosis.js`

| Export | Notes |
|---|---|
| `DIAGNOSTIC_STEPS` | The fixed 7-step order |
| `fieldsMatching(uiValue, candidates)` | Which API fields could be the one on screen |
| `explainDisplayedField({ uiValue, expectedField, candidates, label })` | Names the field, not the symptom |
| `fieldsAreIndistinguishable(candidates, a, b)` | **Reports when a check cannot distinguish** two candidates holding the same number |
| `diagnosticHeader(label)` | |

Two rules that fall out of it:

- **Name the field, not the symptom.** "The page renders `vas_price`" and
  "Device Protection is wrong" are different bugs, fixed by different people.
- **Say when a check cannot distinguish.** If two candidate fields hold the same
  number, an assertion separating them passes by coincidence.

### `domProbe.js`

`describeInputs`, `describeButtons`, `formatInputs`, `formatButtons`,
`countCandidates`, `describeFrames`.

Describes what is on screen, for diagnostics. **Never reports input values** —
these screens carry a phone number and a one-time code, and this output lands in
reports and CI logs.

### `otpHelper.js`

`waitForManualOtp(page, message)` — a deliberate `page.pause()` so a human can
type the code. `isOtpScreenVisible(page)`.

`eslint.config.js` turns off `playwright/no-page-pause` for this file alone.

---

## `tests/data/` — facts, no logic

### `constants.js`

| Export | Contents |
|---|---|
| `BASE_URL` | `https://www.bytepe.com` |
| `BASE_API_URL` | `process.env.BYTEPE_API_BASE \|\| 'https://www.bytepe.com/api'` — same origin; there is no `api.bytepe.com` |
| `URLS` | `subscription`, `emiStore`, `products`, `aboutUs`, `cart`, `review`, `orderSummary` |
| `MESSAGES` | `invalidCoupon: 'Invalid or inactive coupon'` |
| `TEST_ADDRESS` | Obviously synthetic on purpose — it sits on a real account beside real addresses. `areaStreet` is the **match key**; do not reuse it |
| `TIMEOUTS` | `nav` 15s, `otp` 120s (env-overridable), `otpScreen` 10s, `otpAuto` 20s, `login` 20s, `action` 15s |

`URLS.review` is the last page before an order is minted — both the subscription
(Subscribe) and upfront (Buy Now) paths land there.

`TIMEOUTS.otp` is overridable because 120s assumes somebody is already at the
keyboard. Measured 14 Aug 2026: a run launched from a tool call burned both
attempts — 120s each, then a retry that sent a **second real SMS**. `auth-setup`
derives its own test timeout from this value, so raising it here is enough;
raising one without the other just moves the failure.

**New URLs, messages and timeouts go here**, not inline in a spec.

### `config.js`

`baseURL`, `mobileNumber` (a placeholder — **not used for login**, only
`BYTEPE_MOBILE` is), `coupons.valid` = `BYTE500`, `coupons.invalid` = `FAKE000`,
`timeouts.otp`.

### `apiEndpoints.js`

The BytePe HTTP API as the storefront itself calls it. **Provenance:** paths,
methods and bodies were read out of the shipped client bundles
(`/_next/static/chunks/*.js`, grepped for `url:"...",method:"..."`), then every
GET was confirmed with a read-only probe. Anything unconfirmed is marked.

Two facts that surprise people:

1. **There is no separate API host.** Same origin, under `/api`.
2. **Auth is a cookie, not a header.** The string `Bearer` appears nowhere in the
   client. Requests are authenticated by the `access_token` cookie for
   `www.bytepe.com` — which is why the helper attaches `auth.json` as a
   `storageState` rather than setting an `Authorization` header.

| Export | Contents |
|---|---|
| `ENDPOINTS` | Catalogue, auth, account, cart, coupons, addresses. Paths are returned **relative** |
| `FORBIDDEN` | Real routes deliberately **not** exposed and never to be called: payment creation, down payment, loan initiation, Razorpay init, gateway resolution, order cancel, and `DELETE /users` (deletes the account). Listed so "is there an endpoint for X" has an answer without someone finding it the hard way |
| `ENVELOPE` | `unauthorizedMessage`, `productNotFoundMessage` |
| `BASE_API_URL` | Re-exported |

> **The leading-slash trap.** Playwright resolves a request path against
> `baseURL` with the `URL` constructor, so a leading slash is root-relative and
> silently drops `/api`:
>
> ```
> new URL('/cart', 'https://www.bytepe.com/api')  ->  https://www.bytepe.com/cart
> ```
>
> That 404s, and it is not obvious from the failure — **it cost a full run of 15
> false failures.** The table keeps the leading slashes so it stays diffable
> against the client bundle it was read from; `toRelative()` strips them on the
> way out, and `getApiContext()` gives `baseURL` the matching trailing slash.
> **Both halves are required.**

Asserting on the envelope is the point of the API layer: **a 200 carrying
`{status: false}` is precisely the regression a status-code-only test waves
through.**

### `emiApi.js`

`pdpApiPath(slug, bpid)`, `variantPricingPath(slug, variantId)`,
`cardlessEmiFrom(body)` → `data.nbfc`, `creditCardEmiFrom(body)` → `data.cc`,
`cardEmiOptionsFrom(body)` → `data.emi.emi_option[]`.

> `nbfc` is **subscription pricing, not an availability switch**.
> `nbfc.emi_amount === 0` means "not pre-priced" — it does **not** mean cardless
> EMI is unavailable. On upfront products the amount is settled at eligibility
> time and is 0 here regardless.

### `videoFeature.js`

`PUBLIC_API`, `GCS_BUCKET` (`BYTEPE_GCS_BUCKET`, default `bytepestorage-prod`),
`adminConfigured()`, `ADMIN_SKIP_REASON`, `WRITE_SKIP_REASON`,
`pdpApiPath(slug, bpid)`, `expectedManifestUrl(videoServiceId, bucket)`,
`videosFromPdpPayload(body)`.

### `subHomeFeature.js`

`PUBLIC_API`, `sectionsPath(params)`, `TAB_QUERY_PARAM` (`sub_home_page`),
`DESIGN`, `ACTIVE_UNDERLINE_RGB` (`rgb(255, 67, 6)`), `TABLIST_LABEL`
(`Home page categories`), the four skip reasons, `pageWithTabs(navData)`, and
**`productionGuard()`**.

`productionGuard()` makes pointing the admin suite at `www.bytepe.com` an
**error, not a skip**. Those endpoints rewrite the tab strip every shopper sees.
A missing token is an accident; a production host is a decision, and it is the
wrong one.

### Generated fixtures

`products.json`, `cardless-emi.json`, `video-products.json`,
`device-protection.json` — regenerate from `tests/scripts/`. Slugs and bpids
drift on their own, for reasons unrelated to this code.

> **Neither the slug nor the listing bpid is a stable key.** Slugs are derived
> from the product name, so a rename moves the URL. The listing links whichever
> variant is currently featured, so the bpid changes too. Old product URLs return
> **HTTP 200 with a "404 This page could not be found." body** and no redirect —
> expected, do not report it.

---

## `tests/api/apiHelper.js`

Shared plumbing for the HTTP suite. **Excluded from collection by an explicit
`testIgnore` entry** — any further helper added under `tests/api/` needs its own
entry, or belongs in `data/` / `utils/`.

| Export | Notes |
|---|---|
| `getApiContext({ authenticated = false, extraHeaders = {} })` | Builds a `request` context. Authenticated contexts attach `auth.json` as `storageState` — **cookie auth, no Bearer header** |
| `loginAndGetToken({ forceOtpLogin = false })` | **Sends a real SMS.** Behind `BYTEPE_API_OTP_LOGIN=1` |
| `readSavedAccessToken()` / `readSavedUserId()` / `hasSavedSession()` | Read `auth.json` |
| `pick(obj, paths)` | Trim a payload for a failure message |
| `safeJson(res)` | Parse without throwing on a non-JSON body |
| `DEFAULT_HEADERS` | |

An unauthenticated context is a context with **no cookie jar** — which is what
`getApiContext()` gives you by default, and what "accessing an endpoint without a
token" means here.
