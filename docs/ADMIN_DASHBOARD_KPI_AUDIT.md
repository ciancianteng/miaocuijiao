# Admin dashboard KPI audit (今日营业额 30 猫粮)

## Verdict
**Not mock / not hardcoded.** The cards are real Production DB aggregates from `GET /api/admin/dashboard`.

Smoke / `is_test_account` / ProdSmoke / `@meow.test` orders **are already excluded**. The remaining **30 猫粮** comes from one **non-test** completed order.

## UI → API → compute

| Layer | File | Detail |
| --- | --- | --- |
| Cards | `src/admin-final-v1.js` (`renderDashboard`) | `今日营业额` ← `stats.todayAmount`; `平台利润` ← `stats.platformProfit`; `已完成订单` ← `stats.completed` |
| Mount | `admin.html` `#superStats` | Loaded via `admin-final-v1.js` |
| API | `GET /api/admin/dashboard` | `server/api/admin/dashboard.js` → `buildDashboardStats()` |

No hardcoded `30` / `6` / `1` in the card path. Unconfigured env returns all zeros (“不返回假统计”).

## Exact source of 今日营业额 = 30

| Field | Value |
| --- | --- |
| Order id | `f8c5a1da-e3c3-4384-870b-8b6eb335dca9` |
| `total_amount` | **30** |
| `status` | `completed` |
| `created_at` | `2026-09-07T14:47:24.901Z` (UTC today) |
| Boss | `xiangzai42@gmail.com` / 九纹祥 / `is_test_account=false` |
| Companion user | `ciancianteng@gmail.com` / 1717 / `is_test_account=false` |
| Companion code | PW00021 |

**平台利润 6** = `30 × 0.2` default platform share in `platformProfitOf()` when fee columns are absent on `orders`.

**已完成订单 1** = that same completed business order (all-time completed count after test filter).

## Smoke exclusion (working)

Today also has smoke orders (e.g. `boss@meow.test` + `ProdSmokeService`, amount 30) — **excluded** by `isTestTouchedOrder` / `indexProfilesForStats`.

`filter.excludedOrders` includes those smoke rows; they do **not** enter `todayAmount`.

## Hardening in follow-up code
Also merge `companion_profiles.is_test_account=true` user ids into the dashboard test set (profiles flag alone can lag).

## If product wants 30 gone
Do **not** delete the order. Options (ops, not this filter bug):
- Mark the relevant accounts `is_test_account=true` (explicit ops decision), or
- Leave as real business KPI (九纹祥 → 1717 completed order).
