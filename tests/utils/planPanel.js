// tests/utils/planPanel.js
//
// The PDP plan panel, as redesigned by 23 Sep 2026.
//
// WHAT CHANGED. Plans used to render inline under a heading "Choose your plan",
// as a set of `input[type=radio]` options. Both are gone. The PDP now shows a
// one-line summary in the header —
//
//     ₹1,49,900   From ₹6,975/mo   See Plans
//
// — and the plans themselves only exist in the DOM once "See Plans" is
// activated. Measured logged out on 23 Sep 2026, the revealed panel differs by
// payment mode:
//
//   BOTH     "Recommended / Subscription / Own it from Day 1 /
//             🎉 You'll save up to ₹3,190 / Upgrade anytime / Device Protection /
//             Assured Buyback / Credit Card EMI / All major cards / ₹6,975 x 24mo"
//   UPFRONT  "EMI plans / Own it from Day 1. protection and buyback included /
//             Credit Card | Cardless EMI | Pay in Full / ₹36,999 /
//             3 mo No Cost ₹12,333/mo / ... / 24 mo Low Cost ₹1,722/mo / Understood"
//
// TWO THINGS THAT BREAK NAIVE AUTOMATION:
//
//  1. "See Plans" is NOT a <button>. `getByRole('button', {name:/see plans/i})`
//     finds nothing — measured. It resolves only as text, so this clicks the
//     text node. Anything asserting on plans must open the panel first or it is
//     reading a page that genuinely has no plans in it.
//
//  2. The panel carries NO radio inputs at all (measured: 0 on both layouts),
//     so the old "dispatch a click at the plan tile" workaround has nothing to
//     aim at. Its container class is build-hashed and differs per layout
//     (`mui-1q7icm` on BOTH, `mui-3ne49d` on UPFRONT), so the container is not
//     a usable anchor either — which is why callers read TEXT via
//     utils/priceText.js rather than locating plan rows.
//
// Returns true when the panel was opened (or was already open), false when the
// product renders no disclosure at all. False is a real answer, not an error:
// a sold-out or unpriced product may render no plans.

const PANEL_COPY = /EMI plans|Own it from Day ?1|Choose your plan/i;

// THE PANEL IS A DIALOG, and "is it open?" must be answered from the dialog, not
// from body copy.
//
// The first version of this tested `body.innerText` against PANEL_COPY. That is
// wrong on a BOTH-mode product: "Own it from Day 1" is ALSO rendered inline on
// the PDP, above the fold, before anything is opened. So this reported "already
// open", never clicked "See Plans", and every caller then read a page with no
// plan dialog in it — which looks exactly like a product that offers no plans.
// Measured on pixel-11-pro-xl logged out: 8 consecutive reads of a dialog that
// had never been opened.
function planDialog(page) {
  return page.getByRole('dialog');
}

async function planPanelIsOpen(page) {
  return (await planDialog(page).count()) > 0;
}

// Opens the plan panel and waits for the dialog to actually carry its content,
// rather than returning the instant the click lands. The dialog animates in and
// fills asynchronously, and reading it too early is how a caller concludes a
// product offers no plans when it is simply still loading.
async function openPlanPanel(page, { timeout = 15000 } = {}) {
  if (await planPanelIsOpen(page)) return true;

  // "See Plans" is NOT a <button> — getByRole('button') finds nothing, measured.
  const disclosure = page.getByText(/see plans/i).first();
  const present = await disclosure
    .waitFor({ state: 'visible', timeout })
    .then(() => true)
    .catch(() => false);
  if (!present) return false;

  await disclosure.click();

  const appeared = await planDialog(page)
    .first()
    .waitFor({ state: 'visible', timeout })
    .then(() => true)
    .catch(() => false);
  if (!appeared) return false;

  // Wait for the dialog to stop being empty. It renders its chrome ("EMI plans",
  // the funding tabs) before the plans themselves arrive, so a caller that reads
  // immediately sees neither a ladder nor the no-plans message.
  await page
    .waitForFunction(
      (source) => {
        const d = document.querySelector('[role="dialog"]');
        if (!d) return false;
        const t = d.innerText || '';
        return /\d+\s*mo/.test(t) || /aren.t available right now/i.test(t) || new RegExp(source, 'i').test(t);
      },
      PANEL_COPY.source,
      { timeout }
    )
    .catch(() => {});

  return true;
}

// THE PLANS LIVE ON TWO SURFACES, and a parser needs both.
//
// A BOTH-mode PDP renders an inline summary block — "Own it from Day 1 /
// 🎉 You'll save up to ₹1,594 / Credit Card EMI / All major cards /
// ₹3,485 x 24mo" — while the dialog carries the funding tabs and the tenure
// ladder, including the upfront figure ("Pay in Full ₹74,901").
//
// The dialog is a PORTAL, appended outside the product markup, so a body-text
// parse that anchors on the inline block and stops at "Delivery details" never
// reaches it. Measured on iphone-15: the inline block was parsed, the dialog's
// "Pay in Full ₹74,901" was not, and the caller reported the product as quoting
// no upfront price at all while it was on screen.
//
// Dialog first so an anchor search lands in it, then the body for everything
// the dialog does not carry.
async function readPlanSurfaces(page) {
  const dialogText = (await planPanelIsOpen(page))
    ? await planDialog(page).first().innerText().catch(() => '')
    : '';
  const bodyText = await page.locator('body').innerText();
  return [dialogText, bodyText].filter(Boolean).join('\n');
}

module.exports = {
  openPlanPanel,
  planPanelIsOpen,
  planDialog,
  readPlanSurfaces,
  PANEL_COPY,
};
