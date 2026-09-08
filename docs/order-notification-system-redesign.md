# 订单通知系统 Redesign（Design-only）

**日期：** 2026-09-08  
**约束：** 本文档仅设计；**不改生产代码、不执行 migration、不写 Production。**  
**现状结论：** 通知系统约 **~55–60%** 可用；强项是「指定陪玩指派」时的 companion inbox + Resend + Realtime；短板是生命周期后半段与老板侧静默。

对齐权威订单状态：`docs/order-lifecycle.md`。

---

## 1. 执行摘要

| 项 | 结论 |
|----|------|
| 当前可用 | Companion：指派/改派 inbox + email + broadcast；钱包/提现类系统通知；CS 改状态可走 status notify |
| 明确缺口 | `companion_notifications` **CREATE migration 为空**；boss 无订单生命周期通知；accept/start/complete/confirm 多数无结构化通知；无 email retry cron；无开服前提醒；无原生 Push |
| Redesign 目标 | 补齐订单生命周期双边（boss + companion）通知；修复 schema 源；可观测、可重试、可拆 PR 落地 |

---

## 2. Affected tables

### 2.1 现有（保留并加固）

| 表 | 现状 | Redesign 动作 |
|----|------|----------------|
| `companion_notifications` | Prod/Staging 可能已有表，但仓库 `20260804_companion_notifications.sql` **0 bytes** | **P0：补 CREATE IF NOT EXISTS**（幂等，不 DROP） |
| `companion_notification_reads` | 已有 PK `(companion_id, notice_key)` | 保留；可选加 `notification_id` 外键（P2） |
| `companion_notification_emails` | 指派邮件账本 + `retry_count` / `email_status` | 扩展：`next_retry_at`、`provider_message_id`、`provider_event`（webhook） |
| `boss_notifications` | 仅钱包/退款 `kind` | 扩展 `kind` 枚举语义 + 可选列 `order_id` / `notice_key` / `href` / `channel_flags` |
| `orders` | Realtime publication（部分环境） | 不改业务列；通知只读 `status` / `scheduled_at` / `companion_id` / `customer_id` |
| `staff_notifications` | 财务/客服 | **本 redesign 不纳入**（保持独立） |

### 2.2 拟新增（Staging → 评审 → Prod）

| 表 | 用途 |
|----|------|
| `notification_outbox` | 统一出站队列：事件 → channel fan-out（inbox / email / push / realtime） |
| `notification_delivery_attempts` | 每次发送尝试日志（可替代部分散落 detail 字符串） |
| `boss_notification_reads` *(可选)* | 若老板端改为 notice_key 模型；否则继续用 `boss_notifications.read_at` |
| `push_device_tokens` | Web Push / 未来 APNs/FCM device 注册 |
| `notification_preferences` | 用户级渠道开关（boss/companion × email/push/inbox） |
| `order_reminder_jobs` | 开服前提醒 / 待确认完成 等调度状态（idempotent） |

### 2.3 Proposed `companion_notifications` CREATE（修复空 migration；**未执行**）

```sql
-- DESIGN ONLY — do not apply in this PR
create table if not exists public.companion_notifications (
  id uuid primary key default gen_random_uuid(),
  companion_id uuid not null references public.profiles(id) on delete cascade,
  notice_key text not null,
  category text not null default 'system',  -- system|order|withdraw|audit|activity|email_log
  title text not null default '',
  body text not null default '',
  href text not null default '',
  notification_type text,
  related_application_id uuid,
  order_id uuid,
  created_at timestamptz not null default now(),
  unique (companion_id, notice_key)
);
create index if not exists idx_companion_notifications_companion_created
  on public.companion_notifications (companion_id, created_at desc);
```

> 与现有 `insertCompanionNotification` / alter migrations 对齐；`IF NOT EXISTS` 保证对已有 Prod 表安全。

### 2.4 Proposed `boss_notifications` 扩展（**未执行**）

```sql
-- DESIGN ONLY
alter table public.boss_notifications
  add column if not exists notice_key text,
  add column if not exists order_id uuid,
  add column if not exists href text not null default '',
  add column if not exists category text not null default 'wallet'; -- wallet|order|refund|system
  add column if not exists meta jsonb not null default '{}'::jsonb;

create unique index if not exists boss_notifications_boss_notice_uidx
  on public.boss_notifications (boss_id, notice_key)
  where notice_key is not null and btrim(notice_key) <> '';
```

