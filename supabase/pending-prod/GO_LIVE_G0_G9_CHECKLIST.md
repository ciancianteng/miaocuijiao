# Production 上线前最终 Checklist（G0–G9）

**状态：CHECKLIST ONLY**  
**生成时间：2026-09-05**  
**依据：**
1. `supabase/pending-prod/01`–`05` migration 草稿 + `APPLY_RUNBOOK.md`
2. `SMOKE_TEST_ISOLATION_DESIGN.md`（11 个 smoke/test 账号 + 过滤/结算门禁）
3. 只读探测现状（未写库）

**本轮约束：** 未执行 migration；未 INSERT/UPDATE/DELETE；未修改 Production。

---

## 总判定

| 项 | 结论 |
|---|---|
| 是否可 apply 01–05 | **尚未授权；文档与 SQL 已就绪，但 G0 仍为未完成** |
| 是否可开启结算/积分入账 | **否。G0–G9 未全绿** |
| 当前最高阻断 | **P0：缺表/缺列 + smoke 未标记 + 写入门禁缺失 + 唯一 admin 为 test** |

---

## G0–G9 状态总表

| Gate | 必须完成项 | 状态 | 风险 | 证据（只读） |
|---|---|---|---|---|
| **G0** | pending-prod **01–05** schema 已成功 apply，且只读对象检查通过 | **未完成** | **P0** | `boss_companion_relations` / `boss_commission_earnings` / `boss_levels` / `boss_companion_invitations` / `user_points_*` / `points_settings` 均为 `PGRST205`；`orders.platform_fee` 缺失 |
| **G1** | `profiles.is_test_account`（及 companion 镜像列）已存在 | **未完成** | **P0** | `profiles.is_test_account` 列探测为缺失 |
| **G2** | 设计清单中 **11** 个 smoke/test 账号已回填 `is_test_account=true`，companion 镜像一致 | **未完成** | **P0** | 列不存在，无法回填；账号清单已设计完成 |
| **G3** | 真实**非 test** 管理员可登录后台（替代 `admin@meow.test`） | **未完成** | **P0** | 现网唯一 admin = `admin@meow.test` |
| **G4** | `_test-accounts` 覆盖 disposable 域；Dashboard 正式统计回归通过 | **未完成** | **P1** | Dashboard 已有启发式过滤；`guerrillamail*` 未在检测器中显式覆盖（主要靠名字）；缺权威 flag |
| **G5** | Boss 佣金**写入**路径 test fail-closed（test-touched 订单不入账） | **未完成** | **P0** | `_boss-commission` 未见 test 过滤 |
| **G6** | 积分 award/clawback **写入**路径 test fail-closed | **未完成** | **P0** | `_user-points` 未见 test 过滤 |
| **G7** | 旧单策略生效：`platform_fee` 可空且 **test-touched / 历史单不自动回补** | **未完成** | **P0** | 列未创建；策略仅在设计/runbook 中；存在 completed smoke 单 RM 6000 |
| **G8** | 结算/积分 feature flag **默认关闭**；仅超管可开灰度 | **未完成** | **P1** | 未见已落地的 Prod「结算开关默认关」验收记录 |
| **G9** | 只读对账签字：正式 GMV 不含 smoke；test 用户 earnings/points = 0 | **未完成** | **P0** | 表未建，无法做入账后对账；预估正式订单约 1 笔，smoke 触达 2 笔（含 6000） |

---

## 按 Gate 展开：上线前必须完成项目

### G0 — Schema 01–05 apply（P0）

| # | 必做项 | 状态 | 风险 |
|---|---|---|---|
| G0.1 | 人工确认目标库 host = 当前 `PROD_*` | **未完成**（需发布窗口口头确认） | P0 |
| G0.2 | Backup / PITR，记录 `T0`（见 `APPLY_RUNBOOK.md`） | **未完成** | P0 |
| G0.3 | 按序执行 `01→02→03→04→05` | **未完成** | P0 |
| G0.4 | 验证 10 张核心表存在 | **未完成** | P0 |
| G0.5 | 验证 `orders.platform_fee` 等结算列存在且旧值为 NULL | **未完成** | P0 |
| G0.6 | 验证 `boss_levels` seed=4、`points_settings` 单例 | **未完成** | P1 |
| — | SQL 草稿 + Runbook 已生成 | **已完成** | — |

### G1 — `is_test_account` 列（P0）

| # | 必做项 | 状态 | 风险 |
|---|---|---|---|
| G1.1 | apply `profiles.is_test_account` / companion 镜像列 migration | **未完成** | P0 |
| G1.2 | 确认默认值为 `false`，索引可用 | **未完成** | P1 |
| — | 仓库已有列 migration 草稿 | **已完成** | — |

### G2 — Smoke 回填（P0）

| # | 必做项 | 状态 | 风险 |
|---|---|---|---|
| G2.1 | 按隔离设计精确标记 11 个 id 为 test | **未完成** | P0 |
| G2.2 | companion 镜像 `is_test_account` 同步 | **未完成** | P0 |
| G2.3 | 只读核对 count(test)=11，且不误伤 13 个正式候选 | **未完成** | P0 |
| — | 11 账号清单已只读枚举并文档化 | **已完成** | — |

### G3 — 真实管理员（P0）

