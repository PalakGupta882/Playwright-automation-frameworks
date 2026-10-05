// tests/utils/createOrder.js
//
// WATCH THE ORDER BEING CREATED, SO A REFUSAL READS AS A REFUSAL.
//
// Pressing Continue on Review Order fires
//
//   POST /api/customer-order/v2/create-order?payment_type=UPFRONT|SUBSCRIPTION
//
// and the client navigates to Payment Summary only if that answers 2xx. When it
// does not, the page stays on Review Order and renders NOTHING — the refusal is
// logged to the console and never surfaced. Measured 1 Sep 2026:
//
//   400 POST .../create-order?payment_type=UPFRONT
//   {"status":false,"code":400,"message":"Stock not available for one or more products."}
//   CONSOLE ERROR: createOrderV2 (UPFRONT) failed {status: 400, data: Object}
//
// A caller that only waits for the Payment Summary URL therefore fails with
//
//   TimeoutError: page.waitForURL: Timeout 90000ms exceeded
//
// ninety seconds later, naming the navigation instead of the cause. Both upfront
// Payment Summary tests failed exactly that way and it took a network capture to
// find out that the server had answered immediately, in full sentences.
//
// Same rule as everywhere else in this suite: confirm an action by its request,
// not by what the page did afterwards, and name the field rather than the
// symptom. This also proves whether an order was minted — which matters here
// more than usual, because these are the tests that mint real ones.

const CREATE_ORDER = /\/customer-order\/v2\/create-order/;

// Arms the listener BEFORE the click, because create-order can answer faster
// than the click promise resolves.
function watchCreateOrder(page, timeout = 90000) {
  return page
    .waitForResponse(
      (res) => CREATE_ORDER.test(res.url()) && res.request().method() === 'POST',
      { timeout }
    )
    .catch(() => null);
}

// Reads the verdict off the armed watcher. Returns a plain object rather than
// throwing, so the caller decides whether a refusal is a failure or a skip.
async function readCreateOrder(watcher) {
  const res = await watcher;
  if (!res) {
    return {
      sent: false,
      ok: false,
      status: null,
      message:
        'Continue was clicked and no POST create-order was sent at all. The control is ' +
        'inert — no handler bound, or a client-side guard that renders no message.',
    };
  }

  let body = '';
  try {
    body = await res.text();
  } catch {
    body = '';
  }

  let message = body.slice(0, 300);
  try {
    const parsed = JSON.parse(body);
    if (parsed && typeof parsed.message === 'string') message = parsed.message;
  } catch {
    // Not JSON. The raw prefix above is what there is to report.
  }

  // body: the raw response, for callers that need the minted orders[] (bpid,
  // amount) and not just the verdict.
  return { sent: true, ok: res.ok(), status: res.status(), message, url: res.url(), body };
}

// The sentence a failing test should carry. Kept here so all three call sites
// report a refusal identically.
function createOrderFailure(verdict) {
  if (!verdict.sent) return verdict.message;
  return (
    `The site REFUSED to create the order: ${verdict.status} — "${verdict.message}"\n` +
    'No order was minted. Review Order renders nothing when this happens, so the ' +
    'shopper presses Continue and is told nothing at all; the only trace is a ' +
    'console error. This is the refusal, not a navigation timeout.'
  );
}

module.exports = { watchCreateOrder, readCreateOrder, createOrderFailure, CREATE_ORDER };
