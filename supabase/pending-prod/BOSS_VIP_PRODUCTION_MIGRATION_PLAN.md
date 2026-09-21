# Boss VIP Production Migration Plan

**PRODUCTION MIGRATION REQUIRED: YES**  
**SQL executed: NO** (waiting for owner confirmation)

## Root cause (Production Boss card)

Code for Boss VIP already shipped (PR #252). Admin UI exists under **Boss VIP 等级管理**.  
Production shows `普通会员 / 0 / 已是最高等级 / 暂无专属福利` because **`boss_vip_*` tables were never applied** → API soft-fallback (`tablesReady: false`).

## File to apply (idempotent)

1. `supabase/migrations/20260915090000_boss_vip_spend.sql`  
   (copy in pending-prod: `15_boss_vip_spend.sql`)

Creates:
- `boss_vip_levels` (name, spend_threshold, benefits, sort_order, is_active)
- `boss_vip_status`
- `boss_vip_history`
- Seed tiers only when empty: 普通会员@0, VIP1@500, VIP2@1500, VIP3@3000, VIP4@5000

## After apply

1. `NOTIFY pgrst, 'reload schema';` (migration already notifies)
2. Admin → Boss VIP 等级管理 → confirm levels list
3. Optional: `POST /api/admin/boss-vip` `{ action: "backfill_preview" }` then `backfill_apply`
4. Edit names/benefits/thresholds as product needs

## Safe to apply

YES — additive, IF NOT EXISTS, seed only when empty. Does not rewrite orders.

## Do not

- Auto-run from CI
- Confuse with `boss_levels` (commission / 直属门槛)
