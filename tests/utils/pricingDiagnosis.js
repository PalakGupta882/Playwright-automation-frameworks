// tests/utils/pricingDiagnosis.js
//
// The order in which a pricing discrepancy must be investigated.
//
//   1. Is it the SAME product?
//   2. Is it the SAME variant/SKU?
//   3. What does the API return?
//   4. Which API field is the UI displaying?
//   5. Does that field represent a price, an amount, a discount or a total?
//   6. Compare across Cart -> Review -> Payment.
//   7. Only then investigate arithmetic.
//
// This ordering is not stylistic. Steps 1-5 are cheap, need no order to be
// minted, and each of them can fully explain a difference that looks like
// broken maths. Step 7 is the expensive one and the one most likely to produce
// a confident, wrong bug report.
//
// It was arrived at the hard way. A Device Protection charge read ₹1 on Review
// Order and ₹2,001 on Payment Summary, and it was investigated as arithmetic
// for a long time. The actual answer was step 4: both figures were in the same
// API record — `vas_price: 1` and `vas_amount: 2001` — and the page was
// rendering the per-unit field where it should have rendered the total. No
// amount-comparison could have found that, because every page's own sums were
// correct.
//
// The helpers below exist to make step 4 as mechanical as steps 1-2 already are
// (tests/utils/surfaceIdentity.js).

// The canonical order, exported so a spec can log it and a failure message can
// say which step it reached.
const DIAGNOSTIC_STEPS = [
  'same product?',
  'same variant/SKU?',
  'what does the API return?',
  'which API field is the UI displaying?',
  'is that field a price, an amount, a discount or a total?',
  'compare across Cart -> Review -> Payment',
  'only then, arithmetic',
];

// Given a number shown in the UI and the candidate fields from the API payload,
// answer: which field is this actually?
//
// `candidates` is a flat object of fieldName -> value, e.g.
//   { vas_price: 1, vas_amount: 2001, care_plan: 0 }
//
// Returns every field the UI value matches. More than one match means the
// figures coincide and the UI cannot be told apart from the API by this test —
// which is itself worth reporting, because an assertion that passes on a
// coincidence is not evidence.
function fieldsMatching(uiValue, candidates = {}) {
  return Object.entries(candidates)
    .filter(([, value]) => Number(value) === Number(uiValue))
    .map(([field]) => field);
}

// The step-4 sentence, ready to drop into a failure message.
//
// Names the field the UI is actually showing rather than reporting a bare
// difference, so the bug report says "the page is rendering vas_price" instead
// of "Device Protection mismatch". Those are different bugs to fix and land on
// different people.
function explainDisplayedField({ uiValue, expectedField, candidates = {}, label = 'the UI' }) {
  const expected = candidates[expectedField];
  const matches = fieldsMatching(uiValue, candidates).filter((f) => f !== expectedField);

  const table = Object.entries(candidates)
    .map(([field, value]) => `      ${field.padEnd(24)} ${value}`)
    .join('\n');

  if (Number(uiValue) === Number(expected)) {
    return `${label} shows ${uiValue}, which is ${expectedField} — correct.\n${table}`;
  }

  const culprit = matches.length
    ? `${label} is displaying ${matches.join(' / ')} (${uiValue}), not ${expectedField} (${expected}).`
    : `${label} shows ${uiValue}, which matches no field the API returned — ` +
      `${expectedField} is ${expected}.`;

  return (
    `STEP 4 — WHICH API FIELD IS THE UI DISPLAYING?\n` +
    `    ${culprit}\n` +
    `    API fields:\n${table}\n` +
    `    Difference: ${Number(uiValue) - Number(expected)}\n` +
    '    Fix the field the page reads before treating this as an arithmetic fault.'
  );
}

// True when two candidate fields hold the same number, so any assertion
// distinguishing them is passing by coincidence. Specs should report this
// rather than claim a clean result.
function fieldsAreIndistinguishable(candidates, a, b) {
  return Number(candidates[a]) === Number(candidates[b]);
}

// A compact header for logs, so a run shows the order it is working in.
function diagnosticHeader(label) {
  return (
    `pricing diagnosis for ${label} — ` +
    DIAGNOSTIC_STEPS.map((step, i) => `${i + 1}. ${step}`).join('  ')
  );
}

module.exports = {
  DIAGNOSTIC_STEPS,
  fieldsMatching,
  explainDisplayedField,
  fieldsAreIndistinguishable,
  diagnosticHeader,
};
