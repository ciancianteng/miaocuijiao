# 陪玩定价体系重构方案（PR #200 · 设计稿）

> **范围：** 仅方案与 UI 页面设计 + **P1–P5 实现 PR 拆分**，**不包含实现代码**。  
> **约束：** 不修改 PR #198（gameplay `commission_rate` 独立 / BLOCKED）；不在本 PR 改业务逻辑 / 跑 Production migration。  
> **状态：** 产品规则已确认（§0）→ 按 P1–P5 分 PR 落地，禁止大改生产一锅端。  
> **复核日期：** 2026-09-08c。

---

## 0. 产品规则锁定（2026-09-08 确认）

| # | 规则 | 含义 |
|---|------|------|
| **R1** | 删除陪玩申请填写价格逻辑 | 申请阶段**不产生售价**；submit 忽略/拒绝 `price` / `game_prices` |
| **R2** | 等级必须绑定 `base_price`；审核通过必须选等级 | 无 `base_price` 的等级不可用；无等级不可通过审核（禁止静默 Lv1） |
| **R3** | 等级价格 = 默认售价 SoT | 审核通过后按等级 `base_price` 种子 `companion_services.price` |
| **R4** | 陪玩自定义价只能提交 pending | **禁止**直接覆盖生效价；pending 期间下单仍用旧 effective |
| **R5** | 后台新增自定义价审核 + 服务总览 | 独立审核队列 + 全量服务矩阵 |
| **R6** | 下单 / 大厅 / 订单金额统一 `resolveEffectiveServicePrice` | 禁止各通道各自读 `profiles.price` |
| **R7** | `profiles.price` / `game_prices` 降为缓存 | **不再作为业务来源**；仅派生展示兼容，P5 冻结写路径 |

### 落地原则（防大改生产）

1. **一阶段一 PR**，可独立 revert；禁止 P1–P5 打成一个巨型 PR。  
2. **Staging 先行**：schema / 回填 / 读切流只在 Staging 验证 PASS 后再申请 Prod migration。  
3. **Feature flag `PRICING_V2`**：读路径可回退；新表写入可保留不阻断旧路径，直到 P4/P5 切流完成。  
4. **先加后切**：P1 引入解析器（内含 legacy fallback）→ P2–P3 改写路径 → P4 切读路径 → P5 删 fallback / 冻结缓存写。  
5. **不改 PR #198**；玩法商品抽成与本体系隔离。

### 一句话目标模型

**等级 `base_price` → 审核强制绑级并种子服务行 → 陪玩只能 pending 自定义价 → 后台审通过后再生效 → 全站只读 `resolveEffectiveServicePrice`；`profiles.price`/`game_prices` 仅缓存。**

---

## 1. 当前价格字段来源（SoT 审计）

### 1.1 写入路径（谁决定卖价）

```
┌─────────────────────┐
│ companion-apply.html │  「接单价格（必填）」hourlyPrice / gamePriceMap
│ companion-application.js │
└──────────┬──────────┘
           │ POST /api/companion  action=submit_application
           │ body.price + body.game_prices
           ▼
┌──────────────────────────────────────────────┐
│ companion_profiles.price          ← 主卖价   │  ← 今日 SoT
│ companion_profiles.game_prices    ← 分游戏价 │
└──────────────────────────────────────────────┘
           │
           ├─ 工作台改价（已通过陪玩）→ companion.js update_profile
           │     仍直接写 price / game_prices（等级仅做 min/max clamp）
           │
           └─ set_level：仅当当前无正价时，用 level.min 补价
                 （有自填价时等级不会覆盖）
```

### 1.2 读取路径（谁用卖价）

