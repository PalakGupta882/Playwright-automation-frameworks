# Documentation index

Everything written down about this suite, and which file answers which question.

## Start here

| If you want to… | Read |
|---|---|
| Clone it and get a green run | [`../README.md`](../README.md) |
| Understand *how BytePe sells* — plans, variants, cardless EMI, pricing rules | [`../CLAUDE.md`](../CLAUDE.md) |
| Understand *how the framework is built* | [architecture.md](architecture.md) |
| Find out what a given spec covers | [test-inventory.md](test-inventory.md) |
| Look up a page-object or util function | [api-reference.md](api-reference.md) |
| Write or repair a spec | [authoring-guide.md](authoring-guide.md) |
| Run it, gate it, ship it, debug it | [operations.md](operations.md) |
| See where a file lives | [repo-map.md](repo-map.md) |

## Reading order for someone new

1. **`README.md`** — install, first run, the write gate. Ten minutes.
2. **`CLAUDE.md`** — the domain. Non-negotiable before touching a pricing or
   payment spec; almost every wrong bug report this suite has produced came from
   skipping it.
3. **[architecture.md](architecture.md)** — the execution chain and the config
   decisions, each of which was paid for by a failed run.
4. **[authoring-guide.md](authoring-guide.md)** — then write something.

## Feature coverage documents

These are traceability maps: a test-case id from a spreadsheet on one side, the
spec that covers it on the other, and an honest column for what is *not*
automatable from this repo.

| Doc | Feature | Ids |
|---|---|---|
| [video-feature-coverage.md](video-feature-coverage.md) | Product Video | VID-01..53 — 32 automated, 21 not automatable |
| [subhome-tabs-coverage.md](subhome-tabs-coverage.md) | Sub Home Page tabs | TCB-001..054, E2E-NAV/SEC/SHP-* |
| [cardless-emi.md](cardless-emi.md) | Cardless EMI | How it works, and the four expected eligibility states |
| [cardless-emi-bugs.md](cardless-emi-bugs.md) | Cardless EMI | Investigation closed — **no defects**. Read before re-filing one. |
| [site-health.md](site-health.md) | Catalogue-wide sweep | The 5 Aug 2026 full-site run |
| [../test-cases/address-management.md](../test-cases/address-management.md) | Saved addresses | TC-ADDR-001..013, the manual source behind the spec |

## Bug records

| Doc | Status |
|---|---|
| [BUG-02-address-delete-no-confirmation.md](BUG-02-address-delete-no-confirmation.md) | Open — delete happens instantly, no confirmation, no undo |
| `BUG-01-cart-nitro-crash.*` | Gitignored (local-only analysis output) |

## Generated output

Not hand-written; regenerate rather than edit.

| File | Produced by |
|---|---|
| `regression-report.{csv,html,pdf}` | reporting run |
| `search-test-cases.{csv,html,pdf}` | reporting run |
| `../page-health.json` | `npm run page-health` |
| `../page-health-report.html` | `npm run page-report` |

## Things this documentation deliberately repeats

Three facts appear in more than one file on purpose, because each one has
already cost a real run:

- **Tests hit production.** There is no staging host for the UI suite.
- **`BYTEPE_ALLOW_WRITES=1` can mint real orders.** It is never set in CI.
- **A skip is usually the design, not a defect.** Do not "fix" one by weakening
  the assertion.
