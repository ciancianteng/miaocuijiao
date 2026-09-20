# 线上 OTP 偶发收不到 — 排查报告

**日期：** 2026-09-08  
**范围：** Production（`www.meowcuijiao.com` / Supabase `jqfaknpmcnqwqvatrwgo`）只读排查  
**结论摘要：** 主因是 **serverless 进程内 cooldown 失效 + 重发覆盖旧码**；次因是 **防枚举成功假象** 与 **邮件投递不可观测**。OTP **不是** Supabase Auth `signInWithOtp`，查 Auth logs 看不到发送结果。

---

## 检查清单对照

| # | 检查项 | 结果 |
|---|--------|------|
| 1 | OTP API 是否每次真实发送成功 | **否。** 未注册/角色不匹配/禁用账号 → HTTP 200 `ok:true` **但不发信**（防枚举）。邮件失败 → 正式环境应 503（`clientOtpSendPayload` fail-closed）。 |
| 2 | Supabase Auth logs | **基本无关。** 登录/注册/找回 OTP 走自定义 `/api/auth` + Resend/SMTP；Auth 只在 **校验成功后** `generate_link(magiclink)` 建会话。Auth logs **不会**记录 OTP 邮件投递。 |
| 3 | Rate limit | **弱。** `assertOtpResendCooldown` 用 `globalThis.__mcjOtpCooldown`（**进程内存 Map**）。Vercel 多 isolate / 冷启动 **不共享** → 60s 限制可被绕过。校验失败次数限制同样在内存。 |
| 4 | 重复发送导致旧 OTP invalid | **是（设计如此 + 被 3 放大）。** `storeOtp` 写入同一 `platform_settings` id（merge）或新 `password_reset_requests` 行后 `findOtp` 取最新 → **新码使旧码失效**。Production **无** `password_reset_requests` 表（404），全程走 `platform_settings` 覆盖写。 |
| 5 | 前端连续点击 | **部分防护。** `role-gates` / forgot 会 `disabled=true`；无 `sessionStorage` 持久 cooldown；刷新后按钮可立即再点。同 tick 双击窗口很小；iOS 合成 click 一般单次。 |
| 6 | OTP cooldown 是否正确 | **UI 60s ≠ 服务端强保证。** 登录/找回成功响应常 **不带** `retryAfterSec`（前端默认 60）；服务端 cooldown 可因 isolate 漂移。后台 tab 会冻结 `setInterval`。 |
| 7 | 邮件/SMS provider delivery | **SMS：MVP 禁用**（`sendSmsOtp` stub）。邮件：Resend → SMTP fallback。本环境 **无** Production `RESEND_API_KEY`，无法拉 Resend delivery；需 Dashboard / Vercel `[mail/resend]` 日志。 |
| 8 | Safari iOS / Chrome mobile session | 找回页已修 countdown remount 丢焦点（#183）。**无** visibility/bfcache 处理。会话本身用 token storage，与「收不到码」弱相关；更相关是 **键盘/焦点** 与 **连点/刷新绕过 UI cooldown**。 |

---

## A. 根因判断（按优先级）

### P0 — Serverless 内存 cooldown 失效（最吻合「第一次有、第二次没有」）

```376:388:server/api/auth.js
async function assertOtpResendCooldown(...) {
  globalThis.__mcjOtpCooldown = globalThis.__mcjOtpCooldown || new Map();
  // ...
  globalThis.__mcjOtpCooldown.set(key, Date.now());
}
```

- 第一次发送：isolate A 发信成功，用户收到码 #1。  
- 用户快速再点 / 刷新后再点：请求落到 isolate B → **无 last 记录** → 再次 `storeOtp` + 发信。  
- `platform_settings` **同 id 覆盖** → 库里只剩码 #2；码 #1 立刻无效。  
- 若邮件 #2 进垃圾箱/延迟，用户感觉「第二次收不到」或「有码却验证失败」。

### P0 — 重发覆盖旧 OTP（产品语义 + 上述放大）

- `findOtp` 只认最新有效 `kind:code:exp`。  
- Production 缺表 `password_reset_requests`（pending-prod `06_...sql` **未上线**），只能靠 `platform_settings` 单槽覆盖，**无历史行可审计**。

### P1 — 防枚举「假成功」被当成发送成功

```700:707:server/api/auth.js
const generic = { ok: true, message: "如该邮箱已注册，将收到登录验证码。", ... };
if (!resolved?.profile || resolved.profile.status === "disabled") return json(res, 200, generic);
```

- 错邮箱、错角色入口、禁用号 → UI 显示类似成功，**邮箱为空**。  
- Live 探针：`send_login_otp` + 不存在邮箱 → `{"ok":true,"message":"如该邮箱已注册，将收到登录验证码。"}`（已验证）。

### P1 — 投递层不可观测 / 可能的 Resend 延迟或限流

- 成功路径只 `console.info("[mail/resend] sent", { id })`，**无业务表落库 Resend id / delivery webhook**。  
- 「部分用户」符合 spam、域名信誉、二次发送被 defer 的特征，但 **本次无法在 Resend 侧证实**。

### P2 — 前端 cooldown 非持久

- 仅按钮 `disabled` + `setInterval`；无跨刷新存储。  
- 与 P0 叠加：用户刷新 → UI 可点 → 新 isolate → 再发 → 旧码作废。

### 非主因

- **Supabase Auth OTP 配置**：本产品路径不用它发码。  
- **SMS**：未启用，若用户等短信则会「永远收不到」。  
- **正式环境邮件失败仍返回成功**：代码在 production/preview 对 mail fail 返回 503（除非误开 `MCJ_OTP_DEBUG`/`ALLOW_STAGING_OTP`）；需确认 Vercel Production **未**开启这两个开关。

