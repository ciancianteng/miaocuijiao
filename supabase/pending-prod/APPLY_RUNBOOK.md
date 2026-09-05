# Production Migration Apply Runbook

**状态：DRAFT — 仅供人工执行前审阅**  
**本轮禁止：apply / INSERT / UPDATE / DELETE（由 Agent 执行）**  
**目标对象：** `supabase/pending-prod/01`–`05`  
**目标库：** 以当时 `PROD_SUPABASE_URL` 为准（先前只读指纹：`jqfaknpmcnqwqvatrwgo.supabase.co`）  
**前置结论：** 空表新建 + 可空列 ALTER 大概率可通过；风险在 seed/配置写入、旧单 `platform_fee=NULL`、smoke 账号污染。

---

## 0. 总原则

1. **只按顺序执行 01→05**，中途失败即停，不要跳步。  
2. **先 backup，再 apply。**  
3. Apply 后 **不要立刻开启** Boss 佣金结算 / 积分发放 feature flag。  
4. 旧订单 `platform_fee` 保持 `NULL`（不回填），结算逻辑必须 fail-closed。  
5. smoke/test 账号未隔离前，禁止对 Prod 跑结算/积分回填脚本。

---

## 1. 执行顺序（强制）

| Step | 文件 | 依赖 | 可否并行 |
|---|---|---|---|
| 1 | `01_boss_companion_relations.sql` | `public.profiles` | 否 |
| 2 | `02_boss_commission_earnings_and_orders_platform_fee.sql` | Step1（`boss_companion_relations` + `set_updated_at()`） | 否 |
| 3 | `03_boss_levels_and_invitations.sql` | Step1+2 | 否 |
| 4 | `04_user_points_accounts_and_ledger.sql` | `profiles` + `orders` | 否（建议仍串行） |
| 5 | `05_points_settings_and_debt_rpcs.sql` | Step4 | 否 |

**推荐窗口命令形态（人工执行，本 Agent 不跑）：**

```bash
# 仅示意：在授权窗口用 psql / Supabase SQL editor 逐文件执行
# 01 → 验证 → 02 → 验证 → 03 → 验证 → 04 → 验证 → 05 → 验证
```

---

## 2. 每一步会 CREATE / ALTER / INSERT / UPDATE 什么

### Step 01 — `01_boss_companion_relations.sql`

| 动作 | 对象 | 说明 |
|---|---|---|
| **CREATE TABLE** | `public.boss_companion_relations` | Boss↔陪玩直属关系 |
| **CREATE TABLE** | `public.boss_companion_relation_events` | 关系事件（append-only） |
| **CREATE INDEX** | active companion 唯一索引 + 查询索引 | 含 partial unique(`companion_id`) where active |
| **CREATE OR REPLACE FUNCTION** | `public.set_updated_at()` | 后续多表 trigger 依赖 |
| **CREATE OR REPLACE FUNCTION** | `public.bcr_forbid_event_mutation()` | 禁止 events UPDATE/DELETE |
| **CREATE TRIGGER** | relations `updated_at`；events 禁 UPDATE/DELETE | |
| **ENABLE RLS + CREATE POLICY** | 上述两表 | admin all；boss/companion select |
| **GRANT** | `authenticated` SELECT | |
| **NOTIFY** | `pgrst, reload schema` | |
| INSERT | — | 无 |
| UPDATE | — | 无 |

---

### Step 02 — `02_boss_commission_earnings_and_orders_platform_fee.sql`

| 动作 | 对象 | 说明 |
|---|---|---|
| **ALTER TABLE** | `boss_companion_relations` | 加 `commission_rate` + check |
| **ALTER TABLE** | `orders` | 加可空列：`platform_fee`, `companion_income`, `settlement_status`, `settlement_note`, `platform_fee_rate`, `boss_commission_rate`, `boss_commission_amount`, `direct_boss_id`, `boss_commission_relation_id` |
| **CREATE TABLE** | `public.boss_commission_earnings` | Boss 佣金账本 |
| **CREATE INDEX** | order 幂等唯一索引 + boss/companion 索引 | pending/settled 唯一 |
| **CREATE TRIGGER** | `trg_boss_commission_earnings_updated_at` | 依赖 `set_updated_at()` |
| **ENABLE RLS + POLICY** | earnings | admin all；boss select own |
| **UPDATE（条件）** | `platform_settings` where `id='global'` | 若缺少键 `defaultBossCommissionRate`，写入 `0` |
| **NOTIFY** | schema reload | |
| INSERT | — | 无业务行插入（仅可能间接无） |

**注意：** 这是 01–05 中**第一个会改现网业务配置 JSON** 的步骤。

---

### Step 03 — `03_boss_levels_and_invitations.sql`

