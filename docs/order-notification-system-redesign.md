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

### 1.1 Architecture principles（已确认 — 实现前冻结）

| 原则 | 说明 |
|------|------|
| **Inbox is source of truth** | `companion_notifications` / `boss_notifications`（及未来 outbox→inbox 写入）是用户可见通知的权威记录。Realtime / email / push **不是** SoT。 |
| **Email / realtime / push are fan-out channels** | 渠道从 outbox（或等价 emit）扇出；任一渠道失败只标记该渠道，不删除 inbox 行。 |
| **Order mutation succeeds before notification emission** | 订单状态机 / 支付 / 指派等业务写库 **先 commit 成功**，再 `emitOrderNotificationEvent`。禁止「先发通知再改单」。 |
| **Notification failures never rollback orders** | emit / fan-out / cron retry 均在业务事务之外（或独立 try/catch）；通知错误 **不得** `ROLLBACK` 订单 mutation，也不得把订单 API 改为 5xx 仅因邮件失败。 |

---

## 1.2 Unified `notice_key` format

**Canonical（订单类）：**

```text
order:{orderId}:{recipientId}:{event}:{version}
```

| 段 | 含义 |
|----|------|
| `order` | 固定前缀；与非订单 notice（钱包、审核等）命名空间隔离 |
| `orderId` | `orders.id` |
| `recipientId` | 收件人 `profiles.id`（boss 或 companion） |
| `event` | 稳定事件码，如 `payment_success` / `assigned` / `accepted` / `rejected` / `cancelled` / `prestart_reminder` / `review_reminder` |
| `version` | 整数版本，默认 `1`；同事件语义变更或产品要求「允许再通知一次」时递增 |

示例：`order:ord_abc:uuid-boss:payment_success:1`

**非订单类**（钱包、陪玩入驻审核等）**不使用**此前缀；保持既有 key 约定，避免碰撞。

---

## 1.3 Idempotency strategy

| 层 | 策略 |
|----|------|
| Inbox | `UNIQUE (companion_id, notice_key)` / boss `UNIQUE (boss_id, notice_key)`（partial where notice_key 非空） |
| Outbox | `UNIQUE (notice_key)`（key 已含 recipient；勿再叠 recipient 维度导致歧义） |
| Emit | `INSERT … ON CONFLICT (notice_key) DO NOTHING`（或等价 upsert）；冲突 = 已投递过，**成功幂等** |
| Email row | 订单邮件账本以同一 `notice_key`（或 1:1 派生 key）去重；已 `sent` 跳过 |
| 二次 API | 用户重复点击 accept / cron 重跑 **不得** 产生第二条同 key 通知 |

唯一约束是防重复的硬保证；应用层「先 SELECT」仅作优化，不可替代约束。

---

## 1.4 Email ledger decision

| 决策 | 说明 |
|------|------|
| **订单邮件账本独立** | 订单生命周期邮件继续使用 / 扩展 **订单侧** 账本（现有 `companion_notification_emails` + 未来 boss 订单邮件表或 `audience` 扩展），**与陪玩入驻 / application review 邮件账本隔离**。 |
| **不合并** | 除非未来显式引入统一 `notification_outbox`（及可选统一 delivery ledger）落地，否则 **不要** 把订单投递状态写入 application review email ledger，也勿反向污染。 |
| **Outbox 关系** | `notification_outbox` 负责「要发什么」；订单 email ledger 负责「Resend/provider 投递结果」。二者可关联 `notice_key`，但表职责分离。 |

---

## 1.5 Cron safety — prestart reminder

| 项 | 要求 |
|----|------|
| 窗口 | `scheduled_at` ∈ T−30m ±5m；状态 ∈ 可提醒集合 |
| **Idempotent claim/insert** | Cron worker **必须** 先以唯一键 claim：`order_reminder_jobs(order_id, reminder_type='prestart')` **或** outbox `notice_key=order:{id}:{recipient}:prestart_reminder:1` 的 `INSERT … ON CONFLICT DO NOTHING` |
| 并发 | 多实例 cron 同时跑时，只有 **一个** claim 成功者继续 fan-out；失败者视为已处理 |
| 失败 | claim 成功但 email 失败 → 重试 email，**不** 再插第二条 inbox（同 notice_key） |
| 禁止 | 先发邮件再写 job 行（会双发）；无唯一约束的「SELECT 再 INSERT」 |

---

## 1.6 Implementation priority（实现顺序；未批准前不开实现 PR）

