# Authoring guide

How to add or repair a spec here without producing the failures this suite has
already produced.

Prerequisites: [architecture.md](architecture.md) for the layering,
[api-reference.md](api-reference.md) for what you can import, and **`CLAUDE.md`
before anything touching pricing or payment**.

---

## Before you write anything

### 1. Decide where it goes

| Directory | For | Runs by default |
|---|---|---|
| `tests/smoke/` | Fast public-page checks — does this stand up at all | ✅ |
| `tests/regression/` | Flows, contracts, cross-surface comparisons | ✅ |
| `tests/api/` | HTTP only — a `request` context, no browser, no page objects | `npm run api` |
| `tests/scripts/` | Probes and discovery that log rather than assert | ❌ — by name only |

### 2. Decide whether it is login-gated

Login-gated: cart, coupons, checkout, EMI store, account, addresses, order
history, subscription.

Not login-gated: search, pricing, static pages, catalogue, sub-home tabs, the
public video API.

**If a check is about product *configuration*, run it logged out** even when a
session is available. A logged-in run folds one account's state into what is
meant to be a configuration check — and `pincode-valid.spec.js` was failing for
exactly that reason, because a stale `auth.json` renders no pincode widget at
all.

### 3. Measure before you assert

This is the rule the repo is built on. Almost every wrong assertion in this
suite's history came from writing a locator against what the feature *should*
look like.

Write a probe in `tests/scripts/` first, run it by name, and read what the page
actually renders. There are 28 of them and each exists because a spec could not
be written without the answer. Examples of what measuring found:

- The header renders **four** search inputs, two hidden.
- The homepage renders its `<header>` **twice**, both visible, stacked.
- The PDP renders **14** nodes matching `/^₹[\d,]+$/`.
- Address form inputs have **no accessible name at all**.
- There is **no search results page** — `GET /search?q=` is 404.
- There is **no add-to-cart endpoint**.

### 4. Read a neighbour

`regression/product-search.spec.js` for a public flow,
`regression/cart.spec.js` for a gated one. Match it.

---

## The shape

```js
const { test, expect } = require('../fixtures/pageFixtures');
const { URLS } = require('../data/constants');
const { assertFreshSession } = require('../utils/session');   // login-gated only
const { writesAllowed, writeSkipReason } = require('../utils/writes'); // if it writes

// Login-gated only — fails fast instead of timing out on a logged-out page.
test.beforeAll(() => assertFreshSession());

test.describe('<feature>', () => {
  test('<what must be true>', async ({ page, productsListPage }) => {
    test.setTimeout(60000);
    ...
  });
});
```

### Public specs: pin the logged-out context

```js
test.use({ storageState: { cookies: [], origins: [] } });
```

Do this whenever the answer must not depend on whether someone ran `npm run auth`
recently. `storageState` cannot be overridden per test — put the block in its own
`test.describe` if only part of the file needs it (see
`address-management.spec.js`).

### Write-gated specs

```js
test.skip(!writesAllowed(), writeSkipReason('Mints a real order'));
```

Gate anything that mints an order, moves money, or leaves a record a human has to
clean up. Ordinary cart writes are noisy but reversible and are **not** gated.

If the spec reaches Payment Summary, also add:

```js
test.describe.configure({ retries: 0 });
```

The config retries once locally and twice in CI, and **a retry there mints
another real order**. For the same reason, fold refresh and back/forward checks
into the *same* test rather than writing separate ones.

---

## The rules

### Imports and navigation

1. **Import `test`/`expect` from `../fixtures/pageFixtures`**, never
   `@playwright/test` — that is where the page-object fixtures come from.
2. Take page objects as destructured test arguments
   (`{ page, productsListPage }`). Construct one directly (`new CartPage(page)`)
   only if it is not registered in `pageFixtures.js` — `cartPage`, `accountPage`
   and `productVideoPage` are not.
3. **There is no `baseURL`.** `page.goto('/cart')` will not work. Use a page
   object's `goto()` or an absolute URL.
4. Pull paths, messages and timeouts from `tests/data/constants.js`. **Add to
   that file** rather than inlining a new literal.
5. Set an explicit `test.setTimeout(...)` when the flow is slow. The config
   floor is 60s.

### Where a helper may live

`pages/`, `data/`, `fixtures/` or `utils/` — nowhere else under `tests/`.
`testMatch` is `**/*.js`, so a helper anywhere else is collected as a spec, and a
spec importing it fails with:

```
test file X should not import test file Y
```