| 动作 | 对象 | 说明 |
|---|---|---|
| **ALTER TABLE** | `orders` | 加 `boss_commission_rate_source`, `boss_level_id`, `boss_level_code` |
| **ALTER TABLE** | `boss_commission_earnings` | 加 `rate_source`, `boss_level_id`, `boss_level_code`, `companion_income_amount` |
| **DROP/CREATE INDEX** | earnings order unique | 重建幂等索引名 |
| **CREATE OR REPLACE FUNCTION** | `public.mcj_forbid_boss_earnings_money_rewrite()` | 已结算金额不可改 |
| **CREATE TRIGGER** | forbid money rewrite | |
| **ALTER TABLE** | `boss_companion_relation_events` | 加 `reason` |
| **CREATE TABLE** | `boss_levels` | 等级档位（含 `required_active_companions`,`commission_rate`,`sort_order`,`is_enabled`） |
| **CREATE TABLE** | `boss_level_assignments` | 当前等级 |
| **CREATE TABLE** | `boss_level_events` | 等级变更审计 |
| **CREATE TABLE** | `boss_companion_invitations` | 邀请状态机 |
| **INSERT** | `boss_levels` 4 行 seed | `boss_lv_normal/silver/gold/diamond`；`ON CONFLICT DO NOTHING` |
| **ENABLE RLS + POLICY** | 上述新表 | |
| **NOTIFY** | schema reload | |
| UPDATE | — | 无（除索引/函数替换） |

---

### Step 04 — `04_user_points_accounts_and_ledger.sql`

| 动作 | 对象 | 说明 |
|---|---|---|
| **CREATE EXTENSION** | `pgcrypto` | if not exists |
| **CREATE TABLE** | `user_points_accounts` | 积分账户（= 清单中的 user_points） |
| **CREATE TABLE** | `user_points_ledger` | 积分流水 |
| **CREATE INDEX** | user/order/source | |
| **CREATE OR REPLACE FUNCTION** | `tg_user_points_accounts_set_updated_at()` | |
| **CREATE OR REPLACE FUNCTION** | `mcj_award_user_points(...)` | 基础幂等入账 RPC |
| **CREATE TRIGGER** | accounts updated_at | |
| **GRANT** | service_role / authenticated | |
| **NOTIFY** | schema reload | |
| INSERT | — | 无（RPC 内含逻辑，但 apply 时不调用） |
| UPDATE | — | 无 |

---

### Step 05 — `05_points_settings_and_debt_rpcs.sql`

| 动作 | 对象 | 说明 |
|---|---|---|
| **CREATE TABLE** | `points_settings` | 积分规则单例表 |
| **INSERT** | `points_settings (id=1, ...)` | seed；`ON CONFLICT DO NOTHING` |
| **ALTER TABLE** | `points_settings` | 加 `enabled`, `points_per_cat_food`, `min_order_cat_food`, `max_reward_points`, `rounding_mode` |
| **UPDATE** | `points_settings` where `id=1` | coalesce 默认倍率等 |
| **INSERT** | 再次 seed（`ON CONFLICT DO NOTHING`） | |
| **ALTER TABLE** | `user_points_accounts` | 加 `outstanding_debt` 等欠款列 |
| **ALTER TABLE** | `user_points_ledger` | 加 `debt_delta` / `debt_after` / `clawback_target` / `gross_points` |
| **CREATE OR REPLACE FUNCTION** | `mcj_award_user_points` / `mcj_clawback_user_points` | 替换为欠款感知版 |
| **GRANT / REVOKE** | RPC execute | |
| **NOTIFY** | schema reload | |

**注意：** Step5 含明确 **INSERT + UPDATE** 配置数据。

---

## 3. 执行前 Backup 建议

### 3.1 必做

1. **Supabase 项目快照 / PITR 确认**
   - 确认 Production 已开 PITR 或可手动 backup。
   - 记录 apply 开始 UTC 时间 `T0`，便于按时间点恢复。

2. **逻辑备份（至少导出这些对象的当前定义与关键数据）**
   - `public.orders` 全表（当前仅 3 行，务必保留）
   - `public.profiles` 全表
   - `public.platform_settings` 中 `id='global'` 整行 JSON
   - 现有 schema 清单（`information_schema.tables/columns`）

3. **配置备份**
   - 导出当前 `PROD_SUPABASE_URL` / project ref（勿把 service_role 写入仓库）
   - 记录 feature flags：佣金结算、积分发放是否关闭

### 3.2 建议的预检查（只读）

