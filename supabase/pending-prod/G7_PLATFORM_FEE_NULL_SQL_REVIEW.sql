-- =============================================================================
-- G7 SQL REVIEW — 旧订单 platform_fee NULL / 禁止 smoke 回补（只生成 / 不执行）
-- =============================================================================
-- 状态：REVIEW ONLY
-- =============================================================================

-- 策略（锁定）：
-- 1) G0.02 仅：alter table public.orders add column if not exists platform_fee numeric(12,2);
--    → 既有行 platform_fee IS NULL；不改写 total_amount / status。
-- 2) **禁止**历史自动回补：
--      -- FORBIDDEN example (do not run):
--      -- update public.orders set platform_fee = total_amount * 0.2 where platform_fee is null;
-- 3) **禁止**对 smoke 完成单（MCJO000344 / RM6000）做结算补偿 INSERT。
-- 4) 新完成订单：仅在 SETTLEMENT_ENABLED=true 且非 test-touched 时由应用写入 platform_fee。
-- 5) 历史正式订单：保持 NULL 直到单独变更单授权的人工回补；与首开结算解耦。

-- 只读现状（2026-09-05）：orders.platform_fee 列尚不存在（REST 400）。
-- Smoke 完成单仍在：
--   order_no=MCJO000344 total_amount=6000 status=completed
--   boss_id=0664ef55-de58-48e3-8dbb-ca8111318e91
--   companion_id=9f7fb39a-bec8-47cc-974a-e314ac2f5cd5

-- 只读核验（未来 apply 后）：
-- select order_no, status, total_amount, platform_fee, settlement_status
-- from public.orders
-- order by created_at desc limit 20;
-- 期望：旧行 platform_fee null；无自动填入的 smoke 结算痕迹。

-- 本轮：策略文档化 ✅；Production 无任何 UPDATE ❌
-- =============================================================================
