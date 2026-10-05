# Architecture

How the framework is put together, and why each piece is the way it is. Every
decision recorded below was made after a run failed for the reason described —
none of it is preference.

Companion documents: [api-reference.md](api-reference.md) for the function-level
detail, [test-inventory.md](test-inventory.md) for what the specs cover.

---

## The execution chain

Learn this first. Everything else hangs off it.

```
npm test
  └─ playwright.config.js          what to collect, timeouts, storageState, chromium
     └─ tests/<suite>/*.spec.js    the test — assertions and flow only
        ├─ tests/fixtures/pageFixtures.js   injects page objects as test arguments
        │  └─ tests/pages/*.js              locators + actions
        │     └─ tests/data/*.js|json       URLs, constants, generated fixtures
        └─ tests/utils/*.js                 session guard, write gate, retry, parsers
```

**A spec never touches a raw URL or a raw selector.** It asks a page object,
which reads from data, and is guarded by utils. When a selector breaks it is
fixed once, in `tests/pages/`, not across every spec that used it.

### What belongs in each layer

| Layer | Holds | Never holds |
|---|---|---|
| `tests/<suite>/*.spec.js` | `test.describe`, `test`, `expect`, flow, gates | CSS selectors, hostnames, magic numbers |
| `tests/fixtures/` | the `test`/`expect` re-export that supplies page objects | assertions |
| `tests/pages/` | locators, actions, diagnostics (`whyStuck`, `diagnose`) | `expect` calls |
| `tests/data/` | URLs, messages, timeouts, endpoint map, generated JSON | logic that reaches the network |
| `tests/utils/` | guards, retries, parsers, comparators | anything spec-specific |

---

## `playwright.config.js` — the decisions

The only ESM file in the repo. Every setting below carries a reason.

### `testDir: './tests'` + `testMatch: '**/*.js'`

**Everything under `tests/` is a spec** unless `testIgnore` excludes it. The
exclusions are `pages/`, `data/`, `fixtures/`, `utils/`, `wip/`, plus one
explicit entry for `api/apiHelper.js`.

Consequence: a helper placed anywhere else under `tests/` is collected as a test
file, and any spec importing it fails with

```
test file X should not import test file Y
```

`tests/api/` is not ignored wholesale because it holds real specs. Its one shared
helper needed its own line. **Any further helper added under `tests/api/` needs
its own `testIgnore` entry — or it belongs in `data/` or `utils/` instead.**

### `storageState` is resolved, not hard-coded

```js
const AUTH_FILE = path.join(HERE, 'auth.json');
const storageState = existsSync(AUTH_FILE) ? AUTH_FILE : undefined;
```

`auth.json` is gitignored, so it does not exist after `git clone`. Pointing
`storageState` at a missing file makes Playwright fail **every** test before it
starts — including the public specs that need no session — with

```
Error reading storage state from auth.json: ENOENT
```

A new engineer's first `npm test` then fails 100% and looks like a broken
framework. So: use the file when it is there, start logged out when it is not.
Login-gated specs still refuse to run, via `assertFreshSession()`, which fails
fast with the real reason and a pointer to `npm run auth`.

CI is unaffected — it writes an empty `auth.json` before the run, so this
resolves to that file exactly as before.

### `tests/scripts/` is excluded from a bare run

`tests/scripts/` holds 28 probes, discovery runs and the page-health sweep. They
are real Playwright files, so `testMatch` collected them: a bare
`npx playwright test` was picking up **352 tests in 66 files** and pointing all
of them at production, including a 15-minute full-catalogue sweep.

The ignore lifts when you ask for them:

- the command names a path containing `scripts/` — so
  `npx playwright test scripts/probe-x.spec.js`, `npm run discover` and
  `npm run page-health` all work unchanged; or
- `BYTEPE_INCLUDE_SCRIPTS=1` is set.

### `workers: 2` locally, `1` in CI

Capped on purpose. These specs hit live production and an uncapped local run
(6 workers on the development machine) rate-limits the origin: a full regression
pass returned 429s and timed out UI flows that pass fine alone.

Lowered 3 → 2 after measuring. At 3 workers every full run lost 2–5 tests to
timeouts and 429s — never the same ones, which is contention rather than
defects. The same specs passed 103/103 with retries off in a smaller set.
**Retries were absorbing the difference, which meant a real regression would have
looked like the usual noise.**

### Timeouts

