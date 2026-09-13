# Phase 2–5 status (Preview-only, Merge = BLOCKED)

## Implemented

| Item | Status | Notes |
|---|---|---|
| P0 companions origin latency | **improved (real)** | Parallel signed URLs + hall `summaryOnly` reviews; CDN allow-list |
| P0 Orders expire off GET path | **code (Phase1)** | Fire-and-forget |
| P0 OTP | **attributed** | Not caused by perf PR — `OTP-P0-ATTRIBUTION.md` |
| P1 daily-stats | **proven warm HIT** | CDN + `X-MCJ-Mem-Cache: HIT` |
| P1 forced-ack N+1 | **code (Phase1)** | `listAcksForUser` batch |
| P2 /api cache classification | **code + doc** | Allow-list only |
| P3 workbench split | **partial** | Dashboard boot skeleton; full route split deferred |
| P3 brand 96webp | **kept** | ~3.5KB + jpg fallback |
| Hall UX shell | **code** | Skeleton cards while list loads |

## REAL API BEFORE → AFTER (2026-09-12 agent measure)

Source: [`measured-phase25-preview.json`](./measured-phase25-preview.json)

| Endpoint | Prod BEFORE p50 | Preview AFTER cold | Preview AFTER warm p50 | Cache proof |
|---|---:|---:|---:|---|
| `GET /api/public/companions` | **3929ms** (n=8) | **1275ms** (n=2) | **186ms** | `x-vercel-cache: HIT` |
| `GET /api/home/daily-stats` | **686ms** | **528ms** | **180ms** | CDN HIT + `X-MCJ-Mem-Cache: HIT` |
| `GET /api/platform/services` | **324ms** | **268ms** | **76ms** | `x-vercel-cache: HIT` |

Notes:
- Preview companion **count** (2) ≠ Prod (8): Preview env/DB divergence — not a hall visibility-rule change in this PR.
- Warm companions **186ms < 800ms target**. Cold origin still >800ms; further DB/index work remains optional.
- These are **server fetch** latencies (RTT included), not Lab LCP/INP.

## Still required before READY FOR FINAL REVIEW

- [ ] Full `scripts/perf-fullsite-baseline.mjs` page table (home/hall/detail/orders/mine/workbench)
- [ ] Browser smoke: 4 login portals + OTP portals + i18n/PWA + order path
- [ ] Confirm no business regression
- [ ] Human final review

**Merge = BLOCKED. Not READY FOR FINAL REVIEW.**
