// tests/utils/apiRetry.js
//
// These specs hit the live production API, and a full `npm run regression` runs
// many of them at once. Under that load the origin starts returning 429, which
// has nothing to do with the contract being tested — a rate-limited run reports
// a broken API when the API is fine.
//
// Retries only the statuses that mean "ask again later". A 404 or a 500 is a
// real answer and is returned to the caller untouched, so a genuine failure
// still fails.

const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

// 2s + 4s + 8s + 16s = 30s of waiting across 5 attempts. A first pass with 4
// attempts and a 1s base gave up after 7s and the origin was still returning
// 429, so the window is wider than that. Kept under the 60s setTimeout these
// specs declare, so a genuinely down API still fails rather than hanging.
const DEFAULTS = { attempts: 5, baseDelayMs: 2000 };

// Note: leaves `failOnStatusCode` to the caller. Passing `true` would make the
// request throw on 429 before this ever sees the status, defeating the retry.
async function getWithRetry(request, url, options = {}, retry = {}) {
  const { attempts, baseDelayMs } = { ...DEFAULTS, ...retry };

  let res;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    res = await request.get(url, options);
    if (!RETRYABLE_STATUSES.has(res.status())) return res;
    if (attempt === attempts) break;

    // Honour Retry-After when the origin sends one; otherwise back off
    // exponentially: 1s, 2s, 4s.
    const retryAfter = Number(res.headers()['retry-after']);
    const delayMs =
      Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : baseDelayMs * 2 ** (attempt - 1);

    console.log(`  ${res.status()} from ${url} — retrying in ${delayMs}ms (${attempt}/${attempts - 1})`);
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }

  return res; // still rate-limited after every attempt; let the caller assert
}

module.exports = { getWithRetry, RETRYABLE_STATUSES };
