# CS Salary Flow Audit

## Classification

**E → connected (PARTIAL before this PR)**

Existing real systems:
- RM ledger: `cs_commission_settlements` (idempotent per order/service)
- Dock cat-food ledger: `cs_dock_rewards`
- Wage center: `loadServiceWorkData` → estimated salary
- Payroll: `staff_payrolls` → admin finance → Friday `payout_requests`

Missing / broken before this PR:
- Production `service_receptions` table **missing**
- Production `cs_commission_settlements` **0 rows** (commission never credited)
- Sample completed paid order `MCJO000344` conversation still **open** → end-reception gate never ran
- Already-ended conversation early-return skipped commission catch-up
- `settleOnOrderComplete` node blocked paid-but-not-completed end-reception settles
- Frontend toast preferred dock message over commission/salary message

## Salary Source of Truth

`server/api/_cs-commission-settle.js`
- `getGlobalCommissionConfig()` via `_customer-service-work.js`
- `computeCommissionBreakdown` / `calculateStaffSalary`
- Formula: `orderCommission` (fixed) + `total_amount * commissionPercent / 100`
- Snapshot stored on settlement row; later config changes do not rewrite history

## Completion Trigger (call chain)

```
CS UI [data-end] → api(end_conversation)
  → server/api/customer-service.js action end_conversation
  → PATCH conversations status ended/closed (assigned CS only)
  → endReceptionRecord(service_receptions)
  → evaluateEndReceptionReward (dock)
  → evaluateEndReceptionCommission
       → trySettleCommission (fromEndReception=true)
       → INSERT cs_commission_settlements status=settled
       → notifyCsCommissionSettled → staff_notifications
  → loadServiceWorkData sums settled ledger into estimatedSalary
  → request_salary_withdraw → staff_payrolls → admin finance Friday payout
```

## Staff Binding

Settlement `service_id` = conversation/order `customer_service_id` of the CS who ends reception.  
Cross-CS blocked (`NOT_RECEPTION_CS`). Admin/operator is not the earner.

## Idempotency

DB unique `(order_id, service_id)` (+ order_id unique). Duplicate end / API retry → `ALREADY_SETTLED`.

## Cancel Protection

Cancel/refund → `clawbackCsOrderIncome` / `clawbackOrCancelCommission` (clawback row fields, not silent overwrite of history without clawback amount).

## Production Migration

| Table | Production |
|---|---|
| `cs_commission_settlements` | APPLIED (0 rows before fix) |
| `cs_dock_rewards` | APPLIED |
| `staff_payrolls` | APPLIED (0 rows) |
| `service_receptions` | APPLIED by this PR migration |
| `orders.paid_at` / `payment_status` | NOT PRESENT (payment proof falls back to status+amount) |

## RLS / Permission

Writes use service_role via trusted API only. CS clients cannot UPDATE salary balances. Staff UI reads own wage data through CS API.
