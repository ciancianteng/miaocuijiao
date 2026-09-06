# G9 人工确认包（只读 / 等待批准）

**生成时间：** 2026-09-05  
**Production host（只读）：** 以环境变量 `PROD_SUPABASE_URL` 为准  
**本文件约束：** **不 apply**；**不执行**任何 Production mutation（无 INSERT/UPDATE/DELETE/DDL apply）

---

## 1) 真实 admin 登录验证结果

| 检查项 | 结果 |
|---|---|
| Production `profiles.role=admin` 数量 | **1** |
| 唯一 admin | `admin@meow.test` / id `6f31b706-11e7-42df-8db1-d2caccd796de` / status=active |
| 是否 `@meow.test` 测试账号 | **是** |
| Auth 用户存在 | 是（`email_confirmed_at` 有值；`last_sign_in_at≈2026-09-03`） |
| Production 代码是否拦截该账号登录 | **是**（`isBlockedProductionTestAdmin` → 403） |
| 是否存在非 test 真实 admin | **否** |
| **真实 admin 登录验证** | **❌ 未通过（阻塞）** |

### 结论

- **当前无法完成「真实 admin 登录验证」**：Production 上没有非 `@meow.test` 的 admin。
- **在创建并验证真实 admin 之前，禁止执行 G2**（否则会把唯一 admin 标成 test，叠加登录拦截 → 后台锁死）。
- 真实管理员账号（非 meow.test / 非 disposable）登录时，**不会**被 test 过滤逻辑误伤（`is_test_account` 默认 false；启发式不匹配正式邮箱）。

### 你需要做的（人工）

1. 在 Production 创建正式 admin（真实邮箱）并设 `profiles.role=admin`（或 `super_admin`，以现网枚举为准）。  
2. 用该账号完成一次后台登录验证。  
3. 把验证结果回复给我（邮箱可打码，但需确认「非 meow.test 且可进后台」）。

---

## 2) Production backup / PITR 确认

| 检查项 | 结果 |
|---|---|
| Management API token（`SUPABASE_ACCESS_TOKEN`） | **未注入** |
| Agent 能否自动核对 PITR/备份开关 | **不能**（只读 REST 无法查 backup 配置） |
| **Backup / PITR 确认状态** | **⏳ 待你在 Dashboard 人工确认** |

### 请你在 Supabase Dashboard 确认并回复

项目：`PROD_SUPABASE_URL` 对应项目  

1. **Database → Backups**  
   - [ ] Daily backup 已开启  
   - [ ] 最近一次成功备份时间：________  
2. **Point-in-Time Recovery (PITR)**  
   - [ ] PITR 已开启  
   - [ ] 可恢复窗口（例如 7/14/28 天）：________  
3. Apply 前准备  
   - [ ] 已记录 apply 前时间点 `T0`（UTC）：________  
   - [ ] 已知如何按 `T0` 回滚 / 恢复  

**在你勾选并回复前，Agent 不会 apply 任何 SQL。**

---

## 3) 即将执行的 SQL 清单（仅清单 / 未执行）

> 下列文件均已在仓库中；**全部等待你明确批准后才可人工/授权执行**。  
> 推荐顺序严格串行；任一步失败即停。

### Batch A — G0 schema（pending-prod 01→05）

| 序号 | 文件 | 主要动作 | 是否含业务 DML | 风险备注 |
|---|---|---|---|---|
| A1 | `supabase/pending-prod/01_boss_companion_relations.sql` | CREATE 表/索引/函数/trigger/RLS | 无业务行写入 | 空表创建；不改现有订单 |
| A2 | `supabase/pending-prod/02_boss_commission_earnings_and_orders_platform_fee.sql` | CREATE earnings；`orders` 可空加列（含 `platform_fee`）；RLS | **有条件 UPDATE** `platform_settings`（缺 key 时写入 `defaultBossCommissionRate=0`） | **不回填**历史 `platform_fee`；旧行保持 NULL |
| A3 | `supabase/pending-prod/03_boss_levels_and_invitations.sql` | CREATE levels/assignments/events/invitations；orders/earnings 加列 | **INSERT seed** `boss_levels`（ON CONFLICT DO NOTHING） | 不改订单金额 |
| A4 | `supabase/pending-prod/04_user_points_accounts_and_ledger.sql` | CREATE points accounts/ledger；函数/trigger | 无业务回填 | 空账本 |
| A5 | `supabase/pending-prod/05_points_settings_and_debt_rpcs.sql` | CREATE/ALTER points_settings；CREATE/REPLACE debt RPCs | **INSERT/UPDATE seed** settings；RPC 内含未来运行时 DML | 仅 schema+配置种子，不回放历史订单积分 |

### Batch B — G1 test flag 列

| 序号 | 文件 | 主要动作 | 是否含业务 DML | 风险备注 |
|---|---|---|---|---|
| B1 | `supabase/migrations/20260903_profiles_is_test_account.sql` | `profiles` / `companion_profiles` ADD `is_test_account boolean not null default false` + 部分索引 | 无（既有行自动 false） | **不标记任何人** |

### Batch C — G2 标记 11 个 smoke/test（高风险，依赖真实 admin）

| 序号 | 文件 | 主要动作 | 是否含业务 DML | 风险备注 |
|---|---|---|---|---|
| C1 | `supabase/pending-prod/G2_MARK_TEST_ACCOUNTS_SQL_REVIEW.sql` | `UPDATE profiles/companion_profiles SET is_test_account=true`（精确 11 ids） | **是（UPDATE）** | **必须先完成真实 admin**；会标记 `admin@meow.test`；不删数据 |

### 明确排除（本次批准范围外）

- 任何历史 `orders.platform_fee` 回填 UPDATE  
- 任何 smoke 订单结算补偿 INSERT  
- `DROP TABLE` / 删除 smoke 数据  
- 开启 `SETTLEMENT_ENABLED` / `POINTS_AWARD_ENABLED`  
- G2 在真实 admin 验证通过前执行  

---

## 4) 批准门禁（请直接回复）

请按条回复，例如：

```text
1) 真实 admin 登录：已通过 / 未通过 — 邮箱域：___
2) Backup/PITR：已确认 — 最近备份：___ ；PITR窗口：___ ；T0：___
3) 批准范围（多选）：
   [ ] 仅批准 Batch A（01–05）
   [ ] 批准 Batch A + B（+ is_test_account 列）
   [ ] 批准 Batch A + B + C（含 G2 标记；仅当真实 admin 已通过）
   [ ] 全部不批准（继续等待）
4) 02 中 platform_settings 条件 UPDATE：允许 / 跳过
```

**在收到你的明确批准前：不 apply、不 mutation Production。**
