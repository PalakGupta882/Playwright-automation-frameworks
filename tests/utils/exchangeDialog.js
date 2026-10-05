// tests/utils/exchangeDialog.js
//
// BytePe Exchange (device trade-in) shipped between 20 and 26 Aug 2026. On the
// cart and on Review Order it opens a promotional dialog BY ITSELF, gated on the
// selected delivery address being exchange-eligible:
//
//     Exchange is now available!
//     Your selected delivery address is eligible for BytePe Exchange.
//     Add your old device and save on this order.
//     [ Add Exchange ]   [ Not now ]   [ Close ]
//
// Left alone it intercepts pointer events, which is how a click times out
// against a control that is plainly visible in the screenshot. Measured
// 26 Aug 2026 — it failed coupon-valid, coupon-invalid and checkout-flow like
// this, and none of the three failures named the dialog:
//
//     - locator resolved to <input ... placeholder="Have a Coupon Code?" />
//     - element is visible, enabled and stable
//     - <div class="MuiDialog-container MuiDialog-scrollPaper mui-ekeie0">…</div>
//       from <div class="MuiDialog-root MuiModal-root mui-e3rc31">…</div>
//       subtree intercepts pointer events
//     - retrying click action (54 ×)
//     TimeoutError: locator.click: Timeout 30000ms exceeded.
//
// LOCATOR RATIONALE. Anchored on "the dialog that contains an Add Exchange
// button", not on the headline copy and not on a class.
//
//   - The MUI classes (`mui-e3rc31`, `mui-ekeie0`) are build-hashed and change
//     on every deploy — the same trap already documented on parsePlanBox and
//     ProductPage.lowestEffectivePriceRow.
//   - The headline is marketing copy. "Exchange is now available!" will be
//     reworded; the button will not, because it is the dialog's whole function.
//   - It has to be narrower than `getByRole('dialog')`. Two other dialogs live
//     on these same pages — the login modal and the cart's Nitro crash dialog
//     (docs/api-reference.md) — and neither may be dismissed here. Filtering on
//     the button means this handler cannot fire on either one.
//
// It DECLINES rather than closes: "Not now" is the site's own decline control
// and leaves the order untouched. Close is the fallback for a build that drops
// it. "Add Exchange" must never be clicked from a test — it attaches a trade-in
// to a real order on a real account.

// Every dismissal is logged. A run that silently swallows an overlay looks
// identical to a run where the overlay never appeared, and the difference is
// the whole point: the same dialog is sitting in front of a real shopper.
function exchangeDialog(page) {
  return page.getByRole('dialog').filter({
    has: page.getByRole('button', { name: /add exchange/i }),
  });
}

// Playwright re-checks a locator handler before every action, which is what this
// needs: the dialog is address-gated and arrives whenever the address resolves,
// not at a point any spec could await. Registering it once per page beats a
// dismiss() call at the top of each flow, because the flows that break are the
// ones where it appears mid-flow.
async function installExchangeDialogHandler(page) {
  await page.addLocatorHandler(exchangeDialog(page), async (dialog) => {
    const notNow = dialog.getByRole('button', { name: /not now/i });
    const close = dialog.getByRole('button', { name: /^close$/i });

    const control = (await notNow.count()) > 0 ? notNow : close;
    const label = (await notNow.count()) > 0 ? 'Not now' : 'Close';

    if ((await control.count()) === 0) {
      // Loud, not silent. If neither decline control is there any more the
      // dialog has been redesigned, and quietly leaving it up would resurface
      // as a pointer-interception timeout somewhere unrelated.
      throw new Error(
        'The BytePe Exchange dialog is open but carries neither a "Not now" nor a ' +
          '"Close" control. It has been redesigned — update tests/utils/exchangeDialog.js. ' +
          `Dialog text:\n${await dialog.innerText()}`
      );
    }

    console.log(`exchange dialog dismissed via "${label}"`);
    await control.click();
  });
}

module.exports = { exchangeDialog, installExchangeDialogHandler };
