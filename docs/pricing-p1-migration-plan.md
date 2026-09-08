# P1 实施前计划：base_price + companion_services + resolveEffectiveServicePrice

> **PR 目标：** `feat(pricing-p1): base_price + companion_services fields + resolveEffectiveServicePrice`  
> **基线：** PR #200 产品终稿 R1–R9 + `docs/pricing-design-review-gate.md`  
> **硬约束：** **不执行 Production migration**；Staging 先行；不改 PR #198  
> **门禁：** ✅ 用户已确认「开始 P1」— 本 PR 为 P1 实现

---

## 0. P1 范围（做什么 / 不做什么）

### 做

1. Schema：`companion_levels.base_price`；增强 `companion_services` 定价列  
2. 代码：`resolveEffectiveServicePrice`（优先级：approved custom → level base → legacy）  
3. Flag：`PRICE_V2`（别名 `PRICING_V2`）脚手架；**P1 默认不切生产读行为**（解析器可被调用但含 legacy fallback，行为等价）  
4. 等级 Admin/store：读写校验 `base_price`  
5. Staging 回填脚本 + offline 单测 + pending-prod **评审稿**

### 不做

- 申请去价 / 审核强制等级（P2）  
- 陪玩自定义价 UI / 审核队列（P3）  
- 全通道强制切流 / 后台总览（P4）  
- 冻结 `profiles.price` 写 / 删 fallback（P5）  
- **任何 Production SQL 执行**

---

## 1. Migration plan

### 1.1 顺序（Staging only）

| Step | 动作 | 文件 |
|------|------|------|
| S0 | 只读探测：表/列是否已存在；记录 schema diff | verify 脚本 |
| S1 | 加 `companion_levels.base_price`；回填 `base_price = min_price` | migration SQL |
| S2 | 增强 `companion_services` 列（见 §2） | migration SQL |
| S3 | `NOTIFY pgrst, 'reload schema'`（若走 PostgREST） | migration 末尾 |
| S4 | 回填服务行：从 `game_prices`/`price`/`service_ids` 生成 `legacy_import` | Staging 脚本 |
| S5 | 无等级 / 无价陪玩：`allow_orders=false` 暂挂（不 silent Lv1） | Staging 脚本 |
| S6 | 离线 + Staging 验收清单全部勾选 | §4 |

### 1.2 幂等原则

- 全部 `ADD COLUMN IF NOT EXISTS`  
- 回填用 `WHERE base_price IS NULL` / 按 `(companion_id, service_id|service_name)` upsert，可重跑  
- 不 DELETE 历史 `companion_services` 行  

### 1.3 Production

- 只新增 `supabase/pending-prod/11_companion_pricing_p1_base_price_services.sql`（**DRAFT FOR REVIEW ONLY**）  
- 本 PR / 本 agent **禁止**对 Prod 执行  
- Prod 授权执行须在 Staging PASS 且人工确认后另开变更窗口  

---

## 2. Affected tables / columns

| 对象 | Diff | 说明 |
|------|------|------|
| **`public.companion_levels`** | **+** `base_price numeric(10,2)` | 默认售价 SoT；回填 `= min_price`；NOT NULL（回填后加约束或应用层强制） |
| | 保留 `min_price` / `max_price` / `max_plus` | **仅**自定义价规则限制，非售卖来源 |
| **`public.companion_services`** | **+** `base_price_snapshot numeric(12,2)` | 绑定时等级基础价 |
| | **+** `proposed_price numeric(12,2)` | pending 自定义价（P3 使用；P1 建列） |
| | **+** `proposed_at timestamptz` | |
| | **+** `reviewed_at timestamptz` | |
| | **+** `reviewed_by uuid` | |
| | **+** `review_note text` | |
| | **+** `source text` | `level_default` \| `admin_set` \| `companion_custom` \| `legacy_import` |
| | **+** `level_id_at_price text` | 定价时等级 |
| | 现有 `price` / `enabled` / `review_status` | 生效价；pending 时 `price` 保持旧 effective |
| **`public.companion_profiles`** | **无结构性破坏** | `price`/`game_prices` 继续作兼容缓存；P1 回填可刷新派生价 |
| **`public.orders`** | **本阶段可不改** | P4 再扩展 `price_snapshot` 键；P1 不强制 |

### 不改动

- `gameplay_products` / PR #198  
- 玩法商城、礼物、Boss 佣金表  

---

## 3. Rollback plan

