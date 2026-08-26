# Test inventory

Every spec file in the repo: what it covers, how big it is, what gates it, and
whether CI runs it.

Counts are what Playwright actually **collects** (`npx playwright test smoke/
regression/ api/ --project=chromium --list`), so parameterised files are shown
expanded. A file's *executed* count is lower wherever the gates below skip.

**312 tests in 40 files** as of 21 Aug 2026. Regenerate with `--list` rather than
trusting this number after a change.

## Legend

| Gate | Meaning |
|---|---|
| **Public** | Runs logged out. Some set `test.use({ storageState: { cookies: [], origins: [] } })` explicitly so a stale `auth.json` cannot change the result. |
| **Login** | Calls `assertFreshSession()` in `test.beforeAll`. Fails in ~1s without a live session. |
| **Write** | Gated on `BYTEPE_ALLOW_WRITES=1` via `tests/utils/writes.js`. **Skips by default.** |
| **Creds** | Gated on an admin API URL + JWT. Skips when unset. |
| **CI** | In the public list in `.github/workflows/playwright.yml`. |

Totals: **2 smoke + 34 regression + 4 API = 40 spec files**, plus 28 diagnostic
scripts, 1 demo and the auth setup spec.

---

## `tests/smoke/` — does the site stand up

| Spec | Tests | Gate | CI | Covers |
|---|---|---|---|---|
| `homepage.spec.js` | 6 | Public | — | Homepage loads; header navigation to Subscription, Products, EMI Store, About Us, Cart |
| `core-pages.spec.js` | 3 | Public | — | PLP renders `/pd/` links; a PDP opens with a purchase control (`Buy Now` **or** `Subscribe` — which one depends on catalogue order, not on health); `/cart` opens |

---

## `tests/regression/` — pricing

