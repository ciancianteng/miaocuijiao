# Boss 1717 points backfill — acceptance (DO NOT run on Prod until human approve)

## Targets
| order_no | expected points | idempotency_key |
|---|---|---|
| MCJO000356 | 300 | `order_points:{uuid}` |
| MCJO000357 | 300 | `order_points:{uuid}` |
| **Total** | **600** | — |

## Preconditions
1. Prod schema `user_points_accounts` / `user_points_ledger` / `points_settings` exist (04+05 applied).
2. `points_settings.enabled=true`, `points_per_cat_food=10`.
3. Vercel Production `POINTS_AWARD_ENABLED=true` (and redeployed) before WRITE mode.
4. Do **not** enable `SETTLEMENT_ENABLED` just for this backfill.

## Dry run (safe)
```bash
node scripts/backfill-boss-points-1717-orders.mjs
```
Expect `mode: DRY_RUN`, plan rows with `ledger_exists` true/false.

## Write (Production — human only)
```bash
ALLOW_PROD_POINTS_BACKFILL=1 CONFIRM_PROD_POINTS_BACKFILL=I_UNDERSTAND_PROD_RISK \
  node scripts/backfill-boss-points-1717-orders.mjs
```

## Verify
- Two ledger rows with keys `order_points:{id}` and `points=300`
- `user_points_accounts.balance` for boss 1717 increased by **600** (if starting from 0 and no other awards)
- Re-run WRITE → `duplicate` / skip, balance unchanged

## Rollback
- Prefer reverse clawback via `order_points_clawback:{order_id}` tooling if available
- Do **not** manually `UPDATE balance` without ledger