| 消费端 | 单价来源 | 文件 |
|--------|---------|------|
| 大厅 / 首页卡片 | `profiles.price` → `sellingPrice` | `server/api/public/companions.js` |
| 老板直下单 `place_order` | **服务端** `priceForGame(cp)` → `cp.price` → 首个正 `game_prices`；客户端仅防漂移 | `server/api/orders.js`, `_game-prices.js` |
| Marketplace | 优先 `companion_services.price`（若有行）；否则 `servicesFromGamePrices` | `server/api/boss/marketplace.js` |
| 客服代下 | 优先 `priceForGame`，再退客户端 | `server/api/customer-service.js` |
| 等级区间文案 | `min_price`–`max_price`（**展示/校验上限，非卖价**） | `_companion-levels-store.js` |

### 1.3 等级价为何「失效」

| 机制 | 实际行为 |
|------|---------|
| `companion_levels.min_price / max_price` | 只约束工作台改价区间；**不是**下单基础单价 |
| 申请自填价 | 审核硬要求正价格（`assertHasPositivePrice` / `MISSING_PRICE`） |
| 审核绑等级 | **可选**；空则 `approveListingPatchForRow` 静默补 Lv1 |
| `set_level` | 仅 `!(price > 0)` 时写 `price = min`；已有自填价则不动 |
| `companion_services` | 表已存在且 Marketplace 可读，但申请/审核/工作台**几乎不写**；默认 `review_status='approved'` |

**结论：** 后台设等级价 ≠ 卖价；卖价始终跟申请人/陪玩自填走。

### 1.4 价格相关字段一览

| 位置 | 字段 | 角色（现状） |
|------|------|-------------|
| `companion_profiles` | `price` | **主卖价 SoT** |
| `companion_profiles` | `game_prices` jsonb | 分游戏卖价 SoT |
| `companion_profiles` | `pricing_unit` | 默认「小时」 |
| `companion_profiles` | `commission_rate` | 抽成（可被等级 sync） |
| `companion_levels` | `min_price` / `max_price` / `max_plus` | 改价区间 |
| `companion_levels` | `commission_rate` | 等级抽成模板 |
| `companion_services` | `price` / `enabled` / `review_status` | 预留 SoT；产品化不足 |
| `orders` | `unit_price` / `price_snapshot` | 下单快照 |

**没有** `base_price`；**没有**「自定义价待审」写路径。

---

## 2. `companion_profiles` 结构（与定价相关）

### 2.1 核心列（init + 增量迁移合并视图）

来源：`supabase/init.sql`、`companion-admin-data.sql`、`companion-marketplace.sql`、`20260731_companion_service_*.sql`。

| 分组 | 字段 | 定价/接单相关说明 |
|------|------|------------------|
| 身份 | `id`, `user_id`, `companion_uid`, `nickname` | 大厅/下单锚点 |
| **卖价** | **`price`**, **`game_prices`**, `pricing_unit` | 今日卖价 SoT |
| 服务目录 | `game`, `main_service`, `service_ids`, `service_type` | 开通游戏/类型；**非单价** |
| 等级 | `level_id`, `level_name`, `level_effective_at` | 可空；不驱动卖价 |
| 抽成 | `commission_rate`, `gift_commission_rate`, `direct_rebate_rate`, `commission_effective_at` | 结算用 |
| 审核/接单门 | `application_status`, `verification_status`, `deposit_status`, **`allow_orders`**, `media_status` | 通过后 `allow_orders=true` 才可公开接单 |
| 在线 | `online_status`, `availability_status` | 接单开关（全局在线态，非按游戏） |
| 资料 | `description`, `voice_url`, `card_image_url`, `tags`, `age`, `gender`, `region`, … | 能力展示 |

### 2.2 接单门禁（现状）

大厅可见 ≈ `verification/application approved` + `allow_orders !== false` + 账号 active + 非测试（见 `_companion-publish-gate.js` / public companions）。  

但：**首次审核通过硬要求已有正价格**（`assertApproveCanPublish` → `criticalMissing` 含价格），等于「没自填价就审不过」——这正是等级价失效的根因之一。

陪玩工作台：未通过可登录填资料，文案明确「审核通过前不可接单」（`companion-workbench.js`）。

### 2.3 与目标结构的差距

