# Production G0–G9 执行计划（如何完成）

**状态：PLAN ONLY — 不连接 Production、不执行写操作、不 apply migration**  
**生成时间：2026-09-05**  
**依据：**
- `pending-prod/01`–`05` + `APPLY_RUNBOOK.md`
- `SMOKE_TEST_ISOLATION_DESIGN.md`
- `GO_LIVE_G0_G9_CHECKLIST.md`（当前 0/10 未完成）

**总原则**
1. **严格按 G0 → G9 顺序**；前序未绿不得开后序写路径。  
2. **先文档/代码/备份，后授权窗口才跑 SQL。**  
3. **本文件只描述“怎么做”；不授权、不执行。**

---

## 总览：每类工作归类

| 类型 | 涉及 Gate | 说明 |
|---|---|---|
| **SQL** | G0, G1, G2, G7（结构侧） | schema / 加列 / 回填标记；仅授权窗口执行 |
| **代码修改** | G4, G5, G6, G7（逻辑侧）, G8 | 过滤、fail-closed、feature flag |
| **人工验证** | 全部 Gate；尤其 G3, G9 | 账号、登录、对账签字 |
| **测试** | 每 Gate 完成后 | Staging 优先；Prod 仅只读核对（除非该 Gate 明确要求授权写入） |

---

## G0 — Schema 01–05 apply

### 如何完成（顺序）
1. 人工确认目标库 host = 计划中的 Production。  
2. 按 `APPLY_RUNBOOK.md` 做 backup / 记录 `T0`。  
3. 授权后按序执行：
   - `01_boss_companion_relations.sql`
   - `02_boss_commission_earnings_and_orders_platform_fee.sql`
   - `03_boss_levels_and_invitations.sql`
   - `04_user_points_accounts_and_ledger.sql`
   - `05_points_settings_and_debt_rpcs.sql`
4. 每步后跑 Runbook 中的对象存在性检查；失败即停并按 rollback 段处理。

### 需要 SQL？
**是（核心）** — pending-prod 01–05 全文。

### 需要代码修改？
**否**（G0 仅 schema）。可选：部署前确认 API 对缺表已有降级，避免半状态 500。

### 需要人工验证？
**是** — host 确认、backup 确认、逐步放行。

### 完成后如何测试
**只读验证（apply 之后才做）：**
```sql
-- 示意：表存在
select tablename from pg_tables
where schemaname='public'
  and tablename in (
    'boss_companion_relations','boss_companion_relation_events',
    'boss_commission_earnings','boss_levels','boss_level_assignments',
    'boss_level_events','boss_companion_invitations',
    'user_points_accounts','user_points_ledger','points_settings'
  );

-- orders.platform_fee 存在且旧行可为 NULL
select column_name, is_nullable
from information_schema.columns
where table_name='orders' and column_name='platform_fee';

select count(*) as levels from boss_levels;           -- 期望 4
select count(*) as pts_settings from points_settings; -- 期望 1
```
REST：`GET /rest/v1/<table>?select=id&limit=0` 不再 `PGRST205`。

**通过标准：** 10 表可见 + `platform_fee` 列存在 + seed 符合预期 + 无业务写入异常。

---

## G1 — `is_test_account` 列

### 如何完成
1. 使用仓库草稿（如 `20260903_profiles_is_test_account.sql`）或等价 SQL：  
   - `profiles.is_test_account boolean not null default false`  
   - companion 镜像列（若使用 `companion_profiles`）  
   - 部分索引 `where is_test_account = true`
2. 在 **G0 完成后** 的同一维护窗口或紧随窗口执行（可与 G0 分窗，但必须早于 G2）。

### 需要 SQL？
**是。**

### 需要代码修改？
**建议同步：** 确认 `admin/dashboard.js` / `_test-accounts.js` 已 select `is_test_account`（已有则无需改）。

### 需要人工验证？
**是** — 确认列默认 false，不改变现有行业务语义。

### 完成后如何测试
```sql
select column_name, data_type, column_default
from information_schema.columns
where table_name='profiles' and column_name='is_test_account';

select count(*) filter (where is_test_account) as marked,
       count(*) filter (where not is_test_account) as unmarked
from profiles;
-- 刚加列、未回填时 marked 应为 0
```
API：Dashboard `select=...,is_test_account` 不再因缺列 fallback。

