# Migration Plan — Invite Confirm + Rewards (Phase 1)

> **Status:** DRAFT — do **NOT** apply to Production without explicit approval.  
> **Preview/Staging first.** Flags stay fail-closed on Production until approved.

## Goal

Replace Boss invite **auto-bind** with:

`invite link → register/login → pending attribution → invitee confirm → active relation + one-time invite reward`

Reuse `#185` SoT: `boss_companion_relations` / `boss_companion_relation_events`.  
Do **not** create a parallel relation SoT (`direct_invite_relations` / `referral_relations`).

---

## Execution order (when approved)

| Order | File | Purpose | Depends on | Destructive? | Rollback / disable |
|------:|------|---------|------------|--------------|--------------------|
| 1 | `01_boss_companion_relations.sql` | Ops relation SoT + events | — | **NO** (create if not exists) | Keep tables; disable via app |
| 2 | `02_boss_commission_earnings_and_orders_platform_fee.sql` | Commission ledger + order fee cols | 01 | **NO** | Flag `SETTLEMENT_ENABLED=false` |
| 3 | `03_boss_levels_and_invitations.sql` | Levels + legacy invitations table | 01 | **NO** | Leave unused |
| 4 | `09_boss_invite_links.sql` | Invite links + redemptions (#185) | 01 | **NO** | Flag `BOSS_INVITE_LINKS_ENABLED=false` |
| 5 | **`14_invite_confirm_and_rewards.sql`** (this PR) | Attribution pending/confirm, reward ledger, cash wallets, `owner_role` | 09 | **NO** (additive) | Flag off; stop writing new attributions; tables remain |

> Items 01–03/09 may already exist on Staging. Production status was UNKNOWN/fail-closed at audit time — **re-probe before apply**.

---

## `14_invite_confirm_and_rewards.sql` detail

| Object | Use |
|--------|-----|
| `boss_invite_links.owner_role` | boss \| companion inviter |
| `invite_attributions` | pending → confirmed (not ops SoT) |
| `invite_attribution_events` | append-only audit |
| `invite_reward_ledger` | one granted reward per attribution (idempotent) |
| `invite_cash_wallets` | companion cash invite balance (#134 wallet pattern, not order rebate) |
| redemption outcomes | + `pending_confirm` / `confirmed` / `rejected` |

**Destructive:** NO  
**Data backfill:** NONE required  
**Downtime:** NONE  

**Disable without DROP:**
1. Set `BOSS_INVITE_LINKS_ENABLED=false` (fail-closed on Production by default)
2. Optionally leave tables in place

**Hard rollback (only if required):**
```sql
-- ONLY after approval; loses attribution/reward history
-- drop table invite_attribution_events, invite_reward_ledger, invite_attributions, invite_cash_wallets;
-- alter table boss_invite_links drop column owner_role;
```

---

## Flags

| Flag | Production unset | Meaning |
|------|------------------|---------|
| `BOSS_INVITE_LINKS_ENABLED` | disabled | Gates invite links + confirm APIs |
| `SETTLEMENT_ENABLED` | disabled | Gates ops commission (unchanged; orthogonal to invite rewards) |

Do **not** enable Production flags in this PR.

---

## Rewards (orthogonal to commission)

| Inviter | Reward | Withdrawable | Ledger |
|---------|--------|--------------|--------|
| boss | 喵币 / bonus catfood (`invite_reward`) | NO | `mcj_wallet_credit` + `invite_reward_ledger` |
| companion | cash | YES | `invite_cash_wallets` + `invite_reward_ledger` |

Defaults: `MCJ_BOSS_INVITE_MEOWCOIN=10`, `MCJ_COMPANION_INVITE_CASH=5`.

Ops commission (`boss_commission_earnings`) remains order-complete → active relation lookup (#185). **Not** mixed with invite rewards.

---

## #134 / #261 notes

- **#134**: Ported **wallet pattern only** (`invite_cash_wallets`). Did **not** port `referral_relations` / order rebate product (parallel SoT).
- **#261**: Marked **superseded** for Phase 1 (auto-bind + dual-side settlement diverge). Did not merge whole PR.
