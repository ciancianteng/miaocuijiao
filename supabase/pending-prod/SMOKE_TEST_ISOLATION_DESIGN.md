# Production Smoke/Test 数据隔离方案（设计稿）

**状态：DESIGN ONLY — 本轮不执行 migration / 不 INSERT / 不 UPDATE / 不 DELETE**  
**数据来源：** 只读探测 `PROD_*`（host 以环境变量为准）  
**原则：** 保留全部历史数据；用标记 + 查询过滤隔离，不物理删除。

---

## 1. 现网 smoke/test 账号清单（只读枚举）

**统计：** profiles 共 24；判定为 smoke/test **11**；暂视为正式 **13**。

### 1.1 建议标记为 `is_test_account = true` 的账号

| # | role | email | display_name | id | 判定依据 |
|---|---|---|---|---|---|
| 1 | admin | `admin@meow.test` | Admin | `6f31b706-11e7-42df-8db1-d2caccd796de` | `@meow.test` |
| 2 | boss | `boss@meow.test` | P0 Boss | `b989960b-ddc2-4f1b-899f-12b2b0cac3b7` | `@meow.test` + Smoke/`P0` |
| 3 | boss | `boss.final.1785714993009@meow.test` | Boss Final | `d397b7bb-826b-4e7a-8fdf-f14602dd92bb` | `@meow.test` |
| 4 | customer_service | `cs.smoke.1788374622374@meow.test` | ProdSmokeCS | `5f20a7fe-3a48-4b42-82b9-82222bc81311` | `@meow.test` + Smoke/`P0` |
| 5 | companion | `brnwxnfv@guerrillamailblock.com` | ProdSmokeInviter | `47178368-a3d4-44b3-97fe-8a648d951c66` | 临时邮箱 + Smoke/`P0` |
| 6 | companion | `swrfscrd@guerrillamailblock.com` | ProdSmokeService | `ed5054bd-93d2-434a-b468-68f75423d830` | 临时邮箱 + Smoke/`P0` |
| 7 | boss | `qemvmuma@guerrillamailblock.com` | ProdSmokeBoss | `779db97b-9a5d-4a97-8be8-5d7bc6d24109` | 临时邮箱 + Smoke/`P0` |
| 8 | customer_service | `cs.smoke.1788374831089@meow.test` | ProdSmokeCS | `b9347ea4-3b45-400d-bf8d-ae2fbe05d690` | `@meow.test` + Smoke/`P0` |
| 9 | companion | `shjqelap@guerrillamailblock.com` | ProdSmokeInviter2 | `6d368f4b-7f33-4923-9441-c63cecef2070` | 临时邮箱 + Smoke/`P0` |
| 10 | companion | `uuzkxxgk@guerrillamailblock.com` | ProdSmokeService2 | `9f7fb39a-bec8-47cc-974a-e314ac2f5cd5` | 临时邮箱 + Smoke/`P0` |
| 11 | boss | `ijogepcg@guerrillamailblock.com` | ProdSmokeBoss2 | `0664ef55-de58-48e3-8dbb-ca8111318e91` | 临时邮箱 + Smoke/`P0` |

**按角色：** admin 1 / boss 4 / companion 4 / customer_service 2。

### 1.2 关联业务数据（不删除，仅标注影响面）

| 对象 | 现状 | 隔离含义 |
|---|---|---|
| 订单 `MCJO000344` completed / RM 6000 | boss+companion+CS 均为 smoke | **必须从正式 GMV/佣金/积分统计排除** |
| 订单 `MCJO000343` awaiting_payment / 30 | boss+companion smoke | 同上 |
| 订单 `MCJO000342` awaiting_payment / 40 | 双方均为正式账号 | 可计入正式统计 |
| companion_profiles | 至少 4 条绑定 smoke user | 列表/大厅应隐藏或标测试 |

### 1.3 暂不自动标记（正式候选）

13 个非 `@meow.test` / 非 `ProdSmoke*` / 非 guerrilla 的 gmail/qq/outlook/163 等账号（含真实客服显示名）。  
**人工复核建议：** 抽查是否有内部小号；确认后再决定是否补标。

### 1.4 特殊风险：`admin@meow.test`

- 现网唯一 `admin`。
- 代码已有 Production 拦截 `@meow.test` 登录的逻辑（`shouldBlockTestIdentityOnProduction`）。
- **隔离前必须先创建并验证真实管理员**，否则标记/拦截后可能锁死后台。

---

## 2. 不删除数据的隔离原则