**通过标准：** 列存在、默认 false、API 可读。

---

## G2 — 回填 11 个 smoke/test 账号

### 如何完成
1. 打开 `SMOKE_TEST_ISOLATION_DESIGN.md` 中的 **11 个精确 id**。  
2. 授权后执行 **按 id 列表** 的 UPDATE（禁止只靠模糊 email 批量，防误伤 13 个正式候选）。  
3. 同步 companion 镜像：`user_id in (test ids)`。  
4. 只读 count 核对 = 11。

### 需要 SQL？
**是（数据回填 UPDATE）** — 本计划不执行；示例形态：
```sql
-- 示意 ONLY（勿在未授权窗口执行）
update public.profiles
set is_test_account = true
where id in ( /* 11 uuids from design doc */ );

update public.companion_profiles
set is_test_account = true
where user_id in ( /* same 11 or companion subset */ );
```

### 需要代码修改？
**否**（纯数据）。可选：Admin UI 显示测试徽章（非门禁硬依赖）。

### 需要人工验证？
**是** — 逐条核对 11 人；确认正式 13 人仍为 false；特别确认真实 admin 不在误标名单。

### 完成后如何测试
```sql
select id, role, email, display_name, is_test_account
from profiles
where is_test_account = true
order by role, created_at;
-- 期望正好 11 行，且与设计清单一致

select count(*) from profiles where is_test_account = false;
-- 期望 13（若总数仍为 24）
```
抽查 smoke 订单参与方均 `is_test_account=true`。

**通过标准：** test=11、正式候选未被误标、companion 镜像一致。

---

## G3 — 真实非 test 管理员

### 如何完成
1. 人工创建 **非 `@meow.test`** 邮箱的 admin 账号（Auth + `profiles.role=admin`）。  
2. 用该账号完成一次真实后台登录。  
3. 确认 `is_test_account=false`。  
4. **之后**再决定如何处置 `admin@meow.test`（标记 test / 禁止登录 / 降权）——不得先锁死后台。

### 需要 SQL？
**可选。** 若走 SQL 提权：更新 `profiles.role`（需与 Auth 用户绑定流程一致）。更推荐走既有注册/后台邀请流程。

### 需要代码修改？
**通常否。** 若 Production 已拦截 `@meow.test` 登录，只需保证新 admin 不命中拦截。

### 需要人工验证？
**是（核心）。** 双人确认：登录、权限、退出、再登录。

### 完成后如何测试
- 浏览器：新 admin 登录 Admin Dashboard 成功。  
- 只读：`profiles` 中存在 `role=admin AND is_test_account=false AND email not like '%@meow.test'`。  
- 负向：`admin@meow.test` 在 Production 登录被拒或仅 break-glass（按最终策略）。

**通过标准：** 至少 1 个可用正式 admin；不依赖 smoke 邮箱。

---

## G4 — 检测器增强 + Dashboard 回归

### 如何完成
1. **代码：** 扩展 `server/api/_test-accounts.js`  
   - 显式 disposable 域：`guerrillamailblock.com` 等  
   - 保持：`is_test_account` flag > email > display_name  
2. **代码：** Dashboard / 统计路径统一走 `isTestAccountRecord` / `isTestTouchedOrder`。  
3. Staging 用夹具账号回归；再在 Prod 做**只读**统计对比。

### 需要 SQL？
**否**（逻辑层）。依赖 G1/G2 的列与回填。

### 需要代码修改？
**是。**  
- `_test-accounts.js`（必改）  
- `admin/dashboard.js`（确认无漏网聚合）  
- 订单列表默认隐藏 test（若尚未）

### 需要人工验证？
**是** — 对比「含测试 / 不含测试」两套数字。

### 完成后如何测试
**单元：** `scripts/*test-accounts*` / dashboard filter 断言。  
**接口：** Dashboard JSON 中 `filter.testAccountsExcluded=true`，`excludedOrders >= 2`（按现网 smoke 订单数）。  
**人工：** 正式 GMV 不含 RM 6000 smoke 单。

**通过标准：** 关掉名字启发式仅靠 flag 仍能排除 11 人；改名 smoke 账号仍被 flag 挡住。

