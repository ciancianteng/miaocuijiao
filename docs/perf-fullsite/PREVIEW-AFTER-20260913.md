# Preview AFTER (partial) — 2026-09-13

Preview: `https://meow-cuijiao-homepage-git-cu-f1d74e-ciancianteng-4581s-projects.vercel.app`  
Commit: `cc7372b` (+ follow-up CDN header fix)

## API BEFORE (Production) → AFTER (Preview)

| API | Prod BEFORE p50 | Preview AFTER cold | Preview AFTER warm p50 | Notes |
|---|---:|---:|---:|---|
| `/api/public/companions` | **3150ms** (n=8) | **723ms** (n=2) | **604ms** | List skips voice/video signing; CC public |
| `/api/home/daily-stats` | 655ms | 676ms | **233ms** | `X-MCJ-Mem-Cache: HIT` on warm |
| `/api/platform/services` | 296ms | 275ms | 277ms | CC public |
| `/api/platform/content?types=banners` | 293ms | 280ms | 274ms | still no-store (intentional for now) |

### Caveats (honest)
- Preview companion **count = 2** vs Prod **8** — env/DB divergence; not a visibility-rule change.
- First Preview measure still showed `cdn-cache-control: no-store` from `/api/(.*)` merge — **fixed** by placing allow-list **after** catch-all and dropping CDN no-store from catch-all. Re-measure CDN HIT after next Preview deploy.
- Hall browser check: `共 2 位陪玩`, `emptyHidden=true`, cards=2 — **no fake empty**.
- Hall still double-fetches companions/services (taxonomy refresh) — follow-up candidate.
- Orders/mine redirected to login (expected without session) — auth-page timings still pending.

## Fake-empty status
| Surface | Status |
|---|---|
| Companion hall | **Fixed** — loading skeleton; never `共 0` / empty mid-fetch |
| Home daily-stats | **Fixed** — shows 正在加载… before empty |
| Home popularity | Already had loading guard |

## Merge
**BLOCKED** — wait for CDN HIT re-verify + human acceptance.
