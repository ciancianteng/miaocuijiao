# 陪玩定价体系重构方案（PR #200 · 设计稿）

> **范围：** 仅方案与 UI 页面设计，**不包含实现代码**。  
> **约束：** 不修改 PR #198；不在本 PR 改业务逻辑 / 跑 Production migration。  
> **状态：** Design only → 评审通过后再开实现 PR。

---

## 0. 一句话结论

今天的「卖价」= 陪玩申请时自填的 `companion_profiles.price` / `game_prices`，审核后直接进大厅与下单；等级只提供 **min/max 区间 + 抽成**，并不决定基础单价。  
目标模型改为：**等级决定基础价 → 审核强制绑等级 → 陪玩只能在规则内申请自定义价（需审）→ 下单只读最终有效服务价**。

---

## 1. 现状审查（代码事实）

### 1.1 `companion_profiles` 与价格字段

| 字段 | 含义（现状） | 关键文件 |
|------|-------------|---------|
| `price` | 主卖价（RM/小时），申请必填并持久化 | `supabase/init.sql`, `server/api/companion.js` |
| `game_prices` jsonb | `{ serviceId\|name → n }` 分游戏价 | `20260731_companion_service_ids.sql`, `_game-prices.js` |
| `service_ids` jsonb | 开通的 `services.id` 列表 | 同上 |
| `service_type` | 陪玩/陪聊 | `20260731_companion_service_type.sql` |
| `level_id` / `level_name` | 等级绑定（可空；审核时缺省自动 Lv1） | `companion-admin-data.sql`, `_companion-listing-sync.js` |
| `pricing_unit` | 默认「小时」 | `companion-marketplace.sql` |
| `commission_rate` | 陪玩侧抽成（可被等级 sync） | init + levels store |

**没有**「等级基础价覆盖卖价」的字段；也没有「自定义价待审」状态写在 `companion_profiles` 上。

### 1.2 等级体系（`companion_levels`）

| 字段 | 现状用途 |
|------|---------|
| `min_price` / `max_price` / `max_plus` | **区间**，约束工作台改价；**不是**下单基础单价 |
| `commission_rate` | 抽成 |
| 视觉字段 | 徽章/卡片样式 |

Store：`server/api/_companion-levels-store.js`；Admin UI：`src/admin-companion-levels.js`。

### 1.3 申请流（自填单价）

```
companion-apply.html
  → src/companion-application.js  「接单价格（必填）」hourlyPrice / gamePriceMap
  → POST /api/companion  action=submit_application
  → patch companion_profiles.price + game_prices
  → assertHasPositivePrice（_companion-publish-gate.js）
```

审核（`POST /api/admin/players` `review_application`）：

- **硬门槛：** 必须已有正价格（`MISSING_PRICE` / `assertApproveCanPublish`）。
- **等级：** 可选；列表一键通过甚至不传 `levelId`；空则 `approveListingPatchForRow` **静默补 Lv1**。
- **不**用等级 min 覆盖申请人自填价（除非 `set_level` 且当前无价时写 `price = min`）。

### 1.4 下单价格计算

| 通道 | 单价来源 | 文件 |
|------|---------|------|
| 老板直下 `place_order` | **服务端** `priceForGame(cp)` → `cp.price` → 首个正 `game_prices`；客户端仅防漂移 | `server/api/orders.js`, `_game-prices.js` |
| Marketplace | 若有 `companion_services` 行用其 `price`，否则 `servicesFromGamePrices` | `server/api/boss/marketplace.js` |
| 客服代下 | 优先 `priceForGame`，再退客户端 | `server/api/customer-service.js` |

直下单路径**已经 server-authoritative**，但权威源仍是「陪玩自填卖价」，不是等级基础价。

### 1.5 大厅 / 首页展示价来源

