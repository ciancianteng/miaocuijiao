# Production（正式环境）Setup

目标：Production 只使用正式 Supabase 与 HitPay Live；所有功能先在 Preview 验收通过后再上正式站。

## 1. 何时才能发 Production

必须同时满足：

1. 当前变更已在 **Vercel Preview** 部署成功。  
2. 四端（老板 / 陪玩 / 客服 / 后台）已按 `DEPLOY_CHECKLIST.md` 在 Preview 验收通过。  
3. Production 环境变量已填且**未**与 Preview 混用。  
4. HitPay 为 **Live**；数据库为 **正式 Supabase 项目**。  
5. 负责人明确确认「可以上正式」。

未验收完不要合并进 Production 分支，也不要 `vercel --prod`。

## 2. 正式 Supabase

使用独立项目（与 Staging 分离）：`meow-cuijiao-production`。

1. 在正式库 SQL Editor 执行与 Staging **同一套** schema 脚本（`supabase/*.sql`、`docs/*.sql`）。  
2. Schema 变更顺序：**先 Staging 验证 → 再 Production 执行**。  
3. 创建正式账号（管理员 / 客服 / 陪玩 / 老板），**不要**沿用 `*.meow.test` 弱密码到公网。  
4. Auth URL / Redirect 配置正式域名。  
5. Storage bucket、RLS、service_role 仅服务端使用；禁止 `VITE_*` 带 service_role。

健康检查：

```bash
curl "https://YOUR_PRODUCTION_DOMAIN/api/auth?action=health"
```

期望：`configured: true`，`missing: []`。

## 3. HitPay Live

1. HitPay Dashboard 切到 **Live**。  
2. 取得 Live API Key、Salt、Webhook Secret。  
3. Webhook 指向正式域名，例如：
   - `https://YOUR_PRODUCTION_DOMAIN/api/payment-callback`
4. 正式库支付配置：
   - `mode = live`（勿留 `test`）
   - `api_base_url = https://api.hit-pay.com/v1`
5. Vercel **Production** 环境变量使用 Live 密钥（模板：`.env.production.example`）。

上线前建议：用真实最小金额做一笔 Live 冒烟，确认入账与回调；确认后再开放大额。

## 4. Vercel Production 环境变量

Project → **Settings → Environment Variables**。

对照 `.env.production.example`：

1. 每项填入 **正式** 值。  
2. Environment **只勾选 Production**。  
3. 与 Preview 同名变量必须是 **两套不同值**（URL、key、加密盐皆不同）。

| Key | Production 值 |
| --- | --- |
| `APP_ENV` | `production` |
| `SUPABASE_URL` / `VITE_SUPABASE_URL` | 正式项目 |
| `SUPABASE_ANON_KEY` / `VITE_SUPABASE_*` | 正式 anon/publishable |
| `SUPABASE_SERVICE_ROLE_KEY` | 正式 service_role |
| `HITPAY_MODE` | `live` |
| `HITPAY_API_BASE_URL` | `https://api.hit-pay.com/v1` |
| `HITPAY_API_KEY` / `HITPAY_SALT` / `HITPAY_WEBHOOK_SECRET` | Live 密钥 |
| `PAYMENT_ENCRYPTION_KEY` 等 | 正式专用；丢失则无法解密已存密钥 |

切勿：

- 把 Live Key 勾到 Preview  
- 把 Staging service_role 勾到 Production  
- 在文档 / 聊天 / 前端代码里粘贴 service_role 或 Live 密钥  

## 5. 发布方式

### 推荐：分支保护 + 合并发布

```text
feature/* → push → Preview 自动部署 → 四端验收
       ↓
   PR 合入 main（或 Production Branch）
       ↓
   Vercel Production 自动部署
```

建议：

- Production Branch = `main`  
- `main` 开 PR Review，禁止直接 force push  
- 仅维护者可合并  

### 紧急热修（慎用）

```bash
npx vercel --prod
```

仍须先有 Preview 验证或明确可接受回滚风险。

## 5.1 Production mutation guards（强制）

仓库内 seed / cleanup / destructive migrate 脚本已接入 `scripts/lib/prod-guard.mjs`：

- 目标 URL / `DATABASE_URL` / `SUPABASE_URL` 看起来像 Production，或 `VERCEL_ENV=production` / `APP_ENV=production` 时，**默认拒绝执行**。
- 仅当同时设置：
  - `ALLOW_PROD_MUTATION=1`（或 `ALLOW_PROD_SEED` / `ALLOW_PROD_MIGRATE` / `ALLOW_PROD_RESET`）
  - `CONFIRM_PROD_MUTATION=YES_I_MEAN_PRODUCTION`
  才允许覆盖（危险，仅事故修复用）。
- **禁止**用 seed / truncate / demo cleanup 对正式库做验收重灌。Deploy 本身不得 wipe / reinit Production 数据。
- Staging 与 Production 的 `SUPABASE_*` **必须是两套不同项目**。若 `/api/public/companions` 两边返回同一 `*.supabase.co` storage host，视为 P0，禁止发正式。

## 5.2 Backup before Production deploy

正式发版前必须有可恢复备份（任选其一，并记录时间点）：

1. Supabase Dashboard → Database → Backups（Pro+ 自动备份 / PITR），确认最近成功备份时间。  
2. 或本地 `pg_dump`（使用 **Production** `DATABASE_URL`，输出到安全离线位置，勿提交 Git）。  

本仓库 **不**自动在 deploy 时 dump；没有确认备份前不要 `vercel --prod` / 合入 Production。

恢复路径：Supabase Dashboard restore，或 `psql` 导入 dump（先在 Staging 演练）。

## 6. 自定义域名

1. Vercel → Project → Domains → 绑定正式域名。  
2. DNS 按提示加 A / CNAME。  
3. 更新 Supabase Auth Site URL、Redirect URLs。  
4. 更新 HitPay Live Webhook / redirect。  
5. 如有跨域限制，设置 `FRONTEND_ORIGINS=https://your-domain.com`。

## 7. 上线后冒烟（正式站）

在 **Production URL** 快速确认（小流量 / 内部账号）：

1. `/api/auth?action=health` → configured  
2. 后台登录  
3. 客服登录  
4. 陪玩登录  
5. 老板登录与下单  
6. HitPay Live 最小金额充值（或确认渠道已启用且回调可达）  

完整业务回归仍以 Preview 清单为准；Production 只做冒烟，避免污染正式数据。

## 8. 回滚

1. Vercel → Deployments → 上一成功 Production → **Promote to Production**。  
2. 若含数据库迁移：先评估回滚 SQL / 兼容性，再动库。  
3. 支付相关事故：先在后台停用 Live 渠道，再查 HitPay 与 `payment_orders`。

## 9. 密钥轮换

轮换 Production 密钥时：

1. 新密钥先只加在 Production 变量（或正式库配置）。  
2. Redeploy Production。  
3. 验证登录 / 支付。  
4. 再作废旧密钥。  

Staging 与 Production **分别轮换**，互不影响。

相关文档：`STAGING_SETUP.md`、`DEPLOY_CHECKLIST.md`。