`kind` 继续兼容：`wallet` | `refund` | **`order`**（新）。

### 2.5 Proposed `notification_outbox`（**未执行**）

```sql
-- DESIGN ONLY
create table if not exists public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,           -- see §3 matrix
  audience text not null,             -- companion|boss|both
  order_id uuid,
  recipient_id uuid not null,
  notice_key text not null,
  payload jsonb not null default '{}'::jsonb,
  channels text[] not null default '{inbox}',  -- inbox|email|realtime|push
  status text not null default 'pending',      -- pending|processing|sent|partial|failed|dead
  attempts int not null default 0,
  next_retry_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (notice_key, recipient_id)
);
create index if not exists idx_notification_outbox_poll
  on public.notification_outbox (status, next_retry_at)
  where status in ('pending','failed');
```

---

## 3. Order lifecycle event matrix

图例：✅ 已有 · ⚠ 部分/仅 CS · ❌ 缺失 · → 目标渠道

| # | Event（产品） | DB / 触发点 | Companion inbox | Companion email | Companion realtime | Boss inbox | Boss email | Push (目标) |
|---|---------------|-------------|-----------------|-----------------|--------------------|------------|------------|-------------|
| E1 | 下单待支付 | `awaiting_payment` | — | — | — | ❌→✅ 可选 | ❌ | ❌ |
| E2 | 支付成功 / 待接单 | → `claimed` | ✅ 指定单 | ✅ | ✅ | ❌→✅ | ❌→✅ 摘要 | → |
| E3 | 改派 / 取消指派 | admin/CS assign | ✅ | ✅ | ✅ | ❌→✅ | ❌ | → |
| E4 | 陪玩接单 | `accept_direct` → `in_progress` | ❌→✅ | ❌ | ❌→✅ | ❌→✅ | ❌→✅ | → |
| E5 | 陪玩拒单 | `reject_direct_order` | ❌（仅 chat）→✅ | ❌ | ❌ | ❌→✅ | ❌→✅ | → |
| E6 | 开始服务 | `start_order` | ❌→✅ | ❌ | ❌→✅ | ❌→✅ | ❌ | → |
| E7 | **开服前提醒**（T−30m） | cron on `scheduled_at` | ❌→✅ | ❌→✅ | ❌ | ❌→✅ | ❌→✅ | → |
| E8 | 陪玩申请完成 | `complete_order` + chat | ❌→✅ | ❌ | ❌ | ❌→✅ | ❌→✅ | → |
| E9 | 老板确认完成 | `confirm_complete` | ❌→✅ | ❌→✅ 结算摘要 | ❌ | ❌→✅ | ❌ | → |
| E10 | 24h 自动完成 | cron `order-auto-complete` | ❌→✅ | ❌ | ❌ | ❌→✅ | ❌→✅ | → |
| E11 | 取消（未支付） | `cancel_order` | — | — | — | ❌→✅ | ❌ | — |
| E12 | 退款请求 / 退款完成 | refund paths | ⚠ CS status | ⚠ | ⚠ | ✅ 钱包类 | ❌→✅ | → |
| E13 | 结算入账 | `companion_income` | ⚠ 财务通知 | ❌ | ❌ | — | — | → |
| E14 | 接单超时预警 | `_order-confirm-timeout` **已禁用** | 代码存在但 no-op | — | — | — | — | P3 再开 |

### Event flow（目标）

```
Order mutation (orders / companion / boss / CS / admin / cron)
        │
        ▼
  emitOrderNotificationEvent(event_type, order, actors)
        │  notice_key = `{orderId}:{recipientId}:{event_type}`
        ▼
  notification_outbox (idempotent upsert)
        │
        ├── inbox writer  → companion_notifications / boss_notifications
        ├── email writer  → companion_notification_emails (+ 未来 boss_notification_emails)
        ├── realtime      → broadcast topic mcj-{role}-orders:{uid}
        └── push writer   → Web Push / 未来 FCM（读 push_device_tokens）
        │
        ▼
  delivery_attempts + status；失败 → next_retry_at（cron 捞取）
```

**原则：**
- 业务 API **只 emit**，不各自拼邮件 HTML（收敛到 `_order-notify-dispatch.js` 一类模块）。
- `proposed` / 未读语义：inbox 行是 SoT；派生 `buildSystemNotices` 逐步降级为「无 DB 行时的只读补充」，最终以 outbox→inbox 为准。
- **不改变权限规则**：谁能读通知仍按角色 JWT；不扩大订单可见性。

