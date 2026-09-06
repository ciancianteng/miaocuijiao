-- =============================================================================
-- PENDING PROD MIGRATION 02 / 05
-- DO NOT EXECUTE on Production in this agent turn.
-- Source SoT: supabase/migrations/20260902_boss_commission_from_platform_fee.sql
-- =============================================================================
-- 覆盖对象：
--   • public.boss_commission_earnings
--   • public.boss_companion_relations.commission_rate
--   • public.orders.platform_fee (+ 结算快照列)
--
-- 用途：
--   1) orders.platform_fee：订单结算时平台抽成金额快照（Boss 佣金计算输入）。
--   2) boss_commission_earnings：Boss 直属佣金账本。
--      公式：platform_fee = order_amount * platform_rate / 100
--            boss_commission = platform_fee * boss_commission_rate / 100
--      佣金来自平台抽成，不侵蚀陪玩收入。
--
-- 依赖：
--   必须先有 01_boss_companion_relations.sql（relation_id / commission_rate）。
--
-- 风险：
--   P0-功能：缺 platform_fee → 佣金结算无法取数/落快照。
--   P0-功能：缺 boss_commission_earnings → Boss 佣金页/入账失败。
--   P0-资金：若对历史已完成订单回补结算，可能重复发放（需应用层幂等 + unique(order_id)）。
--   P1-语义：order_id 在本表为 text（应用写入 String(order.id)）；与 orders.id uuid 不同型，
--           不要误加 uuid FK，除非先统一类型。
--   P1-配置：可选更新 platform_settings.defaultBossCommissionRate；缺省 fail-closed=0。
--   P2：本文件末尾对 platform_settings 的 UPDATE 是数据变更——执行前必须确认目标库。
-- =============================================================================

-- 1) Relation-level boss commission rate (% of platform fee)
alter table public.boss_companion_relations
  add column if not exists commission_rate numeric(5,2);

alter table public.boss_companion_relations
  drop constraint if exists boss_companion_relations_commission_rate_check;

alter table public.boss_companion_relations
  add constraint boss_companion_relations_commission_rate_check
  check (commission_rate is null or (commission_rate >= 0 and commission_rate <= 100));

comment on column public.boss_companion_relations.commission_rate is
  'Boss share of platform_fee (%). NULL = use platform_settings.defaultBossCommissionRate at settle time.';

-- 2) Order settlement snapshots (includes orders.platform_fee)
alter table public.orders add column if not exists platform_fee numeric(12,2);
alter table public.orders add column if not exists companion_income numeric(12,2);
alter table public.orders add column if not exists settlement_status text;
alter table public.orders add column if not exists settlement_note text;

alter table public.orders add column if not exists platform_fee_rate numeric(5,2);
alter table public.orders add column if not exists boss_commission_rate numeric(5,2);
alter table public.orders add column if not exists boss_commission_amount numeric(12,2);
alter table public.orders add column if not exists direct_boss_id uuid;
alter table public.orders add column if not exists boss_commission_relation_id uuid;

comment on column public.orders.platform_fee is
  'Snapshot: platform fee amount at settlement (input to boss commission).';
comment on column public.orders.platform_fee_rate is
  'Snapshot: platform fee % of order gross at settlement';
comment on column public.orders.boss_commission_rate is
  'Snapshot: boss commission % of platform_fee at settlement';
comment on column public.orders.boss_commission_amount is
  'Snapshot: boss earning amount (from platform revenue)';

-- 3) Boss commission earnings ledger
create table if not exists public.boss_commission_earnings (
  id uuid primary key default gen_random_uuid(),
  boss_id uuid not null references public.profiles (id) on delete restrict,
  companion_id uuid not null references public.profiles (id) on delete restrict,
  relation_id uuid references public.boss_companion_relations (id) on delete set null,
  order_id text not null,
  order_amount numeric(12,2) not null default 0,
  platform_fee_rate numeric(5,2) not null default 0,
  platform_fee_amount numeric(12,2) not null default 0,
  boss_commission_rate numeric(5,2) not null default 0,
  boss_commission_amount numeric(12,2) not null default 0,
  status text not null default 'settled'
    check (status in ('pending', 'settled', 'clawed_back', 'void')),
  note text,
  meta jsonb not null default '{}'::jsonb,
  settled_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_boss_commission_earnings_order
  on public.boss_commission_earnings (order_id)
  where status in ('pending', 'settled');

create index if not exists idx_boss_commission_earnings_boss_settled
  on public.boss_commission_earnings (boss_id, settled_at desc);

create index if not exists idx_boss_commission_earnings_companion
  on public.boss_commission_earnings (companion_id, settled_at desc);

drop trigger if exists trg_boss_commission_earnings_updated_at on public.boss_commission_earnings;
create trigger trg_boss_commission_earnings_updated_at
before update on public.boss_commission_earnings
for each row execute function public.set_updated_at();

alter table public.boss_commission_earnings enable row level security;

drop policy if exists bce_admin_all on public.boss_commission_earnings;
drop policy if exists bce_boss_select_own on public.boss_commission_earnings;

create policy bce_admin_all on public.boss_commission_earnings
  for all
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and lower(coalesce(p.role::text, '')) in ('admin', 'super_admin')
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and lower(coalesce(p.role::text, '')) in ('admin', 'super_admin')
    )
  );

create policy bce_boss_select_own on public.boss_commission_earnings
  for select
  using (boss_id = auth.uid());

-- 4) OPTIONAL seed of platform default (DATA CHANGE — confirm target DB before run)
do $$
declare
  row_data jsonb;
begin
  select data into row_data from public.platform_settings where id = 'global' limit 1;
  if found then
    if row_data ? 'defaultBossCommissionRate' then
      null;
    else
      update public.platform_settings
        set data = coalesce(data, '{}'::jsonb) || jsonb_build_object('defaultBossCommissionRate', 0),
            updated_at = now()
      where id = 'global';
    end if;
  end if;
exception when undefined_table then
  null;
end $$;

notify pgrst, 'reload schema';