| 层级 | 动作 |
|------|------|
| **代码** | Revert P1 PR；读路径立即回到纯 `priceForGame` / `profiles.price` |
| **Flag** | `PRICE_V2=0`（P4 才依赖；P1 即使 revert 也安全） |
| **Schema** | **默认保留新列**（向前兼容，避免二次 migration 风险） |
| **数据** | Staging 回填可用脚本标记/`source=legacy_import` 识别；必要时软禁新行 `enabled=false`，**不建议** DROP COLUMN |
| **Prod** | 若误执行 pending SQL：停写新列依赖代码；列可留；**禁止**盲目 DROP 有数据的列 |

回滚优先级：先关行为（revert 代码）→ 再评估数据 → **最后**才考虑 DDL 回退。

---

## 4. Staging verification checklist

### 4.1 前置

- [ ] 仅使用 `STAGING_SUPABASE_URL` + `STAGING_SUPABASE_SERVICE_ROLE_KEY`（ref=`cfccwysniduwkjskiqgy`）  
- [ ] **拒绝** Prod（`jqfaknpmcnqwqvatrwgo`）凭证 / `SUPABASE_*` 回落  
- [ ] Offline：`node scripts/verify-pricing-p1-offline.mjs` PASS  

### 4.2 Schema

- [ ] `companion_levels.base_price` 存在且每级 `base_price =` 回填后的值（初值 = 原 `min_price`）  
- [ ] `min_price`/`max_price` 仍在，语义未变  
- [ ] `companion_services` 新列全部存在；PostgREST 可选中 `proposed_price,source,base_price_snapshot`  
- [ ] 缺列场景：应用层 fail-loud（对齐 #198 教训，不静默剥字段）  

### 4.3 回填

- [ ] 每个 `allow_orders=true` 且 approved 的陪玩：≥1 条 `companion_services`（或被暂挂）  
- [ ] 无等级陪玩：`allow_orders=false`，**未** silent 写入 Lv1  
- [ ] `source=legacy_import` 行的 `price` ≈ 回填前卖价（允许派生缓存对齐）  

### 4.4 解析器行为（等价）

- [ ] 无服务行：`resolveEffectiveServicePrice` = 旧 `priceForGame` / `profiles.price`  
- [ ] 有 approved 服务行：返回行上 `price`（**忽略** `proposed_price`）  
- [ ] pending 自定义价不影响大厅/下单金额  
- [ ] 改级模拟：`source=companion_custom` 行价格不变；`level_default` 行可变（逻辑单测；写路径属 P2/P3）  

### 4.5 回归

- [ ] 直下单金额与回填前抽样一致（无服务行或 legacy 路径）  
- [ ] Marketplace / public companions 无 5xx  
- [ ] 与 gameplay commission（#198）无交叉破坏  

### 4.6 退出标准（方可开 P2）

- [ ] 上表全部 PASS  
- [ ] pending-prod SQL 已挂 PR 供人工评审（**未**执行）  
- [ ] PR 描述写明：Merge ≠ Prod migration  

---

## 5. Effective resolver 合同（P1 落地）

```
resolveEffectiveServicePrice({ companionId|companion, serviceId?, gameName?, level? })

1. 若 companion_services 有 enabled=true 且 review_status ∈ {approved, active}
     → 返回 { price: row.price, source, source: row.source }
     （绝不读 proposed_price）
2. 否则若 companion 绑定等级且 level.base_price > 0
     → 返回 { price: base_price, source: 'level_base_price' }
3. 否则 legacy：priceForGame / profiles.price
     → { price, source: 'legacy_profile' }   // 迁移期 only；P5 删除
```

`PRICE_V2`：P1 仅注册 flag helper；**P4** 才用它关掉「绕过解析器的旧读法」。P1 接线点可调用解析器，因含 legacy，金额应等价。

---

## 6. 交付物清单（本实现 PR）

| 交付物 | 路径（预期） |
|--------|-------------|
| Staging migration | `supabase/migrations/20260908_companion_pricing_p1.sql` |
| pending-prod 评审稿 | `supabase/pending-prod/11_companion_pricing_p1_base_price_services.sql` |
| 解析器 | `server/api/_resolve-effective-service-price.js` |
| Flag | `server/api/_feature-flags.js` → `isPricingV2Enabled` |
| Levels store | `_companion-levels-store.js` + admin API/UI `base_price` |
| Staging 回填 | `scripts/backfill-companion-pricing-p1-staging.mjs` |
| Offline verify | `scripts/verify-pricing-p1-offline.mjs` |
| 本计划 | `docs/pricing-p1-migration-plan.md` |

---

*P1 plan · 2026-09-08 · 不执行 Production migration*