```sql
-- A. 确认待建表不存在
select tablename from pg_tables
where schemaname='public'
  and tablename in (
    'boss_companion_relations','boss_companion_relation_events',
    'boss_commission_earnings','boss_levels','boss_level_assignments',
    'boss_level_events','boss_companion_invitations',
    'user_points_accounts','user_points_ledger','points_settings'
  );

-- B. 确认 orders.platform_fee 仍缺失
select column_name from information_schema.columns
where table_schema='public' and table_name='orders' and column_name='platform_fee';

-- C. 备份点核对
select count(*) as orders_count from public.orders;
select count(*) as profiles_count from public.profiles;
select id, updated_at from public.platform_settings where id='global';
```

### 3.3 人工执行前 Gate

- [ ] 目标库 host 已口头/工单确认  
- [ ] PITR/backup 可用  
- [ ] 佣金/积分 feature flag **关闭**  
- [ ] 接受 Step02 可能写入 `defaultBossCommissionRate=0`  
- [ ] 接受 Step03/05 seed  
- [ ] 旧单 `platform_fee` **不回填**策略已批准  
- [ ] smoke 账号隔离方案已批准（至少应用层黑名单）

---

## 4. 失败如何 Rollback

> Postgres DDL 多数语句自动提交；`CREATE TABLE IF NOT EXISTS` / `ALTER ... ADD COLUMN IF NOT EXISTS` **通常不能靠一个大事务完整回滚**。按“失败步骤”做补偿。

### 4.1 通用策略

1. **立刻停止**后续 step。  
2. 记录失败报错、已成功 step、`T_fail`。  
3. 优先选：  
   - **PITR 回到 T0**（最干净，若尚未产生新业务写入）  
   - 或 **正向补偿 DROP**（仅当确认无新业务数据写入新表）

### 4.2 分步补偿（仅在无新业务写入时）

#### 若失败于 Step01 后 / Step02 前

```sql
-- 补偿示例（人工审慎执行；本 Agent 不执行）
drop table if exists public.boss_companion_relation_events cascade;
drop table if exists public.boss_companion_relations cascade;
-- set_updated_at() 可保留（无害）或 drop function（若确认无其它依赖）
```

#### 若失败于 Step02 后 / Step03 前

```sql
drop table if exists public.boss_commission_earnings cascade;
alter table public.boss_companion_relations drop column if exists commission_rate;
alter table public.orders drop column if exists platform_fee;
alter table public.orders drop column if exists companion_income;
alter table public.orders drop column if exists settlement_status;
alter table public.orders drop column if exists settlement_note;
alter table public.orders drop column if exists platform_fee_rate;
alter table public.orders drop column if exists boss_commission_rate;
alter table public.orders drop column if exists boss_commission_amount;
alter table public.orders drop column if exists direct_boss_id;
alter table public.orders drop column if exists boss_commission_relation_id;
-- 恢复 platform_settings.global JSON：从 backup 还原整行，勿手工猜
```

#### 若失败于 Step03 后 / Step04 前

```sql
drop table if exists public.boss_companion_invitations cascade;
drop table if exists public.boss_level_events cascade;
drop table if exists public.boss_level_assignments cascade;
drop table if exists public.boss_levels cascade;
-- orders / earnings 新增列是否回撤：若无业务写入可 drop column；否则保留
```

#### 若失败于 Step04 后 / Step05 前

```sql
drop function if exists public.mcj_award_user_points(uuid, integer, text, text, uuid, text, uuid);
drop table if exists public.user_points_ledger cascade;
drop table if exists public.user_points_accounts cascade;
```

#### 若失败于 Step05 中后段

```sql
drop function if exists public.mcj_clawback_user_points(uuid, integer, text, text, uuid, text, uuid);
drop function if exists public.mcj_award_user_points(uuid, integer, text, text, uuid, text, uuid);
-- 然后视情况重建 Step04 基础 RPC，或整体 PITR
drop table if exists public.points_settings cascade;
-- accounts/ledger 的欠款列若已加上且无数据，可 drop column；否则保留
```

### 4.3 不可轻易回滚的点

| 项 | 原因 |
|---|---|
| `orders` 已有新列且开始写入快照 | `DROP COLUMN` 丢业务数据 |
| `platform_settings` JSON 已改 | 必须从 backup 精确还原 |
| earnings/ledger 已有业务行 | 禁止直接 DROP；需业务对账 |
| RLS/POLICY 已对客户端生效 | 回滚后需再 `NOTIFY pgrst` |

### 4.4 Rollback 决策树

```
失败？
 ├─ 尚无任何新业务写入（推荐）→ PITR 到 T0
 ├─ 仅新建空表/空列 → 可按分步 DROP/ DROP COLUMN 补偿
 └─ 已产生佣金/积分行 → 停止；人工对账；禁止盲目 DROP
```

---

## 5. Apply 后验证 SQL Checklist（只读验证）

> 以下为 **apply 完成后**由人工运行的检查清单。现在不要执行 apply；下列 SQL 也仅作 runbook 内容。

