-- =============================================================================
-- P0-7 PRODUCTION TEST DATA CLEANUP — REVIEW ONLY
-- =============================================================================
-- Status: NOT EXECUTED. Agent must not run this against Production.
-- Owner must reply: 「这些都是假数据，可以删」 before any DELETE.
-- Forbidden: TRUNCATE, DROP, delete-by-nickname, purge_test_data on Production.
--
-- Evidence for the 10 profile IDs: G2 APPLIED 2026-09-06 (is_test_account=true)
--   + 2026-09-02 Production OTP smoke (artifacts/security/prod-data-contamination-report.md)
--
-- DO NOT TOUCH (real accounts):
--   6f31b706-11e7-42df-8db1-d2caccd796de  meowcuijiao@gmail.com  admin
--   458ce9ad-3425-42b1-ab66-24bca342f971  ciancianteng@gmail.com boss (1717)
-- =============================================================================

begin; -- keep as a review transaction; default end is ROLLBACK

-- ---------------------------------------------------------------------------
-- 0) Candidate identity set (authoritative)
-- ---------------------------------------------------------------------------
create temporary table tmp_p07_test_ids (
  id uuid primary key
) on commit drop;

insert into tmp_p07_test_ids (id) values
  ('b989960b-ddc2-4f1b-899f-12b2b0cac3b7'), -- boss@meow.test / P0 Boss
  ('d397b7bb-826b-4e7a-8fdf-f14602dd92bb'), -- boss.final.*@meow.test / Boss Final
  ('5f20a7fe-3a48-4b42-82b9-82222bc81311'), -- cs.smoke.*@meow.test / ProdSmokeCS
  ('47178368-a3d4-44b3-97fe-8a648d951c66'), -- guerrilla / ProdSmokeInviter
  ('ed5054bd-93d2-434a-b468-68f75423d830'), -- guerrilla / ProdSmokeService
  ('779db97b-9a5d-4a97-8be8-5d7bc6d24109'), -- guerrilla / ProdSmokeBoss
  ('b9347ea4-3b45-400d-bf8d-ae2fbe05d690'), -- cs.smoke.*@meow.test / ProdSmokeCS
  ('6d368f4b-7f33-4923-9441-c63cecef2070'), -- guerrilla / ProdSmokeInviter2
  ('9f7fb39a-bec8-47cc-974a-e314ac2f5cd5'), -- guerrilla / ProdSmokeService2
  ('0664ef55-de58-48e3-8dbb-ca8111318e91'); -- guerrilla / ProdSmokeBoss2

-- Safety: abort if a protected real account slipped into the set
do $$
begin
  if exists (
    select 1 from tmp_p07_test_ids
    where id in (
      '6f31b706-11e7-42df-8db1-d2caccd796de',
      '458ce9ad-3425-42b1-ab66-24bca342f971'
    )
  ) then
    raise exception 'P0-7 SAFETY: protected real account in candidate set';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1) READ-ONLY inventory (run these even if you never DELETE)
-- ---------------------------------------------------------------------------
select 'TEST USERS' as bucket, p.id, p.role, p.email, p.display_name, p.status,
       p.is_test_account, p.created_at
from public.profiles p
join tmp_p07_test_ids t on t.id = p.id
order by p.role, p.email;

select 'TEST COMPANION PROFILES' as bucket, cp.id, cp.user_id, cp.nickname,
       cp.verification_status, cp.is_test_account, cp.created_at
from public.companion_profiles cp
join tmp_p07_test_ids t on t.id = cp.user_id;

select 'TEST ORDERS' as bucket, o.id, o.order_no, o.status, o.total_amount,
       o.boss_id, o.companion_id, o.customer_service_id, o.created_at
from public.orders o
where o.boss_id in (select id from tmp_p07_test_ids)
   or o.companion_id in (select id from tmp_p07_test_ids)
   or o.customer_service_id in (select id from tmp_p07_test_ids)
order by o.created_at desc;

-- Known smoke order from 2026-09-02 OTP run
select 'KNOWN SMOKE ORDER' as bucket, *
from public.orders
where id = '8821329f-32c3-48c3-a24f-dde2b3e4d332'
   or order_no in ('MCJO000342','MCJO000343','MCJO000344');

select 'TEST WALLET / LEDGER' as bucket, 'wallets' as table_name, w.id, w.boss_id, w.user_id,
       w.balance, w.created_at
from public.wallets w
where w.boss_id in (select id from tmp_p07_test_ids)
   or w.user_id in (select id from tmp_p07_test_ids);

select 'TEST WALLET TX' as bucket, wt.id, wt.boss_id, wt.user_id, wt.amount, wt.type, wt.created_at
from public.wallet_transactions wt
where wt.boss_id in (select id from tmp_p07_test_ids)
   or wt.user_id in (select id from tmp_p07_test_ids);

select 'TEST RECHARGES payment_orders' as bucket, po.id, po.boss_id, po.user_id, po.payment_no,
       po.status, po.amount, po.created_at
from public.payment_orders po
where po.boss_id in (select id from tmp_p07_test_ids)
   or po.user_id in (select id from tmp_p07_test_ids);

select 'TEST RECHARGES recharge_orders' as bucket, ro.*
from public.recharge_orders ro
where ro.boss_id in (select id from tmp_p07_test_ids)
   or ro.user_id in (select id from tmp_p07_test_ids);

select 'TEST REVIEWS' as bucket, r.id, r.order_id, r.boss_id, r.companion_id, r.rating, r.created_at
from public.companion_reviews r
where r.boss_id in (select id from tmp_p07_test_ids)
   or r.companion_id in (select id from tmp_p07_test_ids);

