# Prod test cleanup — Owner runbook (§20–§23)

## Gates (current manifest)

- `REAL_USER_MATCH = 0`
- `UNPROVEN_ROW = 1` (suspected `meowcuijiao123@gmail.com` — **NOT deleted**)
- `CONFIRMED_PROFILES = 42`
- `CONFIRMED_RELATED = 105`
- `DELETE_ALLOWED = READY_FOR_AUTHORIZED_EXECUTE`

## Never

- Patch test wallet opening ledger (§23)
- Auto-fix real-user wallet DIFF (§24) — last readonly audit: `real_user_diffs = 0`
- Delete unproven / suspected rows

## Execute (Owner machine / approved agent)

```powershell
$env:ALLOW_PROD_SUPABASE_WRITE='1'
$env:CONFIRM_PROD_WRITE='I_UNDERSTAND_PROD_RISK'
$env:DRY_RUN='1'
node scripts/execute-prod-test-cleanup-authorized.mjs

$env:DRY_RUN='0'
node scripts/execute-prod-test-cleanup-authorized.mjs

node scripts/audit-prod-real-wallet-diff-readonly.mjs
```

Transaction path requires Production `DATABASE_URL`. On any FK / real-user invariant failure → **ROLLBACK**.

## Last auto-execute attempt

- Rolled back on `messages_order_id_fkey` (fixed: cascade dependents)
- Rolled back on `finance_payments.payee_user_id` NOT NULL (fixed: delete payee test finance_payments)
- Subsequent execute blocked by Cursor production-write approval gate — re-run with Owner approval
