// tests/utils/domProbe.js
//
// Describes the form controls on screen, for diagnostics.
//
// Used in two places on purpose: the login probe script prints it, and
// enterOtp() embeds it in the error it throws when no OTP field matches. That
// way the failure message already contains the information needed to fix it,
// instead of sending someone off to re-run a probe by hand.
//
// NEVER reports input values. These screens carry a phone number and a one-time
// code, and this output ends up in console logs, HTML reports and CI output.

// Keep the attributes that help identify a field; drop everything else.
async function describeInputs(page) {
  return page.locator('input').evaluateAll(nodes =>
    nodes.map((node, index) => ({
      index,
      type: node.type || null,
      name: node.name || null,
      id: node.id || null,
      placeholder: node.placeholder || null,
      autocomplete: node.getAttribute('autocomplete'),
      inputMode: node.getAttribute('inputmode'),
      maxLength: node.maxLength > 0 ? node.maxLength : null,
      ariaLabel: node.getAttribute('aria-label'),
      testId: node.getAttribute('data-testid'),
      className: (node.className || '').toString().slice(0, 60) || null,
      disabled: node.disabled,
      // offsetParent is null for display:none and for fixed-position elements;
      // good enough to tell a rendered field from a hidden one.
      visible: !!node.offsetParent,
    }))
  );
}

async function describeButtons(page) {
  return page.locator('button').evaluateAll(nodes =>
    nodes
      .filter(node => !!node.offsetParent)
      .map(node => ({
        text: (node.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 40),
        ariaLabel: node.getAttribute('aria-label'),
        disabled: node.disabled,
        type: node.type || null,
      }))
      .filter(b => b.text || b.ariaLabel)
  );
}

// One row per input, short enough to read in a terminal.
function formatInputs(inputs) {
  if (!inputs.length) return '  (no inputs on the page)';
  return inputs
    .map(i => {
      const bits = [
        `type=${i.type}`,
        i.name && `name=${i.name}`,
        i.placeholder && `placeholder=${JSON.stringify(i.placeholder)}`,
        i.autocomplete && `autocomplete=${i.autocomplete}`,
        i.inputMode && `inputmode=${i.inputMode}`,
        i.maxLength && `maxlength=${i.maxLength}`,
        i.ariaLabel && `aria-label=${JSON.stringify(i.ariaLabel)}`,
        i.testId && `data-testid=${i.testId}`,
        i.disabled && 'DISABLED',
        !i.visible && 'HIDDEN',
      ].filter(Boolean);
      return `  [${i.index}] ${bits.join(' ')}`;
    })
    .join('\n');
}

function formatButtons(buttons) {
  if (!buttons.length) return '  (no visible buttons)';
  return buttons
    .map(b => `  ${JSON.stringify(b.text || b.ariaLabel)}${b.disabled ? ' DISABLED' : ''}`)
    .join('\n');
}

// Counts each candidate locator so a failure says which ones missed, rather
// than leaving the next person to guess which of four was wrong.
async function countCandidates(candidates) {
  const counts = [];
  for (const [label, locator] of candidates) {
    counts.push(`${label}=${await locator.count().catch(() => '?')}`);
  }
  return counts.join(' | ');
}

// An OTP widget inside an iframe defeats every page-level locator in exactly
// the way we saw, so it is worth reporting explicitly.
async function describeFrames(page) {
  const frames = page.frames();
  if (frames.length <= 1) return 'frames: 1 (no iframes)';
  const counts = await Promise.all(
    frames.map(async f => `${f.url().slice(0, 60)}=${await f.locator('input').count().catch(() => '?')}`)
  );
  return `frames: ${frames.length} — inputs per frame: ${counts.join(' , ')}`;
}

module.exports = {
  describeInputs,
  describeButtons,
  formatInputs,
  formatButtons,
  countCandidates,
  describeFrames,
};