---

## G5 — Boss 佣金写入 fail-closed

### 如何完成
1. **代码：** 在佣金结算写入点（如 `_boss-commission.js` / order-complete 钩子）增加：
   - 若 boss/companion/订单任一方 test → **skip 写入** `boss_commission_earnings`
   - 返回明确 `skipped: 'test_account'`（勿静默当成功入账）
2. Admin/Boss 收益读取默认 `is_test_account=false`。  
3. Staging：用 test 订单跑结算，确认 **0 行** earnings。

### 需要 SQL？
**否**（依赖 G0 表已存在）。禁止用 SQL 手工给 smoke 单补 earnings。

### 需要代码修改？
**是（P0）。**

### 需要人工验证？
**是** — 代码评审 + Staging 用例签字。

### 完成后如何测试
| 用例 | 期望 |
|---|---|
| 正式订单 settle | 可写 earnings（在 flag 开启后） |
| smoke 触达订单 settle | 不写 earnings |
| RM 6000 历史 smoke 单回补尝试 | 拒绝 |
| Boss 收益 API | 不含 test boss 数据 |

```sql
-- apply 且跑过测试后只读
select count(*) from boss_commission_earnings e
join profiles b on b.id = e.boss_id
where b.is_test_account = true;
-- 期望 0
```

**通过标准：** test 路径零入账；正式路径可测通（flag 开时）。

---

## G6 — 积分写入 fail-closed

### 如何完成
1. **代码：** `_user-points.js`（或等价）award/clawback 入口：
   - test user → skip  
   - test-touched order → skip  
2. 排行榜/总览排除 test。  
3. Staging 夹具验证。

### 需要 SQL？
**否。**

### 需要代码修改？
**是（P0）。**

### 需要人工验证？
**是。**

### 完成后如何测试
| 用例 | 期望 |
|---|---|
| 正式用户完成单赠分 | flag 开时可入账 |
| test 用户完成单 | ledger 无新行 |
| test 用户排行 | 不出现 |

```sql
select count(*) from user_points_ledger l
join profiles p on p.id = l.user_id
where p.is_test_account = true;
-- 期望 0（上线初期）
```

**通过标准：** test 零赠分；正式路径可测。

---

## G7 — 旧单 / `platform_fee` 策略

### 如何完成
1. **SQL（G0.02 已含）：** 仅 `ADD COLUMN ... NULL`，**不做**历史 `UPDATE platform_fee=...`。  
2. **代码：** 结算前若 `platform_fee IS NULL` → fail-closed（或显式计算后写入**新完成单**，但不得批回补历史）。  
3. **配置/代码：** 维护「禁止回补」订单集合（至少包含 completed smoke RM 6000 单）。  
4. 文档：历史非 test 回补另开变更单（G8.3）。

### 需要 SQL？
**结构：是（随 G0）。回填历史金额：明确不需要 / 禁止自动 SQL。**

### 需要代码修改？
**是** — NULL 处理 + 禁止回补名单/开关。

### 需要人工验证？
**是** — 确认旧三单 `platform_fee` 仍为 NULL；确认 6000 单在黑名单。

### 完成后如何测试
```sql
select id, status, total_amount, platform_fee
from orders
order by created_at;
-- 旧单 platform_fee 全 NULL
```
尝试对 smoke completed 单触发回补 API → 期望 4xx/skipped。  
新完成正式单 → 允许写 `platform_fee` 快照（flag 开时）。

**通过标准：** 无历史自动回填；smoke 单不可补结算。

---

## G8 — Feature flag 默认关闭

### 如何完成
1. **代码/配置：** 引入（或确认）例如：
   - `SETTLEMENT_ENABLED=false`
   - `POINTS_AWARD_ENABLED=false`
2. 写入路径最外层检查 flag；关则整单 skip。  
3. 仅超管后台可切换；审计日志记录开关人。  
4. 首开范围：**仅新完成订单**，不含历史回补。

### 需要 SQL？
**可选** — 若用 `platform_settings` JSON 存开关；否则用环境变量即可。

### 需要代码修改？
**是。**

### 需要人工验证？
**是** — 确认 Prod 环境变量/配置默认 false；开关操作有人值守。