1. **禁止 DELETE** smoke 账号、订单、流水。  
2. **禁止**为隔离目的改 `status=disabled` 作为唯一手段（会干扰审计；可作辅佐）。  
3. **主手段：** `profiles.is_test_account`（及 companion 镜像列）布尔标记。  
4. **辅手段：** 应用层启发式（email/display_name）作为 flag 缺失时的安全网。  
5. **报表默认：** 正式视图排除 test；另提供「含测试数据」开关给运营排障。  
6. **结算/积分：** test 触达的订单 **fail-closed 不入正式账本**（见第 5 节）。

---

## 3. `is_test_account` 标记方案（设计，本轮不 apply）

### 3.1 Schema（已有仓库草稿，Prod 尚未落地）

参考：`supabase/migrations/20260903_profiles_is_test_account.sql`

```text
profiles.is_test_account boolean not null default false
companion_profiles.is_test_account boolean not null default false
index: (is_test_account) where true
```

**说明：** 该列 migration 与 pending-prod 01–05 **独立**；建议在开启结算前单独执行并回填，但 **本轮不执行**。

### 3.2 判定规则（写入 flag 的候选规则，仍不执行）

满足任一则候选 `true`：

| 优先级 | 规则 | 覆盖 |
|---|---|---|
| P0 | `email ~* '@meow\\.test$'` | 5 个 meow.test |
| P0 | `display_name ~* 'ProdSmoke\\|Smoke'` | ProdSmoke* |
| P0 | disposable 域：`guerrillamailblock.com` 等 | 6 个临时邮 |
| P1 | `email ~* '(^\\|+)(smoke\\|e2e\\|prodsmoke)'` | 防御未来 fixture |
| P2 | 人工白名单/黑名单表（可选） | 误判纠偏 |

**与现码差距（必须修后再开结算）：**  
`server/api/_test-accounts.js` 目前主要认 `@meow.test`、`@mcj-prod-smoke.invalid`、名字含 Smoke。  
**未显式覆盖 `guerrillamailblock.com`**（现靠名字命中）。应扩展启发式，且以 DB flag 为准。

### 3.3 回填策略（未来授权时的步骤，现在不做）

1. Add column（default false）  
2. 按上表 11 个 id **精确 UPDATE**（优先 id 列表，次选启发式）  
3. 同步 `companion_profiles.is_test_account` where `user_id` in test ids  
4. 只读核对：`count(*) filter (where is_test_account)` = 预期  
5. **不**自动标记正式候选 13 人

### 3.4 运营语义

| `is_test_account` | 登录 Prod | 出现在大厅 | 计入 Dashboard | 可触发佣金/积分 |
|---|---|---|---|---|
| `false` | 允许（角色门控） | 是 | 是 | 是（功能开启后） |
| `true` | 建议拒绝（除紧急 break-glass） | 否 | 否 | **否** |

Admin 例外：真实管理员必须是 `is_test_account=false` 的非 `@meow.test` 账号。

---

## 4. 各模块如何过滤

> 目标：所有「正式经营指标」统一走 `!isTestAccount` / `!isTestTouchedOrder`。

### 4.1 Dashboard（后台首页）

**已有：** `admin/dashboard.js` + `_test-accounts.js`  
- 排除 test profiles 的 boss/companion/CS 计数  
- 排除 `isTestTouchedOrder` 的订单 GMV / 完成单 / 平台毛利  

**缺口：**  
- Prod 尚无 `is_test_account` 列 → 目前只靠 email/name 启发式  
- guerrilla 账号依赖名字；改名会漏网  
- 提现统计未证明按 test 过滤（需在开启前补齐）

**设计要求：**  
```text
businessOrders = orders.filter(o => !isTestTouchedOrder(o, testIds))
stats.* 全部基于 businessOrders / filterBusinessProfiles
filter.excluded* 在 API 返回中保留，便于审计
```

### 4.2 Boss 收益（`boss_commission_earnings`）

**现状：** `_boss-commission.js` **未见** test 过滤。

**设计：**
1. **写入门禁（结算 job / complete-order 钩子）**  
   - 若 `boss_id` / `companion_id` / 订单任一方 `is_test_account` → **不创建** earnings 行  
   - 同时不写 `orders.platform_fee` 正式快照，或写快照但 `settlement_status='skipped_test'`（二选一，推荐 skip 不写正式 earnings）
2. **读取门禁（Boss 收益页 / Admin 佣金报表）**  
   - `where boss_id = authBoss and not exists test flag`  
   - Admin 报表默认 `join profiles p on p.id = earnings.boss_id and p.is_test_account = false`  
   - 提供 `?includeTest=1` 仅超管可见
3. **历史 smoke completed 单（6000）**  
   - 开结算后 **禁止回补** 该单佣金  
   - 若误写入，只能 void + 审计，不 DELETE

