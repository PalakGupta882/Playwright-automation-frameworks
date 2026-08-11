# Address Management — test cases

Feature: saved addresses on the BytePe storefront account area
(`/my-profile` → Saved Addresses → `/my-profile/address`).

**Status: Phase 1 (design), revision 2. Awaiting approval before any automation.**

> **Revision 2 — the live probe overturned the premise of revision 1.**
> Edit and delete controls **do exist**. Everything below is re-measured against
> production on 11 Aug 2026, not carried over from the repo's comments.

---

## What the probe found (11 Aug 2026, read-only, nothing submitted)

### Edit and delete exist — the repo says otherwise, and the repo is wrong

`tests/pages/accountPage.js` and `address-management.spec.js` both state, in
comments, that the UI has no edit and no delete control, citing zero matches for
`getByRole('button', { name: /edit/i })` and `/delete|remove/i`.

Those counts were real, but the conclusion did not follow. **Every address card
carries two 30×30 MUI `IconButton`s with no text, no `aria-label` and no
`title`** — invisible to any name-based locator. Reading the icon inside them:

```
[1] y=183  data-testid="EditIcon"      <- card 1
[2] y=221  data-testid="DeleteIcon"    <- card 1
[3] y=361  data-testid="EditIcon"      <- card 2
[4] y=399  data-testid="DeleteIcon"    <- card 2
...  12 buttons over 6 cards, strictly alternating
```

Distinct icon test ids on the page: `SearchIcon`, `EditIcon`, `DeleteIcon`.
Nothing was clicked — clicking the second one deletes a real address.

**Consequence:** every "no such control, nothing to drive" exclusion in revision 1
was wrong, and `accountPage.js` / `address-management.spec.js` / `apiEndpoints.js`
all carry a comment that needs correcting.

### The account's current state

6 saved addresses. Exactly **one** carries a `Default` marker. Type markers read
`Home` and `Home & Office` — **not** the Home/Office/Other the add form offers.

`TEST_ADDRESS` **already exists** on the account
(`QA Automation / Apt 4B / 123 Test Street / 110001`), so any creation case will
report `already-present` unless it is deleted first.

### The add form, as measured

| Field | `name` | Required | Notes |
|---|---|---|---|
| Your Full Name | `fullName` | **Yes** (`*`) | |
| Your email id | `email` | No | but **format-validated** on blur |
| Your mobile number | `mobile` | **Yes** (`*`) | `type=tel`, `maxlength=10` |
| Flat No. / House no. | `flatNo` | **Yes** (`*`) | |
| Area, Street, Sector | `areaStreet` | **No** — no `*` | no maxlength; accepts 500 chars |
| Landmark (optional) | `landmark` | No | |
| Pincode | `pincode` | **Yes** (`*`) | `type=tel`, `maxlength=6`, **silently drops letters** |
| Area/City | `city` | **Yes** (`*`) | autofilled from pincode |
| State | `state` | **Yes** (`*`) | autofilled from pincode |

No input carries `required` or `aria-required` — **validation is entirely
JS-side**, so an empty-form submit is a client-side outcome, not an HTTP one.

Also present: a **"Use my current location"** button, a **Set as Default**
checkbox, and three `addressType` radios (Home / Office / Other).

Real validation messages, captured on blur:

- `Please enter a valid email address`
- `Mobile number must be 10 digits`
- `Please enter a valid pincode`

### Pincode lookup

- `110001` → `city="New Delhi"`, `state="Delhi"`. Autofill works.
- `999999` → error `Please enter a valid pincode`, **but city/state keep their
  previous values**. So an invalid-pincode test must assert the *message*;
  asserting "city is empty" would fail for the wrong reason.
- Typing `abcdef` leaves the field empty — the input filters non-digits, so
  "letters in pincode" is not reachable through the UI at all.

### The address API route in the repo is wrong

`ENDPOINTS.customerAddresses = '/customer-address/'` → **404 `Route not found`**.

What the page actually calls:

```
GET /api/customer-address/user/<userId>
```

`customerAddress(id)` is unverified and may be equally wrong.

---

## Constraints

1. **Production, real account.** Nothing runs without asking first.
2. **Creation is no longer irreversible** — delete exists. That changes the
   calculus on write-gated cases; see Open Questions.
3. **"Set as Default" is still never touched.** `subscription-e2e`,
   `emi-store-flow` and `checkout-flow` all resolve the account's default
   address. Repointing it breaks all three, invisibly.
