# Performance Phase 2 — Feel Audit & Low-Risk Fixes

Branch: `cursor/boss-perf-phase2-feel-6f29`  
PR: `#228` (draft) — Preview Ready  
Base: `main` @ `#227` (auth overlay P0) — **not** mixed with `#226`.

Final acceptance checklist: [`AK-REPORT.md`](./AK-REPORT.md).

## Production root causes (measured)

1. **MPA full reload every nav** (`mine ↔ orders/messages/support/recharge/hall`)  
   - Each click downloads HTML + re-executes auth/header JS.
2. **`/src/*` served `Cache-Control: no-store`** (vercel.json)  
   - `role-gates.js` ~79KB, `boss-header.js` ~40KB, etc. re-downloaded on every page.
3. **Brand logo 638KB JPEG** used at 24–40px display size.
4. **Duplicate APIs per page**
   - `GET /api/chat?action=conversations` ×2–3 (header chat unread + page)
   - `GET /api/notifications?action=list` ×2–3 (boot + focus + visibility + poll)
   - Hall also duplicated `companion-levels` / `public/companions` / `platform/services` (out of Phase2 scope — Hall untouched)
5. **messages.html loaded unrelated bundles** (`commission-engine`, `unified-api`, `platform-contract`, `unified-config`) before chat.
6. **Click → white wait**: no immediate visual feedback on MPA anchors.

TTFB on Production HTML is already fast (~15–35ms). Slowness is mostly **repeat JS download + duplicate chrome APIs + huge logo + full reload architecture**.

## Fixes in this PR (low risk)

| Change | Why safe |
|---|---|
| `vercel.json`: `/src/*` → `max-age=3600, SWR=86400`; `portal-early-gate.js` short cache | Scripts already cache-busted with `?v=` |
| `meow-cuijiao-brand-96.webp/jpg` (~3KB) for header logos | Visual size unchanged; quality fine at 24–40px |
| `src/boss-profile-cache.js` 45s session cache for `/me` only | Not for balance/orders/unread |
| `src/boss-nav-prefetch.js` idle prefetch of shells | HTML/JS/CSS only — no sensitive realtime APIs |
| Header notify/chat **in-flight + 8s throttle** | Same data, fewer duplicate calls |
| mine click `is-nav-pending` feedback | CSS only |
| Strip unused scripts from `messages.html` | Chat still loads chat-api/ui/customer-chat |

## Non-goals / untouched

- `#227` auth semantics
- `#226` P1/P2/P5 UI
- Hall / Pricing / Order **business logic** / DB
- No SPA rewrite

## Metrics

See `docs/perf-phase2/prod-audit.json` (Production BEFORE) and Preview AFTER artifacts after deploy.
