---
name: refresh-session
description: Refresh the saved BytePe login session in auth.json by running the headed auth spec and waiting for a manually typed OTP.
disable-model-invocation: true
---

Re-authenticate against www.bytepe.com and rewrite `auth.json`. This opens a real browser and logs into a real account, so it only runs when the user asks.

Run it when a login-gated spec fails with "Saved login session is unusable" from `tests/utils/session.js`, or when a flow times out waiting for an element that only renders for a logged-in user.

## Steps

1. Confirm `BYTEPE_MOBILE` is set: `echo $env:BYTEPE_MOBILE` (PowerShell). If it's empty, stop and tell the user to run `setx BYTEPE_MOBILE "<number>"` and open a new terminal — `setx` does not affect the current session.

2. Check what the current session looks like before overwriting it, so you can report what changed:
   `node -e "const s=require('./auth.json');const t=(s.cookies||[]).find(c=>c.name==='access_token');console.log(t?new Date(t.expires*1000).toISOString():'no access_token')"`

3. Run `npm run auth`. This is `playwright test auth-setup.spec.js --project=chromium --headed` with a 180s timeout. It either detects an already-valid session and re-saves it, or drives the login form.

4. The spec pauses for the OTP. Tell the user plainly: type the OTP in the browser window, then click **Resume ▶** in the Playwright Inspector. Do not try to read, guess, or automate the OTP.

5. When it finishes, verify `auth.json` was actually rewritten — re-run the check from step 2 and confirm the `access_token` expiry moved forward. If there is still no `access_token` cookie for `www.bytepe.com`, the login did not take; report that rather than declaring success.

6. Remind the user `auth.json` is gitignored and must stay uncommitted.

If the user's goal was to unblock a specific failing spec, offer to re-run that spec — but ask first, since it hits production.
