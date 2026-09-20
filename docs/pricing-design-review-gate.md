# Design Review Gate — Companion Pricing P1–P5（PR #200）

> **状态：** ✅ 产品已确认「开始 P1」（2026-09-08）→ P1 实现进行中。  
> **硬约束：** **不执行任何 Production migration**；不改 PR #198。  
> **产品终稿：** 与用户 2026-09-08 确认规则一致（见 §0）。  
> **相关文档：** `docs/companion-pricing-system-redesign.md`（总方案）、`docs/pricing-p1-migration-plan.md`（P1 实施清单）。

---

## 0. 产品规则终稿（确认签字栏）

### Pricing Source of Truth

| 规则 | 确认 |
|------|------|
| `base_price` = 等级**默认售价**（SoT） | ✅ |
| `min_price` / `max_price` **仅**后台规则限制，**不是**售卖价来源 | ✅ |
| 新审核流程**必须**绑定等级 | ✅ |
| **禁止** silent Lv1 fallback | ✅ |

### Custom Price Rules

| 规则 | 确认 |
|------|------|
| 陪玩可提交 `custom_price`（`proposed_price`） | ✅ |
| 提交后状态必须为 **pending** | ✅ |
| 未审通过：**不影响**大厅价 / 订单金额 / 结算金额 | ✅ |
| 仅 **approved** custom 进入 effective price | ✅ |

### Effective Price Resolver

```
approved custom_price
        ↓
level base_price
        ↓
legacy fallback（仅迁移期）
```

统一函数：`resolveEffectiveServicePrice()`  
强制统一：大厅、服务详情、下单、订单金额、结算金额、客服查看、后台价格展示。  
**禁止**新增任何直接读取旧价格字段作业务源的逻辑。

### Legacy Fields

| 阶段 | `profiles.price` / `game_prices` |
|------|----------------------------------|
| P5 前 | 仅兼容；禁止新增业务读取；禁止作为价格来源 |
| P5 | 冻结写入；移除 fallback；完成旧字段退役 |

### Level Change Rules

| 情况 | 行为 |
|------|------|
| 服务存在 **approved** custom_price | **保留** custom；不自动覆盖 |
| 无 approved custom | **自动跟随**新的 level `base_price` |

### PRICE_V2 Rollout

| 阶段 | 行为 |
|------|------|
| P4 | Feature flag `PRICE_V2`；Staging 完整验证；Production **灰度**开启 |
| | **禁止**直接全量开启 |

---

## 1. Migration Plan

### 1.1 Schema change（P1）

#### A. `public.companion_levels`

```sql
ALTER TABLE public.companion_levels
  ADD COLUMN IF NOT EXISTS base_price numeric(10,2);

-- backfill then enforce in app (and optionally CHECK / NOT NULL after backfill)
UPDATE public.companion_levels
SET base_price = min_price
WHERE base_price IS NULL;
```

| 列 | 角色 |
|----|------|
| `base_price` | **默认售价 SoT** |
| `min_price` / `max_price` / `max_plus` | **仅**自定义价区间限制（保留，语义收窄） |

可选（P1 或 P3）：`custom_price_requires_review boolean DEFAULT true`。

#### B. `public.companion_services`

```sql
ALTER TABLE public.companion_services
  ADD COLUMN IF NOT EXISTS base_price_snapshot numeric(12,2),
  ADD COLUMN IF NOT EXISTS proposed_price numeric(12,2),
  ADD COLUMN IF NOT EXISTS proposed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS review_note text,
  ADD COLUMN IF NOT EXISTS source text,           -- level_default|admin_set|companion_custom|legacy_import
  ADD COLUMN IF NOT EXISTS level_id_at_price text;
-- existing: price, enabled, review_status, service_id, service_name, ...
```

| 列 | 角色 |
|----|------|
| `price` | **当前生效价**（approved / level_default） |
| `proposed_price` | pending 自定义；**永不**被 resolver 读取为 effective |
| `review_status` | `pending` / `approved`（兼容 `active`）/ `rejected` / … |
| `source` | 改级策略判定（`companion_custom` vs `level_default`） |