```
GET /api/public/companions
  → publicCompanion: sellingPrice = money(row.price)
  → gamePrices / services[] from servicesFromGamePrices
src/companion-hall.js / site-data.js / home-popularity.js / profile-detail.js
  → 展示 companion 卖价；等级区间仅作 limit 展示，不替代卖价
```

### 1.6 已有但未产品化：`companion_services`

```sql
-- supabase/companion-marketplace.sql
companion_services (
  companion_id, service_id, service_name,
  price, pricing_unit, enabled,
  review_status default 'approved',  -- 已有审核字段但默认直通
  specs, custom_fields, ...
)
```

Marketplace **可读**；应用层**几乎无写入/审核工作流**。这是改造的最佳落点（避免再叠一层平行 JSON）。

### 1.7 现状 vs 目标（差距表）

| 目标 | 现状 | 差距 |
|------|------|------|
| 申请不填最终单价 | 必填并持久化为卖价 | 删字段 + 改 gate |
| 等级控制基础价 | 等级 = 区间 | 等级需有 `base_price`（或约定 `min_price`=基础价） |
| 审核绑等级 | 可选 + 默认 Lv1 | 审核强制选级；选级即写入基础服务价 |
| 陪玩「服务/价格管理」+ 自定义价需审 | 工作台改价即生效 | 启用 `companion_services` + pending 审核 |
| 下单读最终有效价 | 读 `price`/`game_prices` | 统一解析器：有效价 = 已启用且已通过的服务价 |
| 后台总览入口 | 仅单人详情零散字段 | 新 Admin 页：全量服务矩阵 + 审核队列 |

---

## 2. 目标领域模型

### 2.1 核心原则

1. **Source of Truth（卖价）** = `companion_services`（每陪玩 × 每游戏/服务一行）。  
2. **等级** 提供：`base_price`（默认服务价）+ 允许自定义的规则（区间 / 上浮上限 / 是否需审）。  
3. **`companion_profiles.price`** 降级为 **派生缓存**（取主服务或最低有效价，供旧大厅卡片兼容），禁止申请直写。  
4. **`game_prices` jsonb** 进入只读兼容期，写路径迁到 `companion_services` 后冻结。  
5. **任何下单通道** 只能调用统一函数 `resolveEffectiveServicePrice(companionId, serviceId)`。

### 2.2 价格状态机（单服务行）

```
[审核通过绑等级]
        │
        ▼
  active @ base_price     ←── 管理员改等级 / 重算基础价
        │
        │ 陪玩提交自定义价
        ▼
  pending_custom          ←── 大厅/下单仍用上一档 effective（base 或上次 approved）
        │
   ┌────┴────┐
   ▼         ▼
approved   rejected
(新价生效)  (保持旧 effective；可再提)
```

`enabled=false`：服务不可选、不进大厅服务列表，但不删除历史行。

### 2.3 建议 Schema 变更（设计层，本 PR 不执行）

#### A. `companion_levels` 增强

| 列 | 类型 | 说明 |
|----|------|------|
| `base_price` | `numeric(10,2)` | **等级默认服务单价**（必填） |
| `min_price` / `max_price` | 保留 | 自定义价允许区间 |
| `custom_price_requires_review` | `boolean default true` | 偏离 base 是否必须后台审 |
| `max_custom_delta_pct` | `numeric` 可选 | 相对 base 上浮封顶 |

迁移策略：`base_price = min_price` 回填现有等级，再人工校准。

#### B. `companion_services` 增强（主 SoT）

| 列 | 说明 |
|----|------|
| 现有 `price` | 当前**已生效**单价 |
| 现有 `review_status` | 扩展枚举：`active` / `pending` / `approved` / `rejected` / `disabled`（兼容旧 `approved`） |
| `base_price_snapshot` | 绑定时的等级基础价 |
| `proposed_price` | 待审自定义价（nullable） |
| `proposed_at` / `reviewed_at` / `reviewed_by` / `review_note` | 审核审计 |
| `source` | `level_default` \| `admin_set` \| `companion_custom` |
| `level_id_at_price` | 定价时等级（防改级后歧义） |