| # | 必做项 | 状态 | 风险 |
|---|---|---|---|
| G3.1 | 创建非 `@meow.test` 的正式 admin | **未完成** | P0 |
| G3.2 | 验证该 admin 可登录后台 | **未完成** | P0 |
| G3.3 | 再处理 `admin@meow.test`（标记 test / 降权策略） | **未完成** | P0 |

### G4 — 检测器 + Dashboard（P1）

| # | 必做项 | 状态 | 风险 |
|---|---|---|---|
| G4.1 | `_test-accounts` 显式覆盖 disposable 域（含 guerrilla） | **未完成** | P1 |
| G4.2 | Dashboard 默认排除 test；`include_test` 仅排障 | **部分完成→计未完成** | P1 |
| G4.3 | 回归：正式老板/陪玩/客服计数与订单 GMV 不含 smoke | **未完成** | P1 |
| — | Dashboard 已有基础启发式排除逻辑 | **已完成（代码侧）** | — |

### G5 — Boss 佣金写入门禁（P0）

| # | 必做项 | 状态 | 风险 |
|---|---|---|---|
| G5.1 | 结算写入前 `assertNotTestAccountForSettlement` | **未完成** | P0 |
| G5.2 | test-touched 订单不写 `boss_commission_earnings` | **未完成** | P0 |
| G5.3 | Admin/Boss 收益读取默认排除 test | **未完成** | P1 |

### G6 — 积分写入门禁（P0）

| # | 必做项 | 状态 | 风险 |
|---|---|---|---|
| G6.1 | award/clawback 对 test user skip | **未完成** | P0 |
| G6.2 | test-touched 订单不触发赠分 | **未完成** | P0 |
| G6.3 | 积分排行/总览排除 test | **未完成** | P1 |

### G7 — 旧单 / platform_fee 策略（P0）

| # | 必做项 | 状态 | 风险 |
|---|---|---|---|
| G7.1 | `platform_fee` 仅可空加列，不做历史自动回填 | **未完成**（待 apply 时遵守） | P0 |
| G7.2 | completed smoke 单（RM 6000）加入「禁止回补」名单 | **未完成** | P0 |
| G7.3 | 结算代码对 `platform_fee IS NULL` fail-closed | **未完成** | P0 |
| — | 旧单策略已写入 isolation design + runbook | **已完成（文档）** | — |

### G8 — Feature flag（P1）

| # | 必做项 | 状态 | 风险 |
|---|---|---|---|
| G8.1 | `SETTLEMENT_ENABLED` / `POINTS_AWARD_ENABLED` 默认 `false` | **未完成** | P1 |
| G8.2 | 仅超管可打开；先开「新完成订单」 | **未完成** | P1 |
| G8.3 | 历史回补单独变更单，不与首开绑定 | **未完成** | P2 |

### G9 — 上线前对账签字（P0）

| # | 必做项 | 状态 | 风险 |
|---|---|---|---|
| G9.1 | 正式订单集确认（预期约 1 笔非 smoke） | **未完成** | P0 |
| G9.2 | 正式 GMV 不含 RM 6000 smoke 单 | **未完成** | P0 |
| G9.3 | test 用户 earnings count=0、points ledger=0 | **未完成** | P0 |
| G9.4 | 产品/运营/工程三方签字后才开 flag | **未完成** | P0 |

---

## 已完成的前置工作（非 Gate 绿，但是备件就绪）

| 项 | 状态 | 风险 |
|---|---|---|
| pending-prod 01–05 SQL 草稿 | **已完成** | P2（仍需人工审 SQL） |
| `APPLY_RUNBOOK.md`（顺序/backup/rollback/验证） | **已完成** | P2 |
| Smoke 账号只读枚举（11） | **已完成** | P2 |
| `SMOKE_TEST_ISOLATION_DESIGN.md` | **已完成** | P2 |
| Apply 前风险报告（FK/旧单/smoke） | **已完成** | P2 |
| Production 只读连接确认 | **已完成** | P2 |

---

## 开启结算的硬条件（摘要）

```text
允许开启结算/积分入账
  ⟺  G0 ∧ G1 ∧ G2 ∧ G3 ∧ G4 ∧ G5 ∧ G6 ∧ G7 ∧ G8 ∧ G9 全为「已完成」

当前：0/10 Gate 完成 → 禁止开启
```

**推荐顺序（仍不执行）：**  
文档齐 →（授权后）G0 schema → G1/G2 标记 → G3 真管理员 → G4–G6 代码门禁 → G7 旧单策略验收 → G8 flag 默认关 → G9 对账签字 → 仅开新单结算。

---

## 风险分布（未完成项）

| 等级 | 含义 | 未完成 Gate |
|---|---|---|
| **P0** | 上线/开结算阻断 | G0, G1, G2, G3, G5, G6, G7, G9 |
| **P1** | 高概率漏统计/误入账或失控发布 | G4, G8 |
| **P2** | 流程完善项 | G8.3 历史回补拆单 |

---

## 本轮声明

- 未执行任何 SQL  
- 未修改 Production  
- 未 apply migration  
- 本文件仅为上线前最终 checklist  

**文档路径：** `supabase/pending-prod/GO_LIVE_G0_G9_CHECKLIST.md`  
**关联：** `APPLY_RUNBOOK.md`、`SMOKE_TEST_ISOLATION_DESIGN.md`、pending-prod `01`–`05`
