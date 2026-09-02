# Boss Commission + Relations — Production Architecture (APPROVED WITH SAFEGUARDS)

See full checklist and locks in agent artifact; this is the in-repo summary.

## Locked money rule

```
customer_payment
  → platform_fee = order × platform_rate / 100
  → boss_commission = platform_fee × boss_rate / 100   // NEVER from companion income
  → companion_income = order − platform_fee            // unchanged by Boss
```

Canonical Staging case: **RM30 → platform RM6 (20%) → Boss RM0.30 (5%) → Companion RM24**.

## Safeguards

1. Commission from platform_fee only; freeze snapshots after settle; history immutable on level/rate change.
2. ≤1 active Boss per Companion; immutable relation events; Admin writes require reason (who/when/why).
3. Levels Admin-configurable; manual pin permanent | until_expiry; orders keep snapshot level.
4. Settlement idempotent; unique `boss_commission_earnings(order_id)` for pending/settled.
5. Staging E2E four-end same snapshot before any Production approval request.

## Rate resolution

relation override → boss level → platform default → skip (fail-closed).

## Staging acceptance URL

https://meow-cuijiao-homepage-staging.vercel.app/

**Do not touch Production without separate approval.**