#### C. `companion_profiles` 行为变更

- 申请：**禁止**写 `price` / `game_prices`（可保留游戏/能力字段）。  
- 审核通过：按所选等级 `base_price`，为每个已选 `service_id` upsert `companion_services`，并刷新派生 `price`。  
- 改级：可选策略「仅影响未自定义服务」或「全部重算待确认」（见风险）。

#### D. 订单

- 继续写 `unit_price` + `price_snapshot`（扩展字段：`service_row_id`, `base_price`, `effective_price`, `level_id`, `source`）。  
- 禁止信任客户端单价（已有；保持并扩到 CS/自定义通道）。

---

## 3. 业务流程改造

### 3.1 陪玩申请

**删除：**「接单价格 / 单价」整块（`applyPriceFieldsHtml`、校验 `draftHasPositivePrice`、submit 的 `price`/`game_prices`）。  

**保留：** 游戏选择、段位、语音、日程、相册、证件等能力资料。  

**文案：**「服务价格由平台等级体系在审核通过后自动设定；你可在通过后于『我的服务/价格』申请自定义价。」

### 3.2 后台审核

必填：

1. **选择等级**（禁止空过；取消静默 Lv1，或仅在显式「使用默认 Lv1」勾选时允许）。  
2. 确认游戏/资料完整。  

动作：

- 写 `level_id` / `level_name` / 抽成生效时间。  
- 为每个申请游戏 upsert `companion_services`：`price = level.base_price`，`source=level_default`，`review_status=active|approved`，`enabled=true`。  
- 派生刷新 `companion_profiles.price`。  
- **不再**要求申请人已填价格。

### 3.3 陪玩端「我的服务/价格管理」（新）

入口：工作台主导航（通过后可见）。

能力：

| 能力 | 规则 |
|------|------|
| 开启/关闭游戏服务 | `enabled` toggle；关闭立即不可下单该服务 |
| 查看当前有效价 / 等级基础价 / 区间 | 只读展示 |
| 提交自定义价 | 写入 `proposed_price` → `pending`；**不立刻改** `price` |
| 撤回待审 | pending → 清 proposed |
| 查看驳回原因 | `review_note` |

规则引擎（服务端强制）：

- `proposed` 必须落在 `[min_price, max_price]`（或 max_plus 规则）。  
- 若 `custom_price_requires_review=false` 且等于 `base_price`：可直接 active。  
- 任何试图直接 PATCH 生效 `price` 的旧 API 路径关闭或转 pending。

### 3.4 后台：自定义价审核 + 服务总览

1. **审核队列：** 所有 `review_status=pending` 的服务行。  
2. **服务总览页：** 见 §4 UI。  
3. 通过：`price = proposed_price`，清 proposed，`source=companion_custom`。  
4. 驳回：保留旧 `price`，记 note。

### 3.5 下单 / 大厅

统一解析：

```
effective =
  companion_services 中 (companion_id, service_id)
    AND enabled = true
    AND review_status IN ('active','approved')
  → price
fallback (迁移期) = priceForGame(legacy game_prices) / profiles.price
大厅卡片主价 = 派生 profiles.price 或「最低已启用服务价」
```

老板下单 UI 只展示已启用服务及其 effective 价；提交后服务端再算一遍，漂移则 400。

---

## 4. UI 页面设计（线框）

### 4.1 陪玩申请页（改造后）

```
┌─────────────────────────────────────────────┐
│  喵翠娇 · 陪玩入驻申请                         │
├─────────────────────────────────────────────┤
│  ① 基本资料    ② 游戏/能力    ③ 媒体    ④ 提交 │
│                                             │
│  【游戏/能力】                                 │
│  ☑ 无畏契约  段位 ____  位置 ____              │
│  ☑ 英雄联盟  段位 ____                         │
│  ☐ …                                        │
│                                             │
│  ┌─ 价格说明（信息条，非表单）─────────────────┐ │
│  │ 服务单价由平台等级在审核通过后设定。          │ │
│  │ 通过后可在「我的服务/价格」申请自定义价格。    │ │
│  └──────────────────────────────────────────┘ │
│                                             │
│            [ 保存草稿 ]  [ 提交审核 ]           │
└─────────────────────────────────────────────┘
```