4. **Delete only ever targets the suite's own address**, matched on
   `TEST_ADDRESS.areaStreet`. No case may delete a card it did not create.

## Test data

`TEST_ADDRESS` in `tests/data/constants.js` — `QA Automation`, `Apt 4B`,
`123 Test Street`, `Automation Landmark`, `110001`, `New Delhi`, `Delhi`, type
`Other`. Mobile from `TEST_PHONE` → `BYTEPE_MOBILE`. No number hardcoded.

---

## Cases

**Gate:** `session` = live `auth.json` · `writes` = also `BYTEPE_ALLOW_WRITES=1`
· `public` = logged out.

### Happy path

#### TC-ADDR-001 — Saved addresses page lists deliverable addresses
- **Priority:** High · **Type:** Positive · **Gate:** session · **Status:** Automated (existing)
- **Steps:** Go to `/my-profile/address`; wait for "Add New Address"; read the list.
- **Expected:** A 6-digit pincode and `Phone: <digits>` are present. An empty-state page must fail this.

#### TC-ADDR-002 — Add form exposes every field
- **Priority:** High · **Type:** UI · **Gate:** session · **Status:** Automated (existing)
- **Steps:** Open the add form; assert all 9 inputs + SAVE & PROCEED are visible.
- **Expected:** All visible; failure names the missing field.

#### TC-ADDR-003 — An added address is saved with the data entered
- **Priority:** High · **Type:** Positive · **Gate:** **writes** (newly gated) · **Status:** Automated
- **Steps:** Read the list; create only if the marker is absent; submit; wait for the new row.
- **Expected:** Street, flat, pincode and city all come back. The list grew on a run that created. The pre-existing `Default` survives.

#### TC-ADDR-004 — A saved address survives a reload
- **Priority:** High · **Type:** Positive · **Gate:** session · **Status:** Automated
- **Steps:** Load, capture; reload; capture again.
- **Expected:** Same addresses, same count. Creates nothing.

#### TC-ADDR-005 — Pincode lookup autofills city and state
- **Priority:** Medium · **Type:** Positive · **Gate:** session · **Status:** Automated
- **Steps:** Open form; type `110001` key-by-key; read city/state. **No submit.**
- **Expected:** `New Delhi` / `Delhi`.

### Edit — new in revision 2

#### TC-ADDR-018 — Edit opens a form pre-filled with the address
- **Priority:** High · **Type:** Positive · **Gate:** session · **Status:** Automated
- **Steps:** Locate the card matching `TEST_ADDRESS.areaStreet`; click **its** EditIcon; read the field values. Navigate away without saving.
- **Test data:** the existing QA Automation address
- **Expected:** Form opens pre-populated — flat, street, pincode, city match what the card showed. A blank form would mean edit silently creates instead of editing. **Read-only: abandons without saving.**

#### TC-ADDR-019 — An edit persists
- **Priority:** High · **Type:** Positive · **Gate:** writes · **Status:** Automated
- **Steps:** Edit the QA Automation address, change `landmark` to a timestamped value, save, re-read the list.
- **Test data:** `landmark = "Automation Landmark <run id>"`
- **Expected:** The new landmark renders; the address count is unchanged (an edit must not create a second card); the street/pincode are untouched. Modifies only the suite's own address.

#### TC-ADDR-020 — Edit does not touch the default marker
- **Priority:** Medium · **Type:** Edge · **Gate:** writes · **Status:** Automated
- **Steps:** Count `Default` markers before and after TC-ADDR-019's edit.
- **Expected:** Still exactly one, on the same card. This is the guard that stops an address edit silently breaking the three checkout specs.

### Delete — new in revision 2

#### TC-ADDR-021 — Delete removes an address (create → delete round trip)
- **Priority:** High · **Type:** Positive · **Gate:** writes · **Status:** Automated
- **Steps:** Create a throwaway address with a unique marker; confirm it is listed; click **its** DeleteIcon; handle any confirmation; re-read the list.
- **Test data:** street `QA DELETE ME <run id>`, otherwise `TEST_ADDRESS`
- **Expected:** The card is gone, the count drops by exactly one, and every other address — including `Default` and the QA Automation one — is still there. **Only ever deletes the card it just created in the same test.**

