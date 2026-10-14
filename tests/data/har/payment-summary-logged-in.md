# Journey 2 — Payment Summary, logged in (galaxy-m47-5g/SAMSAMOBW4IQZM)

> **INCOMPLETE** — the journey failed before the end. This is a partial capture.

- Captured: 2026-09-28T06:42:03.268Z
- HAR: `tests/data/har/payment-summary-logged-in.har` (gitignored, unmasked)
- `/api/` calls: 8 of 270 requests in the HAR
- `access_token` cookie sent on 3 of 8 calls; Authorization header on 0
- Token cookies are set by: `POST /api/auth/verify-otp`
- Flow: homepage → Login drawer → Send OTP → Verify OTP → PDP → Add to cart → /cart → /review → Continue → /payment-summary.
- Basket checks (GET /cart) made outside the browser are not in the HAR.
- Masked: phone number, OTP, token values, JWTs, and any JSON field named like token/otp/user_id/mobile/phone.

| # | Method | URL | Status | Request body | Authorization header | `access_token` cookie sent | Sets cookies | Response cache-control |
|---|---|---|---|---|---|---|---|---|
| 1 | GET | `https://www.bytepe.com/api/product-service/apps/home-page/nav?page_type=home` | 200 | — | No | No | — | `public, max-age=60, s-maxage=300, stale-while-revalidate=86400` |
| 2 | GET | `https://www.bytepe.com/api/product-service/apps/home-page/sections?home_page_id=2fab4e12-00ce-4732-a143-7d5f1d212a74&sub_home_page_id=0c64e547-f0e5-4219-99e4-14326e88c78d&platform=desktop&eager=5` | 200 | — | No | No | — | `public, max-age=60, s-maxage=300, stale-while-revalidate=86400` |
| 3 | GET | `https://www.bytepe.com/api/product-service/apps/home-page/sections/568f9622-c5cf-45b2-a15b-87decdc86cd5?home_page_id=2fab4e12-00ce-4732-a143-7d5f1d212a74&sub_home_page_id=0c64e547-f0e5-4219-99e4-14326e88c78d&platform=desktop` | 200 | — | No | No | — | `public, max-age=60, s-maxage=300, stale-while-revalidate=86400` |
| 4 | POST | `https://www.bytepe.com/api/auth/login` | 200 | `{"emailOrPhone":"***","loginType":"OTP","role_type":"customer"}` | No | No | — | `private, no-store` |
| 5 | POST | `https://www.bytepe.com/api/auth/verify-otp` | 200 | `{"user_id":"***","otp":"***"}` | No | No | `access_token, refresh_token, bp_user_v2` | `private, no-store` |
| 6 | GET | `https://www.bytepe.com/api/users/get-user-details` | 201 | — | No | Yes | — | `private, no-store` |
| 7 | GET | `https://www.bytepe.com/api/products/pre-approved?page=1&limit=12` | 200 | — | No | Yes | — | `private, no-store` |
| 8 | GET | `https://www.bytepe.com/api/users/get-user-details` | 201 | — | No | Yes | — | `private, no-store` |
