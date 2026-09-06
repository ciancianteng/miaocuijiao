# 正式 Admin 安全创建方案（阻塞态 / 不 apply）

**状态：PLAN ONLY — 等待人工执行与确认**  
**约束：** Agent **不**自动创建账号、**不**执行 Production SQL、**不**跑 G2。  
**前置：** 当前 Production 唯一 admin = `admin@meow.test`（测试号，Production 登录会被拦截）。

---

## 1. 安全创建方案（推荐）

### 1.1 账号选型规则（硬性）

| 项 | 要求 | 原因 |
|---|---|---|
| 邮箱域名 | 公司/个人正式邮箱（如 `ops@yourcompany.com`、`you@gmail.com`） | `@meow.test` / disposable 会被 Production 登录拦截 |
| 禁止邮箱 | `*@meow.test`、`*@mcj-prod-smoke.invalid`、guerrilla/sharklasers 等 | `isTestEmail` / `shouldBlockTestIdentityOnProduction` |
| 禁止 display_name | 含 `Smoke` / `ProdSmoke` | `isTestUsername` 会拦截登录 |
| role | `admin`（或现网枚举允许的 `super_admin`） | Dashboard 门禁要求 |
| status | `active`（或现网等价启用态） | 未启用会被拒 |
| `is_test_account` | **必须为 false / 未设置** | G2 不会也不应标记该账号 |

### 1.2 推荐创建路径（人工，Dashboard）

> 不要走公开注册接口创建 admin（公开 register 走 boss 画像）。用 **Auth Admin + profiles 提升**。

**步骤 A — 在 Supabase Dashboard 创建 Auth 用户**

1. 打开 Production 项目 → **Authentication → Users → Add user**  
2. 选择 **Create new user**（或 Invite；Invite 需能收信）  
3. Email = 正式邮箱；设置强密码；勾选 **Auto Confirm User**（避免邮箱确认卡死）  
4. 记录返回的 `user.id`（UUID）

**步骤 B — 写入 / 提升 `profiles`（你在 SQL Editor 手工执行，Agent 不执行）**

> 仅当你本人确认后，在 Dashboard SQL Editor 执行；以下为**模板**，不是本轮 apply。

```sql
-- TEMPLATE ONLY — do not run until you decide to create the admin yourself.
-- Replace :NEW_ADMIN_ID / :NEW_ADMIN_EMAIL / :NEW_ADMIN_NAME

insert into public.profiles (id, email, role, display_name, status)
values (
  ':NEW_ADMIN_ID'::uuid,
  lower(':NEW_ADMIN_EMAIL'),
  'admin',
  ':NEW_ADMIN_NAME',   -- 不要含 Smoke / ProdSmoke
  'active'
)
on conflict (id) do update
set email = excluded.email,
    role = 'admin',
    display_name = excluded.display_name,
    status = 'active';

-- 若 G1 列已存在，显式保证非 test（列不存在则跳过本句）
-- update public.profiles
-- set is_test_account = false
-- where id = ':NEW_ADMIN_ID'::uuid;
```

**步骤 C — 不要动 `admin@meow.test`**

- 保留该测试账号用于历史对照。  
- **等你确认正式 admin 可登录后**，再批准 G2（G2 会把它标 `is_test_account=true`）。

### 1.3 备选路径（已有 Auth 用户）

若该邮箱已在 Auth 中：只需把对应 `profiles.role` 提升为 `admin` 且 `status=active`，无需新建 Auth 用户。

---

## 2. 创建后不会被 `is_test_account` / test 逻辑拦截（代码确认）

离线核对 `server/api/_test-accounts.js` + `auth.js`：

| 检查点 | 正式 admin（例：`ops@company.com` / 名「运营管理员」） | `admin@meow.test` |
|---|---|---|
| `isTestEmail` | false | true |
| `isTestUsername` | false（名不含 Smoke） | false（但仍被硬拦） |
| `isTestAccountRecord`（`is_test_account=false`） | **false** | true（邮箱启发式） |
| `shouldBlockTestIdentityOnProduction` | **false → 可登录** | **true → 403** |
| `isBlockedProductionTestAdmin` | false | true（仅该邮箱） |
| Dashboard `requireAdmin` | 看 `role∈{admin,super_admin}` + status | 角色够，但登录已被拦 |

补充说明：

1. **登录拦截看的是邮箱/显示名启发式**，不是单独依赖 `is_test_account` 列。正式邮箱 + 正常名字 → **不会被拦**。  
2. **G1** 加列后默认 `false`；正式 admin 只要不在 G2 的 11 个 id 列表里，**不会被标 test**。  
3. **G2 精确 UPDATE 11 个固定 UUID**；新正式 admin 是新 UUID → **不在列表内** → 不受 G2 影响。  
4. Dashboard 统计会排除 test；正式 admin **登录身份**不依赖 GMV 过滤，只要 role/status 正确即可进后台。

---

## 3. 创建后的验证步骤（请你人工完成并回贴结果）

按顺序做；全部通过后再谈 G2。

### V1 — 数据层（只读 SQL / Table Editor）

```sql
select id, email, role, display_name, status
  -- , is_test_account   -- 仅 G1 之后有列时加上
from public.profiles
where role in ('admin', 'super_admin')
order by created_at;
```

期望：

- 至少 **2** 行 admin（含旧 `admin@meow.test` + 新正式账号），或你已决定停用旧号但仍保留行  
- 新账号：`email` 正式域、`role=admin`、`status=active`  
- 若已有 `is_test_account` 列：新账号 = **false**

### V2 — 登录（Production 后台）

1. 打开 Production Admin 登录页  
2. 用**正式邮箱 + 密码**登录  
3. 期望：**成功进入后台**（非 403 `PROD_TEST_ACCOUNT_BLOCKED`）

### V3 — 负向对照（可选但推荐）

1. 尝试 `admin@meow.test` 登录 Production  
2. 期望：**仍被拒绝**（证明 test 拦截仍有效，且你不再依赖它进后台）

### V4 — 回贴给我的确认模板

```text
正式 admin 验证：
- 邮箱域：___（可打码本地部分）
- profiles.role / status：admin / active
- is_test_account：false / 列尚不存在
- Production 后台登录：成功 / 失败
- admin@meow.test 负向：仍拦截 / 未测
- 批准 G2：是 / 否（仅当登录成功时才可「是」）
```

---

## 4. G2 门禁（继续阻塞）

| 条件 | 当前 |
|---|---|
| 正式 admin 已创建并登录成功 | ❌ 待你完成 |
| Backup / PITR 已确认 | ⏳ 仍待你确认 |
| Agent 自动执行 G2 | **禁止** |
| 收到你明确「批准 G2」前 | **不 apply、不 UPDATE** |

**本轮 Agent 动作：仅文档 / 方案；零 Production mutation。**