| Spec | Tests | Gate | CI | Covers |
|---|---|---|---|---|
| `product-pricing.spec.js` | 1 | Public | ✅ | Discounted price is lower than the struck-through original |
| `best-price-banner.spec.js` | 6 | Public | ✅ | The "Lowest Effective Price" banner. **Naming mismatch:** the API field is `best_price`, the on-screen copy is "Lowest Effective Price" — grepping for "best price" finds nothing. Asserts per-variant, measured across the seven Galaxy Z Fold8 Ultra variants |
| `cardless-emi.spec.js` | 32 | Public | ✅ | Guards the **pre-priced subscription** cardless plan against silent removal: `prodPaymentMode === 'BOTH'` **and** `data.nbfc.emi_amount > 0`. Does **not** test availability or eligibility — those are per-shopper and unassertable |
| `emi-plan-config.spec.js` | 4 | Public | — | The EMI tenure ladder behind "Choose your plan": how many tenures, what kind (NCEMI / LCEMI / EMI), that Pay-in-Full exists, that a pre-priced cardless plan adds up. Covers `data.emi.emi_option[]`, which `cardless-emi` does not |
| `emi-checkout-flow.spec.js` | 8 | Public | — | Instalment arithmetic per tenure. **Not** a UI tenure picker — measured logged out, the storefront renders no "Select EMI Tenure" control, 0 radios, 0 interest figures. See [known failures](operations.md#known-failing-tests) |
| `pincode-based-pricing.spec.js` | 4 | Public | — | Pins the **measured** behaviour: pincode does **not** change price, in the UI or in the payload. Requested as "Gold bucket > Bronze bucket"; that assertion cannot pass and making it pass would mean deleting it |

---

## `tests/regression/` — search and browse

| Spec | Tests | Gate | CI | Covers |
|---|---|---|---|---|
| `product-search.spec.js` | 2 | Public | ✅ | Happy path (known product is suggested and opens its PDP) and the gibberish case |
| `search.spec.js` | 7 | Public | — | Relevance, brand matching, odd input. **There is no search results page** — Enter does not navigate, `GET /search?q=` is 404. Search is an autocomplete dropdown that goes straight to a product |
| `data-driven-products.spec.js` | 5 | Public | ✅ | One test per product from `products.json`; currently `.slice(0, 5)` |
| `static-pages.spec.js` | 12 | Public | ✅ | Each static page loads |
| `site-health.spec.js` | 4 | Public | — | Catalogue-wide crash guard from `products.json`. **A dead PDP returns HTTP 200 with the site shell**, so status alone reports a dead catalogue as healthy — the `<title>` is the discriminator |
| `catalogue-integrity.spec.js` | 5 | Public | — | Identity integrity at API level, starting from the **live listing** rather than a scrape, so slug/bpid drift cannot fail it by construction. Written after a catalogue-wide brand-prefix rename broke `site-health` on three Apple accessories |

---

## `tests/regression/` — sub-home tabs

| Spec | Tests | Gate | CI | Covers |
|---|---|---|---|---|
| `subhome-tabs-ui.spec.js` | 31 | Public | — | TCB-001..054, the storefront tab strip. The sheet's fixtures ("Laptop", "5G Phones") are a developer machine's data — production carries 8 Home tabs and **zero** on Subscription and EMI Store, so label cases assert against the live nav response |
| `subhome-tabs-api.spec.js` | 17 | Public | — | E2E-NAV-01..06, E2E-SEC-01..11. Asserts the **contract** — fields, ordering, that filtering filters — never a tab name |
| `subhome-admin-api.spec.js` | 26 | Creds + Write | — | E2E-SHP-CREATE/LIST/GET/UPDATE/DELETE/AUTH. Three gates, including `productionGuard()`, which makes pointing this at production an **error, not a skip** |

These replaced `category-browsing`, which asserted the
`/all-products?category=<name>` navigation the tabs took over.

---

## `tests/regression/` — cart through to order

| Spec | Tests | Gate | CI | Covers |
|---|---|---|---|---|
| `cart.spec.js` | 1 | Login | — | Add the first product to cart and reach `/cart` |
| `coupon-valid.spec.js` | 1 | Login | — | `BYTE500` is accepted (no error shown) |
| `coupon-invalid.spec.js` | 1 | Public | — | `FAKE000` shows "Invalid or inactive coupon" |
| `pincode-valid.spec.js` | 1 | Public | — | A serviceable pincode shows no "not available" error. Runs logged out because a **stale** `auth.json` renders no pincode widget at all — the result was depending on session freshness |
| `pincode-invalid.spec.js` | 1 | Public | — | An unserviceable pincode shows the delivery error |
| `checkout-flow.spec.js` | 2 | Login (one case logged out) | — | Product → Add to Cart → Cart → Continue → Review Order. **Stops at Review Order** — creates no order, but adds one item to the real cart per run |
| `emi-store-flow.spec.js` | 1 | Login | — | EMI Store → category → product → Review Order. Also stops before Continue. Asserts plan **configuration** only, never cardless eligibility |

---

## `tests/regression/` — order-minting (write-gated)

**These create real orders.** The id is minted by Continue on Review Order,
before any payment step.

| Spec | Tests | Gate | CI | Covers |
|---|---|---|---|---|
| `subscription-e2e.spec.js` | 1 | **Write** + Login | — | Homepage → Subscription → product → Subscribe → Review Order → Continue → Order Summary. Each stage is a `test.step` that attaches a screenshot, pass or fail. Timeout 180s |
| `subscription-full-flow.spec.js` | 1 | **Write** + Login | — | Subscribe to a named product through to Review Order |

---

## `tests/regression/` — account

| Spec | Tests | Gate | CI | Covers |
|---|---|---|---|---|
| `account.spec.js` | 2 | Login | — | `/my-profile` loads; My Orders opens from it |
| `address-management.spec.js` | 22 | Login + **Write** (+ logged-out block) | — | TC-ADDR-001..013. One of the largest files in the repo at 678 lines. Edit and Delete **do** exist, as unlabelled MUI icon buttons no name-based locator can see — locators key off `data-testid`. Throwaway cases create and remove their own state. Source: [`test-cases/address-management.md`](../test-cases/address-management.md) |
| `order-history.spec.js` | 4 | Login | — | My Orders list and an order detail page. **The list carries no order id and no date**, and cards are `<button>`s, not links — `a[href*="order"]` matches 0 |

---

## `tests/regression/` — cross-surface consistency

The newest group, and the one the rest of the suite structurally could not do.
Every pricing check written before 14 Aug 2026 was self-consistent within **one**
layer, so a product priced differently on the listing and the PDP passed the
whole suite.

| Spec | Tests | Gate | CI | Covers |
|---|---|---|---|---|
| `pricing-consistency.spec.js` | 7 | Public | — | pricing API → PLP tile → PDP header → PDP plan box, per plan. Sweeps the **live** listing (~209 products), not `products.json` |
| `pricing-checkout-consistency.spec.js` | 3 | **Write** + Login | — | The second half: PDP → cart line → cart summary → Review Order → Payment Summary. Adds one real item per run |
| `device-protection-consistency.spec.js` | 5 | **Write** + Login, `retries: 0` | — | Cart → Review Order → Payment Summary, compared **component by component** — product amount, discount, device protection, shipping, other, total — so a mismatch names the charge that moved |
| `device-protection-multi-product.spec.js` | 3 | Login | — | The cart's single Device Protection line must equal the sum of per-product protection prices. Measured first: it is **subscription-only**, priced per product, and the pricing API does not carry it — the rendered PDP is the only source |

`retries: 0` on the Payment Summary test is load-bearing: the config retries once
locally and twice in CI, and **a retry there mints another real order**. Refresh
and back/forward checks are folded into the same test for the same reason.

### Device Protection ₹1 vs ₹2,001 — confirmed expected

Review Order renders `vas_price` (per unit); Payment Summary charges
`vas_amount` (the total). Both sit in the same VAS record. Product confirmed this
is intended on 20 Aug 2026. **Do not re-report it.** The spec no longer asserts
which field Review Order renders — it asserts the rendered figure is *one of the
two the response carries*, and reports plainly when `vas_price == vas_amount`,
since the check then proves nothing.

---

## `tests/regression/` — video

Full traceability: [video-feature-coverage.md](video-feature-coverage.md).

| Spec | Tests | Gate | CI | Covers |
|---|---|---|---|---|
| `video-pdp-api.spec.js` | 4 | Public | — | VID-24/25/26 plus a contract guard that `product.videos` exists. VID-25 is **partial** — proving exclusion needs admin access |
| `video-admin-api.spec.js` | 22 | Creds + Write | — | VID-01..23, the admin registry and product mapping. Routes come from the sheet and have **not** been executed live; expect envelope field names to need adjusting on first run |
| `video-pdp-rendering.spec.js` | 7 | Public | — | One contract test asserting the current expected state (API serves a video, PDP mounts **no** player), non-vacuously. VID-42/43/44/45/46/51 skip with that reason |

The web PDP mounting no player is **confirmed expected** as of 20 Aug 2026, not a
blocker. Slots always equal images + 1 — the gallery accounts for the video and
renders nothing into it.

---

## `tests/api/` — HTTP only

No browser, no page objects. Built on `request.newContext()` via
`tests/api/apiHelper.js`, which is excluded from collection by an explicit
`testIgnore` entry.

| Spec | Tests | Gate | CI | Covers |
|---|---|---|---|---|
| `products-api.spec.js` | 9 | Public | ✅ | Catalogue API, structured on presence / correctness / chained behaviour / negative |
| `pricing-api.spec.js` | 21 | Public | ✅ | Whether `best_price` follows from the inputs the service itself publishes — each branch carries `competitors[]`, the coupon it chose, and its own selection rule as a string |
| `auth-api.spec.js` | 9 | Public + Login + opt-in OTP | — | Protected routes reject anonymous callers; the saved session is a working credential. **`POST /auth/login` sends a real SMS** — the full round trip is behind `BYTEPE_API_OTP_LOGIN=1` |
| `cart-api.spec.js` | 11 | Login + **Write** | — | Anonymous 401s, authenticated reads, gated writes. **There is no add-to-cart endpoint** — the client ships five cart routes and none is named add, so the write cases operate on whatever is already in the cart and skip when it is empty |

`auth-api` and `cart-api` are deliberately kept out of CI: their anonymous cases
would pass, but most of each file would report as skips, which reads as coverage
that is not there.

### `best_price` is intentionally disabled

The offer behind it ended. It is absent from `variant-pricing` on every sampled
product, which turns 20 of the 21 tests in `pricing-api.spec.js` into skips with
a reason. **That is the correct outcome.** A coverage guard asserting the field
was present was added once and deliberately removed; the spec carries a "do not
re-add a guard here" note at that spot.

---

## `tests/scripts/` — diagnostics and discovery

Not collected by a bare run. Run by name, or set `BYTEPE_INCLUDE_SCRIPTS=1`.
They log rather than assert, which is why eslint relaxes several rules here.

### Discovery — regenerate the JSON fixtures

| Script | Writes |
|---|---|
| `discover-products.spec.js` | `tests/data/products.json` (`npm run discover`) |
| `discover-cardless-emi.spec.js` | `tests/data/cardless-emi.json` |
| `discover-device-protection.spec.js` | `tests/data/device-protection.json` — payment mode and protection add-on figures across a catalogue spread. Reads the row through `parseAddOn`'s fallback names, so it sees protection under either label but not a freebie |
| `discover-video-products.spec.js` | `tests/data/video-products.json` — 35 of 186 products had a video as of 11 Aug 2026 |
| `crawl-site.spec.js` | a link crawl |

**Re-run `discover-products.spec.js` before any catalogue-wide work.** Slugs and
bpids drift for reasons unrelated to this code.

### Reporting

| Script | Produces |
|---|---|
| `page-health-report.spec.js` | `page-health.json` — renders every page and records status, whether the route resolved or fell through to the 404 shell, and load behaviour (`npm run page-health`) |
| `extract-video-frames.spec.js` | Stills from a local MP4. Playwright's bundled ffmpeg is a WebM-only build and cannot demux H.264, so Chrome does the decoding — and the player must be served from the video's own directory |

### Probes — measure before asserting

Each was written to answer one question that a spec could not be written without.

| Probe | Question |
|---|---|
| `probe-loaders.spec.js` | Spinners left after the network settles, broken images, console errors, failed requests |
| `probe-loader-scroll.spec.js` | Separates a stuck skeleton from a below-the-fold lazy one waiting on an IntersectionObserver |
| `probe-rate-limit.spec.js` | How hard the storefront throttles **one** ordinary visitor — 429s were seen from a single browser doing a single page load |
| `probe-login-screens.spec.js` | What the login dialog actually renders, so the OTP locator came from evidence |
| `probe-search-dropdown.spec.js` | The autocomplete dropdown's real DOM |
| `probe-plan-box.spec.js` | Whether a product genuinely lacks Buy Upfront or the copy moved |
| `probe-header-links.spec.js` | What the header offers, logged out and logged in |
| `probe-products-link.spec.js` | Why `.last()` on a substring-matched "Products" link resolved to the wrong anchor |
| `probe-home-nav.spec.js` | Whether three failures were our own two-worker load or a live defect |
| `probe-critical-detail.spec.js` | Ticket-ready detail behind the crossed SKU, duplicated product name, and player-less video |
| `probe-sub-home.spec.js` | Zero `/pd/` anchors is not zero products — how the homepage renders tiles |
| `probe-subhome-nav.spec.js` | What production serves, before writing a line of TCB spec |
| `probe-subhome-sections.spec.js` | Shape of the sections endpoint under the sheet's query params |
| `probe-subhome-tabs-ui.spec.js` | Live tab-strip measurements, so specs assert numbers rather than the sheet's fixtures |
| `probe-subhome-a11y.spec.js` | Keyboard reachability (TCB-046/047) and behaviour when nav fails (TCB-052) |
| `probe-tab-keyboard.spec.js` | Why TCB-046/047 failed roughly one run in three — tablist re-render after load |
| `probe-tab-underline.spec.js` | Why the active underline reads `rgba(0,0,0,0)` |
| `probe-tab-underline-slide.spec.js` | Whether the brand-coloured 104×3 sibling box really is the indicator (does it move?) |
| `probe-tab-underline-timing.spec.js` | When the indicator actually appears, versus when `open()` stops waiting |
| `probe-api-contract.spec.js` | **Resolved, confirmed expected** — kept as a record |
| `probe-variant-pricing-404.spec.js` | **Resolved, confirmed expected** — `variant-pricing` validates the slug, not the variant, and answers 200 for an impossible variant id. Do not file a defect from this file |

---

## Other spec files

| File | Purpose |
|---|---|
| `tests/auth-setup.spec.js` | Headed one-time login that writes `auth.json`. Run via `npm run auth`. Needs `BYTEPE_MOBILE` and a human to type the OTP |
| `tests/demos/full-demo-flow.spec.js` | A scripted walkthrough for demonstrating the suite to someone |