**删除控件：**「接单价格（必填）」、每游戏单价 input、`hourlyPrice`。

### 4.2 后台 · 陪玩审核详情（改造）

```
┌──────────────────────────────────────────────────┐
│ 申请审核 · {昵称}                    [驳回] [通过] │
├───────────────────┬──────────────────────────────┤
│ 资料预览           │ 审核决策（必填）                 │
│ 游戏 / 相册 / 语音  │  等级 *  [ Lv2 ▼ ]              │
│                    │  基础价预览：RM 30 / 小时（只读） │
│                    │  抽成：20%（随等级）              │
│                    │  开通服务将按基础价生成：         │
│                    │   · 无畏契约 → 30                │
│                    │   · 英雄联盟 → 30                │
│                    │  ☐ 使用平台默认 Lv1（显式）       │
└───────────────────┴──────────────────────────────┘
```

列表「一键通过」改为：**必须先选等级**（弹层），禁止无等级静默通过。

### 4.3 陪玩端 · 我的服务 / 价格管理（新页）

路由建议：`companion-workbench` 内 Tab，或 `companion-services.html`。

```
┌────────────────────────────────────────────────────────┐
│ 我的服务 / 价格          当前等级：Lv2  · 基础价 RM 30   │
│ 允许自定义区间：RM 30–40 · 偏离基础价需后台审核           │
├──────┬──────────┬──────────┬──────────┬────────────────┤
│ 开   │ 游戏     │ 有效价   │ 自定义申请 │ 状态           │
├──────┼──────────┼──────────┼──────────┼────────────────┤
│ [✓]  │ 无畏契约  │ 30       │ [申请改价] │ 等级默认        │
│ [✓]  │ 英雄联盟  │ 35*      │ 待审 38   │ 自定义待审      │
│ [ ]  │ 永劫无间  │ —        │ —        │ 已关闭          │
└──────┴──────────┴──────────┴──────────┴────────────────┘
* 35 = 上次已通过的自定义价；待审 38 不影响当前下单价。

弹层「申请改价」：
  当前有效价 / 基础价 / 区间提示
  新价格 [____]
  说明（可选）
  [取消] [提交审核]
```

### 4.4 后台中心 · 陪玩服务总览（新页）

导航：后台 → **陪玩服务与价格**（与「陪玩列表」「等级配置」并列）。

```
┌─────────────────────────────────────────────────────────────────┐
│ 陪玩服务与价格          筛选：等级▼ 游戏▼ 状态▼  关键词____ 🔍   │
│ Tabs: [全部服务] [自定义价待审 (12)] [已关闭]                      │
├────────┬──────┬──────┬────────┬────────┬────────┬──────────────┤
│ 陪玩   │ 游戏 │ 等级 │ 基础价 │ 当前价 │ 待审价 │ 状态 / 操作   │
├────────┼──────┼──────┼────────┼────────┼────────┼──────────────┤
│ 小橘   │ 无畏 │ Lv2  │ 30     │ 30     │ —      │ 等级默认      │
│ 阿喵   │ 联盟 │ Lv3  │ 45     │ 45     │ 50     │ 待审 [过][驳] │
│ …      │      │      │        │        │        │              │
└────────┴──────┴──────┴────────┴────────┴────────┴──────────────┘
行点击 → 侧栏：改级影响预览 / 强制改价（admin_set）/ 审计日志
```

### 4.5 后台 · 等级配置（增强）

在现有 `admin-companion-levels` 增加：

