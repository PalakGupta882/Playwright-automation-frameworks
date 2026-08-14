// tests/utils/priceText.js
//
// Reads the rupee figures a shopper actually sees, off each surface that shows
// one: PLP tile, PDP header, PDP "Choose your plan" box, and the Order Summary
// that appears on both Cart and Review Order.
//
// WHY TEXT PARSING AND NOT LOCATORS. The plan box's container is
// `div.MuiBox-root.mui-zv7ju9` — build-hashed, so it changes on every deploy
// (the same trap documented on ProductPage.lowestEffectivePriceRow). Its rows
// carry no role, no test id and no stable class. Measured on a live PDP, the
// page renders 17 rupee-shaped text nodes and nothing distinguishes them
// structurally. What IS stable is the copy next to each figure — "Pay in Full",
// "Cardless EMI", "₹164 x 24mo" — so every reader below anchors on that copy and
// the amount together. A row that loses either half returns null and the caller
// reports it as missing, rather than silently matching a different figure.
//
// checkout-flow.spec.js already takes this approach for the order summary; this
// generalises it so cart, review and PDP are read the same way.
//
// Every reader takes FLATTENED text: page.locator('body').innerText() with
// /\s+/g collapsed to single spaces. innerText (not textContent) matters — it
// respects visibility, so hidden pre-rendered plan panels are excluded.