### 4.3 积分（`user_points_*` / `points_settings`）

**现状：** `_user-points.js` **未见** test 过滤。

**设计：**
1. Award / clawback RPC 调用前：`if (isTestAccount(user)) return {ok:true, skipped:'test_account'}`  
2. 订单完成赠分：订单 `isTestTouchedOrder` → skip  
3. Admin 积分排行/总览：排除 test user_id  
4. 测试环境可用单独开关 `ALLOW_TEST_POINTS=1`（Prod 默认 false）

### 4.4 订单统计

**规则：** 任一参与方为 test ⇒ 整单标为 test-touched，正式统计排除。

| 场景 | 过滤 |
|---|---|
| GMV / 完成单 / 客单价 | 排除 test-touched |
| 转化漏斗 | 排除 |
| 客服绩效单量 | 排除（含 CS 为 smoke 的单） |
| 大厅可接单列表 | companion `is_test_account` 不上架 |
| Admin 订单列表 | 默认隐藏 test；开关「显示测试单」 |

**现网验证预期（标记完成后）：**
- 正式订单统计应只剩 `MCJO000342`（若仍存在）  
- `MCJO000344`（6000）不得进入正式 GMV

### 4.5 统一工具函数（设计约定）

继续以 `server/api/_test-accounts.js` 为 SoT，扩展：

```text
isTestAccountRecord(profile)      // flag || email || name || disposable domain
isTestTouchedOrder(order, testIds)
filterBusinessProfiles(profiles, role)
assertNotTestAccountForSettlement(order)  // 结算前硬门禁
```

---

## 5. Migration 后何时可以开启结算功能

> 这里的「migration」指 pending-prod 01–05（关系/佣金/等级/积分表）+ `is_test_account` 列迁移。

### 5.1 必须全部满足的 Gate（按顺序）

| Gate | 条件 | 为何必须 |
|---|---|---|
| G0 | 01–05 schema apply 成功，只读 checklist 通过 | 否则结算无表可写 |
| G1 | `profiles.is_test_account` 列已存在 | Dashboard/结算缺权威 flag |
| G2 | 上文 11 账号已回填 `true`；companion 镜像一致 | 防漏过滤 |
| G3 | 真实非 test 管理员可登录后台 | 避免 `admin@meow.test` 锁死 |
| G4 | `_test-accounts` 覆盖 disposable 域；Dashboard 回归通过 | 防改名漏网 |
| G5 | Boss 佣金写入路径含 test fail-closed | 防 smoke 单入账 |
| G6 | 积分 award 路径含 test fail-closed | 防测试刷分 |
| G7 | 旧单策略生效：`platform_fee IS NULL` 且 test-touched **不回补** | 防 6000 smoke 单爆发佣金 |
| G8 | feature flag 默认关；灰度开关仅超管 | 可控发布 |
| G9 | 只读对账：正式 GMV 不含 smoke 单；earnings/points 对 test 用户为 0 | 发布前签字 |

### 5.2 建议开启顺序

```text
1) schema 01–05
2) is_test_account 列 + 回填 11 账号
3) 部署带过滤的 API
4) 验证 Dashboard 数字（正式单 ≈ 1，GMV 不含 6000）
5) Staging/Prod shadow：跑结算 dry-run（只日志不写）
6) 开启「新完成订单」结算（不含历史回填）
7) 观察 24–72h
8) 再考虑历史非 test 订单回补（单独变更单）
```

### 5.3 明确：现在还不能开结算

当前同时缺少：
- 佣金/积分表（pending）
- `is_test_account` 列（Prod 缺失）
- 佣金/积分写入侧 test 门禁（代码缺口）
- 真实管理员替代 `admin@meow.test` 的确认

**因此：migration apply 完成 ≠ 可开结算；必须 G0–G9 全绿。**

---

## 6. 可选后续（仍不执行）

1. 扩展 `_test-accounts.js` disposable 域列表  
2. Admin UI：账号详情显示「测试账号」徽章 + 一键标记（写权限另授权）  
3. 报表增加 `include_test=false` 默认参数  
4. 监控告警：若 test 账号产生 `boss_commission_earnings` / points ledger → P0 告警  

---

## 7. 本轮约束声明

- 未 apply migration  
- 未 INSERT / UPDATE / DELETE  
- 未修改 Production 数据  
- 仅只读枚举 + 方案设计  

**文档版本：** 2026-09-05  
**关联：** `APPLY_RUNBOOK.md`、`20260903_profiles_is_test_account.sql`、`server/api/_test-accounts.js`
