# P0 Multi Payment / Parent-Child / Confirm State — ROOT CAUSE

**Date:** 2026-09-22  
**Mode:** Production READ-ONLY for MCJO000392 / MCJO000394; no row mutations.

## Verdict (Git / Deploy)

| Question | Answer | Evidence |
|---|---|---|
| A. Feature never merged? | **NO** | PR **#266** MERGED 2026-09-20 (`b68a50d`) confirm/replace UI; PR **#281** MERGED 2026-09-21 (`2e763fc` / pay route `6350b99`) payment-confirm; PR **#265** pricing only |
| B. Merged but not deployed? | **PARTIAL / NOT PROVEN for SHA** | Prod `orders.html` contains `isMultiChild`, `parentOrderId`, `多人陪玩订单`, confirm UI; `payment-confirm.html` **200**. `/api/build-info` returns `"sha":""` → **PRODUCTION_SHA NOT PROVEN** |
| C. Merged + deployed, later regression? | **YES (API/schema regression)** | Code path assumes `orders.paid_at` + `orders.paid_cat_food`. **Prod columns missing** (`42703`). Select fallback jumped to **legacy without `parent_order_id`** → UI lost grouping |
| D. Backend yes / frontend no? | **NO** | Frontend confirm UI is present; backend grouping field stripped by select fallback |

**Classification: C (+ schema debt).** Features were merged into `origin/main` (`059185e`). Frontend bundle on Prod includes multi UI. Runtime failed because Prod schema lacked paid stamps → API dropped `parent_order_id`.

Pending SQL already existed, never applied on Prod: `supabase/pending-prod/07_orders_paid_at_paid_cat_food.sql`.

---

## Prod orders (READ-ONLY)

| Order | Role | parent_order_id | status | amount | companion |
|---|---|---|---|---|---|
| **MCJO000392** | **PARENT** `multi_group` | null | `in_progress` (incorrect for 1/2) | 70 | null |
| MCJO000393 | child | → 392 | `claimed` | 35 | 小灰灰 |
| **MCJO000394** | **CHILD** | → 392 | `in_progress` | 35 | 小宏 |

- Wallet: **1** debit `order-pay:MCJO000392` amount **70** (single parent payment — correct financially).
- Child count in DB: **2** with valid companion IDs + profiles.
- Why UI「共0位陪玩」: list API omitted `parent_order_id` → `childrenOf(parent)` empty.
- Why 394 top-level card: same — `isMultiChild` false without `parentOrderId`.
- Why parent「进行中」at 1/2: `aggregateParentStatus` mirrored strongest child (`in_progress`) instead of requiring ALL active children confirmed.

Artifacts: `artifacts/p0-multi-payment-fix/00-prod-mcjo392-394-readonly.json`, `01-prod-sha-schema.json`.

---

## Payment UX note

Catfood path: team → `payment-confirm.html?order=<parent>` → explicit `pay_order` → single wallet debit.  
Ledger proves payment ran once (~23s after create). User perception of “skipped payment / already paid” is consistent with wallet one-click after landing on payment-confirm, **not** with unpaid auto-claim. Still enforced: place stays `awaiting_payment`; no frontend status forge.

---

## Fix (this branch)

1. `server/api/orders.js` — select cascade keeps `parent_order_id` when `paid_*` / `cancel_reason` missing.
2. `server/api/_order-group.js` — `aggregateParentStatus` + `deriveMultiGroupState`: 1/N confirm → `claimed`; only ALL confirmed → `in_progress`.
3. `orders.html` — normalize `[[PARENT_ORDER]]` fallback; hide children; show avatars + ✅/⏱; status `等待陪玩确认（1/2）`; give-up CTA.
4. Offline verify: **20/20 PASS** including TEST 7b/7c/17.

Prior finance audit multi PASS → **NOT PROVEN / REGRESSION FOUND** until Staging re-run (see `artifacts/finance-audit/MULTI_ORDER_P0_REGRESSION_NOTE.md`).