#### C. 不在 P1 强制改

- `companion_profiles.price` / `game_prices` — 结构保留，作兼容缓存  
- `orders.price_snapshot` — **P4** 扩展键（`service_row_id`, `base_price`, `effective_price`, `level_id`, `source`）  
- `gameplay_products` — **禁止**牵涉 PR #198  

#### D. DDL 文件

| 环境 | 文件 | 执行 |
|------|------|------|
| Staging | `supabase/migrations/20260908_companion_pricing_p1.sql` | Staging only（P1 实现 PR） |
| Production | `supabase/pending-prod/11_companion_pricing_p1_base_price_services.sql` | **评审稿 only；本阶段禁止执行** |

### 1.2 Data backfill strategy（Staging first）

| Step | 动作 | 规则 |
|------|------|------|
| B1 | 每级 `base_price ← min_price` | 可重跑；人工可后调 |
| B2 | 已通过且可接单陪玩：按 `service_ids` / `game` / `game_prices` upsert `companion_services` | `source=legacy_import`；`price` = 当时卖价；`review_status=approved`；`enabled=true` |
| B3 | 有等级无正价：用 `base_price` 种子行 | `source=level_default` |
| B4 | **无等级**陪玩 | **`allow_orders=false` 暂挂**；**禁止 silent Lv1** |
| B5 | 刷新派生缓存 `profiles.price`（可选） | 取主服务/最低有效价；**不作为 SoT** |
| B6 | 校验 | 每个 `allow_orders=true` + approved 陪玩 ≥ 1 条 enabled+approved 服务行 |

幂等：`ADD COLUMN IF NOT EXISTS`；upsert 按 `(companion_id, service_id|service_name)`；不 DELETE 历史行。

### 1.3 Migration order

```
S0  Read-only schema probe (Staging ref only)
S1  companion_levels.base_price + backfill from min_price
S2  companion_services column adds
S3  PostgREST schema reload (if applicable)
S4  Backfill companion_services rows (legacy_import / level_default)
S5  Quarantine no-level companions (allow_orders=false)
S6  Offline verify + Staging checklist (§4)
S7  pending-prod SQL attached for human review — NO Prod execute
─── gate: design review signed + Staging PASS ───
P2…P5  application / custom / PRICE_V2 gray / freeze legacy
```

**P4 才**用 `PRICE_V2` 灰度切读；**禁止** P1–P3 直接全量关掉 legacy。

### 1.4 Rollback strategy（概要；细节见 §3）

1. **先关行为**：revert 实现 PR / `PRICE_V2=0`  
2. **再评估数据**：新列可保留；`legacy_import` 可识别  
3. **最后**才考虑 DDL 回退（默认 **不** DROP 有数据的列）  
4. Production：若误跑 pending SQL → 停依赖新列的代码；**禁止**盲目 DROP  

---

## 2. Affected Tables

| Table | Current usage | New usage | Migration impact |
|-------|---------------|-----------|------------------|
| **`companion_levels`** | `min_price`/`max_price` 约束改价区间 + 抽成/视觉 | **`base_price` = 默认售价 SoT**；min/max 仅限自定义规则 | **+** `base_price`；回填 `= min_price`；Admin CRUD 必填 |
| **`companion_services`** | 表已存在；Marketplace 偶尔读；几乎无写入/审核 | **卖价 SoT 行**：生效价、pending 自定义、改级 source | **+** proposed/source/snapshot/audit 列；Staging 回填行 |
| **`companion_profiles`** | `price`/`game_prices` = 今日卖价 SoT；申请必写 | P5 前：**兼容缓存 only**；禁止新业务读；审核/改价写服务行后可刷新派生 | **无破坏性 DDL**；行为在 P2–P5 改变 |
| **`orders`** | `unit_price` + `price_snapshot`；直下单读 profiles | P4+：快照扩展 effective/base/source；金额只来自 resolver | **P1 可不改 DDL**；P4 扩展 jsonb 键 |
| **`services`**（目录） | 游戏元数据 / `default_price` 文案 | 仍作目录；**不是**陪玩售卖 SoT | 无强制 DDL |
| **`profiles`** | 身份/角色 | 不变；审核绑的是 companion 侧 level | 无 |
| **`gameplay_products`** | 玩法商城价/抽成（#198） | **隔离，不改** | **零** |

