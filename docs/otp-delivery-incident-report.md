# OTP 偶发收不到 — 排查报告

> 范围：首页/老板端/陪玩端邮箱验证码登录与注册。  
> 方法：代码审计 + **Production 只读**探测（`platform_settings` OTP 行、Auth health）。  
> **未**发送真实 OTP；**未**改 Production；本环境无 `RESEND_API_KEY`，无法直查 Resend delivery API。

---

## A. 根因判断

**主因（高置信度，可叠加）：**

### A1. 二次发送使旧 OTP 失效（最符合「第一次能收到/能用，第二次以后不行」）
- OTP **不是** Supabase `signInWithOtp`，而是自建邮箱码 + Resend/SMTP。
- Production **缺少** `public.password_reset_requests`（REST 404 / PGRST205）。
- 实际落在 `platform_settings`：`id = mcj_otp_<hash(role,kind,account)>`，**同一账号同一 kind 反复 upsert 覆盖**。
- 用户点第二次「获取验证码」后，库里只剩新码；若仍输入**第一封邮件**的码 →「无效或已过期」。
- 新邮件若进垃圾箱/延迟，表现就是「第二次收不到 / 收到了也登不上」。

### A2. 防枚举成功回包伪装成「已发送」
`handleLoginSendOtp`：邮箱未注册或账号 disabled 时仍返回 **`ok: true`**  
文案：`如该邮箱已注册，将收到登录验证码。` — **不发信**。  
部分用户体感 = 「请求 OTP 没收到」。

### A3. 冷却写在发信成功之前 + serverless 内存冷却不可靠
- `assertOtpResendCooldown` 在 `sendEmailOtp` **之前**就把 60s 冷却写入 `globalThis.__mcjOtpCooldown`。
- 发信失败会 503，但冷却已占用；用户需再等一轮。
- 冷却 Map 在 Vercel 多 isolate 间**不共享** → 仍可能短时间多次真实发信 → 再次触发 A1。

### A4. 前端 429/失败后立刻重新可点
成功才倒计时 60s；`catch` 路径立刻 `disabled=false`，**不消费** `retryAfterSec`。  
可连续点到打满 provider / 覆盖旧码。

### 次要 / 需补证据
| 项 | 状态 |
|----|------|
| Supabase Auth OTP logs | **不适用**：登录 OTP 不走 GoTrue 发信；`/auth/v1/admin/audit` 为空 |
| Resend rate limit / delivery | **未直接验证**（环境无 Resend key）；失败时服务端打 `[mail/resend] fail` / `[auth/send_login_otp] mail failed` |
| SMS | MVP **永不发送**（`sms_disabled_mvp`） |
| Safari session | OTP 本身不靠 cookie；登录成功后 token 在 localStorage — 与「收不到邮件」弱相关；忘记密码页已有 OTP focus 修复 |

**综合结论：**  
线上「偶发收不到 / 第二次不行」优先解释为 **(A1 覆盖旧码 + A2 假成功 + A3/A4 冷却与连点)**，而非 Supabase Auth OTP 通道故障。邮件 provider 偶发失败可能叠加，但需 Resend/Vercel 日志确认。

---

## B. 影响范围

| 范围 | 说明 |
|------|------|
| 产品面 | 首页老板验证码登录、陪玩端验证码登录、注册邮箱 OTP、找回密码 OTP（同一套 store/mail） |
| 用户 | 已注册用户二次重发；未注册用户点登录 OTP（假成功）；多端/多 tab 连点 |
| 数据 | Prod OTP 现网依赖 `platform_settings`（约 50+ `mcj_otp_*` 行）；`password_reset_requests` **未建** |
| 结算/订单 | 无直接影响 |
| Auth | 校验成功后才 `admin/generate_link(magiclink)` 建 session — 收不到码则登不上 |

---

## C. 修复方案（建议，待确认后 PR）

### P0 — 行为修复（推荐立刻开 PR）
1. **冷却移到发信成功之后**；失败不占用冷却（或短冷却）。  
2. 前端：429 时按 `retryAfterSec` 倒计时，禁止立刻重点；发送中保持 disabled。  
3. 成功文案区分：真实已发送 vs 防枚举（对已登录场景可不改枚举策略，但对 UI 可统一「请查收；未收到请 60s 后重试，并以最新邮件为准」）。  
4. 重发时在响应中明确 `codeRotated: true`（不回传码），前端提示「请使用最新一封邮件中的验证码」。

### P1 — 存储与可观测性
5. **Staging/Prod 应用** `pending-prod/06_password_reset_requests.sql`（先 Staging），停止把 OTP 塞进 `platform_settings`。  
6. 每次发送写审计：`mail_provider`、`resend_id`、`ok/fail`（可落 admin mail log 或专用表），便于对照 delivery。  
7. 冷却改为 **DB/Redis 级**（或写入 OTP 行的 `sent_at`），跨 isolate 一致。

### P2 — Provider
8. 核对 Resend domain / 限额 / bounce；失败 fail-loud 已有，需告警。  
9. 明确产品文案：仅邮箱，无短信。

### 不建议
- 不要改成裸依赖 `supabase.auth.signInWithOtp` 除非整体重做（现网是 custom OTP + magiclink session）。

---

## D. 是否需要 PR

**需要。** 建议独立 PR（与定价 P1/P2、#198 分离），例如：  
`fix(auth): otp resend cooldown + latest-code UX + durable store readiness`

本轮为排查报告 only；**未改代码、未跑 Production migration。**

---

## 检查项对照

| # | 检查 | 结论 |
|---|------|------|
| 1 | API 是否每次真实发送成功 | **否保证**：未注册→假成功；mail 失败→503；成功才真发 |
| 2 | Supabase Auth logs | OTP **不经** Auth 发信；audit 空，无 OTP delivery 记录 |
| 3 | Rate limit | 服务端 60s **内存**冷却；跨 isolate 弱；验证失败 8 次/TTL |
| 4 | 重复发送使旧 OTP invalid | **是**（platform_settings 覆盖；符合二次失败现象） |
| 5 | 前端连点 | 成功后有倒计时；失败/429 **可立刻再点** |
| 6 | Cooldown | 客户端约 60s；服务端先记后发；login 成功响应常不带 `retryAfterSec`（前端默认 60） |
| 7 | Email/SMS delivery | SMS 关闭；Resend delivery **本环境无法直查** |
| 8 | Safari/Chrome session | 弱相关；收信问题为主 |

---

## 只读证据摘要

- Prod `password_reset_requests`：**缺失**  
- Prod `platform_settings` `mcj_otp_*`：存在；login/register/forgot 混用；**upsert 单行覆盖**  
- GoTrue health：正常；admin audit：空  

*报告时间：2026-09-08*
