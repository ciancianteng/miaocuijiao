# P0 — Production smoke/E2E order pollution (2026-09-14)

**Status:** Root cause confirmed. Guards in this PR. **No Production deletes yet.**

Formal order numbers are `MCJO######` (UI may show `MCJ0000350` for `MCJO000350`).

## A. Root cause

After PR **#250** merged (`cf1c643`, 2026-09-14 07:51 UTC), an **ad-hoc live Web Push business-event E2E** ran against **Production** using the **real owner session**:

| Field | Value |
|---|---|
| Boss | 1717 / `MCJ00015` / `458ce9ad-3425-42b1-ab66-24bca342f971` (ciancianteng@gmail.com) |
| Companion (paid rows) | 瑞秋 / `PW00012` / `400289d7-a796-47ae-aae4-fc2c96dde08d` (25 猫粮/小时 无畏契约) |
| Marker | titles `WP-BIZ-E2E-*`, notes `webpush-biz-e2e-complete` / `webpush-cancel` / `webpush-started` |
| Window | 2026-09-14 08:16–08:37 UTC |

Repo `scripts/web-push-business-events-smoke.mjs` is **offline** and did not create these rows. The live harness was **not committed**. Existing Production API guard only blocked `@meow.test` / `ProdSmoke*` callers — a **real** login could still place/pay/complete.

Older pollution (still present, not this incident’s 350–355):

- **2026-09-02** PR #136 OTP smoke → `MCJO000342–344` (`ProdSmoke*` / `PROD-REFERRAL-SMOKE`)
- **2026-09-07** PR180 E2E → `MCJO000345–349` (`P0 Boss` @meow.test, and **九纹祥 → 1717/PW00021**)

Why 1717 was used as companion in Sep 7: several E2E scripts treated hall nickname `/1717/` as a test fixture, then fell back to `comps[0]`.

## B. Affected orders (read-only)

| order_no | created_at (UTC) | boss | companion | amount | status | class |
|---|---|---|---|---|---|---|
| MCJO000350 | 2026-09-14 08:16 | 1717 / MCJ00015 | 瑞秋 / PW00012 | 25 | **completed** | WP-BIZ-E2E-A (this incident) |
| MCJO000351 | 2026-09-14 08:22 | 1717 / MCJ00015 | 瑞秋 / PW00012 | 25 | claimed | WP-BIZ-E2E-B |
| MCJO000352 | 2026-09-14 08:28 | 1717 / MCJ00015 | 瑞秋 / PW00012 | 25 | cancelled | WP-BIZ-E2E-C unpaid cancel |
| MCJO000353 | 2026-09-14 08:29 | 1717 / MCJ00015 | (none) | 0 | awaiting_payment | WP-BIZ-E2E-D |
| MCJO000354 | 2026-09-14 08:32 | 1717 / MCJ00015 | 瑞秋 / PW00012 | 30 | in_progress | WP-BIZ-E2E-D3 |
| MCJO000355 | 2026-09-14 08:37 | 1717 / MCJ00015 | 瑞秋 / PW00012 | 25 | cancelled | WP-BIZ-E2E-E3 |
| MCJO000348–349 | 2026-09-07 | 九纹祥 / MCJ00019 | **1717 / PW00021** | 30 | cancelled | PR180 E2E |
| MCJO000345–347 | 2026-09-07 | P0 Boss / MCJ00007 | ProdSmokeService / hall | 30 | pending / awaiting / completed | PR180 E2E |
| MCJO000344 | 2026-09-02 | ProdSmokeBoss2 | ProdSmokeService2 | 6000 | completed | prior smoke |

`orders.payment_status` column **does not exist**. Payment is `status` + `wallet_transactions`.

## C. Real accounts touched

- **1717 / MCJ00015 / PW00021** (owner dual-role) — boss of 350–355; companion of 348–349
- **瑞秋 / PW00012 / MCJ00013** — companion of 350–352, 354–355
- **九纹祥 / MCJ00019** — boss of 348–349 (gmail, not flagged `is_test_account`)

## D. Finance

1717 wallet (`wallets.total_spent=80`, `total_balance=470` after last debit):

| tx | order | debit | after |
|---|---|---|---|
| order_payment | MCJO000350 | 25 | 475 |
| order_payment | MCJO000351 | 25 | 450 |
| order_payment | MCJO000354 | 30 | 470 |

Homepage `https://www.meowcuijiao.com/api/home/daily-stats` on 2026-09-14: `completedOrders=1`, `todayOrders=3`, `grossRevenue=80` — that **is** 350+351+354. Test-account filter did **not** hide them because 1717/瑞秋 are real.

MCJO000350 note: `[[SETTLEMENT_SKIPPED]]settlement_flag_disabled` — companion earnings / platform settlement **not** written for that complete. 瑞秋 hall `completedOrders` stayed 0.

九纹祥 was debited 30 猫粮 for MCJO000348 (then cancelled). P0 Boss wallet was debited for 345/347 (test wallet).

## E. Fix in this PR (no deletes)

1. Treat `WP-BIZ-E2E` / `PR180` / `e2e` / `ProdSmoke` order text as test **even on real parties** → homepage/admin stats exclude them.
2. Production hard-fails place/pay/complete/cancel/CS create/marketplace/companion grab when payload or existing order is automation-marked.
3. Stop E2E hall fallback onto nickname `1717` / `瑞秋`.
4. `prod-guard` refuses Production BASE and protected public IDs.
5. Optional `orders.is_test` column (Staging may set it; Production still refuses the write).

## F. Data cleanup (NOT executed)

Needs explicit human approval. Candidate **test-only** rows: MCJO000345–355 plus prior 342–344. Must refund 1717 **80 猫粮** (350+351+354) and 九纹祥 **30** if 348 was not refunded. Do not delete MCJO000342 (033 / 手瓦上分) unless separately confirmed test.

## G. Tests

Offline: `node scripts/smoke-prod-guard.mjs`, `node scripts/smoke-test-accounts-guard.mjs`, `node scripts/verify-dashboard-test-filter.mjs`, `node scripts/verify-home-daily-stats.mjs`.
