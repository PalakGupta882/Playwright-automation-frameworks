# Cardless EMI — how it actually works

Verified 4 Aug 2026 against the live site, logged out and logged in as two
different accounts.

**No defects found.** Everything below is expected behaviour, confirmed by the
product owner. Earlier drafts of this file claimed 145 products were missing
cardless EMI — that was wrong and is corrected here.

## The short version

**Cardless EMI is offered on every product**, in both upfront EMI plans and the
subscription plan. Whether a given shopper can *use* it is decided by a per-user
credit check, not by the product.

## The plan box has two levels

"Choose your plan" is a list of **plans**; inside an EMI or subscription plan sit
the **funding options**.

| Plan | Where it appears |
|---|---|
| Subscription | products where `prodPaymentMode` is `BOTH` |
| No Cost EMI (0% interest) | upfront products |
| Low Cost EMI | upfront products |
| Standard EMI | upfront products |
| Pay in Full / Buy Upfront | everywhere |
| Pre-Approved Offers | separate plan, own eligibility, "No Documents/KYC" |

Funding options inside a plan:

- **Credit Card EMI** — requires a card
- **Cardless EMI** — no card, credit-score based

Pre-Approved Offers is **not** cardless EMI under another name. On iPhone 17 Pro
one account saw Cardless EMI priced at ₹6,232/mo while Pre-Approved Offers
separately reported "not eligible", and a second account saw Pre-Approved Offers
priced at ₹7,760 × 12mo. They resolve independently.

## The four states of the Cardless EMI row

All expected.

| State | What it shows | When |
|---|---|---|
| 1 | Credit score based · **Check Eligibility** | logged out |
| 2 | 😔 Sorry you are currently not eligible for this plan | logged in, declined |
| 3 | **Pre-approved** badge | logged in, approved |
| 4 | Credit score based, nothing else | logged in, no verdict returned |

On subscription products the figure is pre-computed and shown directly —
e.g. "Cardless EMI · No Card Needed · ₹6,232/mo · + ₹6,232 Now" — with no
eligibility step.

**The state can change between page loads for the same user and product.**
X300 Ultra showed *Pre-approved* at 08:05 and *not eligible* at 08:13 on the same
session. Expected. Never assert on it.

## APIs

Two calls build the plan box. The catalogue call does not carry payment plans.

```
GET /api/product-service/apps/products/by-slug/:slug/:bpid    # catalogue
GET /api/apps/variant-pricing/:slug/:variantId                # plans and prices
```

`:slug` and `:bpid` come from the product URL `/pd/<slug>/<bpid>`. The variant id
comes from `data.variant.id` on the first call.

Inside `variant-pricing`, under `data`:

| Block | Drives |
|---|---|
| `upfront` | Pay in Full / Buy Upfront |
| `cc` | Credit Card EMI |
| `nbfc` | **subscription** cardless EMI figure |
| `emi.emi_option[]` | EMI tenures — `NCEMI` no cost, `LCEMI` low cost, `EMI` standard |
| `cc_y2`, `upgrade`, `keep`, `abb` | subscription end-of-term options |

### Two traps

**`nbfc.emi_amount === 0` does not mean cardless EMI is unavailable.** It means
the figure isn't pre-computed. On upfront products the amount is settled at
eligibility time and reads 0 here regardless. This one field caused every wrong
conclusion in the earlier drafts.

**`prodPaymentMode` is subscription availability, not EMI availability.**
`BOTH` means a subscription plan exists; `UPFRONT` means it doesn't. Cardless EMI
appears either way.

## Variants: a bpid is a configuration, not a product

`/pd/<slug>/<bpid>` identifies **one variant**. Macbook Pro M5 Pro has 47,
ranging ₹2,84,900 to ₹6,26,900 — all under the same name and slug.

- `data.variant.isMaster` marks the default a shopper lands on
- `data.siblingVariants` lists the rest
- pricing is per variant

The bpids in `tests/data/products.json` are whatever the listing page linked and
are **not necessarily masters**. Check `isMaster` before quoting any price.
Quoting ₹4,67,300 for Macbook Pro M5 Pro when production shows ₹2,84,900 was a
real error caused by skipping this check.

## What is and isn't testable

| Layer | Stability | Assert? |
|---|---|---|
| Which plans a product offers | stable | yes |
| Prices per variant | stable | yes |
| `nbfc` pre-priced on subscription products | stable | yes |
| Cardless EMI eligibility for an account | varies between page loads | **no** |

`tests/regression/cardless-emi.spec.js` pins the third row only: 25 products whose
subscription cardless plan is pre-priced. It runs logged out deliberately — a
logged-in run would measure one account's credit standing instead of the site's
configuration.

```
npx playwright test regression/cardless-emi.spec.js --project=chromium
```

26 passing (25 products + one contract check that `nbfc` still exists).

Regenerate the baseline only when the business intentionally changes which
products are subscription-eligible:

```
npx playwright test scripts/discover-cardless-emi.spec.js --project=chromium
```

Never regenerate it to make a failing test pass — that erases the regression it
just caught.

## Logging in for manual checks

Test account logins need two variables; set them once:

```
setx BYTEPE_MOBILE <number>
setx BYTEPE_OTP <fixed otp>
```

Then `npm run auth` runs unattended. Without `BYTEPE_OTP` it waits for you to type
the code in the browser. Access tokens last about an hour, so refresh before any
logged-in work.