### 5.1 对象存在性

```sql
-- 期望：10 张表都存在
select tablename
from pg_tables
where schemaname='public'
  and tablename in (
    'boss_companion_relations','boss_companion_relation_events',
    'boss_commission_earnings',
    'boss_levels','boss_level_assignments','boss_level_events',
    'boss_companion_invitations',
    'user_points_accounts','user_points_ledger','points_settings'
  )
order by 1;
```

### 5.2 `orders.platform_fee` 与旧单语义

```sql
-- 列应存在
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema='public' and table_name='orders'
  and column_name in (
    'platform_fee','platform_fee_rate','boss_commission_rate',
    'boss_commission_amount','companion_income','settlement_status'
  )
order by 1;

-- 旧单应全部为 NULL（若未做回填）
select id, status, total_amount, platform_fee, boss_commission_amount
from public.orders
order by created_at;
-- 期望：既有 3 单 platform_fee IS NULL
```

### 5.3 Seed / 配置

```sql
-- boss_levels 应有 4 档
select id, code, commission_rate, is_enabled
from public.boss_levels
order by sort_order;

-- points_settings 单例
select id, enabled, points_per_cat_food, min_order_cat_food,
       max_reward_points, rounding_mode, order_completion_points
from public.points_settings
where id = 1;

-- platform_settings 默认佣金键（Step02 可能写入 0）
select data->>'defaultBossCommissionRate' as default_boss_commission_rate
from public.platform_settings
where id = 'global';
```

### 5.4 空业务表（apply 刚完成时应为空）

```sql
select 'boss_companion_relations' as t, count(*) from public.boss_companion_relations
union all select 'boss_commission_earnings', count(*) from public.boss_commission_earnings
union all select 'boss_companion_invitations', count(*) from public.boss_companion_invitations
union all select 'boss_level_assignments', count(*) from public.boss_level_assignments
union all select 'user_points_accounts', count(*) from public.user_points_accounts
union all select 'user_points_ledger', count(*) from public.user_points_ledger;
-- 期望：全 0（除 levels/settings seed 外）
```

### 5.5 RPC / 权限冒烟（只读探测，不写分）

```sql
-- 函数应存在
select proname
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public'
  and proname in (
    'set_updated_at',
    'bcr_forbid_event_mutation',
    'mcj_forbid_boss_earnings_money_rewrite',
    'mcj_award_user_points',
    'mcj_clawback_user_points'
  )
order by 1;

-- RLS 已开
select relname, relrowsecurity
from pg_class c
join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public'
  and relname in (
    'boss_companion_relations','boss_commission_earnings','boss_levels',
    'boss_companion_invitations','user_points_accounts','user_points_ledger'
  );
```

### 5.6 PostgREST 可见性

```text
GET /rest/v1/boss_companion_relations?select=id&limit=0
GET /rest/v1/boss_commission_earnings?select=id&limit=0
GET /rest/v1/boss_levels?select=id&limit=1
GET /rest/v1/points_settings?select=id&limit=1
GET /rest/v1/orders?select=id,platform_fee&limit=3
```
期望：不再返回 `PGRST205`；`orders.platform_fee` 可查询且旧值为 null。

### 5.7 Apply 后业务 Gate（仍不写库）

- [ ] 佣金结算开关仍关闭  
- [ ] 积分发放开关仍关闭  
- [ ] 未对旧单回填 `platform_fee`  
- [ ] smoke 账号黑名单已配置  
- [ ] 监控：无异常 settlement job  
- [ ] 回滚点 `T0` 仍可用（至少保留一个维护窗口）

---

## 6. 一页纸执行清单（人工勾选）

```text
[ ] Backup / PITR 确认，记录 T0
[ ] 只读预检查通过
[ ] Feature flags OFF
[ ] 执行 01 → 验证对象
[ ] 执行 02 → 验证 orders.platform_fee + earnings 表 + settings 键
[ ] 执行 03 → 验证 boss_levels(4) + invitations 表
[ ] 执行 04 → 验证 points accounts/ledger + award RPC
[ ] 执行 05 → 验证 points_settings + clawback RPC
[ ] 跑第 5 节 checklist
[ ] 宣布 schema ready；业务功能仍保持关闭
```

---

## 7. 明确不做的事（本 Runbook 约束）

- 不在本文件指导下由 Agent 自动 apply  
- 不自动回填历史 `platform_fee`  
- 不自动给旧单写 `boss_commission_earnings`  
- 不自动给用户发积分  
- 不删除 smoke 账号  

---

**文档版本：** 2026-09-05  
**对应 SQL 目录：** `supabase/pending-prod/`  
**相关风险报告：** 上一轮 Production apply 前风险报告（只读）
