# Order lifecycle (canonical)

Source of truth: `public.mcj_order_status` + helpers in `server/api/_order-status.js`.
Do **not** treat `docs/orders-schema.sql` Chinese drafts as live schema.

## Status map (required label → DB)

| Required (product)     | DB `orders.status`                         | Notes |
|------------------------|--------------------------------------------|-------|
| Pending payment        | `awaiting_payment`                         | Created by `place_order` / `create` / marketplace before debit |
| Paid                   | *(not a DB status)*                        | After wallet/CS pay: status → `claimed`/`pending`; stamp `paid_at`+`paid_cat_food` when columns exist (`07_orders_paid_at_paid_cat_food.sql`) |
| Waiting companion accept | `claimed`                                | Alias `paid` normalizes → `claimed` |
| Accepted               | `confirmed` *(legacy)* or `in_progress`    | `accept_direct` jumps `claimed` → `in_progress` (Accepted ≡ In service) |
| In service             | `in_progress`                              | Companion working; may have `[[COMPLETION_PENDING]]` |
| Completed              | `completed`                                | Boss confirm / 24h auto / admin force |
| Settled                | `settlement_status=settled` + `transactions.companion_income` | Gated by `SETTLEMENT_ENABLED`; not a row in `orders.status` |
| Cancelled              | `cancelled`                                | Unpaid only via boss `cancel_order` |
| Refunded               | `refunded` / `refund_requested`            | Paid cancel blocked → `request_refund` |

## Primary paths (keep; do not duplicate)

1. **Boss place + pay**: `POST /api/orders` `place_order` (alias `create_order`) → `pay_order` (wallet debit, `relatedOrderId`)
2. **Marketplace one-shot**: `POST /api/boss/marketplace` `create_and_pay`
3. **Companion**: notify → `accept_direct` / reject → `complete_order` → boss `confirm_complete`
4. **Settlement**: `_order-complete.js` → `companion_income` txn (idempotent by order_id)
5. **Admin/CS**: search, payment review, freeze/dispute markers, refund confirm

## Safety rules

- Paid orders cannot free-cancel (`PAID_CANCEL_USE_REFUND`); use refund → cat-food credit.
- No silent fake income: settlement skipped when flag off is stamped `settlement_status=skipped` / `[[SETTLEMENT_SKIPPED]]`.
- Wallet payments must stamp `paid_at` when the column exists.
