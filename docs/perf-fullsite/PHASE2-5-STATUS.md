# Phase 2–5 status (Preview-only, Merge = BLOCKED)

## Implemented in this slice

| Item | Status | Notes |
|---|---|---|
| P0 companions origin latency | **code** | Parallel signed URL resolve; list `summaryOnly` reviews; skip HEAD (Phase1); CDN allow-list |
| P0 Orders expire off GET path | **code (Phase1)** | Fire-and-forget `void (async () => …)` |
| P0 OTP | **attributed** | Not caused by perf PR — see `OTP-P0-ATTRIBUTION.md` |
| P1 daily-stats | **code** | CDN allow-list + process mem cache 45s (`X-MCJ-Mem-Cache`) |
| P1 forced-ack N+1 | **code (Phase1)** | `listAcksForUser` batch |
| P1 companions detail resolve | **code** | List parallel; detail keeps HEAD |
| P2 /api cache classification | **code + doc** | Allow-list only; `CACHE-POLICY.md` |
| P3 workbench split | **partial** | Dashboard HTML boot skeleton; full route-level split deferred (monolith IIFE) |
| P3 brand 96webp | **kept (Phase1)** | 96×96 webp ~3.5KB; jpg fallback |
| Hall UX shell | **code** | Skeleton cards while list loads |

## Measurement gate (required before READY FOR FINAL REVIEW)

Re-run on **Preview** after deploy of this commit:

```bash
node scripts/perf-fullsite-baseline.mjs <PREVIEW_ORIGIN>
```

Record real BEFORE (prod) → AFTER (preview) — no estimates.

## Merge gate

Still **BLOCKED** until: Preview deploy + real AFTER numbers + OTP P0 PASS on Preview smoke + navigation/smoke checklist.