| 目标概念 | 现状落点 | 差距 |
|----------|---------|------|
| 等级基础价 | 无 | 需 `companion_levels.base_price` |
| 每游戏服务价 + 开闭 | 散落 `game_prices` + 全局 `availability_status` | 启用并增强 `companion_services` |
| 自定义价审核 | 无 | `proposed_price` + pending 队列 |
| 申请不写卖价 | 必写 | 删申请价 + 改 gate |

---

## 3. 下单价格链路（端到端）

### 3.1 老板直下单（主路径）

```
老板选陪玩/游戏/时长
        │
        ▼
POST /api/orders  action=place_order
        │
        ├─ 加载 companion_profiles（含 price, game_prices, allow_orders, …）
        ├─ unitPrice = priceForGame(cp, game, serviceId)
        │     1) game_prices[serviceId|name]
        │     2) else cp.price
        │     3) else 首个正 game_prices
        ├─ 与客户端 unit 比对，漂移 → 400
        └─ 写 orders.unit_price + total + price_snapshot
```

**已 server-authoritative**，但权威源仍是「陪玩自填卖价」，不是等级基础价。

### 3.2 Marketplace

```
loadCompanionServices(userId)
  → SELECT companion_services WHERE enabled AND review_status=approved
  → 若空：fallback servicesFromGamePrices(profiles)
老板选服务行 → 下单用该行 price
```

表已就绪，缺写入/审核工作流 → 几乎总是走 JSON fallback。

### 3.3 大厅展示

`GET /api/public/companions` → `sellingPrice = money(row.price)`；等级区间仅作 `levelPriceRange` 文案，**不替代卖价**。

### 3.4 目标统一解析器

```
resolveEffectiveServicePrice(companionId, serviceId) =
  companion_services 行：
    enabled=true
    AND review_status IN ('active','approved')
    → price
  迁移期 fallback：priceForGame(legacy) / profiles.price

下单 / 大厅 / Marketplace / CS → 全部只调此函数
订单快照扩展：service_row_id, base_price, effective_price, level_id, source
```

---

## 4. UI：现有 vs 需要新增

### 4.1 现有（改造）

| 页面 | 路径 / 入口 | 改动要点 |
|------|------------|---------|
| 陪玩申请 | `companion-apply.html` + `src/companion-application.js` | **删除**「接单价格（必填）」整块；保留游戏/能力；加价格说明信息条 |
| 后台申请审核 | `src/admin-companion-applications.js` + player detail | **强制选等级**；预览基础价与将生成的服务行；取消「无价不可过」；取消静默 Lv1（或显式勾选） |
| 陪玩工作台资料/改价 | `src/companion-workbench.js` profile 表单 | **关闭直写生效价**；改价入口迁到「我的服务」 |
| 后台等级配置 | `src/admin-companion-levels.js` | 增加 `base_price`、自定义需审开关 |
| 大厅 / 详情 / 下单 | hall + orders UI | 只展示 enabled+approved 服务与 effective 价 |

### 4.2 需要新增

| # | 页面 | 角色 | 核心能力 |
|---|------|------|---------|
| **N1** | **我的服务 / 价格管理** | 陪玩 | ① **添加游戏**（选平台服务目录 → 生成 pending/默认价行）② **按游戏开启/关闭接单**（`enabled`）③ **提交自定义价**（`proposed_price`→pending）④ 查看驳回原因 / 撤回待审 |
| **N2** | **陪玩服务与价格总览** | 后台 | 全量矩阵：陪玩 / 游戏 / 等级 / 基础价 / 当前有效价 / 待审价 / 状态；行内强制改价（`admin_set`） |
| **N3** | **自定义价审核队列** | 后台 | Tab 或独立队列：pending 通过/驳回 + `review_note`（可与 N2 同页 Tabs） |

可选：`companion/services/index.html` 或工作台内 Tab；后台挂在「陪玩列表 / 等级配置」并列导航。

### 4.3 线框摘要

**申请页（去价格）**

