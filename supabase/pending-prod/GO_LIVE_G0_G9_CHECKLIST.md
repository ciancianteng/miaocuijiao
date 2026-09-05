# Production 上线前最终 Checklist（G0–G9）— 本轮准备进度

**更新时间：2026-09-05**  
**本轮约束：** 未执行 Production migration；未 apply 任何 Production SQL；未 DELETE smoke；未开启 settlement flag。

---

## 总判定

| 项 | 结论 |
|---|---|
| 代码层可准备项 | **已完成**（G4–G8 代码 + G0–G2/G7/G9 SQL review + G3 分析） |
| 是否可 apply 01–05 | **否 — 需人工批准** |
| 是否可开启结算/积分 | **否 — G0–G9 Production 落地未全绿** |

---

## G0–G9 本轮状态

| Gate | 本轮准备状态 | Production 落地 | 说明 |
|---|---|---|---|
| **G0** | ✅ SQL review + apply 清单就绪 | ❌ 未 apply | `G0_APPLY_LIST_SQL_REVIEW.sql`；01–05 均为 IF NOT EXISTS / 可空 ADD；不会覆盖既有行 |
| **G1** | ✅ 列方案 + SQL review | ❌ 未 apply | `G1_IS_TEST_ACCOUNT_SQL_REVIEW.sql`；`default false` |
| **G2** | ✅ 11 id UPDATE SQL review + 影响范围 | ❌ 未执行 | `G2_MARK_TEST_ACCOUNTS_SQL_REVIEW.sql`；Production 只读核对 11 id 均存在 |
| **G3** | ✅ 代码路径分析完成 | ❌ 缺真实 admin | 唯一 admin=`admin@meow.test`；真实 admin 不会被 test 过滤误伤 |
| **G4** | ✅ 代码完成 + 离线验证通过 | 待部署 | disposable 域覆盖；Dashboard 排除 RM6000 smoke GMV |
| **G5** | ✅ 代码完成 + fail-closed | 待部署 | `_boss-commission`：flag off + test party skip |
| **G6** | ✅ 代码完成 + fail-closed | 待部署 | `_user-points` award/clawback：flag off + test skip |
| **G7** | ✅ 策略 SQL review | ❌ 列未创建 | 仅可空 ADD；禁止历史/smoke 自动回补 |
| **G8** | ✅ 代码完成 | 保持关闭 | `SETTLEMENT_ENABLED` / `POINTS_AWARD_ENABLED`；Prod 默认 unset=关 |
| **G9** | ✅ 验收 checklist 就绪 | ❌ 未签字 | `G9_GO_LIVE_ACCEPTANCE_CHECKLIST.md` |

---

## 离线验证（本轮已跑）

- `scripts/smoke-test-accounts-guard.mjs` → PASS
- `scripts/verify-settlement-guards.mjs` → PASS（Prod 默认 settlement/points = false）
- `scripts/verify-dashboard-test-filter.mjs` → PASS（RM6000 smoke 不计入 totalAmount）

---

## 需人工确认

1. Production 正式 admin 邮箱（非 `@meow.test` / 非 guerrilla），并验证可登录后台
2. 目标库 host 与 backup/PITR 窗口（apply 前）
3. `02` 末尾 `platform_settings` 可选 UPDATE 是否在目标库执行
4. G9 对账三方签字人

## 需批准后才能执行的 Production 操作

1. Apply pending-prod **01→05**
2. Apply **G1** `is_test_account` DDL
3. 执行 **G2** 精确 UPDATE（11 ids + companion 镜像）— **必须在真实 admin 就绪后**
4. 部署含 G4–G8 的应用版本
5. （更后）开启 `SETTLEMENT_ENABLED` / `POINTS_AWARD_ENABLED` — **仅在 G0–G9 全绿且签字后**
6. （另单）历史正式订单 `platform_fee` 人工回补 — **禁止与首开绑定；禁止回补 smoke**

**禁止清单（本轮已遵守）：** 不删除 smoke；不 DROP；不直接 UPDATE Production；不开启 settlement flag。
