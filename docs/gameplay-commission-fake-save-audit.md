# 更多玩法商城管理 · 抽成假保存审计与修复（PR #198）

> 审查目标：后台「更多玩法商城管理」编辑抽成保存后刷新变回 0%（假成功）。  
> 修复 PR：https://github.com/ciancianteng/miaocuijiao/pull/198  
> 与 PR #200（陪玩定价）隔离。

---

## 1. 数据 Source（读路径）

| 层 | 位置 |
|----|------|
| **Frontend** | `src/admin-gameplay-mall.js`（挂载 `admin.html` → `#table-gameplays`） |
| **Read API** | `GET /api/admin/gameplay-products`（`MCJAdminAuthFetch.get`） |
| **Backend** | `server/api/admin/gameplay-products.js` → `listProducts()` |
| **Table** | `public.gameplay_products` |
| **Column（抽成）** | `commission_rate numeric(5,2)`（0–100） |
| **Mapper** | `server/api/_gameplay-products-store.js`：`fromDbRow` → `commissionRate`；`toPublicProduct(..., { admin: true })` 才暴露 |

### Fallback / mock？

| 类型 | 是否存在 | 说明 |
|------|---------|------|
| localStorage | 否 | 本模块不用 |
| 本地 JSON | **是** | 表缺失或未配 Supabase 时读 `.local-data/gameplay-products.json`（`source: "local"`） |
| 静态种子 | **是** | store 内 `DEFAULT_PRODUCTS`（无抽成字段 → 归一为 0） |

公开老板侧：`GET /api/platform/gameplay-products`（**不**暴露 `commissionRate`）。

---

## 2. 编辑抽成保存（写路径）

| 步骤 | 事实 |
|------|------|
| 前端请求 | `POST /api/admin/gameplay-products` |
| Body | `{ action: "save", id, product }` |
| **抽成字段** | `product.commissionRate`（camelCase；表单 `name="commissionRate"`） |
| Backend 接收 | `cleanProduct` → `normalizeProductRow` 读 `commissionRate` / `commission_rate` |
| DB 写入 | `toDbRow` → **`commission_rate`**；`PATCH/POST` + `Prefer: return=representation` |

### 断点原因（main 上的假成功）

```
前端发送 commissionRate: 20
  → PATCH 含 commission_rate: 20
  → DB/Schema 缺列 → PostgREST 42703 / PGRST204
  → 旧代码：剥离 commission_rate 后重试 PATCH 成功
  → 返回 ok: true「商品已保存」
  → 前端关表单并 load()
  → 列表读回 commission_rate 默认 0 → UI 显示 0%
```

**不是**前端没发字段；**是**后端缺列时静默剥字段仍报成功。

---

## 3. 修复要点（PR #198）

1. **删除**静默 strip；缺列 → `503 MISSING_COMMISSION_RATE_COLUMN`（文案含「不要假装保存成功」）。  
2. UPDATE 后校验 representation：缺 `commission_rate` 或与期望不符 → 失败（`COMMISSION_RATE_MISMATCH`）。  
3. 强制 `dbPayload.commission_rate = expectedRate`。  
4. 同步 `api/_gameplay-products-store.js` 与 server store。  
5. 前端：保存响应 + **刷新重读** 都必须等于所填抽成，否则 alert 失败（禁止假成功 UI）。  
6. SQL：`migrations/20260806_...` + `pending-prod/10_...` + base `gameplay-products.sql` 含列。  
7. 玩法订单创建快照 `orders.platform_fee_rate`（结算优先快照）。

---

## 4. 验收：改 20% → 保存 → 刷新 → DB = 20%

| 检查 | 命令 / 方式 |
|------|-------------|
| Offline（无 DB，CI 可跑） | `node scripts/verify-gameplay-commission-offline.mjs` |
| Staging 真库往返 | `STAGING_SUPABASE_URL` + `STAGING_SUPABASE_SERVICE_ROLE_KEY` → `node scripts/apply-and-verify-gameplay-commission-staging.mjs`（含 0→15→**20**→0 + re-read） |
| UI | 编辑抽成 20 → 保存 → 若未写入则 alert，**不会**关表单装成功；成功则提示「抽成 20% 已写入并完成刷新校验」 |

**禁止** Production 写测试；缺 Staging 凭证时 Staging 项标记 BLOCKED，但 Offline 合同必须 PASS。

---

## 5. 文件清单

| 角色 | 路径 |
|------|------|
| Frontend | `src/admin-gameplay-mall.js` |
| Backend API | `server/api/admin/gameplay-products.js` |
| Store | `server/api/_gameplay-products-store.js`, `api/_gameplay-products-store.js` |
| Table.column | `public.gameplay_products.commission_rate` |
| Migration | `supabase/migrations/20260806_gameplay_commission_rate.sql` |
| Pending Prod | `supabase/pending-prod/10_gameplay_products_commission_rate.sql` |
| Offline verify | `scripts/verify-gameplay-commission-offline.mjs` |
| Staging verify | `scripts/apply-and-verify-gameplay-commission-staging.mjs` |
