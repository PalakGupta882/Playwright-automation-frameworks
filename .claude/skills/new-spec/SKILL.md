---
name: new-spec
description: Scaffold a new Playwright spec that follows this repo's conventions — fixture imports, page objects, shared constants, and session guards. Use when adding a test file under tests/smoke or tests/regression.
---

Create a new spec for: $ARGUMENTS

## Before writing

Ask, or infer from the request, two things:

1. **Smoke or regression?** `tests/smoke/` is for fast public-page checks; `tests/regression/` is for flows.
2. **Is the flow login-gated?** Cart, coupons, EMI, account, and subscription are. Search, pricing, static pages, and category browsing are not.

Read an existing neighbour first — `tests/regression/product-search.spec.js` for a public flow, `tests/regression/cart.spec.js` for a gated one — and match it.

## Shape

```js
const { test, expect } = require('../fixtures/pageFixtures');
const { URLS } = require('../data/constants');
const { assertFreshSession } = require('../utils/session');  // login-gated only

// login-gated only — fails fast instead of timing out on a logged-out page
test.beforeAll(() => assertFreshSession());

test.describe('<feature>', () => {
  test('<what must be true>', async ({ page, productsListPage }) => {
    test.setTimeout(60000);
    ...
  });
});
```

## Rules

- Import `test`/`expect` from `../fixtures/pageFixtures`, never `@playwright/test` — that's where the page-object fixtures come from.
- Take page objects as destructured test arguments (`{ page, productsListPage }`). Only construct one directly (`new CartPage(page)`) if it isn't registered in `pageFixtures.js`.
- No `baseURL` is configured. Navigate via the page object's `goto()`, or an absolute URL.
- Pull paths and messages from `tests/data/constants.js`. Add to that file rather than inlining a new literal.
- Set an explicit `test.setTimeout(...)`; these flows are slower than Playwright's default.
- Prefer role- and text-based locators (`getByRole`, `getByText`) over CSS or nth-child chains.
- Make absence assertions non-vacuous: before asserting something is gone or empty, first assert the container rendered. Otherwise the test passes against a page that simply hadn't loaded.
- Put any new helper in `tests/utils/` or `tests/pages/` — `testMatch` collects `**/*.js` under `tests/` and only ignores `pages/` and `wip/`, so a stray helper elsewhere gets loaded as a spec.

## After writing

Syntax-check it without hitting the site: `npx playwright test <path> --list`.

Do **not** run the spec without asking — it executes against live production.

If the spec is public (no login needed) and belongs in CI, offer to add it to the spec list in `.github/workflows/playwright.yml`. Never add a login-gated spec there; CI runs with an empty session.