#### TC-ADDR-022 — Delete asks for confirmation
- **Priority:** Medium · **Type:** UI · **Gate:** writes · **Status:** Automated — **FAILING, and the failure is the finding**
- **Steps:** Click DeleteIcon on the throwaway address; observe before confirming.
- **Expected:** *Unknown.* Whether a dialog appears cannot be determined without clicking delete on a real address, which the probe would not do. The test records what actually happens. If deletion is immediate and unconfirmed, that is a **finding to report**, not a test to force green.

### Negative / invalid input

#### TC-ADDR-006 — Empty form does not create an address
- **Priority:** High · **Type:** Negative · **Gate:** session · **Status:** Automated (existing)
- **Expected:** Form stays open with validation, or submission refused. List must not grow.

#### TC-ADDR-007 — Non-existent pincode is rejected
- **Priority:** Medium · **Type:** Negative · **Gate:** session · **Status:** Automated
- **Steps:** Type `999999`; wait; read the page.
- **Expected:** `Please enter a valid pincode` renders. **Do not assert city/state are empty** — they retain prior values, measured.

#### TC-ADDR-008 — Pincode field rejects non-digits and over-length
- **Priority:** Medium · **Type:** Negative · **Gate:** session · **Status:** Automated
- **Steps:** Fill `abcdef` → read value. Fill `1234567` → read value. Submit an otherwise-valid form with `12345`.
- **Expected:** Letters produce an empty field; input caps at 6 digits; a 5-digit pincode is refused at submit and creates nothing.

#### TC-ADDR-009 — Invalid mobile rejected
- **Priority:** High · **Type:** Negative · **Gate:** session · **Status:** Automated
- **Steps:** Enter `12345`, blur.
- **Expected:** `Mobile number must be 10 digits`; submit creates nothing.

#### TC-ADDR-010 — Malformed email rejected
- **Priority:** Medium · **Type:** Negative · **Gate:** session · **Status:** Automated
- **Steps:** Enter `not-an-email`, blur.
- **Expected:** `Please enter a valid email address`. Confirmed to fire even though the field is optional.

#### TC-ADDR-011 — Whitespace-only required fields rejected
- **Priority:** Medium · **Type:** Negative · **Gate:** session · **Status:** Automated
- **Steps:** Fill `fullName` and `flatNo` with spaces only; valid pincode/mobile; submit.
- **Expected:** Rejected. Targets `fullName`/`flatNo` — **not** `areaStreet`, which the probe showed is not a required field.

### Edge

#### TC-ADDR-012 — Adding the same address twice
- **Priority:** Medium · **Type:** Edge · **Gate:** writes · **Status:** Automated
- **Expected:** Helper reports `already-present` and creates nothing. Records whether the product itself permits duplicates rather than asserting a defect.

#### TC-ADDR-013 — Landmark is genuinely optional
- **Priority:** Low · **Type:** Edge · **Gate:** writes · **Status:** Automated
- **Steps:** Create with `landmark` blank, unique marker; assert saved; **delete it** in cleanup.
- **Expected:** Saves without a landmark. Now self-cleaning, since delete exists.

#### TC-ADDR-014 — Over-long street value
- **Priority:** Low · **Type:** Edge · **Gate:** writes · **Status:** Automated
- **Steps:** Fill `areaStreet` with 500 chars (confirmed accepted by the input); submit; **delete it** in cleanup if it saved.
- **Expected:** Either a length error, or stored without breaking the card layout. Self-cleaning.

### UI / visibility

#### TC-ADDR-015 — Exactly one default, and every card offers edit + delete
- **Priority:** Medium · **Type:** UI · **Gate:** session · **Status:** Automated
- **Steps:** Count `Default` markers; count `EditIcon` and `DeleteIcon`; count cards.
- **Expected:** Exactly one `Default`. `EditIcon` count == `DeleteIcon` count == card count. Two defaults would break checkout's address resolution silently. Rewritten from revision 1, which asserted Home/Office/Other markers that do not render — the cards read `Home` and `Home & Office`.

#### TC-ADDR-016 — Addresses are not exposed logged out
- **Priority:** High · **Type:** Negative · **Gate:** public · **Status:** Automated
- **Steps:** `test.use({ storageState: { cookies: [], origins: [] } })`; go to `/my-profile/address`.
- **Expected:** No 6-digit pincode, no `Phone:` in the body. CI-eligible.

### Cross-layer

