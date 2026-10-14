# BUG-02 — Deleting a saved address happens instantly, with no confirmation and no undo

| | |
|---|---|
| **Bug ID** | BUG-02 |
| **Severity** | High — irreversible loss of user data, one mis-tap away |
| **Environment** | Production, https://www.bytepe.com |
| **URL** | https://www.bytepe.com/my-profile/address |
| **Browser** | Chromium (Playwright), desktop 1280px |
| **Auth state** | Logged in, real account |
| **Date observed** | 11 August 2026 |
| **Frequency** | 2 of 2 attempts — first run and retry #1 |
| **Detected by** | `tests/regression/address-management.spec.js` — TC-ADDR-022 |
| **Status** | Accepted by dev, fix scheduled |

## Summary

On the Saved Addresses page, each address card carries a delete icon. Clicking it
**removes the address immediately**. There is no confirmation dialog, no "are you
sure", no toast with an undo, and no way to recover the address afterwards — it
has to be typed in again from memory.

The delete icon is a 30×30 icon button sitting **38 pixels below the edit icon**
on every card, and it carries no text, no `aria-label` and no `title`. So the
control that permanently destroys data is unlabelled, and is the nearest
neighbour of the control users actually mean to press.

## Steps to reproduce

1. Log in to https://www.bytepe.com with an account that has at least one saved
   address.
2. Go to https://www.bytepe.com/my-profile/address.
3. On any address card, click the lower of the two icon buttons on the right
   (the trash icon, at x≈1209).
4. Observe: the address is gone.

**Expected:** a confirmation step naming the address about to be deleted, with
cancel as the safe default.

**Actual:** the address is deleted on the single click. No dialog mounts, no
confirming text appears, and nothing offers an undo.

## Evidence

Automated check waits up to 5 seconds after the click for either a
`role="dialog"` element or any text matching `/are you sure|confirm|do you want
to delete/i`. Neither appears.

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

Reproduced on the first attempt and again on retry #1, so this is not a timing
artefact. The test deletes only an address it created seconds earlier, so no
real account data was harmed in finding this.

Screenshot, video and trace: `test-results/regression-address-managem-d1304-asks-for-confirmation-first-chromium-retry1/`.

## Impact

- **Irreversible.** There is no undo and no restore. The shopper re-types the
  address, including the pincode, or loses it.
- **A mis-tap is enough.** Unlabelled 30×30 target, 38px below the edit control
  people are actually aiming for. On touch devices that gap is well inside the
  margin of error.
- **Accessibility.** With no accessible name, a screen reader announces this as
  an unlabelled button. A user cannot tell edit from delete before activating one.
- **Checkout risk — not yet verified, see below.**

## Open questions for dev (deliberately not tested)

These were **not** exercised, because confirming them means destroying real data
on a live account:

1. **Can the default address be deleted?** The default address is the one the
   checkout, EMI-store and subscription flows resolve. If deleting it is allowed
   and nothing is promoted in its place, a shopper can put their own account into
   a state where checkout has no address to use.
2. **Can the last remaining address be deleted?** If yes, an account can be left
   with zero saved addresses. Our reading is that at least one address should
   always remain, or the flows that assume one must handle zero.

Both are cheap to answer from the server side and worth answering before the fix
is designed.

## Suggested fix

1. **Confirmation step before deletion**, naming the address being removed —
   street and pincode, not a bare "Are you sure?". Six near-identical cards make
   an unnamed prompt nearly useless.
2. **Cancel is the safe default.** Focus lands on Cancel, Escape and a backdrop
   click both cancel, and Enter does not confirm.
3. **Label the controls.** `aria-label="Edit address"` / `aria-label="Delete
   address"`. Cheap, and it fixes the accessibility problem in the same change.
4. **Decide the rules for the default and the last address** (see open questions)
   — either block the deletion, or promote another address to default.
5. Optional but valuable: a **short undo window** via a toast, which converts a
   mis-tap from a loss into an annoyance.

## Automation status

`TC-ADDR-022` is left **failing on purpose**. It asserts the behaviour a
destructive control should have, rather than being rewritten to expect the bug —
the same convention as VID-44 in the video suite.

When the fix ships, TC-ADDR-022 should pass with **no test change**: the helper
already detects a dialog and confirms through it. Follow-up cases for the new
dialog (TC-ADDR-023 to 028, including cancel-keeps-the-address and the
accessible-name check) are planned in
`test-cases/address-management.md` under "Future improvements". Their selectors
are deliberately not pre-written until the real dialog can be probed.