```
【游戏/能力】勾选游戏 + 段位/位置…
┌ 信息条（非表单）────────────────────────────┐
│ 服务单价由平台等级在审核通过后设定。           │
│ 通过后可在「我的服务/价格」申请自定义价格。     │
└─────────────────────────────────────────────┘
```

**陪玩 · 我的服务（新）**

```
当前等级 Lv2 · 基础价 RM30 · 自定义区间 30–40 · 偏离需审
开 │ 游戏     │ 有效价 │ 自定义申请 │ 状态
✓ │ 无畏契约 │ 30     │ [申请改价] │ 等级默认
✓ │ 英雄联盟 │ 35     │ 待审 38    │ 自定义待审（下单仍 35）
  │ [+ 添加游戏] …
全局在线态仍可用；按游戏 enabled 决定该游戏可否被下单。
```

**后台 · 服务总览 + 待审（新）**

```
Tabs: [全部服务] [自定义价待审 (n)] [已关闭]
陪玩 │ 游戏 │ 等级 │ 基础价 │ 当前价 │ 待审价 │ 操作
```

**审核详情（改造）**

```
等级 * [Lv2 ▼]  → 基础价预览 RM30（只读）
开通服务将按基础价生成：游戏A→30，游戏B→30
[通过] 无等级 → 拒绝
```

---

## 5. 目标领域模型

### 5.1 原则

1. **卖价 SoT** = `companion_services`（陪玩 × 游戏/服务一行）  
2. **等级** 提供 `base_price` + 自定义区间/是否需审  
3. **`profiles.price`** → **派生缓存**（主服务或最低有效价，兼容旧大厅）；申请禁止直写  
4. **`game_prices`** → 迁移期只读 → 冻结写  
5. **一切下单通道** → `resolveEffectiveServicePrice`

### 5.2 单服务价格状态机

```
审核通过绑等级 → active @ base_price
        │ 陪玩提交自定义价
        ▼
  pending_custom（大厅/下单仍用上一档 effective）
   ├─ approved → 新价生效（source=companion_custom）
   └─ rejected → 保持旧 effective；可再提

enabled=false → 不可选、不进大厅服务列表（行保留）
```

### 5.3 Schema 变更（设计层，本 PR 不执行）

#### A. `companion_levels`

| 列 | 说明 |
|----|------|
| `base_price numeric(10,2)` | **等级默认服务单价（必填）** |
| 保留 `min_price` / `max_price` / `max_plus` | 自定义允许区间 |
| `custom_price_requires_review boolean default true` | 偏离 base 是否必须审 |
| `max_custom_delta_pct` 可选 | 相对 base 上浮封顶 |

回填：`base_price = min_price`，再人工校准。

#### B. `companion_services`（主 SoT）

| 列 | 说明 |
|----|------|
| 现有 `price` / `enabled` / `review_status` | 生效价；扩展 pending 语义 |
| `base_price_snapshot` | 绑定时等级基础价 |
| `proposed_price` / `proposed_at` | 待审 |
| `reviewed_at` / `reviewed_by` / `review_note` | 审核审计 |
| `source` | `level_default` \| `admin_set` \| `companion_custom` \| `legacy_import` |
| `level_id_at_price` | 定价时等级 |

#### C. `companion_profiles` 行为

- 申请：**禁止**写 `price` / `game_prices`  
- 审核通过：强制 `level_id`；按申请游戏 upsert `companion_services`（`price=base_price`）；刷新派生 `price`；`allow_orders=true`（其它门禁照旧）  
- 改级：策略见 §10（保留自定义 vs 回 base）

#### D. 订单

继续 `unit_price` + 扩展 `price_snapshot`；禁止信任客户端单价（已有直下路径；扩到 CS 等）。

---

## 6. 业务流程改造（对齐 6 项目标）