| Priority | Scope | 说明 |
|----------|--------|------|
| **P0** | Notification engine | Schema 修复（空 `companion_notifications` CREATE）、`notice_key` 约定、`emitOrderNotificationEvent`、inbox SoT 写入、outbox（或最小等价）、失败不回滚订单 |
| **P1** | Payment success + assignment + accept | E2 支付成功、E2/E3 指派/改派加固、E4 陪玩接单 — 双边 inbox（+ 既有 companion email 路径） |
| **P2** | Reject / cancel / refund | E5 拒单、E11 取消、E12 退款相关结构化通知 |
| **P3** | Reminder / review | E7 开服前提醒（idempotent claim）、完成后评价/确认提醒类 |
| **P4** | Push | Web Push register + writer；微信/原生更后 |

PR 拆分（§9）应对齐本优先级；**D0 设计批准前不得开 N1+ 实现 PR。**

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
  notice_key text not null,           -- order:{orderId}:{recipientId}:{event}:{version}
  payload jsonb not null default '{}'::jsonb,
  channels text[] not null default '{inbox}',  -- inbox|email|realtime|push
  status text not null default 'pending',      -- pending|processing|sent|partial|failed|dead
  attempts int not null default 0,
  next_retry_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (notice_key)                 -- key already includes recipientId
);
create index if not exists idx_notification_outbox_poll
  on public.notification_outbox (status, next_retry_at)
  where status in ('pending','failed');
```

### 2.6 Proposed `order_reminder_jobs`（prestart claim；**未执行**）

```sql
-- DESIGN ONLY — idempotent cron claim
create table if not exists public.order_reminder_jobs (
  order_id uuid not null references public.orders(id) on delete cascade,
  reminder_type text not null,        -- prestart|review_reminder|…
  claimed_at timestamptz not null default now(),
  notice_key text,                    -- optional link to emitted key
  primary key (order_id, reminder_type)
);
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

### 3.1 Event catalog — required fields per emission（D0 checklist）

**Rule:** every order-notification emission **must** specify all five fields. Missing any field = design incomplete; implementers must not invent ad-hoc keys/hrefs.

**Shared payload schema (minimum):**

```ts
type OrderNotifyPayload = {
  orderId: string;
  event: string;                 // stable event code (see table)
  version: number;               // notice_key version segment; default 1
  recipientRole: "boss" | "companion";
  recipientId: string;           // profiles.id
  title: string;
  body: string;
  href: string;                  // in-app deep link
  status?: string;               // orders.status snapshot after mutation
  scheduledAt?: string | null;
  companionId?: string | null;
  customerId?: string | null;
  meta?: Record<string, unknown>; // non-PII extras only
};
```

`notice_key` always: `order:{orderId}:{recipientId}:{event}:{version}`.