`tests/api/apiHelper.js` has its own `testIgnore` entry. A second helper there
needs one too, or it belongs in `data/` / `utils/`.

### Locators

- Prefer **role** and **text** (`getByRole`, `getByText`) over CSS or nth-child
  chains.
- **Never anchor on a `.mui-*` class** — they are build-hashed and change every
  deploy. This is documented for the plan box and the tab strip and applies
  everywhere.
- Filter to `{ visible: true }` when the page renders desktop and mobile copies
  of a control. Typing into a hidden input does nothing and the click times out
  on an element that looks fine in the screenshot.
- When a name-based locator resolves nothing, check for an unlabelled MUI icon
  button and key off `data-testid`.
- **When you change a locator, say why that one over the alternatives** — in a
  comment, at the locator. Every non-obvious locator in `tests/pages/` carries
  the measurement that chose it and the alternatives that measured worse. That
  comment is what stops the next person "simplifying" it back.
- **Never locate the buy CTA by name.** `getByRole('button', { name: 'Add to
  Cart' }).first()` reaches the recommended-products carousel and once added a
  ₹1,24,999 phone to the live cart. Anchor on `Buy Now` and take the button
  before it.

### Assertions

- **Non-vacuous absence.** Before asserting something is gone or empty, first
  assert the container rendered — otherwise the test passes against a page that
  simply had not loaded. `regression/product-search.spec.js` is the pattern.
- **Identity before arithmetic.** Assert *which* item a surface is showing, not
  only that its numbers add up. Use `tests/utils/surfaceIdentity.js`. A `/pd/`
  URL names one **variant**, not a product, so "a line appeared and the total
  moved by the right amount" is never proof the right thing was added — only the
  bpid is.
- **Confirm a cart add by its request, not its button.** `POST /api/cart` carries
  the site's own verdict. A label can flip for unrelated reasons, and an early
  click is silently inert because the button renders before its handler is bound.
- **Never assert per-shopper state.** Cardless EMI eligibility has four
  legitimate states and can differ between two loads of the same page for the
  same user. So can order history contents. Assert configuration, not verdicts.
- **Hold the PDP price to the cart Total, never to the Price line.** "Price
  (N Items)" is a sum of **MRPs**, not selling prices: adding a ₹1,575 item with
  a ₹3,499 MRP moves Price by 3,499, Discount by 1,924 and Total by 1,575.

### Cart facts that cost a run each

- **Re-adding a product already in the cart is a no-op.** `POST /api/cart`
  returns 200 with "Your Item has been successfully added in Cart" and nothing
  moves — not even the quantity. A spec that adds "the cheapest product" every
  run silently stops testing anything on its second run. Pick a product the cart
  does not already hold.
- **The PDP shows "Add to Cart" whether or not the item is in the cart.** It
  flips to "Go to Cart" only transiently, in the same session, right after a
  click. It is not a reliable "is this in my basket" signal.
- **The subscription basket holds exactly one line** and subscribing silently
  replaces whatever was in it.
- Use `utils/cartNav.js` — `openCart()` reloads past the known nitro crash.
- **You do not need to dismiss the BytePe Exchange dialog.** It opens by itself
  on cart and Review Order and intercepts pointer events, but the `page` fixture
  registers a locator handler that declines it via "Not now" before every
  action. `cartNav.dismissExchangeDialog()` predates that and only fires if the
  dialog happens to be visible at that instant — do not add new calls to it.
- **The add-on block holds more than one row.** Read it with
  `parseAddOns(body, names)` and get `names` from
  `/api/apps/product-vas/:slug/:bpid`. Never match a literal like `BytePe
  Secure`: that label changed on 23 Aug 2026 and the old parser went silently
  null.

### Skips

A skip with a named reason is often the **correct** outcome — it is how the
video, sub-home, exchange and API suites stay safe without credentials.

**Do not "fix" a skip by weakening the assertion.** Write the reason for whoever
finds it in a report months from now: name the consequence, not just the flag.

---

## After you write

### 1. Collect it without touching the site

```bash
npx playwright test regression/<your>.spec.js --project=chromium --list
```

Paths are relative to `testDir: ./tests` — `regression/x.spec.js`, **not**
`tests/regression/x.spec.js`.

### 2. Lint

```bash
npm run lint
```

`eslint-plugin-playwright` catches what still passes silently: a missing `await`
on an `expect`, a conditional wrapped around an assertion, a stray `.only` that
skips the rest of the file. **This is the fast feedback loop** — it never touches
the live site. There is no formatter.

Per-folder relaxations already in `eslint.config.js`:

| Files | Relaxed |
|---|---|
| `tests/scripts/**` | `expect-expect`, `no-conditional-in-test`, `no-wait-for-timeout` — they branch and log by design |
| `tests/regression/video-*` | `no-skipped-test` |
| `tests/regression/exchange-*` | `no-skipped-test` |
| `tests/api/**` | `no-skipped-test` |
| `tests/utils/otpHelper.js` | `no-page-pause` |
| `playwright.config.js`, `eslint.config.js` | parsed as ESM |

If your new file needs a relaxation, add the narrowest possible block — and a
comment saying why the rule is wrong *there*, not that it was inconvenient.

### 3. Ask before running it

**Do not run the spec without asking.** It executes against live production.

### 4. CI

If the spec is public **and passes logged out**, offer to add it to the list in
`.github/workflows/playwright.yml`. Never add a login-gated spec — CI writes an
empty session and it will break the pipeline.

A spec qualifies only if it passes logged out. Setting
`test.use({ storageState: { cookies: [], origins: [] } })` is necessary but not
sufficient: anything asserting per-shopper state does not qualify, whatever its
storageState. `api/auth-api` and `api/cart-api` are excluded for this reason —
their anonymous cases would pass, but most of each file would report as skips,
which reads as coverage that is not there.

---

## Tooling in `.claude/`

### Hook — `check-spec-syntax.js`

A `PostToolUse` hook on `Write|Edit`, wired in `.claude/settings.local.json`. If
the edited file is under `tests/` and ends in `.js`, it runs `node --check` on
it. **Parse-only** — no browser, no network, nothing touches the live site.

Scoped to `tests/` on purpose: those files are CommonJS, while
`playwright.config.js` uses ESM syntax `node --check` would reject.

### Skills

| Skill | Does |
|---|---|
| `new-spec` | Scaffolds a spec following these conventions |
| `refresh-session` | Runs the headed auth spec and waits for a manually typed OTP. `disable-model-invocation: true` — it logs into a real account, so it only runs when asked |

### Agents

| Agent | For |
|---|---|
| `spec-writer` | Writing and repairing UI specs. Knows the fixture imports, page objects, session guard, and the failure modes this suite actually hits |
| `api-tester` | HTTP-level tests via `request.newContext()`. Knows the endpoint table, the response envelope, and that **auth here is a cookie, not a Bearer header** |

Both are told to read `CLAUDE.md` first.

---

## Investigating a pricing discrepancy

Work in this order. Do not skip ahead, and **do not start at the bottom**.

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

Steps 1–5 are cheap, need no order to be minted, and **any one of them can fully
explain a difference that looks like broken maths**. Step 7 is the expensive one
and the one most likely to produce a confident, wrong bug report.

| Step | Use |
|---|---|
| 1–2 | `utils/surfaceIdentity.js` — `identitiesFromCart`, `identitiesFromCreateOrder`, `compareIdentities` |
| 3 | the API directly; `GET /api/cart?payment_type=UPFRONT\|SUBSCRIPTION` |
| 4–5 | `utils/pricingDiagnosis.js` — `explainDisplayedField`, `fieldsAreIndistinguishable` |
| 6 | `utils/priceText.js` — `parsePricingBreakdown` per surface, then compare components |
| 7 | `expectedTotalOf` — last, not first |

This ordering was paid for. The Device Protection ₹1 → ₹2,001 discrepancy was
chased as arithmetic for a long time; the answer was **step 4**. Both figures
were in the same record — `vas_price: 1` and `vas_amount: 2001`. Every page's own
sums were correct throughout, so no amount comparison could ever have found it.

---

## Checklist before you open a PR

- [ ] Imports `test`/`expect` from `../fixtures/pageFixtures`
- [ ] No `page.goto('/relative')`
- [ ] New URLs / messages / timeouts added to `constants.js`, not inlined
- [ ] Any new helper lives in `pages/`, `data/`, `fixtures/` or `utils/`
- [ ] `assertFreshSession()` in `test.beforeAll` if login-gated
- [ ] Write gate applied if it mints an order or leaves a record
- [ ] `retries: 0` if it reaches Payment Summary
- [ ] Every non-obvious locator carries the reason it beat the alternatives
- [ ] Absence assertions are non-vacuous
- [ ] Identity asserted, not just arithmetic
- [ ] `npx playwright test <path> --list` collects it
- [ ] `npm run lint` clean
- [ ] CI list updated **only** if it passes logged out
- [ ] `docs/test-inventory.md` updated