#### TC-ADDR-017 — API address list matches the rendered list
- **Priority:** Medium · **Type:** Positive · **Gate:** session · **Status:** Automated
- **Steps:** `GET /api/customer-address/user/<userId>` with the session context; compare against the rendered list.
- **Expected:** Counts agree; every API pincode appears in the DOM. Read-only. **Requires fixing `apiEndpoints.js` first** — the route recorded there 404s.

---

## Still out of scope

| Not covered | Why |
|---|---|
| Setting an address as default | Repoints the address `checkout-flow`, `emi-store-flow` and `subscription-e2e` resolve. Deliberate. |
| Deleting a pre-existing address | Real account data. Only suite-created addresses are ever deleted. |
| "Use my current location" | Needs geolocation permission and a mocked position; separate piece of work. |
| Address selection during checkout | Belongs to the checkout specs. |

## Open questions for you

1. **Delete is now automatable — do you want TC-ADDR-021/022?** It is the one
   genuinely destructive case. My design creates its own throwaway address and
   deletes only that, so it never touches your six real ones. Say if you'd
   rather leave delete alone entirely.
2. **Edit cases (018/019/020) are new** and were not in what you approved.
   Confirm you want them.
3. **Now that delete exists, TC-ADDR-013/014 are self-cleaning** — they can
   create and then remove their own row. You asked to keep them write-gated;
   that still holds, and they no longer leave residue.
4. **`apiEndpoints.js` has a wrong route** (`/customer-address/` → 404). Fixing
   it to `/customer-address/user/:userId` is a one-line change outside this
   feature's spec file. Want it in the same commit, or separate?
5. **Three repo comments are now false** — the "no edit / no delete" notes in
   `accountPage.js`, `address-management.spec.js` and `apiEndpoints.js`. I'll
   correct them as part of Phase 2 unless you'd rather they moved separately.

## Phase 3 — run results

All 22 cases automated in `tests/regression/address-management.spec.js`.
Executed against production 11 Aug 2026, chromium, 1 worker.

- **Read-only pass** (no `BYTEPE_ALLOW_WRITES`): 14 passed, 8 skipped, 0 failed.
- **Write pass** (`BYTEPE_ALLOW_WRITES=1`): **21 passed, 1 failed** in 2.2m.

| TC | Result |
|---|---|
| 001, 002, 003, 004, 005, 006, 007, 008, 009, 010, 011 | Pass |
| 012, 013, 014, 015, 016, 017, 018, 019, 020, 021 | Pass |
| **022** | **Fail — see below** |

Account state verified after the run: **6 addresses (unchanged), 0 leftover
throwaway rows, exactly 1 default**. Every created address was deleted by the
test that created it.

### TC-ADDR-022 — delete has no confirmation step

```
delete confirmation: NONE

Error: delete removed a saved address immediately, with no confirmation step
expect(received).toBe(expected) // Object.is equality
  Expected: true
  Received: false

  634 |       result.confirmationSeen,
  635 |       'delete removed a saved address immediately, with no confirmation step'
> 636 |     ).toBe(true);
      |       ^
    at tests\regression\address-management.spec.js:636:7
```

Failed on the first attempt **and** on retry #1 — consistent, not flaky.

Clicking the DeleteIcon on a saved address removes it **immediately**. No
`role="dialog"` mounts, and no "are you sure" text appears within the 5s the
helper waits. The control is a 30×30 icon with no label, no tooltip and no
confirmation, sitting 38px below the edit control on every card.

This is a **product finding, not a test defect**. The assertion states the
behaviour a destructive control should have; it is left failing rather than
rewritten to expect immediate deletion, which is this repo's convention for a
known bug (compare VID-44 in `docs/video-feature-coverage.md`).

Worth raising with the team: a mis-tap on the address list destroys a saved
address with no undo and no warning.

## Future improvements — when delete confirmation ships

Dev have accepted TC-ADDR-022 and scheduled a fix. This section is the
readiness plan: what to do the day it lands, and what deliberately is **not**
being written before then.

### Do NOT pre-write the dialog selectors

The obvious move is to write the confirm-dialog tests now so they are ready.
Do not. This repo has already paid for that once — `productVideoPage.js` was
written against the feature spec and "standard HTML5 media markup" before any
player existed, and `docs/video-feature-coverage.md` still carries the warning
that every one of those selectors is unverified. Selectors written against an
imagined UI describe the UI you imagined.

What *is* safe to write now is the plan below. Selectors get added after one
probe of the real dialog — the same 10-minute loop used on 11 Aug: open the
page, dump the markup, then write locators against what is actually there.