| # | 目标 | 改造要点 |
|---|------|---------|
| 1 | 申请移除自由单价 | 删 `applyPriceFieldsHtml` / `draftHasPositivePrice` / submit 的 price 字段；文案改说明条 |
| 2 | 等级决定基础价 | levels + `base_price`；审核/改级种子服务价 |
| 3 | 审核通过后才能接单 | 保持并强化：未 approved / `allow_orders=false` / 无任何 enabled 服务 → 不可抢单、不可被下单；**取消「无价不可审」**，改为「无等级不可审」 |
| 4 | 陪玩服务管理 | 新页 N1：添加游戏、按游戏开闭、提交自定义价 |
| 5 | 自定义价后台审 | 新页 N2/N3；通过才改 `price` |
| 6 | 下单读正确价 | 全通道 `resolveEffectiveServicePrice`；大厅同源派生 |

---

## 7. API 改造清单（实现阶段）

| API | 变更 |
|-----|------|
| `POST /api/companion` `submit_application` | 忽略/拒绝 `price`、`game_prices`；放宽缺价 gate |
| `POST /api/companion` `update_profile` | 禁止直接改生效卖价 |
| `POST /api/companion` 新 `list_my_services` / `add_service` / `toggle_service` / `propose_custom_price` / `withdraw_proposal` | 陪玩端服务管理 |
| `POST /api/admin/players` `review_application` | **强制 levelId**；种子 `companion_services`；取消缺价硬挡 |
| `POST /api/admin/players` `set_level` | 重算未自定义服务 base |
| 新 `GET/POST /api/admin/companion-services` | 总览、待审、通过/驳回、admin 强制改价 |
| `GET/POST` 等级 admin | CRUD `base_price` + review flags |
| `GET /api/public/companions` | 主价改读有效服务派生；`services[]` 仅 enabled+approved |
| `POST /api/orders` `place_order` | 统一解析器 + snapshot 扩展 |
| Marketplace / CS | 同上 |

---

## 8. 数据迁移与风险

### 8.1 回填

1. `companion_levels.base_price ← min_price`  
2. 已通过陪玩：按 `service_ids` / `game` / `game_prices` 生成 `companion_services`；`source=legacy_import`；`review_status=approved`  
3. 无价陪玩：用等级 `base_price` 填充  
4. 校验：每个 `allow_orders` 且 approved 的陪玩 ≥ 1 条 enabled 服务  

### 8.2 主要风险

| 风险 | 等级 | 缓解 |
|------|------|------|
| 大厅突然改价 | 中 | 首发派生价 = 旧 `profiles.price`；先切写路径 |
| 旧工作台 API 绕过审核直写价 | 高 | 服务端关闭直写；E2E 断言 pending 不进下单 |
| `companion_services` 与 `game_prices` 双写不一致 | 高 | 单写新表；读优先新表 fallback JSON |
| 改级 vs 已通过自定义价 | 中 | 产品二选一（§10） |
| Production 缺列静默成功 | 高 | Staging 先跑；fail-loud（对齐 #198 教训，但**不改 #198**） |

### 8.3 回滚

Feature flag `PRICING_V2`：off 时回退旧 `price`/`game_prices` 读；新表保留不阻断。  
任一实现 PR 出问题：先关 flag / revert 该 PR，**不要**连带回滚已验证的前置阶段 schema（除非该阶段自身有缺陷）。

---

## 9. P1–P5 实现 PR 拆分（产品规则已锁定）

> **本 PR #200 = P0 设计 only。** 以下每个阶段单独开 PR、单独 Staging 验证、单独可 revert。  
> 依赖只能向前：P1 → P2 → P3 → P4 → P5。  
> **禁止**把读切流 + 写切流 + 删 fallback 塞进同一 PR。

### 依赖与切流总览

```
P0 设计 (#200) ──已确认──┐
                         ▼
              P1 Schema + 解析器 + Staging 回填
                 │  (读仍 fallback 旧价；写双写缓存)
                 ▼
              P2 申请去价 + 审核强制等级种子服务
                 │  (新通过陪玩走新 SoT；存量靠回填)
                 ▼
              P3 陪玩服务管理 + 自定义价 pending + 审核队列
                 │  (关闭陪玩直写生效价)
                 ▼
              P4 后台服务总览 + 大厅/下单全面切 resolve*
                 │  (flag 默认开；legacy fallback 仍保留但应无命中)
                 ▼
              P5 冻结 profiles.price/game_prices 业务写 + 删 fallback
```