---

## 4. API changes（设计；本 PR 不实现）

### 4.1 保持兼容

| API | 说明 |
|-----|------|
| `GET/POST` companion inbox / `mark_notices_read` | 响应字段保持；后端改为优先读 DB 行 |
| `GET/POST /api/notifications`（boss） | 继续服务 `boss_notifications`；扩展 `kind=order` |
| Admin mail-logs + manual retry | 保留；cron retry 与之共用 writer |

### 4.2 拟新增 / 扩展

| API | 方法 | 用途 |
|-----|------|------|
| `/api/cron/notification-email-retry` | GET（Vercel Cron + secret） | 捞 `failed/pending` 邮件与 outbox |
| `/api/cron/order-prestart-reminder` | GET | `scheduled_at` ∈ [now+25m, now+35m] 且未提醒 |
| `/api/boss/notifications` *(可选别名)* | GET | 与现 `/api/notifications` 统一文档 |
| `/api/push/register` | POST | 注册 Web Push subscription |
| `/api/push/unregister` | POST | 注销 |
| `/api/webhooks/resend` | POST | Resend delivery events → 更新 email 账本 |
| Internal | `emitOrderNotificationEvent` | server-only；挂到 accept/start/complete/confirm/auto-complete |

### 4.3 明确不改

- Supabase Auth
- 订单状态机 / `mcj_order_status` 语义（只挂 notify hook）
- HitPay / 钱包入账逻辑（退款成功已有 boss 通知则复用 emit）

---

## 5. Email retry cron

### 5.1 现状

- 状态：`email_pending` → `sent` | `failed`（`companion_notification_emails`）
- 重试：**仅 Admin 手工**（`admin/mail-logs`）
- **无** Resend delivery webhook

### 5.2 设计

| 项 | 方案 |
|----|------|
| Cron | `*/10 * * * *` → `/api/cron/notification-email-retry` |
| 选取 | `email_status in ('failed','email_pending')` 且 `attempts < 5` 且 `next_retry_at <= now()` |
| 退避 | 1m → 5m → 15m → 60m → 6h；超限 → `dead` |
| 幂等 | 继续用 `notification_key`；已 `sent` 跳过 |
| 密钥 | `CRON_SECRET` / 现有 Vercel cron 鉴权模式 |
| Webhook（P2） | Resend `email.delivered|bounced|complained` → 更新 `provider_event`，bounce 停重试 |

Boss 订单邮件：P1 可先复用同一账本表加 `audience=boss` 列，或新建 `boss_notification_emails`（推荐分表以免污染 companion 管理页）。

---

## 6. Pre-start reminder cron

| 项 | 方案 |
|----|------|
| Cron | `*/5 * * * *` → `/api/cron/order-prestart-reminder` |
| 条件 | `orders.scheduled_at` 非空；状态 ∈ `claimed|confirmed|in_progress`；距开始 **30±5 分钟**；未发过 `event_type=prestart_reminder` |
| 接收方 | companion **必达** inbox+email；boss **必达** inbox（email 可配置） |
| 幂等 | `order_reminder_jobs(order_id, reminder_type)` unique 或 outbox `notice_key` |
| 与 timeout | 不恢复已禁用的接单超时产品行为；reminder ≠ timeout cancel |

依赖列：若 Staging/Prod 缺少可靠 `scheduled_at`，先在 schema 审计 PR 中确认（只读），再开实现 PR。

---

## 7. Push architecture

### 7.1 阶段

| Phase | 通道 | 说明 |
|-------|------|------|
| P0 | Inbox + Realtime + Email | 不引入原生推送也能补齐生命周期可见性 |
| P1 | **Web Push**（VAPID） | Service Worker + `push_device_tokens`；老板/陪玩浏览器后台可达 |
| P2 | 微信模板消息 / 订阅消息 | 仅微信 WebView 场景；需公众号配置（外部依赖） |
| P3 | APNs / FCM | 仅当有原生 App；本仓库暂无 |

### 7.2 Web Push 数据流

```
Client: Notification.requestPermission → pushManager.subscribe(VAPID)
     → POST /api/push/register { endpoint, keys, role }
Server: emit → push writer → web-push library → endpoint
SW:    push event → showNotification → click → href deep link
```

### 7.3 原则

