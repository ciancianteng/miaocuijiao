# Deploy Checklist

公开预览 = **Staging = Vercel Preview**。  
所有四端都必须在 Preview 验收通过后，才能发 Production。

## A. 推代码前（本地）

- [ ] 改动只在预期范围；后台 Design Freeze：未擅自改 admin 布局/CSS（除非已确认）
- [ ] `.env.local` / 密钥未进 Git
- [ ] `npm run build` 本地通过
- [ ] 本地或指向 Staging 的联调无明显报错

## B. 自动 Preview（Staging）

- [ ] 已 `git push` 到 GitHub（功能分支或 PR）
- [ ] Vercel 出现新的 **Preview** Deployment，状态 Ready
- [ ] 打开 Preview URL，记下根地址：`https://__________.vercel.app`

### Preview 环境确认

- [ ] Vercel 该次部署使用的是 **Preview** 环境变量（测库，不是正式库）
- [ ] `GET /api/auth?action=health` → `configured: true`，`missing: []`
- [ ] 页面加载的数据来自 **Staging Supabase**（可用测试账号/测试 Banner 辨认）
- [ ] HitPay 相关配置为 **Sandbox**（`HITPAY_MODE=sandbox` / 测库 `mode=test`）

## C. 四端 Preview 验收（必须全过）

### 1. 老板端

- [ ] `/` 与 `/login` 可打开
- [ ] 测试老板账号登录成功
- [ ] 浏览陪玩 / 下单相关页面正常
- [ ] 在线客服或消息入口可用（按当前版本能力）
- [ ] 充值页可打开；若测支付，只用 **Sandbox**，确认无 Live 扣款

### 2. 陪玩端

- [ ] `/companion/` 、`/companion/login` 可打开
- [ ] 测试陪玩账号登录
- [ ] 接单大厅 / 订单 / 上下线等核心路径可用

### 3. 客服端

- [ ] `/customer-service/` 、`/customer-service/login` 可打开
- [ ] 测试客服账号登录
- [ ] 会话接入、回复、订单相关操作可用

### 4. 后台中心

- [ ] `/admin/` 、`/admin/login` 可打开
- [ ] 测试管理员登录
- [ ] 订单列表、Banner/公告、权限范围内页面可打开且读写落在 **测库**

### 串联业务（建议每版都跑）

参考 `README_DEPLOY.md` V1 流程，在 **Preview** 上：

- [ ] 老板下单 → 客服处理 → 陪玩接单完成 → 老板确认（按现行状态机）
- [ ] 关键数据写在 Staging，不在 Production

## D. 发 Production 前

- [ ] 本节 C 全部打勾
- [ ] Production 环境变量已按 `.env.production.example` 配好（只勾 Production）
- [ ] Production Supabase schema 已同步（迁移先 Staging 后正式）
- [ ] HitPay **Live** Key / Webhook 指向正式域名
- [ ] 正式站域名 / Auth Redirect / CORS（`FRONTEND_ORIGINS`）已更新
- [ ] 有人确认：「可以上正式」

## E. 发布 Production

- [ ] PR 合入 Production Branch（通常 `main`），或按流程 Promote
- [ ] Vercel Production Deployment Ready
- [ ] `GET https://正式域名/api/auth?action=health` → configured
- [ ] 正式站四端各登录一次冒烟（内部账号）
- [ ] （可选）Live 最小金额支付冒烟后，再开放流量

## F. 出问题立刻做

- [ ] Vercel 回滚到上一 Production Deployment
- [ ] 支付异常：后台停用 Live 渠道，核对 HitPay Webhook 与订单表
- [ ] 确认事故是否误用了 Preview/Production 交叉密钥

---

### 环境速查

| | Preview（Staging） | Production |
| --- | --- | --- |
| 模板 | `.env.preview.example` | `.env.production.example` |
| Supabase | 测试项目 | 正式项目 |
| HitPay | Sandbox | Live |
| 验收 | **全部在此完成** | 仅冒烟 |
| 说明 | `STAGING_SETUP.md` | `PRODUCTION_SETUP.md` |