select 'TEST COMMISSION / EARNINGS' as bucket, e.id, e.order_id, e.companion_id, e.amount, e.created_at
from public.companion_earnings e
where e.companion_id in (select id from tmp_p07_test_ids)
   or e.order_id in (
     select id from public.orders o
     where o.boss_id in (select id from tmp_p07_test_ids)
        or o.companion_id in (select id from tmp_p07_test_ids)
        or o.customer_service_id in (select id from tmp_p07_test_ids)
   );

select 'TEST REFERRALS' as bucket, *
from public.companion_referrals cr
where cr.inviter_id in (select id from tmp_p07_test_ids)
   or cr.invitee_id in (select id from tmp_p07_test_ids)
   or cr.id = '84172b1d-7ba5-48d0-9abc-ee6b928e70da';

select 'TEST WITHDRAWALS' as bucket, *
from public.companion_withdrawals cw
where cw.companion_id in (select id from tmp_p07_test_ids)
   or cw.id = '21e042c8-461e-4e82-a491-b5a390b96674';

-- Extra test users that were NEVER in the G2 10-id list (do not auto-delete)
select 'OTHER CANDIDATES (review, do not delete yet)' as bucket,
       p.id, p.role, p.email, p.display_name, p.is_test_account, p.created_at
from public.profiles p
where p.id not in (select id from tmp_p07_test_ids)
  and p.id not in (
    '6f31b706-11e7-42df-8db1-d2caccd796de',
    '458ce9ad-3425-42b1-ab66-24bca342f971'
  )
  and (
    p.is_test_account = true
    or p.email ilike '%@meow.test'
    or p.email ilike '%@guerrillamailblock.com'
    or p.email ilike '%@mcj-prod-smoke.invalid'
    or p.display_name ilike '%ProdSmoke%'
    or p.display_name ilike '%Smoke%'
  )
order by p.created_at desc;

-- ---------------------------------------------------------------------------
-- 2) DELETE — COMMENTED. Uncomment ONLY after owner confirmation + CSV backup.
--    Delete order: children → orders → wallets/ledger → companion rows → profiles → auth.
--    Wallet rule: only rows owned by tmp_p07_test_ids. If a SELECT shows a
--    real-user wallet id as counterparty, STOP and keep the ledger (mark only).
-- ---------------------------------------------------------------------------

-- create table public.p07_backup_profiles as
--   select * from public.profiles where id in (select id from tmp_p07_test_ids);

-- delete from public.messages where conversation_id in (
--   select id from public.conversations
--   where boss_id in (select id from tmp_p07_test_ids)
--      or companion_id in (select id from tmp_p07_test_ids)
--      or customer_service_id in (select id from tmp_p07_test_ids)
--      or order_id in (
--           select id from public.orders
--           where boss_id in (select id from tmp_p07_test_ids)
--              or companion_id in (select id from tmp_p07_test_ids)
--              or customer_service_id in (select id from tmp_p07_test_ids)
--         )
-- );
-- delete from public.conversations
--   where boss_id in (select id from tmp_p07_test_ids)
--      or companion_id in (select id from tmp_p07_test_ids)
--      or customer_service_id in (select id from tmp_p07_test_ids);
-- delete from public.order_grabs where companion_id in (select id from tmp_p07_test_ids)
--    or order_id in (select id from public.orders o where o.boss_id in (select id from tmp_p07_test_ids) or o.companion_id in (select id from tmp_p07_test_ids));
-- delete from public.companion_reviews
--   where boss_id in (select id from tmp_p07_test_ids)
--      or companion_id in (select id from tmp_p07_test_ids);
-- delete from public.order_status_logs where order_id in (
--   select id from public.orders
--   where boss_id in (select id from tmp_p07_test_ids)
--      or companion_id in (select id from tmp_p07_test_ids)
--      or customer_service_id in (select id from tmp_p07_test_ids)
-- );
-- delete from public.companion_earnings
--   where companion_id in (select id from tmp_p07_test_ids);
-- delete from public.transactions
--   where user_id in (select id from tmp_p07_test_ids)
--      or order_id in (select id from public.orders o where o.boss_id in (select id from tmp_p07_test_ids) or o.companion_id in (select id from tmp_p07_test_ids));
-- delete from public.orders
--   where boss_id in (select id from tmp_p07_test_ids)
--      or companion_id in (select id from tmp_p07_test_ids)
--      or customer_service_id in (select id from tmp_p07_test_ids);
-- delete from public.wallet_transactions
--   where boss_id in (select id from tmp_p07_test_ids)
--      or user_id in (select id from tmp_p07_test_ids);
-- delete from public.wallets
--   where boss_id in (select id from tmp_p07_test_ids)
--      or user_id in (select id from tmp_p07_test_ids);
-- delete from public.payment_orders
--   where boss_id in (select id from tmp_p07_test_ids)
--      or user_id in (select id from tmp_p07_test_ids);
-- delete from public.recharge_orders
--   where boss_id in (select id from tmp_p07_test_ids)
--      or user_id in (select id from tmp_p07_test_ids);
-- delete from public.companion_withdrawals
--   where companion_id in (select id from tmp_p07_test_ids);
-- delete from public.companion_profiles
--   where user_id in (select id from tmp_p07_test_ids);
-- delete from public.profiles
--   where id in (select id from tmp_p07_test_ids);

rollback; -- REVIEW END. Never COMMIT in this template.
