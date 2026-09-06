# G3 — 真实 Admin 登录流程检查（代码层，不改 Production）

**状态：ANALYSIS ONLY**  
**约束：** 不创建 Production admin；不 UPDATE。

---

## 1. 登录流程（代码）

1. Admin 邮箱密码登录 `/api/auth`（非 OTP）。
2. `rejectProductionTestIdentity` → `shouldBlockTestIdentityOnProduction`：
   - Production 下 `admin@meow.test` **硬拦截**（`isBlockedProductionTestAdmin`）
   - 任意 `@meow.test` / disposable / Smoke 名在 Production 登录/注册被拒（`PROD_TEST_ACCOUNT_BLOCK_MESSAGE`）
3. Dashboard admin 门禁：`profiles.role` ∈ {admin, super_admin} 且 status 可用
4. **真实管理员不会被过滤：**
   - 非 `@meow.test`、非 disposable、非 Smoke 名
   - `is_test_account` 默认/保持 `false`
   - `isTestAccountRecord` 对正常 ops 邮箱返回 `false`

## 2. `admin@meow.test` 结论（只读 2026-09-05）

| 项 | 结论 |
|---|---|
| 是否仅测试账号 | **是**（`@meow.test`） |
| 现网角色 | **唯一** admin：`6f31b706-11e7-42df-8db1-d2caccd796de` |
| Production 登录 | 代码已禁止（403 `PROD_TEST_ACCOUNT_BLOCKED`） |
| 标记 `is_test_account` | **须等真实 admin 可用后再执行 G2** |

## 3. 本轮完成度

| 项 | 状态 |
|---|---|
| 代码路径确认（拦截 test / 放行真实 admin） | ✅ |
| Production 已存在非 test admin | ❌ 需人工创建并验证登录 |
| 可安全执行 G2 标记 admin@meow.test | ❌ 依赖上一行 |

## 4. 需人工确认

1. 正式 admin 邮箱（非 meow.test / 非 guerrilla）
2. 该账号已写入 `profiles.role=admin`（或 super_admin）且可登录后台
3. 确认后再批准 G2 UPDATE（含将 `admin@meow.test` 标 test）
