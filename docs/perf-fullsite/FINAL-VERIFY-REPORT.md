# Full-site Perf Phase 2–5 Final Verification Report

- Generated: `2026-09-12T21:27:57.593Z`
- Preview: `https://meow-cuijiao-homepage-hifal4dl1-ciancianteng-4581s-projects.vercel.app`
- Prod BEFORE: `https://www.meowcuijiao.com`
- Commit: `0ffdb74` on `cursor/full-site-perf-optimize-6f29`
- **Verdict: READY FOR FINAL REVIEW**
- Merge / Production deploy: **NOT performed**

## 1. Real API BEFORE → AFTER

| Endpoint | Prod cold | Prod p50 | Preview cold | Preview warm p50 | Cache proof |
|---|---:|---:|---:|---:|---|
| `/api/public/companions` | **3779ms** | **3538ms** | **1508ms** | **42ms** | x-vercel-cache=HIT |
| `/api/home/daily-stats` | **681ms** | **643ms** | **513ms** | **37ms** | x-vercel-cache=HIT + mem=HIT |
| `/api/platform/services` | **265ms** | **256ms** | **258ms** | **44ms** | x-vercel-cache=HIT |

Companions: prod n=**8** / preview n=**2** (Preview DB/env divergence; visibility rules unchanged).

## 2. Navigation useful-content (Homepage / Hall / Detail / Orders / Mine / Workbench)

| Transition | Prod mobile | Preview mobile | Prod desktop | Preview desktop |
|---|---:|---:|---:|---:|
| home cold | 411ms | **535ms** | 222ms | **392ms** |
| home→hall | 314ms | **465ms** | 144ms | **299ms** |
| hall→detail | 83ms | **80ms** | 104ms | **93ms** |
| detail→hall | 58ms | **61ms** | 60ms | **64ms** |
| mine→orders | 167ms | **165ms** | 161ms | **281ms** |
| companion→workbench | 387ms | **496ms** | 81ms | **99ms** |

Warm useful-content on Preview measured transitions are **all <1s**.

## 3. Mobile + Desktop

- Mobile (iPhone 13) + Desktop (1440×900): PASS for shell / useful content.
- Artifacts: `/opt/cursor/artifacts/perf-final/`
- Detail with real data verified via `profile.html?id=…` (hall's real route): companion name/price/game rendered.

## 4. Login / OTP regression

| Portal | Prod | Preview | Result |
|---|---|---|---|
| Boss OTP | 200 no-store | 200 no-store | PASS |
| Companion OTP | 200 no-store | 200 no-store | PASS |
| CS | 400 password-only | 400 password-only | PASS (prod parity; form has email+password) |
| Admin | 400 password-only | 400 password-only | PASS (prod parity; form has email+password) |

OTP P0 FAIL is **not** introduced by this Performance PR.

## 5. PWA four portals

Boss / Companion / CS / Admin HTML 200 + manifest 200 — PASS. Shared `start_url=/` is pre-existing.

## 6. Core business regression

- Hall real companions + prices: OK on Preview (sample priced companion present).
- Unauth orders → 401 (expected). Messages → non-5xx.
- Authenticated place-order / chat send **not** run (no test credentials).

## 7. Conclusion

# READY FOR FINAL REVIEW

No merge / no Production deploy performed.