- **基础价 `base_price`**（必填，默认 = 原 min）  
- 开关：**自定义价需审核**  
- 预览文案：「新通过陪玩的默认服务价 = 基础价」

### 4.6 老板下单 / 大厅（展示规则）

- 大厅卡片主价：有效服务最低价或主游戏价（派生字段）。  
- 详情/下单：服务列表只含 `enabled && approved`；标价 = effective。  
- 若陪玩无任何启用服务：不可下单，展示「暂未开放服务」。

### 4.7 信息架构（导航）

```
陪玩工作台
  ├ 接单 / 订单
  ├ 我的服务/价格   ← 新
  ├ 资料 / 认证
  └ …

后台
  ├ 陪玩申请审核    ← 强制绑等级
  ├ 陪玩列表
  ├ 陪玩服务与价格  ← 新总览 + 待审队列
  ├ 等级配置        ← 增加 base_price
  └ …
```

---

## 5. API 改造清单（实现阶段）

| API | 变更 |
|-----|------|
| `POST /api/companion` `submit_application` | 忽略/拒绝 `price`、`game_prices`；放宽 publish gate |
| `POST /api/companion` `update_profile` | 拆出服务价写路径；禁止直接改生效价 |
| `POST /api/companion` 新 `list_my_services` / `toggle_service` / `propose_custom_price` / `withdraw_proposal` | 陪玩端 |
| `POST /api/admin/players` `review_application` | **强制 levelId**；生成 `companion_services`；取消缺价硬挡 |
| `POST /api/admin/players` `set_level` | 重算未自定义服务的 base；自定义服务策略可配置 |
| 新 `GET/POST /api/admin/companion-services` | 总览、待审、通过/驳回、admin 强制改价 |
| `GET/POST /api/admin/companion-levels` | CRUD `base_price` + review flags |
| `GET /api/public/companions` | 主价改读有效服务派生；暴露 `services[]` 仅 enabled+approved |
| `POST /api/orders` `place_order` | `resolveEffectiveServicePrice`；snapshot 扩展 |
| Marketplace / CS | 同上统一解析器 |

---

## 6. 数据迁移与风险

### 6.1 Schema diff（相对现状）

| 对象 | Diff |
|------|------|
| `companion_levels` | **+** `base_price`, `custom_price_requires_review`, （可选）`max_custom_delta_pct` |
| `companion_services` | **+** `base_price_snapshot`, `proposed_price`, `proposed_at`, `reviewed_at`, `reviewed_by`, `review_note`, `source`, `level_id_at_price`；收紧 `review_status` 语义 |
| `companion_profiles.price` | 语义变为派生缓存；申请写路径删除 |
| `companion_profiles.game_prices` | 迁移期只读 → 后续废弃 |
| `orders.price_snapshot` | 扩展键（无破坏性） |

### 6.2 数据回填

1. 现有已通过陪玩：按 `service_ids`/`game`/`game_prices` 生成 `companion_services` 行；`price` 取现网卖价；`source=companion_custom` 或 `legacy_import`；`review_status=approved`。  
2. 无价陪玩：用其等级 `base_price`（或 min）填充。  
3. `companion_levels.base_price ← min_price`。  
4. 校验：每个 `allow_orders` 且 approved 的陪玩至少 1 条 enabled 服务。

### 6.3 Migration 风险

| 风险 | 等级 | 缓解 |
|------|------|------|
| 大厅突然改价（派生规则变化） | 中 | 回填后派生价 = 旧 `profiles.price`，首发只切写路径 |
| 审核中申请无价格被新 gate 卡住 | 低 | 新逻辑明确「无价可审」；旧 verify 脚本需改 |
| 工作台旧改价 API 被滥用绕过审核 | 高 | 服务端关闭直写；E2E 断言 pending 不进下单 |
| 改级导致自定义价冲突 | 中 | 产品二选一：保留自定义 / 全部回 base 并通知 |
| `companion_services` 与 `game_prices` 双写不一致 | 高 | 单写 `companion_services`；读路径优先新表 fallback 旧 JSON |
| Production 缺表/缺列 | 高 | Staging 先跑；pending-prod SQL；禁止静默 strip（对齐 #198 教训） |
| 与 #198 gameplay `commission_rate` 混淆 | 低 | 玩法商品抽成 ≠ 陪玩等级服务价；文档隔离，**不改 #198** |

