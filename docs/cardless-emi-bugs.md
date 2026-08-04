# Cardless EMI — investigation closed, no defects

Every issue raised during this investigation was withdrawn after the product
owner confirmed the intended behaviour. Kept as a record of what was checked and
why the wrong conclusions were reached, so the same mistakes aren't repeated.

**Current reference:** `docs/cardless-emi.md`. **Model:** `CLAUDE.md`.

## Withdrawn

| Claimed | Reality |
|---|---|
| 145 products have no cardless EMI | Every product offers it. `nbfc: 0` means "not pre-priced", not "not available" |
| The "Check Eligibility" row is a dead link | It is the entry point to the credit check, by design |
| Macbook Pro M5 Pro has a hidden ₹23,037/mo offer | `nbfc` on an upfront product is a computed figure, not a suppressed offer |
| Galaxy S26 Plus 5G is missing a downpayment | Intended plan configuration |
| Availability follows brand, not price | Availability follows the shopper's credit check, not the product |
| A logged-in "no verdict" row is broken | Expected state |
| Eligibility flipping between page loads is a bug | Expected |

## Why the analysis went wrong

**Reading a data field instead of the screen.** `nbfc.emi_amount === 0` was
treated as "cardless EMI unavailable". It means the figure isn't pre-computed.
Every headline number in the earlier drafts rested on that one assumption, and
all of them were wrong.

**Testing logged out and reporting it as product configuration.** Cardless EMI is
eligibility-gated. Anonymously, every product shows "Check Eligibility" and no
price — indistinguishable from "not offered". The distinction only appears once
logged in, and it describes the *shopper*, not the product.

**One account is not enough.** The first test account was declined nearly
everywhere, which looked like the feature being absent. A second account showed a
**Pre-approved** badge and a priced Pre-Approved Offer on the same products.
Neither account alone would have revealed the model.

**Quoting a variant price as the product price.** Macbook Pro M5 Pro was reported
at ₹4,67,300 — the 16"/48GB/2TB config. Production shows ₹2,84,900, the master
variant. 47 variants share that name and slug.

## Checks worth keeping

These were run and found nothing, but are the right things to check again:

- Catalogue vs pricing agreement on `prodPaymentMode` — one mismatch found
  (Macbook Pro M5 Pro, `UPFRONT` with populated `nbfc`), confirmed harmless
- Downpayment equals one instalment across pre-priced subscription plans — one
  exception found (Galaxy S26 Plus 5G, ₹0), confirmed intended
- Manifest and price fields present on every reachable product — 171 of 173 pass;
  the two failures are stale slugs in `tests/data/products.json`:
  `tufton-bluetooth-portable-speaker` and `usb-c-wired-earphones`, both 404

That last one is still worth fixing — two products in the test catalogue point at
URLs that no longer exist.