---

### P1 — Schema + `resolveEffectiveServicePrice` + Staging 回填

| 项 | 内容 |
|----|------|
| **覆盖规则** | R2（`base_price` 列）、R3（等级默认价落表）、R6（解析器落地）、R7（开始把 profiles 当缓存双写） |
| **目标** | 基础设施就位；**生产读行为不变或等价**（有 flag / fallback） |
| **含** | |
| Schema | `companion_levels.base_price`（NOT NULL，回填 `= min_price`）；`companion_services` 增强列（`proposed_*` / `source` / `base_price_snapshot` / `level_id_at_price` / review 审计字段） |
| 代码 | 新 `resolveEffectiveServicePrice(companionId, serviceId)`：优先 enabled+approved 服务行 → fallback `priceForGame` / `profiles.price` |
| 回填 | Staging only：存量服务行 `legacy_import`；无服务行则从 `game_prices`/`price` 生成；无价用 `base_price` |
| 等级 Admin | 可编辑/校验 `base_price`（缺则 fail-loud） |
| 测试 | 单测：解析器优先级；Staging schema diff；缺列 fail-loud（对齐 #198 教训，不改 #198） |
| **不含** | 申请 UI 去价、审核强制等级、陪玩服务页、大厅强制切流、Prod 写迁移 |
| **Prod 策略** | 仅提交 **pending-prod SQL 评审稿**；本 PR **不执行** Prod migration；flag 默认 off 或解析器默认仍走 fallback |
| **验收** | Staging：每等级有 `base_price`；回填后 `allow_orders` 陪玩 ≥1 条服务；解析器单测绿；旧下单金额与回填前一致（等价） |
| **回滚** | revert 代码；新列可留；flag off |

**建议 PR 标题：** `feat(pricing-p1): base_price + companion_services fields + resolveEffectiveServicePrice`

---

### P2 — 申请去价 + 审核强制等级并种子服务

| 项 | 内容 |
|----|------|
| **覆盖规则** | R1、R2、R3 |
| **依赖** | P1 merged + Staging schema/回填 PASS |
| **目标** | 新申请不再产生售价；新审核通过必须选级并以 `base_price` 生成服务行 |
| **含** | |
| 申请 UI | 删除「接单价格」控件与校验；信息条说明价格由等级设定 |
| 申请 API | `submit_application` 忽略/拒绝 `price`/`game_prices`；取消 `assertHasPositivePrice` 申请硬挡 |
| 审核 API/UI | `review_application` **强制 `levelId`**；取消静默 Lv1；取消「无价不可过」；通过时 upsert `companion_services`（`price=base_price`, `source=level_default`）；刷新派生缓存 `profiles.price` |
| 接单门 | 审核通过 + 至少 1 条 enabled 服务才可接单（与现有 `allow_orders` 对齐） |
| **不含** | 陪玩自定义价、后台总览页、删 legacy 读 |
| **Prod 策略** | 行为变更仅影响**新申请/新审核**；存量已回填陪玩价格不变 |
| **验收** | 申请页无单价；submit payload 无售价；无等级审核 → 400；有等级 → 服务行价 = 该级 `base_price`；新通过陪玩可被下单且单价 = base |
| **回滚** | revert P2；P1 解析器/表保留 |

**建议 PR 标题：** `feat(pricing-p2): remove apply price + require level on approve`

---

### P3 — 陪玩服务管理 + 自定义价 pending + 审核队列

