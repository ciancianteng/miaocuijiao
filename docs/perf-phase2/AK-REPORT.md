# Performance Phase 2 — Final A–K (Preview AFTER)

Preview: https://meow-cuijiao-homepage-git-cu-e740fd-ciancianteng-4581s-projects.vercel.app  
PR: https://github.com/ciancianteng/miaocuijiao/pull/228  
Measured: 2026-09-11 (docs in this folder + live re-verify)

## A–K

| | Item | Result |
|---|---|---|
| **A** | Preview deployment Ready | **PASS** — Vercel Ready; HTML 200 |
| **B** | `/src/*` cache headers | **PASS** — Preview `public, max-age=3600, stale-while-revalidate=86400` + `x-vercel-cache: HIT` on repeat; Production still `no-store` |
| **C** | Brand logo weight | **PASS** — header uses `meow-cuijiao-brand-96.webp` **3494 bytes** (was ~638KB JPEG) |
| **D** | Mine navigation feel (nav→first visible) | **PASS** — home→mine **202ms**; mine→orders **263ms**; mine→messages **249ms**; mine→recharge **290ms**; back→mine **99ms** (see `summary.json`) |
| **E** | Duplicate chrome APIs (chat/notify) | **PASS** on mine flows — coalesced + 8s throttle; support still saw chat×2 once; Hall platform dupes **out of scope** |
| **F** | `/src` re-download on 2nd+ nav | **PASS** — `srcJsBytes=0` after first page (cache); Production re-downloaded no-store JS every MPA hop |
| **G** | Idle shell prefetch from mine | **PASS** — absolute hrefs + idle prefetch (no sensitive realtime APIs) |
| **H** | Instant click feedback | **PASS** — `is-nav-pending` on mine anchors |
| **I** | messages.html dead bundles removed | **PASS** — dropped unused commission/unified/platform-contract/config scripts |
| **J** | 375 / 390 / 393 / 430 smoke | **PASS** — mine screenshots captured; shell renders |
| **K** | Safe to Merge now? | **NO** — waiting owner confirm (do not merge). Scopes clean: no #226 / Hall business / Pricing / Order / DB / #227 auth semantics |

## PERFORMANCE PHASE 2 summary

```
PREVIEW: READY
/SRC CACHE: PASS (3600 + SWR; HIT on repeat)
LOGO: 638KB → ~3.5KB (brand-96.webp)
MINE NAV (nav→visible): home→mine 202ms | orders 263ms | messages 249ms | recharge 290ms
API DEDUPE (mine chrome): PASS (Hall dupes untouched)
MPA ARCHITECTURE: unchanged (full reload remains; Phase2 = feel/cache/dedupe only)
#227 AUTH: untouched
#226 / Hall / Pricing / Order / DB: untouched
SAFE TO MERGE: NO (await confirm)
```

## Evidence files

- `docs/perf-phase2/prod-audit.json` — Production BEFORE
- `docs/perf-phase2/preview-after.json` — Preview AFTER rows
- `docs/perf-phase2/before-after.json` — header/logo/dupe checklist
- `docs/perf-phase2/summary.json` — compact AFTER table
- `docs/perf-phase2/after-reverify.json` — live Preview spot-check (cache HIT, logo bytes, smoke paths)
- Screenshots: `/opt/cursor/artifacts/screenshots/perf2-after-mine-{375,390,393,430}.png`