### 完成后如何测试
| Flag | 行为 |
|---|---|
| 双关 | 完成订单不写 earnings/points |
| 仅开结算 | 只写佣金，不写积分 |
| 双开 | 新正式单可写；test 仍被 G5/G6 挡住 |

**通过标准：** 默认关；误开可立刻关；有审计。

---

## G9 — 只读对账签字

### 如何完成
1. 在 G0–G8 完成后，**只读**跑对账 SQL/脚本。  
2. 产出一页数字：正式订单数、正式 GMV、test 排除数、earnings/points 对 test=0。  
3. 产品 / 运营 / 工程三方签字。  
4. 签字后才允许将 G8 flag 打开到「新单结算」。

### 需要 SQL？
**只读 SQL（验证用，非 migration）。**

### 需要代码修改？
**否**（可选用只读脚本）。

### 需要人工验证？
**是（放行门禁）。**

### 完成后如何测试 / 对账清单
```sql
-- 正式订单（示意）
select count(*) as business_orders
from orders o
where not exists (
  select 1 from profiles p
  where p.is_test_account = true
    and p.id in (o.boss_id, o.companion_id, o.customer_service_id)
);

-- test earnings / points 应为 0
select count(*) from boss_commission_earnings e
join profiles p on p.id = e.boss_id where p.is_test_account;

select count(*) from user_points_ledger l
join profiles p on p.id = l.user_id where p.is_test_account;
```
人工对照：RM 6000 smoke 单不在正式 GMV。

**通过标准：** 三方签字单归档；数字与预期一致。

---

## 执行顺序总表（谁先谁后）

```text
G0 SQL schema 01-05
  → G1 SQL add is_test_account
    → G2 SQL backfill 11 ids
      → G3 人工创建正式 admin（可与 G1/G2 并行准备，但登录验收放在标记策略前）
        → G4 代码：检测器 + Dashboard
          → G5 代码：佣金写入门禁
            → G6 代码：积分写入门禁
              → G7 代码+策略：旧单 NULL / 禁回补
                → G8 代码/配置：flag 默认关
                  → G9 人工只读对账签字
                    → 才允许打开「新单结算」flag
```

**可并行准备（但仍按上序验收）：**
- G3 账号申请材料  
- G4/G5/G6/G8 代码 PR（可在 Staging 先合，Prod 开关仍关）  
- G9 对账 SQL 草稿  

**不可并行执行：** G0 未绿就回填 G2；G5/G6 未绿就开 G8；G9 未签就开结算。

---

## 工作类型速查

| Gate | SQL | 代码 | 人工 | 主测试方式 |
|---|---|---|---|---|
| G0 | ✅ apply 01–05 | ❌ | ✅ backup/放行 | 只读表/列/seed |
| G1 | ✅ add column | ⚪ 确认 select | ✅ | 列存在/默认值 |
| G2 | ✅ UPDATE 11 ids | ❌ | ✅ 防误伤复核 | count=11 清单对齐 |
| G3 | ⚪ 可选 | ⚪ 通常否 | ✅ 登录验收 | 正式 admin 登录 |
| G4 | ❌ | ✅ | ✅ 数字对比 | 单测+Dashboard |
| G5 | ❌ | ✅ | ✅ 评审 | Staging settle 用例 |
| G6 | ❌ | ✅ | ✅ 评审 | Staging points 用例 |
| G7 | ⚪ 结构随 G0 | ✅ | ✅ 旧单抽查 | NULL+禁回补 |
| G8 | ⚪ 可选 settings | ✅ | ✅ 配置确认 | flag 开关矩阵 |
| G9 | 🔍 只读 | ❌ | ✅ 三方签字 | 对账 SQL |

✅=必须　⚪=可选　❌=不需要　🔍=只读

---

## 本计划明确不包含

- 连接 Production  
- 执行 migration / INSERT / UPDATE / DELETE  
- 开启结算 feature flag  
- 历史订单佣金/积分回补  

---

**文档路径：** `supabase/pending-prod/G0_G9_EXECUTION_PLAN.md`  
**关联：** `GO_LIVE_G0_G9_CHECKLIST.md`、`APPLY_RUNBOOK.md`、`SMOKE_TEST_ISOLATION_DESIGN.md`