- Push **不是** SoT；inbox 行才是。Push 失败不阻断订单。
- 尊重 `notification_preferences`（默认：订单类 on，营销 off）。
- 不在 Push payload 放 PII  transient；仅 `title/body/orderId/href`。

---

## 8. Rollback plan

| 层 | Rollback |
|----|----------|
| 代码 | Revert 实现 PR；emit 改为 no-op / feature flag `ORDER_NOTIFY_V2=0` |
| 表 | **不 DROP** 新列/新表；停止写入即可 |
| 空 migration 修复 | `CREATE IF NOT EXISTS` 对已有表无害；回滚代码不影响已建表 |
| Cron | 从 `vercel.json` 移除 path 即停；不删历史 outbox |
| Email | 停 cron 后仍可 Admin 手工 retry；Resend webhook 取消 endpoint |
| Push | 停 register + writer；tokens 保留 |

Feature flag 建议：`ORDER_NOTIFY_V2`（emit 全量）、`ORDER_NOTIFY_EMAIL_RETRY`、`ORDER_PRESTART_REMINDER`、`ORDER_WEB_PUSH`。

---

## 9. PR 拆分计划

| PR | 范围 | 风险 | 依赖 |
|----|------|------|------|
| **D0（本 PR）** | Design-only 文档 | 无 | — |
| **N1** | 修复 `companion_notifications` CREATE migration + Staging apply 脚本（只 DDL，无行为） | 低 | D0 |
| **N2** | `boss_notifications` 扩展列 + boss inbox 读路径展示 `kind=order`（仍可不发事件） | 低 | N1 |
| **N3** | `notification_outbox` + `emitOrderNotificationEvent`；挂 **E4/E5/E8/E9**（接单/拒单/完成申请/老板确认） | 中 | N1–N2 |
| **N4** | Email retry cron + `next_retry_at` + admin 共用 | 中 | N3 |
| **N5** | Pre-start reminder cron（E7） | 中 | N3、`scheduled_at` 审计 |
| **N6** | Boss/companion 补齐 E2/E3/E6/E10/E12 全矩阵 | 中 | N3 |
| **N7** | Resend webhook + 投递可观测 | 低 | N4 |
| **N8** | Web Push register + writer（P1 push） | 中 | N3、preferences |
| **N9** | 清理派生 notices / 文档与 e2e（扩展 `p0-order-notify-three-paths-e2e`） | 低 | N6 |

**禁止混入：** 定价 P2、OTP、#198 gameplay、Production migration 执行。

---

## 10. 验收标准（实现 PR 用）

1. Staging：`to_regclass('public.companion_notifications')` 非空且含 `notice_key` 唯一约束。  
2. 指派三路径 e2e 仍 PASS（回归）。  
3. `accept_direct` / `complete_order` / `confirm_complete` 各产生 companion+boss inbox 行（幂等二次调用不双写）。  
4. 故意失败的邮件在 ≤10 分钟内被 cron 重试并更新 `retry_count`。  
5. 带 `scheduled_at` 的订单在 T−30m 窗口收到且仅一次 prestart 通知。  
6. 全程无 Production 写入；Prod DDL 仅 `pending-prod/` 评审稿。

---

## 11. 关键文件索引（现状，供实现对照）

- `supabase/migrations/20260804_companion_notifications.sql` *(empty — N1 修复目标)*  
- `supabase/migrations/20260804_companion_review_notify_email.sql`  
- `supabase/migrations/20260806_companion_order_realtime_notify.sql`  
- `supabase/migrations/20260731_companion_inbox.sql`  
- `supabase/wallet-system.sql` (`boss_notifications`)  
- `server/api/_companion-order-notify.js`  
- `server/api/_companion-inbox.js`  
- `server/api/notifications.js`  
- `server/api/cron/order-auto-complete.js`  
- `server/api/admin/mail-logs.js`  
- `docs/order-lifecycle.md`  
- `scripts/p0-order-notify-three-paths-e2e.mjs`

---

## 12. 本 PR 交付清单

- [x] Design-only 文档（本文）  
- [x] Affected tables  
- [x] Event flow + matrix  
- [x] API changes  
- [x] Email retry cron 设计  
- [x] Pre-start reminder cron 设计  
- [x] Push architecture  
- [x] Rollback plan  
- [x] PR 拆分计划  
- [x] **无**生产代码改动、**无** migration 执行  
