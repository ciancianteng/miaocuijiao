# Full-site Performance — Phase 1 PROFILE + low-risk quick wins

**Branch:** `cursor/full-site-perf-optimize-6f29`  
**Base:** `main` @ `faf64fe` (merge #239 OTP delivery P0 hotfix)  
**PR title:** `perf: full-site loading and runtime performance optimization`  
**Scope rule:** independent Performance PR — not mixed with #234 PWA / #238 i18n / #239 OTP / UI acceptance PRs.

## Measurement method (BEFORE)

| Layer | How measured | File |
|---|---|---|
| HTML / API TTFB | urllib against Production `https://www.meowcuijiao.com` | [`baseline-prod-before.json`](./baseline-prod-before.json) |
| Nav feel / dup APIs | prior Phase-2 browser audit (APIs mocked for paint) | [`../perf-phase2/prod-audit.json`](../perf-phase2/prod-audit.json) |
| Bundle sizes | local `dist/assets` after `vite build` on base | see static section below |

> Lab FCP/LCP/INP require Preview deploy + Playwright. Phase 1 ships reproducible **server/API/static** numbers first; Phase 5 fills browser Web Vitals BEFORE/AFTER on Preview.

### Production API baseline (2026-09-12)

| Endpoint | Cold | p50 (3×) | Bytes | Cache |
|---|---:|---:|---:|---|
| `GET /api/public/companions` (8 rows) | **3.04s** | **2.78s** | 35.6KB | `no-store` |
| `GET /api/home/daily-stats` | **1.15s** | **0.72s** | 0.9KB | `no-store` |
| `GET /api/platform/services` | 0.32s | 0.29s | 4.7KB | `no-store` |

HTML document TTFB is already fast (~50–90ms). Perceived 5–7s waits are **API + JS re-exec + empty shell**, not HTML TTFB.

### Static / transfer baseline

| Asset | Bytes | Notes |
|---|---:|---|
| Homepage HTML | ~256KB | large inline CSS/markup |
| `/src/assets/meow-cuijiao-brand.jpg` (header still used on prod) | **638,486** | displayed ~40×40 |
| `/assets/meow-cuijiao-brand-96.webp` | **3,494** | already on CDN; header should use this |
| `role-gates.js` | ~83KB | downloaded on most boss pages |
| `boss-header.js` | ~42KB | |
| Hashed `index-*.js` | ~236KB | |
| Hashed `companion-workbench-*.js` | ~220KB | loaded on companion sub-routes |

### Nav feel baseline (from Phase-2 prod audit)

| Transition | click→first visible | settled | API count |
|---|---:|---:|---:|
| home cold | 477ms | 1304ms | 15 (dup chat×2, notify×2) |
| mine→orders | **4144ms** | 983ms | 7 |
| mine→hall | **4134ms** | 988ms | 14 |
| mine→messages | 186ms | 1004ms | 5 |

---

## TOP 10 PERFORMANCE BOTTLENECKS

| # | Bottleneck | Root cause | Current cost | Proposed fix | Expected improvement |
|---|---|---|---|---|---|
| 1 | Hall `GET /api/public/companions` | Per-companion **sequential** `resolvePlayableUrl` + **HEAD** for voice/video/gallery | **~2.7–3.9s** with only 8 companions; scales with N | Skip HEAD on list; parallel enrich; short CDN cache | List API **→ <800ms** warm; cold **→ <1.5s** |
| 2 | Homepage `daily-stats` full scans | 4× `limit=5000` table scans; always `no-store` | Cold **~1.2–1.8s**, warm **~0.7s** | Short public Cache-Control (30/60s); later aggregate table | Repeat home visits **~instant** from edge |
| 3 | Orders GET blocked on expire helpers | `await Promise.race(expire…, 1.5–2s)` on every list | Up to **~3.5s** added latency on unlucky races | Fire-and-forget expire; list returns immediately | Orders API TTFB drop **1–3s** on slow paths |
| 4 | Forced-ack N+1 | `pendingForcedForUser` loops `getAck` per announcement/rule | Extra **N DB round-trips** on companion/boss boot | Batch `listAcksForUser` once | Boot path **−100–400ms** when many forced items |
| 5 | MPA full reload + empty shell | Every nav re-downloads HTML/JS; no stale-while-revalidate UI | click→visible **~4s** on heavy pages | Prefetch shells; profile cache; skeleton-first (Phase 2+) | Warm nav **→ <1s** feel |
| 6 | Repeat `/api/auth?action=me` | Profile cache only wired on `mine.html` | Extra **200–300ms**/page | Wire `boss-profile-cache` on orders/messages/support/recharge | Drop duplicate `/me` within 45s TTL |
| 7 | Header brand JPEG | 638KB logo at 40px | +0.5–1s on slow links | Use `brand-96.webp` (~3.5KB) | **−635KB** transfer on home header |
| 8 | Wrong/missing DB indexes | `chat_messages` index migration; live table is `messages` | Slow chat/history queries under load | Migration on `messages` / `transactions` / reviews | Chat/history p95 drop (Phase 3 measure) |
| 9 | Global `/api/*` `no-store` | vercel.json forces no CDN cache for all APIs | Every public list hits origin | Allow-list short SWR for public companions + daily-stats | Edge HIT on warm navigations |
| 10 | Large unsplit pages | workbench ~220KB; admin classic ~1MB scripts | Slow companion/admin cold | Code-split (Phase 4) | Cold JS **−30–50%** on those routes |

---

## Phase 1 changes (this commit)

Low-risk, business-logic preserving:

1. **Hall list media** — `skipHead` on list path; `Promise.all` enrich; short Cache-Control; vercel allow-list for `/api/public/companions`.
2. **daily-stats** — short public cache headers + vercel allow-list.
3. **Orders GET** — expire helpers fire-and-forget (no await race).
4. **Content acks** — batch user acks for `pendingForcedForUser`.
5. **Indexes** — `supabase/migrations/20260912_perf_fullsite_indexes.sql` (messages/transactions/reviews/notifications/acks).
6. **Homepage brand** — header uses `/assets/meow-cuijiao-brand-96.webp` (+ jpg fallback).
7. **Profile cache + nav prefetch** — wired on `orders` / `messages` / `support` / `recharge`.
8. **Docs + baseline JSON** — this folder.

### Explicitly NOT changed (safety)

Orders pricing/payment, OTP, login semantics, hall visibility rules, gift/notify business logic, PWA four portals, i18n, admin business mutations.

---

## BEFORE / AFTER (Phase 1)

| Metric | BEFORE (prod) | AFTER (expected on Preview) | Status |
|---|---|---|---|
| `GET /api/public/companions` p50 | **2.78s** | **<0.8s** (skip HEAD + parallel; edge warm) | measure on Preview |
| `GET /api/home/daily-stats` warm | **0.72s** origin every time | **<50ms** edge HIT within 60s | measure on Preview |
| Orders GET expire wait | up to **3.5s** | **0ms** on request path | code-level |
| Home header brand | **638KB** jpg | **3.5KB** webp | code-level |
| Forced-ack DB round-trips | **N+1** | **1** | code-level |

Full page-level BEFORE/AFTER table (Homepage / Hall / Profile / Orders) completes in **Phase 5** after Preview deploy with Playwright.

---

## Phased plan (same PR)

| Phase | Focus | Status |
|---|---|---|
| 1 | Measurement + low-risk quick wins | **this PR slice** |
| 2 | API/request/cache (SWR client hall/orders, coalesce chrome APIs) | next |
| 3 | DB/query (apply indexes in Supabase; daily-stats aggregate) | next |
| 4 | Bundle/image/render (workbench split, thumbnails) | next |
| 5 | Production-like regression + Web Vitals BEFORE/AFTER | next |

---

## Regression / SAFE TO TEST

- Hall visibility filters unchanged (`hallVisible` / audit / test-account).
- Detail companion path still HEAD-gates tiny voice stubs.
- Orders expire still runs async (eventual consistency same as cron).
- Ack batching preserves same pending semantics.

**SAFE TO TEST: YES** (Preview only — do not merge until Phase 5 numbers + smoke).
