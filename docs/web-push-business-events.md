# Web Push Business Events Integration (P0)

Builds on frozen **#248** Web Push foundation. Does not change VAPID, subscription model, or Admin test sender.

## Event → recipient matrix

| Event | Boss (`orders.boss_id`) | Companion (`orders.companion_id`) | Notes |
|-------|-------------------------|----------------------------------|-------|
| `ORDER_PAID` | Yes | Yes (if already assigned) | Open-grab unpaid→paid with no companion: boss only |
| `ORDER_ASSIGNED` | No | Yes | Designated / grab confirm bind |
| `ORDER_ACCEPTED` | Yes | No | Companion confirms designated order |
| `ORDER_STARTED` | Yes | No | Companion starts service |
| `ORDER_COMPLETED` | Yes | Yes | Terminal success |
| `ORDER_CANCELLED` | Yes | Yes (if assigned) | Affected parties only |

**Never broadcast.** Extra targets must still equal boss_id or companion_id.

## Trigger points

| Event | Primary hooks |
|-------|----------------|
| `ORDER_PAID` | `orders.js` `pay_order` → `notifyBossOrderEvent(..., kind: order_paid)` |
| `ORDER_ASSIGNED` | `notifyCompanionOrderAssigned` (orders / CS / admin / marketplace assign paths) |
| `ORDER_ACCEPTED` | `companion.js` accept direct → `notifyBossOrderEvent(..., order_accepted)`; also companion status `confirmed` |
| `ORDER_STARTED` | `companion.js` start → `notifyBossOrderEvent(..., order_started)`; status `in_progress` |
| `ORDER_COMPLETED` | `orders.js` confirm completion → `order_completed`; companion status `completed` |
| `ORDER_CANCELLED` | `orders.js` cancel → `order_cancelled`; companion status `cancelled` |

## Dedupe

Table `web_push_delivery_log` with **unique `dedupe_key`** =

`{EVENT_TYPE}:{order_id}:{target_user_id}`

First successful claim sends; retries / double hooks get `skipped: duplicate`.

## Payload / click URL

Push JSON includes: `title`, `body`, `url`, `event_type`, `order_id`, `target_user_id`, `notification_type`, `entity_id`.

- Boss click → `/orders.html?id={orderId}`
- Companion click → `/companion/orders?focus={orderId}`

SW `notificationclick` navigates to `data.url` (not home).

## Dead endpoints

Unchanged from #248: `sendWebPushToUser` marks **that** subscription `expired` on 404/410; other users untouched.

## Staging / Production test

1. Ensure user **1717** still has active subscription (Admin test tool).
2. Apply migration `20260914_web_push_delivery_log.sql` on target DB.
3. Drive each lifecycle on Staging with 1717 as boss or companion.
4. Expect one system notification per event; retry same action → no second push (`web_push_delivery_log` shows one row).
5. Click notification → order detail URL above.
6. Admin single-user test sender still works (regression).
