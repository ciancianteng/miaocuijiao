# Staging（公开预览）Setup

目标：**以后公开预览 = Staging = Vercel Preview**。  
本地改完、推到 GitHub 后，Vercel 自动出 Preview；Preview 只连测试库与 HitPay Sandbox。

## 1. 环境定义

| 名称 | 平台 | 数据库 | 支付 | 用途 |
| --- | --- | --- | --- | --- |
| Local | `npm run dev` | 通常指向 Staging 测库 | Sandbox | 开发 |
| **Staging / Preview** | Vercel Preview URL | Supabase **测试项目** | HitPay **Sandbox** | 公开验收 |
| Production | Vercel Production | Supabase **正式项目** | HitPay **Live** | 真实用户 |

规则：

- 所有四端验收只在 **Preview URL** 上做，不在 Production 上试新功能。
- Preview 环境变量与 Production **必须分开配置**，禁止把正式密钥勾到 Preview。

## 2. 前置：两个 Supabase 项目

新建（或保留）两个独立项目：

1. `meow-cuijiao-staging` — 测试库  
2. `meow-cuijiao-production` — 正式库  

在 **Staging** 项目中：

1. 于 SQL Editor 执行仓库内 schema（至少 `supabase/init.sql`，及你们已用的其它 `supabase/*.sql` / `docs/*.sql`）。
2. 创建 Auth 测试账号与 `profiles` 角色（参考 `README_DEPLOY.md` V1 测试账号）。
3. 在后台 / `payment_methods` 中配置 HitPay 时：
   - `mode = test`（或 `sandbox`）
   - `api_base_url = https://api.sandbox.hit-pay.com/v1`
   - 填入 Sandbox API Key / Salt / Webhook Secret

确认健康检查（本地或 Preview 均可）：

```bash
curl "https://YOUR_PREVIEW_URL/api/auth?action=health"
```

期望：`configured: true`，`missing: []`。

## 3. HitPay Sandbox

1. 登录 [HitPay Dashboard](https://dashboard.hit-pay.com/) → 切到 **Sandbox**。
2. 取得 Sandbox API Key、Salt。
3. Webhook / 回调 URL 指向 Preview 域名，例如：
   - `https://YOUR_PREVIEW_URL/api/payment-callback`
4. 把 Sandbox 密钥填进：
   - Vercel 的 **Preview** 环境变量（见下），和 / 或  
   - Staging 库里的支付渠道配置（与现有后台支付设置一致）。

本仓库模板：`.env.preview.example`。

## 4. 连接 GitHub → Vercel（自动 Preview）

1. 代码已在 GitHub（或推上去）。
2. [Vercel](https://vercel.com/) → Import 该仓库。
3. Framework：Vite；Build：`npm run build`；Output：`dist`（若仪表盘自动识别则保持默认）。
4. **Production Branch** 设为 `main`（或你们的正式分支）。
5. 其它分支 / PR：自动生成 **Preview Deployment**。

### 本地修改后如何自动上 Preview

```text
本地改代码 → git commit → git push → Vercel 构建 Preview → 得到 *.vercel.app 链接
```

- Push 到功能分支：得到该分支的 Preview URL（公开预览 / Staging）。  
- PR：评论区会有 Preview 链接。  
- 合并进 Production 分支并部署：才进入正式流程（见 `PRODUCTION_SETUP.md`）。

> “自动部署 Preview”依赖 Git 推送，不是保存文件就触发。要用 CLI 临时发 Preview：`npx vercel`（不带 `--prod`）。

## 5. 在 Vercel 配置 Preview 环境变量

Project → **Settings → Environment Variables**。

对 `.env.preview.example` 里每一项：

1. 填入 **测试** 值。  
2. Environment **只勾选 Preview**（本地联调可再勾 Development）。  
3. **不要**勾选 Production。

必配至少：

| Key | Staging 值 |
| --- | --- |
| `APP_ENV` | `preview` |
| `SUPABASE_URL` / `VITE_SUPABASE_URL` | 测试项目 URL |
| `SUPABASE_ANON_KEY` / `VITE_SUPABASE_ANON_KEY` | 测试 anon/publishable |
| `SUPABASE_SERVICE_ROLE_KEY` | 测试 service_role（仅服务端） |
| `HITPAY_MODE` | `sandbox` |
| `HITPAY_API_BASE_URL` | `https://api.sandbox.hit-pay.com/v1` |
| `HITPAY_API_KEY` / `HITPAY_SALT` / `HITPAY_WEBHOOK_SECRET` | Sandbox 密钥 |
| `PAYMENT_ENCRYPTION_KEY` 等 | Staging 专用随机串 |

改完环境变量后，**重新部署一次 Preview** 才会生效。

## 6. 四端 Preview 验收入口

假设 Preview 根地址为 `https://meow-xxx-git-branch-team.vercel.app`：

| 端 | URL |
| --- | --- |
| 老板端 / 首页 | `/` 、`/login` 、`/orders` 、`/recharge` |
| 陪玩端 | `/companion/` 、`/companion/login` |
| 客服端 | `/customer-service/` 、`/customer-service/login` |
| 后台中心 | `/admin/` 、`/admin/login` |

全部用 **Staging 测试账号**（见 `README_DEPLOY.md`），在 Preview 上跑完整流程。  
验收清单见 `DEPLOY_CHECKLIST.md`。

## 7. 本地开发建议

```bash
cp .env.preview.example .env.local
# 填入 Staging / Sandbox 值后：
npm install
npm run dev
```

`.env.local` 已在 `.gitignore`，勿提交。

本地默认跟 Preview 同一套测库，避免误写正式数据。

## 8. 常见问题

| 现象 | 处理 |
| --- | --- |
| Preview 连到正式库 | 检查该变量是否误勾了 Preview+Production；拆成两套值 |
| HitPay 真扣款 | 确认 Preview 只用 Sandbox Key，且 Staging 库 `mode=test` |
| 改 env 不生效 | Redeploy Preview |
| `configured: false` | Preview 缺少 Supabase 三项之一 |
| CORS / 自定义域名 | 按需设置 `FRONTEND_ORIGINS` |

下一步：正式上线见 `PRODUCTION_SETUP.md`；日常发版打勾见 `DEPLOY_CHECKLIST.md`。