### 解析器消费面（必须统一，禁止旁路）

| Module | Today | Target |
|--------|-------|--------|
| 陪玩大厅 | `profiles.price` | `resolveEffectiveServicePrice`（卡片主价派生） |
| 服务详情 | gamePrices / price | 同上 |
| 下单流程 | `priceForGame` | 同上 |
| 订单金额计算 | 同上 | 同上 + snapshot |
| 结算金额 | 订单快照 / 当时单价 | 以订单快照为准；新单来自 resolver |
| 客服查看/代下 | `priceForGame` + 客户端 | 同上 |
| 后台价格展示 | 散落 price / game_prices | 服务行 + resolver |

---

## 3. Rollback Plan

### 3.1 关闭 `PRICE_V2`

| 环境 | 动作 |
|------|------|
| Staging / Prod | 设 `PRICE_V2=0`（或删除 env / 默认 false） |
| 期望行为 | 读路径允许 **legacy fallback**（P1 保留的 `priceForGame` / `profiles.price` 分支） |
| 注意 | P5 之后若已删 fallback，关 flag **不够**——需 revert P5 或紧急热修恢复 fallback |

### 3.2 恢复 legacy price resolver

| 阶段 | 如何恢复 |
|------|----------|
| P1–P3（flag 未切 / 默认等价） | Revert 对应 PR 即可；或确保调用仍带 legacy 第三段 |
| P4（灰度中） | **立即** `PRICE_V2=0`；监控大厅/下单金额回到旧口径 |
| P5 后 | Cherry-pick / revert「删 fallback」提交；临时重新打开第三段并告警 |

合同（P1 落地，不可删到 P5）：

```
1) enabled + approved/active companion_services.price   // 含 approved custom
2) else level.base_price
3) else legacy priceForGame / profiles.price            // PRICE_V2 off 或迁移期
```

`proposed_price` **永远**不进入 1)。

### 3.3 回滚 migration（DDL）

| 策略 | 说明 |
|------|------|
| **推荐** | **保留新列**；代码不再依赖即可。避免二次 ADD 风险 |
| Staging 可接受 | 无生产流量时可 DROP 新列（仅 Staging 实验库） |
| Production | **禁止**在未评估数据前 DROP；误执行后以「停写 + 保留列」为主 |

回滚顺序：**代码/flag → 停回填脚本 →（可选）软禁 `source` 新行 `enabled=false` → 最后才 DDL**。

### 3.4 数据恢复策略

| 场景 | 恢复 |
|------|------|
| 回填写错服务价 | 用回填前导出的 `profiles.price`/`game_prices` 快照重跑 upsert（`source=legacy_import`） |
| 误把 pending 当生效 | 清 `proposed_*` 或保持 `review_status=pending`；确认 `price` 未改 |
| 改级误覆盖 custom | 按 `source=companion_custom` + 审计 `reviewed_*` 还原 `price`；禁止静默重算 |
| 无等级被 silent Lv1（违规） | 清除错误 level；`allow_orders=false`；运营重审 |
| 订单金额争议 | **以 `orders.unit_price` / `price_snapshot` 为准**（历史单不重算） |

---

## 4. Staging Verification Checklist

> **仅 Staging**（`cfccwysniduwkjskiqgy`）。拒绝 Production URL/凭证回落。

### 4.0 前置

- [ ] `STAGING_SUPABASE_URL` / `STAGING_SUPABASE_SERVICE_ROLE_KEY` 已注入且 ref 正确  
- [ ] **未**使用 `SUPABASE_*` / `PROD_*` 指向 Production  
- [ ] Offline：`verify-pricing-p1-offline.mjs`（或等价）PASS  
- [ ] **本阶段未执行 Production migration**

### 4.1 价格来源

