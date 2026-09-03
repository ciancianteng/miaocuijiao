# Direct Commission / 直属返点 Formula (PR150 verification)

## Locked formula

```
order_amount (客户实付)
  → platform_fee = order_amount × platform_rate / 100
  → direct_rebate / boss_commission = platform_fee × rebate_rate / 100
  → companion_income = order_amount − platform_fee
```

Canonical case:

| Step | Calc | Result |
|------|------|--------|
| Order | RM30 | RM30 |
| Platform 20% | 30 × 20% | **RM6** |
| Direct rebate 5% | 6 × 5% | **RM0.30** |
| Companion | 30 − 6 | RM24 |

**Forbidden:** `RM30 × 5% = RM1.50`

Rebate is paid from platform fee. Companion service income is unchanged by Boss/直属返点.

## Code

| Path | Role |
|------|------|
| `server/api/_direct-commission-formula.js` | Pure formula (this PR) |
| `server/api/_boss-commission.js` | Staging settle wiring (PR130; not on main yet) |
| `server/api/_companion-referral.js` | Staging companion invite rebate (PR134; PLATFORM_PROFIT base) |
| `server/api/_order-complete.js` | Settlement entry; companion net = order − platform fee |
| `server/api/companion.js` `buildSettlement` | Companion settlement snapshot (fixed: fee×rate) |
| `src/commission-engine.js` | Front/snapshot engine (inviter from platform fee) |
| `scripts/selftest-direct-commission-rm30.mjs` | Unit lock for RM30 |

## Test

```bash
node scripts/selftest-direct-commission-rm30.mjs
```
