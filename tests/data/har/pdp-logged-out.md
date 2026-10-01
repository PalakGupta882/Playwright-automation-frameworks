# Journey 1 — PDP, logged out (galaxy-m47-5g/SAMSAMOBW4IQZM)

- Captured: 2026-09-26T08:06:59.963Z
- HAR: `tests/data/har/pdp-logged-out.har` (gitignored, unmasked)
- `/api/` calls: 12 of 153 requests in the HAR
- `access_token` cookie sent on 0 of 12 calls; Authorization header on 0
- No call set a token cookie.
- Page: `https://www.bytepe.com/pd/galaxy-m47-5g/SAMSAMOBW4IQZM`
- Page loaded and left until /api/ was quiet for 4s. No scrolling or clicks.
- Masked: phone number, OTP, token values, JWTs, and any JSON field named like token/otp/user_id/mobile/phone.

| # | Method | URL | Status | Request body | Authorization header | `access_token` cookie sent | Sets cookies | Response cache-control |
|---|---|---|---|---|---|---|---|---|
| 1 | GET | `https://www.bytepe.com/api/product-service/apps/home-page/nav?page_type=home` | 200 | — | No | No | — | `public, max-age=60, s-maxage=300, stale-while-revalidate=86400` |
| 2 | GET | `https://www.bytepe.com/api/product-review/approved_product_review/cd5a5236-05b1-4297-9407-7a3e3977039b?page=1&limit=3` | 200 | — | No | No | — | `private, no-store` |
| 3 | GET | `https://www.bytepe.com/api/exchange/max-price` | 200 | — | No | No | — | `private, no-store` |
| 4 | GET | `https://www.bytepe.com/api/policy-service/policy/pg-config` | 200 | — | No | No | — | `private, no-store` |
| 5 | GET | `https://www.bytepe.com/api/apps/variant-pricing/galaxy-m47-5g/3a49fee6-ab65-4175-bf1a-847864b01c19` | 200 | — | No | No | — | `private, no-store` |
| 6 | GET | `https://www.bytepe.com/api/pricing-service/pricing/best-price?variantId=3a49fee6-ab65-4175-bf1a-847864b01c19` | 400 | — | No | No | — | `private, no-store` |
| 7 | GET | `https://www.bytepe.com/api/product-service/apps/products/galaxy-m47-5g/attributes` | 200 | — | No | No | — | `public, max-age=60, s-maxage=300, stale-while-revalidate=86400` |
| 8 | GET | `https://www.bytepe.com/api/product-service/apps/products/galaxy-m47-5g/available` | 200 | — | No | No | — | `no-store` |
| 9 | GET | `https://www.bytepe.com/api/faq` | 200 | — | No | No | — | `public, max-age=60, s-maxage=300, stale-while-revalidate=86400` |
| 10 | GET | `https://www.bytepe.com/api/product-service/apps/products/by-slug/galaxy-m47-5g/SAMSAMOBW4IQZM` | 200 | — | No | No | — | `public, max-age=60, s-maxage=300, stale-while-revalidate=86400` |
| 11 | GET | `https://www.bytepe.com/api/apps/product-vas/galaxy-m47-5g/SAMSAMOBW4IQZM` | 200 | — | No | No | — | `private, no-store` |
| 12 | GET | `https://www.bytepe.com/api/apps/variant-offers/galaxy-m47-5g/3a49fee6-ab65-4175-bf1a-847864b01c19?offer_type=EMI&payment_plan=UPFRONT` | 200 | — | No | No | — | `private, no-store` |