| Case | Expected | Pass |
|------|----------|------|
| 仅有 level `base_price`，无 custom | effective = **base_price** | [ ] |
| 存在 **approved** custom_price | effective = **approved custom**（≠ proposed） | [ ] |
| 存在 **pending** custom_price | effective **仍为**旧 approved 或 base；大厅/下单/结算**不变** | [ ] |
| `min_price`/`max_price` 变更 | **不**单独改变售卖价（仅影响后续自定义校验） | [ ] |
| legacy only（无服务行，迁移期） | fallback = profiles/game_prices；打 `source=legacy_profile` | [ ] |

### 4.2 流程端到端

| Flow | Expected | Pass |
|------|----------|------|
| **新申请** | 无最终单价字段；submit 不写售价 SoT | [ ] *(P2)* |
| **审核** | 无等级 → 失败；有等级 → 种子服务行 `price=base_price`；**无 silent Lv1** | [ ] *(P2)* |
| **陪玩上传自定义价** | 写入 `proposed_price` + `pending`；不改 `price` | [ ] *(P3)* |
| **后台审核自定义价** | approve → `price=proposed`，清 proposed，`source=companion_custom`；reject → 旧 effective 不变 | [ ] *(P3)* |
| **大厅展示** | 展示价 = resolver；pending 不可见为涨价 | [ ] *(P4 强制；P1 等价可测)* |
| **创建订单** | unit = resolver；客户端漂移 → 400 | [ ] |
| **订单金额** | `unit_price * qty` 与 resolver 一致；snapshot 含 source | [ ] *(snapshot 键 P4)* |
| **结算金额** | 基于订单快照/当时单价；不受事后 pending 影响 | [ ] |
| **客服查看** | 与大厅/下单同价（同一 resolver） | [ ] |
| **改等级** | 有 approved custom → 保留；无 → 跟随新 base | [ ] *(逻辑 P1 单测；写路径 P2/P3)* |

### 4.3 Flag / 回滚演练（Staging）

- [ ] `PRICE_V2=0`：可读 legacy；金额回退口径符合预期  
- [ ] `PRICE_V2=1`（P4）：旁路直读 `profiles.price` 的路径应消失或告警  
- [ ] **禁止** Staging 未 PASS 就在 Production 全量开 flag  

### 4.4 退出门禁

| Gate | 条件 |
|------|------|
| 开始 **P1 编码** | **本文档确认签字** + 不执行 Prod migration |
| P1 → P2 | Staging schema + 回填 + 解析器清单 PASS；pending-prod 仅评审 |
| P4 Production 灰度 | Staging 全流程 PASS；flag 灰度计划书面确认 |
| P5 | fallback 命中 ≈ 0；稳定观察期 |

---

## 5. P1–P5 执行拆分（确认后按序开 PR）

| Phase | PR 主题 | Prod migration? |
|-------|---------|-----------------|
| **P1** | `base_price` + services 列 + `resolveEffectiveServicePrice` + Staging 回填 + flag 脚手架 | **否**（仅 pending 稿） |
| **P2** | 申请去价；审核强制绑级；禁 silent Lv1；种子 base | 视列是否已在 Prod；默认仍 Staging 先 |
| **P3** | 陪玩自定义 pending + 后台审 | 同左 |
| **P4** | 服务总览；全通道切 resolver；**`PRICE_V2` 灰度** | 需人工窗口；**禁止直接全量** |
| **P5** | 冻结 legacy 写；删 fallback | 行为变更；DDL 非必须 |

---

## 6. 确认签字（等待回复）

请确认下列项后，再指示「开始 P1」：

- [ ] §0 产品规则终稿无异议  
- [ ] §1 Migration Plan（含 **不跑 Prod migration**）同意  
- [ ] §2 Affected Tables 同意  
- [ ] §3 Rollback Plan 同意  
- [ ] §4 Staging Verification Checklist 同意作为验收门禁  

**确认前：不开始 P1 实现、不执行 Production migration、不开启 Production `PRICE_V2`。**

---

*Design review gate · 2026-09-08 · PR #200*