| Event code | Product (#) | Recipient role(s) | notice_key event segment | href destination | Payload notes |
|------------|-------------|-------------------|--------------------------|------------------|---------------|
| `order_created` | E1 | boss | `order_created` | `/orders.html?id={orderId}` | optional; unpaid |
| `payment_success` | E2 | boss, companion* | `payment_success` | boss: `/orders.html?id={orderId}` · companion: `/companion/orders/` or order detail | *companion only if already assigned |
| `assigned` | E2/E3 | companion, boss | `assigned` | companion: order-hall/orders detail · boss: `/orders.html?id={orderId}` | include assignee id in meta |
| `unassigned` | E3 | companion (prev), boss | `unassigned` | same as assigned | version bump if re-emit after reassign |
| `accepted` | E4 | boss, companion | `accepted` | boss `/orders.html?id={orderId}` · companion orders detail | status=`in_progress` |
| `rejected` | E5 | boss, companion | `rejected` | boss `/orders.html?id={orderId}` · companion orders | optional reason in meta (non-PII) |
| `started` | E6 | boss, companion | `started` | same | |
| `prestart_reminder` | E7 | boss, companion | `prestart_reminder` | same | requires cron claim first |
| `complete_requested` | E8 | boss, companion | `complete_requested` | boss confirm UI · companion orders | |
| `completed` | E9/E10 | boss, companion | `completed` | orders detail | distinguish auto vs confirm in meta.source |
| `cancelled` | E11 | boss | `cancelled` | `/orders.html?id={orderId}` | unpaid cancel |
| `refund_requested` | E12 | boss, companion† | `refund_requested` | refund/order detail | †if companion affected |
| `refund_completed` | E12 | boss, companion† | `refund_completed` | wallet/orders | |
| `settlement_posted` | E13 | companion | `settlement_posted` | companion wallet | amount in meta as number only |
| `review_reminder` | P3 | boss | `review_reminder` | review/order href | after complete |

Rows with multiple recipient roles emit **one outbox/inbox row per recipient** (distinct `notice_key`).

---

### Event flow（目标）

```
Order mutation (orders / companion / boss / CS / admin / cron)
        │
        │  ★ commit order mutation FIRST (success required)
        ▼
  emitOrderNotificationEvent(event_type, order, actors)   // never rolls back order
        │  notice_key = order:{orderId}:{recipientId}:{event}:{version}
        ▼
  notification_outbox (INSERT ON CONFLICT notice_key DO NOTHING)
        │
        ├── inbox writer  → companion_notifications / boss_notifications   ★ SoT
        ├── email writer  → order email ledger (NOT application-review ledger)
        ├── realtime      → broadcast topic mcj-{role}-orders:{uid}        (fan-out)
        └── push writer   → Web Push / 未来 FCM（读 push_device_tokens）   (fan-out, P4)
        │
        ▼
  delivery_attempts + status；失败 → next_retry_at（cron 捞取）
```

**原则（与 §1.1 一致）：**
- **Inbox = SoT**；email / realtime / push = fan-out。
- 业务 API **mutation 成功后再 emit**；emit 失败不影响订单结果。
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

Boss 订单邮件：P1 可新建 `boss_notification_emails`（推荐分表），或给订单侧账本加 `audience=boss`。  
**禁止**写入陪玩入驻 / application review 邮件账本（见 §1.4）。

---

## 6. Pre-start reminder cron

| 项 | 方案 |
|----|------|
| Cron | `*/5 * * * *` → `/api/cron/order-prestart-reminder` |
| 条件 | `orders.scheduled_at` 非空；状态 ∈ `claimed|confirmed|in_progress`；距开始 **30±5 分钟**；未 claim 过 `prestart` |
| 接收方 | companion **必达** inbox+email；boss **必达** inbox（email 可配置） |
| **Idempotent claim/insert** | 先 `INSERT INTO order_reminder_jobs(order_id, reminder_type) … ON CONFLICT DO NOTHING`（或 outbox `notice_key` 唯一插入）；**仅 claim 成功** 才 emit。见 §1.5 |
| notice_key | `order:{orderId}:{recipientId}:prestart_reminder:1` |
| 与 timeout | 不恢复已禁用的接单超时产品行为；reminder ≠ timeout cancel |

依赖列：若 Staging/Prod 缺少可靠 `scheduled_at`，先在 schema 审计 PR 中确认（只读），再开实现 PR。

---

## 7. Push architecture

### 7.1 阶段（对齐 §1.6；Push = P4）

| Phase | 通道 | 说明 |
|-------|------|------|
| P0–P3 | Inbox + Realtime + Email | 引擎与订单事件优先；不依赖原生推送 |
| **P4** | **Web Push**（VAPID） | Service Worker + `push_device_tokens`；老板/陪玩浏览器后台可达 |
| 更后 | 微信模板消息 / 订阅消息 | 仅微信 WebView；需公众号配置（外部依赖） |
| 更后 | APNs / FCM | 仅当有原生 App；本仓库暂无 |

### 7.2 Web Push 数据流

```
Client: Notification.requestPermission → pushManager.subscribe(VAPID)
     → POST /api/push/register { endpoint, keys, role }
Server: emit → push writer → web-push library → endpoint
SW:    push event → showNotification → click → href deep link
```

### 7.3 原则

- Push **不是** SoT；inbox 行才是。Push 失败不阻断订单。
- **Single path only:** future Push (P4) **must** consume the same `emitOrderNotificationEvent` → `notification_outbox` model and fan-out as a channel writer. **Forbidden:** parallel “push-only” emitters, separate push event buses, or bypassing outbox/inbox SoT.
- 尊重 `notification_preferences`（默认：订单类 on，营销 off）。
- 不在 Push payload 放 PII 敏感字段；仅 `title/body/orderId/href`（与 §3.1 payload 对齐）。

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

## 9. PR 拆分计划（对齐 §1.6 priority）

| PR | Priority | 范围 | 风险 | 依赖 |
|----|----------|------|------|------|
| **D0（本 PR）** | — | Design-only 文档（含 architecture 冻结） | 无 | — |
| **N1** | **P0** | 修复 `companion_notifications` CREATE + Staging apply 脚本（只 DDL） | 低 | D0 **批准** |
| **N2** | **P0** | `notification_outbox` + `emitOrderNotificationEvent` + inbox SoT 写入；mutation 后 emit；失败不回滚 | 中 | N1 |
| **N3** | **P0/P1** | `boss_notifications` 扩展列 + boss inbox 读 `kind=order` | 低 | N1 |
| **N4** | **P1** | Payment success + assignment 加固 + accept（E2/E3/E4） | 中 | N2–N3 |
| **N5** | **P2** | Reject / cancel / refund（E5/E11/E12） | 中 | N2 |
| **N6** | **P3** | Prestart reminder cron（idempotent claim）+ review/confirm reminders | 中 | N2、`scheduled_at` |
| **N7** | **P1–P2** | Email retry cron + 订单侧 ledger 扩展（**不**碰 application-review ledger） | 中 | N2 |
| **N8** | **P4** | Web Push register + writer | 中 | N2、preferences |
| **N9** | — | 清理派生 notices / e2e / 文档收尾 | 低 | N4–N6 |

**Gate：** D0 checklist 通过并批准后 → **仅** 进入 N1 **implementation planning**（§14）；开 N1 代码/DDL PR 仍需单独确认。  
**禁止混入：** 定价 P2、OTP、#198 gameplay、Production migration 执行、#205 范围扩张。

---

## 10. D0 review checklist（本轮确认）

| # | Requirement | Status |
|---|-------------|--------|
| 1 | Every notification event has **event name**, **recipient role**, **notice_key**, **href destination**, **payload schema** | **PASS** — §3.1 catalog + shared `OrderNotifyPayload` |
| 2 | Emission **never** before transaction success | **PASS** — §1.1 + event flow “commit FIRST” |
| 3 | Future push consumes the **same** event/outbox model — no parallel path | **PASS** — §7.3 single-path rule; Push = outbox channel (P4) |

**D0 decision: APPROVED** (2026-09-08). Next: **N1 implementation planning only** (§14). No N1 code/DDL PR in this change set.

---

## 11. 验收标准（实现 PR 用）

1. Staging：`to_regclass('public.companion_notifications')` 非空且含 `notice_key` 唯一约束。  
2. 指派三路径 e2e 仍 PASS（回归）。  
3. `accept_direct` / `complete_order` / `confirm_complete` 各产生 companion+boss inbox 行；二次调用同 `notice_key` **不双写**（unique 冲突 = 幂等成功）。  
4. 故意失败的**订单**邮件在 ≤10 分钟内被 cron 重试；application-review 账本行数不变。  
5. 带 `scheduled_at` 的订单在 T−30m 窗口收到且仅一次 prestart（claim 表或 outbox unique）。  
6. 模拟 email/push 失败时，订单 mutation 仍返回成功且订单状态已提交。  
7. 全程无 Production 写入；Prod DDL 仅 `pending-prod/` 评审稿。

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

## 13. 本 PR 交付清单

- [x] Design-only 文档（本文）  
- [x] Architecture principles 冻结（inbox SoT / fan-out / mutation-before-emit / no rollback）  
- [x] Unified `notice_key` + idempotency + email ledger isolation + prestart claim + P0–P4 priority  
- [x] Event catalog with event / role / notice_key / href / payload schema (§3.1)  
- [x] Push single-path rule (§7.3)  
- [x] Affected tables  
- [x] Event flow + matrix  
- [x] API changes  
- [x] Email retry cron 设计  
- [x] Pre-start reminder cron 设计  
- [x] Push architecture  
- [x] Rollback plan  
- [x] PR 拆分计划（对齐 priority）  
- [x] D0 checklist PASS → **D0 APPROVED**  
- [x] N1 implementation planning only (§14)  
- [x] **无**生产代码改动、**无** migration 执行、**无** N1 实现 PR  

---

## 14. N1 implementation planning only（P0 schema fix — plan, do not implement here）

### Goal
Repair empty `supabase/migrations/20260804_companion_notifications.sql` with idempotent `CREATE TABLE IF NOT EXISTS` matching §2.3 / `docs/order-notification-pending-ddl.md` N1. **No emit hooks, no outbox, no product behavior.**

### In scope
1. Fill migration SQL (`CREATE IF NOT EXISTS` + index; **no DROP**).  
2. Staging-only apply script (Session pooler; refuse Production / Direct-only if IPv6).  
3. Offline verify: migration file non-empty; SQL contains `notice_key` + unique `(companion_id, notice_key)`.  
4. Staging verify: `to_regclass('public.companion_notifications')` non-null; columns present.  
5. Optional `pending-prod/` review copy — **do not apply to Production** in N1.

### Out of scope (later PRs)
- `emitOrderNotificationEvent` / outbox (N2)  
- Boss column extensions (N3)  
- Lifecycle event wiring (N4+)  
- Email retry / prestart / push  

### Acceptance (N1 PR)
| Check | Pass criteria |
|-------|----------------|
| Migration | Non-empty; `IF NOT EXISTS`; unique on `(companion_id, notice_key)` |
| Staging apply | Session pooler only; Production refused |
| Staging probe | Table selectable; existing Prod-like data not destroyed |
| Behavior | No new notify calls; assign three-path e2e still PASS |
| Prod | No Production migration execution |

### Suggested branch / PR title (when opening N1 later)
- Branch: `cursor/order-notify-n1-companion-notifications-create-dcea`  
- Title: `fix(db): companion_notifications CREATE IF NOT EXISTS (N1 / P0)`  
- Base: `main` after D0 merge (or stacked on D0 if preferred)

### Explicit hold
**Do not open the N1 implementation PR until this planning section is acknowledged and D0 is merged/approved in GitHub.** This D0 revision only adds planning text.