| 项 | 内容 |
|----|------|
| **覆盖规则** | R4、R5（审核队列部分） |
| **依赖** | P2 |
| **目标** | 陪玩可管服务，但**不能**直接改生效价；自定义价进 pending |
| **含** | |
| 陪玩端 N1 | 「我的服务/价格」：添加游戏、按游戏 `enabled` 开闭、查看有效价/基础价、提交/撤回自定义价 |
| API | `list_my_services` / `add_service` / `toggle_service` / `propose_custom_price` / `withdraw_proposal` |
| 关闭直写 | `update_profile` 等旧改价路径：**禁止**写生效 `price`/`game_prices`（或强制转 propose） |
| 后台 N3 | 自定义价待审队列：通过（`price=proposed`，清 pending，`source=companion_custom`）/ 驳回（记 `review_note`） |
| **不含** | 完整服务总览矩阵（留给 P4）；删 fallback |
| **Prod 策略** | 新功能；旧直写关闭需配套工作台入口迁移，避免陪玩无路可改 |
| **验收** | 提交自定义价后大厅/下单仍旧价；后台通过后变新价；直写生效价 API → 400；pending 可撤回 |
| **回滚** | revert P3；恢复旧改价路径仅作应急（需显式），默认不长期保留 |

**建议 PR 标题：** `feat(pricing-p3): companion service mgmt + custom price pending review`

---

### P4 — 后台服务总览 + 全通道切 `resolveEffectiveServicePrice`

| 项 | 内容 |
|----|------|
| **覆盖规则** | R5（总览）、R6、R7（读路径不再以 profiles 为业务源） |
| **依赖** | P3；Staging 上「解析器命中服务行率」足够高（目标 ≈100% 可接单陪玩） |
| **目标** | 大厅、详情、直下单、Marketplace、CS **全部**走统一解析器；后台可看全量矩阵 |
| **含** | |
| 后台 N2 | 「陪玩服务与价格」总览：筛等级/游戏/状态；展示基础价/当前价/待审价；admin 强制改价（`admin_set`） |
| 读切流 | `public/companions`、`orders.place_order`、`boss/marketplace`、CS 代下 → 只调 `resolveEffectiveServicePrice` |
| 派生缓存 | 写服务行后同步刷新 `profiles.price`（缓存）；读业务忽略缓存 |
| Flag | `PRICING_V2` 默认 on（Staging 先）；fallback 仍保留但打 metric/日志，便于 P5 确认零命中 |
| **不含** | 删除 `game_prices` 列；删除 fallback 代码 |
| **Prod 策略** | 灰度：先 Staging 全量 → Prod flag on → 观察 drift/400 与 fallback 命中 |
| **验收** | 总览数字 = 大厅主价 = 下单单价；故意改缓存 `profiles.price` **不影响**下单；CS/Marketplace 同价 |
| **回滚** | flag off → 解析器重新走 legacy fallback（P1 保留的路径） |

**建议 PR 标题：** `feat(pricing-p4): admin service matrix + cut over all reads to resolver`

---

### P5 — 冻结缓存写 + 清理 legacy

| 项 | 内容 |
|----|------|
| **覆盖规则** | R7 收尾 |
| **依赖** | P4 生产稳定；fallback 命中 ≈ 0；无 #198 类静默缺列问题 |
| **目标** | `profiles.price` / `game_prices` **不再作为任何业务写/读来源**（只读派生或只写缓存 helper） |
| **含** | |
| 冻结写 | 删除/拒绝业务路径对 `game_prices` 的写入；`price` 仅允许 `syncDerivedProfilePrice()` 内部写 |
| 删 fallback | `resolveEffectiveServicePrice` 无服务行 → 明确 400（不可下单），不再读旧 JSON |
| 脚本/文档 | 更新 verify / e2e / publish-gate；申请价相关断言删除 |
| 可选 | DB comment 标注 deprecated；暂不 drop 列（避免大迁移） |
| **不含** | drop 列、改 gameplay/PR #198、礼物经济 |
| **Prod 策略** | 最后上；需 Prod 只读审计「无服务行却 allow_orders」= 0 |
| **验收** | 旧 API 写 `game_prices` → 拒绝；无服务行不可下单；文档与脚本无「申请必填价」 |
| **回滚** | 恢复 fallback 仅紧急（从 P4 tag）；正常应不需要 |