---

## B. 影响范围

| 入口 | Action | 受影响 |
|------|--------|--------|
| 首页/老板登录 OTP | `send_login_otp` | 高（用户原话「首页」） |
| 陪玩登录 / 申请登录 | 同上 / `send_register_otp` | 高 |
| 找回密码 | `forgot_send_otp` | 中（同 cooldown/覆盖模型） |
| 注册 OTP | `send_register_otp` | 中（成功响应带 `retryAfterSec`） |
| CS/Admin 登录 | 拒绝 OTP | 无（密码登录） |

**用户体感：**

1. 点了「获取验证码」提示成功但无邮件 → 多为 P1 假成功或进垃圾箱。  
2. 第一次有码，第二次没有 / 第一次码突然失效 → 强烈指向 P0。  
3. 验证码错误次数多 → 旧码失效 + 内存 fail 计数（跨 isolate 也不准）。

**数据面（只读 Production）：**

- `password_reset_requests`：**不存在**（PostgREST 404 / PGRST205）。  
- `platform_settings` `mcj_otp_*`：近 24h 可见少量 `login_otp` / `register_used`；单槽覆盖，**难以从 DB 重建完整发送时间线**。

---

## C. 修复方案

### 必须（Fix PR）

1. **耐久化 resend cooldown**  
   - 写入 `platform_settings` / 新表字段 `last_sent_at`（按 `role+kind+accountKey`），`assertOtpResendCooldown` 读 DB，不依赖 `globalThis`。  
   - 校验失败计数同样落库或至少用共享存储。

2. **上线 `password_reset_requests`（pending-prod/06）**  
   - Staging 验证 → Production 迁移。  
   - 保留历史发送行，便于审计；`findOtp` 仍取最新未过期。

3. **发送成功才轮换有效码（推荐）**  
   - 顺序：`assert cooldown` → `sendEmailOtp` → 成功后再 `storeOtp`。  
   - 或：先 store pending，邮件失败则回滚/不切换 `findOtp` 指针，避免「邮件没到但旧码已废」。

4. **前端 harden**  
   - `sessionStorage` 持久 60s cooldown（key=email+action）。  
   - 发送中 `busy` 锁 + 忽略重复 click。  
   - 登录/找回成功响应 **统一返回** `retryAfterSec`。  
   - `visibilitychange` 用 deadline 时间戳校正倒计时（不依赖纯 tick）。

5. **可观测性**  
   - 表或日志：`resend_id`, `to_masked`, `purpose`, `ok`, `provider`, `http_status`。  
   - 接入 Resend webhook（delivered/bounced/complained）或定期拉 delivery。  
   - Vercel 告警：`[mail/resend] fail` / `[auth/*/mail failed]`。

### 产品/文案（小改）

6. 防枚举文案保持模糊，但前端可提示：**请确认邮箱与端（老板/陪玩）一致，并检查垃圾箱**（不暴露是否注册）。  
7. `EMAIL_NOT_VERIFIED` 明确引导，避免当成「没寄出」。  
8. UI 明确 **仅邮箱**，勿暗示短信。

### 运维核对（人工）

9. Vercel Production：确认无 `MCJ_OTP_DEBUG=1` / `ALLOW_STAGING_OTP=1`。  
10. Resend Dashboard：域名验证、bounce rate、同一收件人短时多封。  
11. 抽样用户：垃圾箱 / 邮箱服务商拦截。

---

## D. 是否需要 PR

| PR | 内容 | 建议 |
|----|------|------|
| **本 PR** | 排查报告（本文） | 仅文档 |
| **Fix PR（建议立即开）** | 耐久 cooldown + 发信成功后再落码 + 前端 sessionStorage cooldown + `retryAfterSec` 统一 | **需要** |
| **Migration PR** | Production 应用 `06_password_reset_requests.sql`（先 Staging） | **需要**（可与 Fix 同 PR 或随后） |
| **Observability PR** | mail send 落库 + Resend webhook | 建议紧随 |

**不要**把「查 Supabase Auth OTP 模板」当主修复路径。

---

## 证据索引

- Cooldown 内存：`server/api/auth.js` `assertOtpResendCooldown`  
- 假成功：`handleLoginSendOtp` / `handleForgotSendOtp` generic 200  
- 存储与覆盖：`server/api/_otp-store.js` `storeOtp` / `findOtp`  
- 邮件：`server/api/_mail.js` Resend + SMTP；SMS stub  
- 前端：`src/role-gates.js`、`src/forgot-password.js`  
- Production：`password_reset_requests` 404；OTP 在 `platform_settings` `mcj_otp_*`  
- Live 探针：不存在邮箱 → `ok:true` 无发送  

---

## 建议验收（Fix 后）

1. 同一邮箱 60s 内第二次请求：任意 isolate 均 429 + `retryAfterSec`。  
2. 邮件 API 失败：旧码仍可验证（若采用「成功后再轮换」）。  
3. 刷新页面：按钮仍显示剩余冷却。  
4. Staging 可查 `password_reset_requests` 发送时间线；Resend id 可对上。  
5. 假账号请求：仍不枚举，但文案含查垃圾箱/确认端。

---

## Fix PR status (2026-09-08)

Implemented on branch `cursor/otp-fix-storage-cooldown-dcea` (awaiting review):
- Durable `password_reset_requests` + columns (`provider_message_id`, `delivery_status`, …)
- DB cooldown; send-success-then-rotate; no `platform_settings` OTP slot
- Frontend `sessionStorage` + `retryAfterSec`
- Production: `allowDebugOtp()` hard-returns false when `VERCEL_ENV=production`
- Staging apply: `scripts/apply-otp-fix-staging.mjs` — **Production migration not executed**
