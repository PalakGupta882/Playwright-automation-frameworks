// tests/utils/writes.js
//
// The single opt-in gate for specs that create real, lasting state on the real
// production account.
//
// Why this exists: on 10 Aug 2026 a routine `npm test` left two real orders
// behind (CM1008266A1D25 and CM1008268BF164). Nothing malfunctioned — the
// subscription specs press Continue on Review Order, and that is the moment the
// order id is minted, before any payment step. They had been running that way
// for as long as the stale `auth.json` happened to be failing them fast; the
// expired token was the only thing standing between the default command and a
// real order. Refreshing the session to make the run meaningful removed it.
//
// So the gate cannot be "the session happens to be broken". It has to be
// explicit.
//
// Use for anything that mints an order, moves money, or leaves a record a human
// has to go and clean up. Ordinary cart writes are noisy but reversible and do
// not need this — reaching Review Order is safe, it is only the last click that
// is not.

const ENV_VAR = 'BYTEPE_ALLOW_WRITES';

function writesAllowed() {
  return process.env[ENV_VAR] === '1';
}

// Skip reasons are read by whoever finds the skip in a report months from now,
// so they name the consequence rather than just the flag.
function writeSkipReason(whatItCreates) {
  return (
    `${whatItCreates} on the live production account. ` +
    `Set ${ENV_VAR}=1 to run it deliberately.`
  );
}

module.exports = { writesAllowed, writeSkipReason, ENV_VAR };