| Setting | Value | Why |
|---|---|---|
| `timeout` | 60 000 | Matches what nearly every spec already set for itself. Existing `test.setTimeout()` calls become no-ops at the same value; outliers like `subscription-e2e` (180s) keep their override. |
| `expect.timeout` | 10 000 | Up from Playwright's 5s default. The specs that flaked under load were the ones with bare `expect`s — `product-search`, `product-pricing`, `account`. Most others already pass an explicit 15s, so this only lifts the floor. |
| `actionTimeout` | 30 000 | **The important one.** Unset, it defaults to `0` — an action waits forever. A click on an overlay-covered control consumed the entire test budget, and any retry loop around it never reached its second attempt. 30s sits above every explicit timeout in the repo (10–20s), so nothing that passes today changes; what changes is that a hang becomes a legible failure. |
| `navigationTimeout` | 30 000 | Same reasoning. |

### There is no `baseURL`

Deliberate, and the single most common trap. `page.goto('/cart')` **will not
work**. Navigate through a page object's `goto()` (`BasePage` prefixes the host
from `constants.BASE_URL`) or use an absolute URL.

The `tests/api/` suite sets its own `baseURL` on its request context — see the
leading-slash trap in [api-reference.md](api-reference.md#apiendpointsjs).

### Artifacts

```js
retries: process.env.CI ? 2 : 1,
trace: 'on-first-retry',
screenshot: 'only-on-failure',
video: 'retain-on-failure',
reporter: 'html',
```

Retries mean **a "passing" run may still have been flaky** — check the report.

### One project

```js
{ name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chrome' } }
```

Real Chrome, desktop viewport. No webkit, no mobile projects — which is why
VID-49 (mobile Safari / Android Chrome) is listed as not automatable.

---

## CommonJS, with one ESM exception

`package.json` sets `"type": "commonjs"`. Specs, page objects, data and utils all
use `require` / `module.exports`.

`playwright.config.js` is written as ESM and loaded through Playwright's own
transpiler, which executes it as CJS. That has one sharp edge:

```js
// __dirname, not import.meta.url.
// import.meta throws "Cannot use 'import.meta' outside a module" here.
const HERE = __dirname;
```

Resolving from the config's own directory rather than `cwd` keeps `auth.json`
correct when the suite is run from a subdirectory.

`eslint.config.js` is the other file the lint config treats as ESM.

---

## Directory layout

```
tests/
  smoke/        2 specs    — does the site stand up at all
  regression/   34 specs   — the real suite
  api/          4 specs    — HTTP only, no browser, no page objects
  scripts/      28 files   — probes, discovery, page-health. NOT run by default
  demos/        1 file     — scripted walkthrough for demonstrating the suite
  pages/        11 page objects
  fixtures/     pageFixtures.js
  data/         constants, config, endpoint map, generated JSON fixtures
  utils/        session guard, write gate, retry, price parsers, identity
  auth-setup.spec.js       headed one-time login → auth.json
docs/           this documentation, coverage maps, bug records
scripts/        node utilities (not Playwright specs)
test-cases/     manual test-case sources
.claude/        agents, skills, and a PostToolUse syntax-check hook
```

---

## Safety design

Three independent mechanisms, none of which replaces the others.

### 1. The write gate — `tests/utils/writes.js`

`BYTEPE_ALLOW_WRITES=1`. Guards anything that mints an order, moves money, or
leaves a record a human has to clean up. It exists because a routine `npm test`
once left two real orders on the production account.

The order id is minted by pressing **Continue on Review Order**, *before* any
payment step. **Reaching Review Order is safe; that last click is not.**

Ordinary cart writes are noisy but reversible and are **not** gated.

### 2. The session guard — `tests/utils/session.js`

`assertFreshSession()` is a pure file read of `auth.json` — no network. Called in
`test.beforeAll`, it fails a login-gated spec in about a second with
"token expired, run `npm run auth`" instead of timing out on a button that only
renders for a logged-in user.

**Deliberately inert** when `auth.json` is missing or has zero cookies, because
CI writes an empty session.

### 3. The production guard — `tests/data/subHomeFeature.js`

`productionGuard()` makes pointing the sub-home admin suite at `www.bytepe.com`
an **error, not a skip**. Those endpoints rewrite the tab strip every shopper
sees. A missing token is an accident; a production host is a decision, and it is
the wrong one.

### Skipping is a feature

The video, sub-home, exchange and API suites all gate themselves and skip when
their credentials are absent. `eslint.config.js` turns off
`playwright/no-skipped-test` for exactly those folders, because skipping *is*
the safety mechanism there. A run that could not skip would be a run that always
writes.

---

## The four rules that catch people out

1. Import `test` and `expect` from `../fixtures/pageFixtures`, **not** from
   `@playwright/test`.
2. **There is no `baseURL`.** Use a page object's `goto()` or an absolute URL.
3. A new helper must live in `pages/`, `data/`, `fixtures/` or `utils/`.
4. Paths are relative to `testDir: ./tests` — `regression/cart.spec.js`, not
   `tests/regression/cart.spec.js`.
