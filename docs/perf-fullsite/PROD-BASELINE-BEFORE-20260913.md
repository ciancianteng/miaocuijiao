# Production BEFORE baseline (2026-09-13)

Measured against **live Production** `https://www.meowcuijiao.com` **before** this perf PR is merged.

Source JSON: `artifacts/perf-fullsite-p0/prod-baseline-before.json`

## Pages (HTML document fetch, n=3)

| Page | p50 | min | max | bytes |
|---|---:|---:|---:|---:|
| `/` | 96ms | 78 | 99 | 255609 |
| `/companion-center.html` | 50ms | 47 | 55 | 11642 |
| `/profile.html` | 52ms | 50 | 58 | 2711 |
| `/orders.html` | 64ms | 60 | 65 | 56687 |
| `/support.html` | 53ms | 50 | 61 | 2907 |
| `/mine.html` | 54ms | 53 | 58 | 56230 |
| `/companion/` | 50ms | 49 | 52 | 2129 |
| `/admin.html` | 50ms | 49 | 55 | 19032 |

HTML shells are fast. **Perceived slowness is API / data / empty-flash**, not HTML TTFB.

## First-paint APIs (n=5)

| API | p50 | p95 | min–max | Cache-Control on Prod |
|---|---:|---:|---|---|
| `GET /api/public/companions` | **3150ms** | **3864ms** | 2857–3864 | `no-store` (MISS) |
| `GET /api/home/daily-stats` | **655ms** | 722ms | 630–722 | `no-store` |
| `GET /api/platform/services` | 296ms | 318ms | 293–318 | `no-store` |
| `GET /api/platform/content?types=banners` | 293ms | 296ms | 285–296 | `no-store` |

Companions list returned **8** approved companions.

## Root causes confirmed

1. **Companions list origin ~3.1s p50** — media signed-URL work + no CDN cache on Production (perf allow-list not merged yet).
2. **Fake empty UX** — hall HTML/`render()` could show `共 0` / empty copy before fetch settled (fixed on this branch via `state.loading` + skeleton).
3. **`vercel.json` header order** — public API allow-list must precede `/api/(.*)` no-store catch-all so CDN SWR actually applies after merge.

## Not claimed as PASS

- No Lighthouse-only score
- No Merge until human acceptance + Preview AFTER re-measure