### What TC-ADDR-022 does when the fix lands

It starts passing on its own. `deleteAddressReportingConfirmation()` already
detects a `role="dialog"` **or** "are you sure"-style text, clicks the confirm
button, and reports `confirmationSeen: true`. No code change needed — that is
why the helper was built to return facts instead of asserting.

If it does **not** flip to green on the first run after the fix, the likely
cause is the confirm control not matching
`/^(yes|confirm|delete|ok|remove)\b/i` or the dialog not using `role="dialog"`
— check those two before assuming the fix did not ship.

### New cases, blocked until then

All **Blocked — awaiting the fix**. Gate: `writes`. Each uses a throwaway
address it creates and removes itself, exactly like TC-ADDR-021.

#### TC-ADDR-023 — The dialog says which address is being deleted
- **Priority:** High · **Type:** UI
- **Steps:** Create a throwaway address; click its DeleteIcon; read the dialog.
- **Expected:** The dialog text identifies the target — street, or name plus
  pincode. A bare "Are you sure?" on a page of six near-identical cards does not
  tell you what you are about to destroy, and would leave the underlying
  mis-tap risk in place.

#### TC-ADDR-024 — Cancel keeps the address
- **Priority:** High · **Type:** Negative
- **Steps:** Create a throwaway; click delete; press **Cancel**; re-read the list.
- **Expected:** The address is still listed and the count is unchanged. **This
  is the case that actually fixes the bug** — a dialog whose Cancel still
  deletes is worse than no dialog. Clean up with a real delete afterwards.

#### TC-ADDR-025 — Dismissing without choosing keeps the address
- **Priority:** Medium · **Type:** Edge
- **Steps:** Create a throwaway; click delete; dismiss via Escape, then repeat
  and dismiss by clicking the backdrop.
- **Expected:** Address intact both times. Covers the two ways a user exits a
  dialog without meaning to confirm.

#### TC-ADDR-026 — Confirm deletes exactly one address
- **Priority:** High · **Type:** Positive
- **Steps:** Create a throwaway; delete it through the dialog; check the list.
- **Expected:** Count drops by exactly one, the Default marker survives, and the
  shared QA Automation address survives. Overlaps TC-ADDR-021 by design — 021
  proves deletion works, 026 proves it still works *through the new dialog*.

#### TC-ADDR-027 — Destructive action is not the default focus
- **Priority:** Medium · **Type:** UI
- **Steps:** Open the dialog; read `document.activeElement`; press Enter.
- **Expected:** Focus is not on the delete/confirm button, so a stray Enter does
  not destroy an address. If Enter does confirm, that is the original bug in a
  new costume and should be raised as such.

### Related improvement, worth asking for in the same change

#### TC-ADDR-028 — The edit and delete controls have accessible names
- **Priority:** Medium · **Type:** UI · **Blocked** — needs an app change
- **Steps:** Assert `getByRole('button', { name: /delete address/i })` resolves
  one control per card.
- **Expected:** Passes. Today it resolves **zero** — the icons carry no text, no
  `aria-label` and no `title`, which is exactly why the earlier probe concluded
  the controls did not exist at all.
- **Why it is worth raising now:** two separate wins for one small change.
  Screen-reader users currently get an unlabelled button that deletes an
  address. And the whole suite's dependency on `data-testid="EditIcon"` — a MUI
  internal that would break if the team ever swaps icon libraries — disappears,
  because the locators can move to `getByRole`, which is what this repo prefers
  everywhere else.

### Checklist for the day the fix lands

1. Re-run the file with `BYTEPE_ALLOW_WRITES=1`. Expect TC-ADDR-022 to pass with
   no code change.
2. Probe the real dialog once — markup, roles, button names, dismiss behaviour.
3. Write TC-ADDR-023 to 027 against that probe output, not against this plan.
4. If TC-ADDR-028 also shipped, move the locators in `accountPage.js` from
   `data-testid` to `getByRole` and delete the risk note in its header.
5. Update this file's status table and the Phase 3 results section.

## Automation status summary

| TC | Status |
|---|---|
| 001–021 | Automated, passing |
| 022 | Automated, **failing — open product bug, fix accepted by dev** |
| 023–027 | Blocked — awaiting the confirmation dialog. Do not pre-write selectors |
| 028 | Blocked — needs accessible names on the icon buttons |