**建议 PR 标题：** `feat(pricing-p5): freeze profile price cache writes + remove legacy fallback`

---

### 阶段边界检查清单（每个实现 PR 合并前）

- [ ] 只包含本阶段「含」列表；无跨阶段偷跑  
- [ ] Staging 验证记录附在 PR 描述  
- [ ] 明确 **不执行** 未经评审的 Prod migration  
- [ ] 声明与 PR #198 无交集  
- [ ] 有回滚步骤（flag / revert）  
- [ ] 验收标准可勾选

---

## 10. 验收标准（P1–P5 全部完成后）

对齐已锁定规则 R1–R7：

1. **R1** 申请页无最终单价；submit 不产生售价。  
2. **R2** 审核无等级 → 失败；等级无 `base_price` → 不可用。  
3. **R3** 新通过陪玩服务行默认价 = 等级 `base_price`。  
4. **R4** 自定义价 pending 期间不改下单价；通过后再生效。  
5. **R5** 后台可审自定义价 + 可看服务总览矩阵。  
6. **R6** 大厅 / 详情 / 直下单 / Marketplace / CS 同价（同一解析器）。  
7. **R7** 篡改 `profiles.price`/`game_prices` 不影响下单；业务写路径已冻结。  
8. 未审核通过 / 无启用服务 → 不可接单、不可被下单。  
9. Production 零静默缺列；缺列 fail-loud。

---

## 11. 明确非目标

- **不修改 PR #198**（`gameplay_products.commission_rate`）。  
- 不在本设计 PR / 任一实现 PR 中「一锅端」改 Production。  
- 不重构玩法商城定价。  
- 不改变猫粮/礼物经济（除非 snapshot 只读引用）。  
- P5 不强制 DROP `price`/`game_prices` 列（可后续独立清理 PR）。

---

## 12. 仍待产品拍板（不影响 P1 开工）

已锁定 R1–R7 后，以下 **不阻塞 P1**，建议在 P2/P3 前确认：

| # | 问题 | 默认建议（若未另指示则按此做） |
|---|------|-------------------------------|
| O1 | `base_price` 与 `min_price` 关系 | **拆分**：`base_price` 为默认售价；`min/max` 仍约束自定义区间；迁移初值 `base=min` |
| O2 | 改级后已通过自定义价 | **保留**自定义价；仅 `source=level_default` 的行重算为新 base |
| O3 | 同等级多游戏不同自定义价 | **允许**，按服务行独立审核 |
| O4 | 大厅主价口径 | **最低已启用有效服务价**（并写回派生缓存） |
| O5 | 历史无等级陪玩 | Staging 回填时 **暂挂 `allow_orders=false`**，运营补级后再开；不静默假 Lv1 充数 |
| O6 | 「添加游戏」是否需审 | **新游戏行先以 `base_price` 生效**；仅自定义价需审 |

---

## 13. 相关代码索引

| 主题 | 路径 |
|------|------|
| 申请 UI | `src/companion-application.js`, `companion-apply.html` |
| 申请/改价 API | `server/api/companion.js` |
| 价格 gate | `server/api/_companion-publish-gate.js` |
| 审核 | `server/api/admin/players.js`, `src/admin-companion-applications.js`, `src/admin-player-detail.js` |
| 等级 | `server/api/_companion-levels-store.js`, `src/admin-companion-levels.js`, `supabase/companion-levels.sql` |
| 解析 | `server/api/_game-prices.js` |
| 下单 | `server/api/orders.js` |
| Marketplace | `server/api/boss/marketplace.js` |
| 大厅 | `server/api/public/companions.js`, `src/companion-hall.js` |
| 预留服务表 | `supabase/companion-marketplace.sql` → `companion_services` |
| 工作台 | `src/companion-workbench.js`, `companion/*` |
| profiles 结构 | `supabase/init.sql` + `companion-admin-data.sql` + `20260731_companion_service_ids.sql` |

---

*文档版本：2026-09-08b · PR #200 design-only · 代码复核通过*