// "₹1,99,999" -> 199999. Returns null rather than NaN or 0: a parser that
// returns 0 makes two broken pages compare equal, which is exactly the failure
// mode ProductPage.getPrice() throws to avoid.
function toRupees(text) {
  const match = (text || '').match(/₹\s?([\d,]+)/);
  if (!match) return null;
  const value = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function flatten(text) {
  return (text || '').replace(/\s+/g, ' ').trim();
}

// ---- PLP tile ----------------------------------------------------------
//
// Measured shapes on /all-products, 14 Aug 2026 (208 tiles):
//
//   "Samsung Galaxy Z Fold8 Ultra ₹1,99,999 ₹2,04,999 2% off EMI from ₹8,994 /mo"
//   "Stuffcool Nomad II ... ₹3,499 ₹4,999 30% off"
//   "Dyson HushJet Purifier Compact-HJ10 ₹29,900"          <- no discount at all
//
// 7 of 208 tiles carry a price and nothing else. Those are not broken: the
// product has no discount, so there is no MRP to strike and no badge to show.
// mrp/percentOff come back null and the caller must not treat null as zero.
//
// Note the PLP writes "EMI from ₹X /mo" with a space before /mo, while the PDP
// writes "₹X/mo" without one. Both are matched.
function parsePlpTile(tileText) {
  const flat = flatten(tileText);
  const amounts = (flat.match(/₹\s?[\d,]+/g) || []).map(toRupees).filter((n) => n !== null);
  if (amounts.length === 0) return null;

  const offMatch = flat.match(/(\d+)\s*%\s*off/i);
  const perMonthMatch = flat.match(/₹\s?([\d,]+)\s*\/\s*mo/i);

  // Discount tiles lead with price then MRP. Where there is no "% off" badge
  // there is only one amount and it is both.
  const price = amounts[0];
  const mrp = offMatch ? amounts[1] ?? null : null;

  return {
    price,
    mrp,
    percentOff: offMatch ? Number(offMatch[1]) : null,
    perMonth: perMonthMatch ? toRupees(perMonthMatch[0]) : null,
    // "EMI from" vs "Subscription from" — the PLP and PDP disagree on the label
    // for the same figure, so the caller can compare the number without
    // asserting the copy.
    perMonthLabel: (flat.match(/(EMI|Subscription)\s+from\s*₹/i) || [])[1] || null,
    text: flat,
  };
}

// ---- PDP header --------------------------------------------------------
//
//   "... ₹1,99,999 ₹2,04,999 2% off Subscription from ₹8,994/mo Color - Graphite"
//   "... ₹3,499 ₹4,999 30% off EMI From ₹164/mo Color - White"
//
// Anchored between the product name and "Choose your plan", because the same
// three figures recur further down the page (the plan box repeats the price,
// the buyback slider repeats rupee amounts). Taking the first match in the
// document is what makes this the *header*.
function parsePdpHeader(bodyText) {
  const flat = flatten(bodyText);

  // The header runs from the first price-shaped run to "Choose your plan".
  const end = flat.search(/Choose your plan/i);
  const region = end > 0 ? flat.slice(0, end) : flat;

  const priced = region.match(/₹\s?[\d,]+\s+₹\s?[\d,]+\s+(\d+)\s*%\s*off/i);
  if (priced) {
    const amounts = (priced[0].match(/₹\s?[\d,]+/g) || []).map(toRupees);
    const perMonth = region.match(/(EMI|Subscription)\s+from\s*₹\s?([\d,]+)\s*\/?\s*mo/i);
    return {
      price: amounts[0],
      mrp: amounts[1],
      percentOff: Number(priced[1]),
      perMonth: perMonth ? toRupees(perMonth[0].slice(perMonth[0].indexOf('₹'))) : null,
      perMonthLabel: perMonth ? perMonth[1] : null,
      region,
    };
  }

  // No-discount product: a single price and no badge.
  const single = region.match(/₹\s?[\d,]+/);
  if (!single) return null;
  return {
    price: toRupees(single[0]),
    mrp: null,
    percentOff: null,
    perMonth: null,
    perMonthLabel: null,
    region,
  };
}

// ---- PDP "Choose your plan" box ---------------------------------------
//
// Two layouts, driven by prodPaymentMode (see CLAUDE.md).
//
// UPFRONT, measured on nomad-ii-smallest-100w-gan-charger:
//   "Choose your plan Recommended No Cost EMI 0% interest ₹583 x 6mo 3 Mon 6 Mon
//    Credit Card EMI No Cost EMI available Cardless EMI Credit score based
//    Check Eligibility 🎉 You'll save up to ₹1,658 Low Cost EMI Upto 24 mo
//    ₹164 x 24mo Pay in Full ₹3,499 All major payment modes accepted"
//
// BOTH, measured on galaxy-z-fold8-ultra:
//   "Choose your plan Subscription New device every year... Credit Card EMI
//    Low Cost EMI available ₹8,994/mo Cardless EMI No Card Needed ₹10,224/mo
//    + ₹10,220 Now 🎉 You'll save up to ₹27,307 Buy Upfront With assured
//    buyback ₹1,99,999 Pre-Approved Offers No Documents/ KYC From ₹8,994/mo
//    Check Eligibility Monthly Subscription ₹8,994/mo Subscribe ...
//    Total Discount ₹27,307 Assured buyback ₹90,000"
//
// Every field is optional by design — which rows render depends on the payment
// mode and, for Cardless EMI, on per-shopper eligibility, which CLAUDE.md is
// explicit must never be asserted. Callers assert on what is present.
function parsePlanBox(bodyText) {
  const flat = flatten(bodyText);
  const start = flat.search(/Choose your plan/i);
  if (start < 0) return null;

  // Ends at the buy controls; on subscription products the section continues
  // into a buyback slider whose rupee figures are not plan prices.
  const tail = flat.slice(start);
  const stopAt = tail.search(/Adjust the slider|Delivery details|What's included/i);
  const region = stopAt > 0 ? tail.slice(0, stopAt) : tail;

  const pick = (pattern) => {
    const m = region.match(pattern);
    return m ? toRupees(m[0].slice(m[0].indexOf('₹'))) : null;
  };

  // The tenure ladder, where it is rendered: "₹164 x 24mo" / "₹1,166 X 3 mo".
  const tenureRows = [...region.matchAll(/₹\s?([\d,]+)\s*[xX]\s*(\d+)\s*mo/g)].map((m) => ({
    installment: Number(m[1].replace(/,/g, '')),
    tenure: Number(m[2]),
  }));

  return {
    // Upfront plan. The two layouts label it differently.
    payInFull: pick(/Pay in Full\s*₹\s?[\d,]+/i),
    buyUpfront: pick(/Buy Upfront\s*With assured buyback\s*₹\s?[\d,]+/i),

    // Card EMI monthly. On BOTH products the figure sits inside the row; on
    // UPFRONT products the row carries only "No Cost EMI available" and the
    // monthly figure lives in the header instead.
    creditCardEmiPerMonth: pick(/Credit Card EMI[^₹]{0,40}₹\s?[\d,]+\s*\/\s*mo/i),

    // Cardless EMI. Two figures: the instalment and the amount due now.
    cardlessEmiPerMonth: pick(/Cardless EMI[^₹]{0,40}₹\s?[\d,]+\s*\/\s*mo/i),
    cardlessDownPayment: pick(/\+\s*₹\s?[\d,]+\s*Now/i),

    // A separate plan with its own eligibility — NOT cardless EMI (CLAUDE.md).
    preApprovedFrom: pick(/Pre-?Approved Offers[^₹]{0,40}₹\s?[\d,]+\s*\/\s*mo/i),

    monthlySubscription: pick(/Monthly Subscription\s*₹\s?[\d,]+\s*\/\s*mo/i),

    saveUpTo: pick(/save up to\s*₹\s?[\d,]+/i),
    totalDiscount: pick(/Total Discount\s*₹\s?[\d,]+/i),
    assuredBuyback: pick(/Assured buyback\s*₹\s?[\d,]+/i),
    instantDiscount: pick(/Instant Discount of\s*₹\s?[\d,]+/i),

    tenureRows,

    // Which plan names the box offers. Scoped to the region on purpose: the
    // site header carries a "Subscription" nav link (/home/subscription), so a
    // whole-body search reports a Subscription plan on every UPFRONT product.
    plans: [
      'Subscription',
      'Credit Card EMI',
      'Cardless EMI',
      'Pay in Full',
      'Buy Upfront',
      'No Cost EMI',
      'Low Cost EMI',
      'Pre-Approved Offers',
    ].filter((label) => new RegExp(label.replace(/[-]/g, '-?'), 'i').test(region)),

    region,
  };
}

// ---- Bundled add-on ----------------------------------------------------
//
//   "BytePe Secure ₹8,000 ₹1,999"     (Galaxy Z Fold8 Ultra)
//   "BytePe Secure ₹8,000 ₹1"         (Macbook Pro M5)
//
// List price then what the shopper actually pays. This sits BELOW the buyback
// slider, so it is outside parsePlanBox's region and is read from the whole
// body instead.
//
// It matters because it is the missing term in the advertised saving. Measured
// exact on both products above: the "Total Discount" the PDP prints is
// (MRP - cc.total_amount) + (list - paid). Without this term the check on that
// figure can only be a loose bound; with it, the claim is verifiable to the
// rupee. It is also the same class of line item as the ₹1 Device Protection
// that once made the cart total look like a rounding defect.
function parseAddOn(bodyText) {
  const flat = flatten(bodyText);
  const match = flat.match(/BytePe Secure\s*₹\s?([\d,]+)\s*₹\s?([\d,]+)/i);
  if (!match) return null;

  const list = Number(match[1].replace(/,/g, ''));
  const paid = Number(match[2].replace(/,/g, ''));
  if (!Number.isFinite(list) || !Number.isFinite(paid)) return null;

  return { name: 'BytePe Secure', list, paid, saving: list - paid };
}

// ---- Order Summary (Cart and Review Order share this block) ------------
//
// Measured 10 Aug 2026 (checkout-flow.spec.js records the same):
//
//     Price (18 Items)     ₹9,30,391
//     Discount            -₹1,89,404
//     Device Protection          ₹1      <- value-added service, easy to miss
//     Total Amount         ₹7,40,988
//
// Everything charged between the Discount line and Total Amount is summed
// rather than named, so a second add-on (a fee, a warranty, a delivery charge)
// does not reintroduce the ₹1 false failure that was once read as a rounding
// defect. The site's arithmetic was right; the assertion's model was incomplete.
function parseOrderSummary(bodyText) {
  const flat = flatten(bodyText);

  const priceMatch = flat.match(/Price\s*\(\s*(\d+)\s*Items?\s*\)\s*₹\s?[\d,]+/i);
  if (!priceMatch) return null;

  const totalMatch = flat.match(/Total Amount\s*₹\s?[\d,]+/i);
  if (!totalMatch) return null;

  const discountMatch = flat.match(/Discount\s*-\s*₹\s?[\d,]+/i);

  const lastKnown = discountMatch
    ? flat.indexOf(discountMatch[0]) + discountMatch[0].length
    : priceMatch.index + priceMatch[0].length;
  const totalAt = flat.search(/Total Amount\s*₹/i);

  const extrasRegion = totalAt > lastKnown ? flat.slice(lastKnown, totalAt) : '';
  const extras = (extrasRegion.match(/₹\s?[\d,]+/g) || []).reduce((sum, a) => sum + toRupees(a), 0);

  return {
    itemCount: Number(priceMatch[1]),
    price: toRupees(priceMatch[0]),
    discount: discountMatch ? toRupees(discountMatch[0]) : 0,
    extras,
    extrasRegion: extrasRegion.trim(),
    total: toRupees(totalMatch[0]),
  };
}

// ---- Pricing breakdown, component by component -------------------------
//
// parseOrderSummary above answers "does this page's total add up". That is not
// enough to chase a charge that CHANGES between two pages: it lumps every line
// between Discount and Total into one `extras` figure, so a Device Protection
// that goes from ₹1 to ₹2,001 shows up only as "total mismatch" with no name
// attached to it.
//
// This returns each component separately, so a cross-page comparison can say
// WHICH line moved. Every amount is a Number — never a formatted string —
// because "₹2,001" and "₹2001" compare unequal as text while being the same
// money, and "₹1" vs "₹2,001" must never be hidden by a formatting nicety.
//
// Works on Cart, Review Order and Payment Summary: it classifies by the label
// beside each amount rather than by position, and anything it cannot classify
// is preserved in `unclassified` rather than dropped — an unrecognised charge
// is exactly what a checkout bug looks like, and silently discarding it would
// make the totals reconcile when they should not.
// Matched against the END of a label, not the whole of it.
//
// innerText gives no row boundaries, so the text before an amount often carries
// the section heading too — the first row of a cart summary reads "Order Summary
// Price", not "Price". Anchoring these to the end of the label lets that match
// while still refusing to classify an unrelated line.
//
// Order matters: the first match wins, so the specific "Device Protection" is
// tested before anything that could also catch a generic charge.
const COMPONENT_PATTERNS = [
  ['deviceProtection', /(?:^|\s)(device protection|protection plan|bytepe secure)$/i],
  ['total', /(?:^|\s)(total amount|amount payable|payable amount|to pay|grand total|net payable)$/i],
  ['productAmount', /(?:^|\s)(price|sub ?total|item total|order value|mrp total)$/i],
  ['discount', /(?:^|\s)(discount|coupon discount|instant discount|savings?)$/i],
  ['shipping', /(?:^|\s)(shipping|delivery|shipping charges?|delivery charges?|shipping fee)$/i],
];

// Splits the summary region into labelled money rows.
//
// Walks amount by amount and takes the text between the previous amount and
// this one as the label, rather than trying to match label-and-amount in one
// expression — a single regex either forces every row to carry the "(N Items)"
// suffix that only the price line has, or lets a lazy label group swallow an
// entire heading. Amounts written "-₹X" are recorded negative, which is how the
// Discount line reads.
function moneyRows(regionText) {
  const AMOUNT = /(-?)\s*₹\s?([\d,]+)/g;
  const rows = [];
  let cursor = 0;
  let match;

  while ((match = AMOUNT.exec(regionText)) !== null) {
    const before = regionText.slice(cursor, match.index);
    cursor = match.index + match[0].length;

    // "Price (7 Items)" carries the count in the label; lift it out, then take
    // the trailing words as the label proper.
    const countMatch = before.match(/\(\s*(\d+)\s*Items?\s*\)\s*$/i);
    const withoutCount = countMatch ? before.slice(0, countMatch.index) : before;
    const label = (withoutCount.match(/[A-Za-z][A-Za-z &/.'-]*$/) || [''])[0]
      .replace(/\s+/g, ' ')
      .trim();

    if (!label) continue;

    rows.push({
      label,
      itemCount: countMatch ? Number(countMatch[1]) : null,
      amount: Number(match[2].replace(/,/g, '')) * (match[1] === '-' ? -1 : 1),
    });
  }

  return rows;
}

function parsePricingBreakdown(bodyText, { label = 'page' } = {}) {
  const flat = flatten(bodyText);

  // The summary block. Anchored on whichever heading this page uses; Payment
  // Summary has never been measured (reaching it mints a real order), so its
  // heading is matched permissively and the raw region is returned for a human
  // to read when classification comes up short.
  const startAt = flat.search(
    /Order Summary|Payment Summary|Price\s*\(\s*\d+\s*Items?\s*\)|Amount Payable/i
  );
  if (startAt < 0) return null;

  const endAt = flat.slice(startAt).search(/PCIDSS|Your payment is 100% safe|Continue|Proceed|Pay Now/i);
  const region = endAt > 0 ? flat.slice(startAt, startAt + endAt) : flat.slice(startAt);

  const rows = moneyRows(region);
  if (rows.length === 0) return null;

  const out = {
    label,
    productAmount: null,
    discount: null,
    deviceProtection: null,
    shipping: null,
    otherCharges: 0,
    total: null,
    itemCount: null,
    unclassified: [],
    rows,
    region,
  };

  for (const row of rows) {
    const hit = COMPONENT_PATTERNS.find(([, re]) => re.test(row.label));

    if (!hit) {
      // Not a line we know. It still costs the shopper money, so it counts
      // toward the total and is named in `unclassified` for the report.
      out.otherCharges += row.amount;
      out.unclassified.push(row);
      continue;
    }

    const [key] = hit;
    // Discount is displayed as a negative; carry it as a positive magnitude so
    // callers can write `product - discount + ...` and read like the page.
    const value = key === 'discount' ? Math.abs(row.amount) : row.amount;

    // A repeated label (the cart prints Subtotal as well as Total Amount) must
    // not silently overwrite the first reading.
    if (out[key] === null) {
      out[key] = value;
      if (key === 'productAmount' && row.itemCount !== null) out.itemCount = row.itemCount;
    }
  }

  return out;
}

// Product - discount + device protection + shipping + other charges.
//
// Returned rather than asserted so the caller controls the failure message, and
// so the same arithmetic can be shown for two pages side by side.
function expectedTotalOf(breakdown) {
  return (
    (breakdown.productAmount ?? 0) -
    (breakdown.discount ?? 0) +
    (breakdown.deviceProtection ?? 0) +
    (breakdown.shipping ?? 0) +
    (breakdown.otherCharges ?? 0)
  );
}

// A one-line-per-component rendering, for failure messages and logs.
function formatBreakdown(breakdown) {
  const money = (n) => (n === null || n === undefined ? '(absent)' : `₹${n.toLocaleString('en-IN')}`);
  return (
    `  product amount     ${money(breakdown.productAmount)}` +
    `${breakdown.itemCount !== null ? ` (${breakdown.itemCount} items)` : ''}\n` +
    `  discount          -${money(breakdown.discount)}\n` +
    `  device protection  ${money(breakdown.deviceProtection)}\n` +
    `  shipping           ${money(breakdown.shipping)}\n` +
    `  other charges      ${money(breakdown.otherCharges)}` +
    `${breakdown.unclassified.length ? ` [${breakdown.unclassified.map((r) => `${r.label} ${money(r.amount)}`).join(', ')}]` : ''}\n` +
    `  ---\n` +
    `  expected total     ${money(expectedTotalOf(breakdown))}\n` +
    `  displayed total    ${money(breakdown.total)}`
  );
}

module.exports = {
  toRupees,
  flatten,
  parsePlpTile,
  parsePdpHeader,
  parsePlanBox,
  parseAddOn,
  parseOrderSummary,
  parsePricingBreakdown,
  expectedTotalOf,
  formatBreakdown,
};