### 6.4 回滚策略

- Feature flag：`PRICING_V2=1`（读新表 / 申请去价格 / 审核强等级）。  
- Flag off：回退旧 `price`/`game_prices` 路径；新表保留但不阻断。  
- 不自动 merge；Staging 验证 PASS 后再建议上线。

---

## 7. 分阶段落地（建议）

| 阶段 | 内容 | 验收 |
|------|------|------|
| **P0 设计** | 本文档（本 PR #200） | 产品/工程评审签字 |
| **P1 Schema + 解析器** | levels.base_price；services 增强；`resolveEffectiveServicePrice`；回填脚本（Staging） | Staging schema diff + 下单单测 |
| **P2 申请/审核** | 去申请价；审核强制等级并种子服务 | 申请无单价控件；无等级无法通过 |
| **P3 陪玩服务页 + 待审** | 工作台新页；admin 队列 | 自定义价不即时生效；通过后下单变价 |
| **P4 总览页 + 大厅对齐** | Admin 矩阵；public API 派生价 | 总览数字 = 下单价 = 大厅价 |
| **P5 清理** | 废弃申请价 gate；冻结 `game_prices` 写 | 文档与 verify 脚本更新 |

每阶段独立实现 PR；**本 PR 只含设计**。

---

## 8. 验收标准（实现完成后）

1. 申请页无最终单价输入；提交 payload 无有效卖价字段。  
2. 审核无等级 → 失败；有等级 → 服务行价格 = `base_price`。  
3. 陪玩自定义价 → pending 期间大厅/下单仍为旧有效价。  
4. 后台通过后 → 三端（大厅、详情、下单）同价。  
5. Admin 总览可筛：陪玩 / 游戏 / 等级 / 当前价 / 待审状态。  
6. 无法通过旧 API 绕过等级体系直写卖价。  
7. Production 零静默失败；缺列 fail-loud。

---

## 9. 明确非目标

- 不修改 PR #198（gameplay_products.commission_rate）。  
- 不在本设计 PR 改 Production / 插测试订单。  
- 不重构玩法商城（`gameplay_products`）定价。  
- 不改变猫粮/礼物经济（除非 snapshot 需要只读引用）。

---

## 10. 待产品确认的开放问题

1. **`base_price` 与现 `min_price`：** 合并（min=base）还是拆成「基础价可高于 min」？  
2. **改级策略：** 已通过的自定义价保留还是作废重审？  
3. **多服务不同价：** 是否允许同一等级下各游戏不同自定义价？（建议：允许，按行审核）  
4. **大厅主价口径：** 最低有效价 / 主游戏价 / 展示区间？  
5. **历史无等级陪玩：** 回填默认 Lv1 还是强制运营补级后再开放接单？

---

## 11. 关键代码索引（便于实现）

- 申请 UI：`src/companion-application.js`, `companion-apply.html`  
- 申请/改价 API：`server/api/companion.js`  
- 价格 gate：`server/api/_companion-publish-gate.js`  
- 审核：`server/api/admin/players.js`, `src/admin-companion-applications.js`, `src/admin-player-detail.js`  
- 等级：`server/api/_companion-levels-store.js`, `src/admin-companion-levels.js`  
- 解析：`server/api/_game-prices.js`  
- 下单：`server/api/orders.js`  
- 大厅：`server/api/public/companions.js`, `src/companion-hall.js`  
- 预留表：`supabase/companion-marketplace.sql` → `companion_services`  
- 工作台：`src/companion-workbench.js`

---

*文档版本：2026-09-08 · PR #200 design-only*
