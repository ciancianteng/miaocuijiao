-- =============================================================================
-- PENDING PROD MIGRATION 03 / 05
-- DO NOT EXECUTE on Production in this agent turn.
-- Source SoT: supabase/migrations/20260903_boss_levels_invites_safeguards.sql
-- =============================================================================
-- 覆盖对象：
--   • public.boss_levels
--   • public.boss_level_assignments
--   • public.boss_level_events
--   • public.boss_companion_invitations
--   • earnings/orders 快照加固列 + 禁止改写已结算金额 trigger
--
-- 用途：
--   boss_levels：Boss 等级档位（所需活跃直属数 + 默认佣金率）。
--   assignments/events：当前等级与变更审计。
--   boss_companion_invitations：邀请状态机（pending/accepted/...），接受后写入 relations。
--
-- 依赖：
--   01 relations、02 earnings（含 orders.platform_fee 结算列）已存在。
--
-- 风险：
--   P0-功能：缺 boss_levels → 等级 Admin/自动评级不可用。
--   P0-功能：缺 invitations → 邀请绑定流程不可用。
--   P1-数据：seed 会插入 4 档默认等级（normal/silver/gold/diamond）；
--           若业务等级口径不同，执行前需改 seed。
--   P1-资金：forbid rewrite trigger 会阻止已 settled 佣金金额被 UPDATE 篡改（预期）。
--   P2：本文件对既有 earnings 表 add column；若 02 未跑会失败。
-- =============================================================================

-- ========== 1) Snapshot enrich on orders + earnings ==========
alter table public.orders add column if not exists boss_commission_rate_source text;
alter table public.orders add column if not exists boss_level_id text;
alter table public.orders add column if not exists boss_level_code text;

alter table public.boss_commission_earnings
  add column if not exists rate_source text;
alter table public.boss_commission_earnings
  add column if not exists boss_level_id text;
alter table public.boss_commission_earnings
  add column if not exists boss_level_code text;
alter table public.boss_commission_earnings
  add column if not exists companion_income_amount numeric(12,2);

drop index if exists uq_boss_commission_earnings_order;
create unique index if not exists uq_boss_commission_earnings_order_id
  on public.boss_commission_earnings (order_id)
  where status in ('pending', 'settled');

create or replace function public.mcj_forbid_boss_earnings_money_rewrite()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and old.status in ('settled', 'clawed_back') then
    if new.order_amount is distinct from old.order_amount
      or new.platform_fee_rate is distinct from old.platform_fee_rate
      or new.platform_fee_amount is distinct from old.platform_fee_amount
      or new.boss_commission_rate is distinct from old.boss_commission_rate
      or new.boss_commission_amount is distinct from old.boss_commission_amount
      or new.boss_id is distinct from old.boss_id
      or new.companion_id is distinct from old.companion_id
      or new.order_id is distinct from old.order_id
      or new.rate_source is distinct from old.rate_source
      or new.boss_level_id is distinct from old.boss_level_id
      or new.boss_level_code is distinct from old.boss_level_code
    then
      raise exception 'boss_commission_earnings money/snapshot fields are immutable after settle';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_bce_forbid_money_rewrite on public.boss_commission_earnings;
create trigger trg_bce_forbid_money_rewrite
before update on public.boss_commission_earnings
for each row execute function public.mcj_forbid_boss_earnings_money_rewrite();

alter table public.boss_companion_relation_events
  add column if not exists reason text;

comment on column public.boss_companion_relation_events.reason is
  'Admin override reason (required for admin bind/rebind/unbind/set-commission).';

-- ========== 2) Boss levels ==========
create table if not exists public.boss_levels (
  id text primary key,
  code text not null unique,
  name text not null,
  required_active_companions integer not null default 0
    check (required_active_companions >= 0),
  commission_rate numeric(5,2) not null default 0
    check (commission_rate >= 0 and commission_rate <= 100),
  effective_from timestamptz not null default now(),
  sort_order integer not null default 100,
  is_enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_boss_levels_sort on public.boss_levels (sort_order, code);

drop trigger if exists trg_boss_levels_updated_at on public.boss_levels;
create trigger trg_boss_levels_updated_at
before update on public.boss_levels
for each row execute function public.set_updated_at();

-- SEED（数据写入）：默认 4 档。执行前确认业务口径。
insert into public.boss_levels (
  id, code, name, required_active_companions, commission_rate, sort_order, is_enabled
) values
  ('boss_lv_normal', 'normal', '普通老板', 0, 0, 10, true),
  ('boss_lv_silver', 'silver', '白银老板', 3, 5, 20, true),
  ('boss_lv_gold', 'gold', '黄金老板', 8, 8, 30, true),
  ('boss_lv_diamond', 'diamond', '钻石老板', 15, 12, 40, true)
on conflict (id) do nothing;

create table if not exists public.boss_level_assignments (
  boss_id uuid primary key references public.profiles (id) on delete cascade,
  level_id text not null references public.boss_levels (id) on delete restrict,
  source text not null default 'auto'
    check (source in ('auto', 'manual')),
  pin_mode text not null default 'none'
    check (pin_mode in ('none', 'permanent', 'until_expiry')),
  pin_expires_at timestamptz,
  effective_at timestamptz not null default now(),
  assigned_by uuid references public.profiles (id) on delete set null,
  reason text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint boss_level_assignments_pin_expiry_check
    check (
      (pin_mode = 'until_expiry' and pin_expires_at is not null)
      or (pin_mode <> 'until_expiry')
    )
);

drop trigger if exists trg_boss_level_assignments_updated_at on public.boss_level_assignments;
create trigger trg_boss_level_assignments_updated_at
before update on public.boss_level_assignments
for each row execute function public.set_updated_at();

create table if not exists public.boss_level_events (
  id uuid primary key default gen_random_uuid(),
  boss_id uuid not null references public.profiles (id) on delete cascade,
  from_level_id text references public.boss_levels (id) on delete set null,
  to_level_id text references public.boss_levels (id) on delete set null,
  action text not null
    check (action in ('auto_eval', 'manual_set', 'upgrade', 'downgrade', 'pin', 'unpin')),
  source text not null default 'auto'
    check (source in ('auto', 'manual')),
  active_companions_count integer not null default 0,
  operator_id uuid references public.profiles (id) on delete set null,
  reason text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_boss_level_events_boss_created
  on public.boss_level_events (boss_id, created_at desc);

-- ========== 3) Invitations ==========
create table if not exists public.boss_companion_invitations (
  id uuid primary key default gen_random_uuid(),
  from_role text not null check (from_role in ('boss', 'companion')),
  boss_id uuid not null references public.profiles (id) on delete restrict,
  companion_id uuid not null references public.profiles (id) on delete restrict,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected', 'cancelled', 'expired', 'superseded')),
  message text,
  expires_at timestamptz not null default (now() + interval '7 days'),
  responded_at timestamptz,
  relation_id uuid references public.boss_companion_relations (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint boss_companion_invitations_not_self check (boss_id <> companion_id)
);

create unique index if not exists uq_bci_pending_pair_direction
  on public.boss_companion_invitations (from_role, boss_id, companion_id)
  where status = 'pending';

create index if not exists idx_bci_boss_status
  on public.boss_companion_invitations (boss_id, status, created_at desc);
create index if not exists idx_bci_companion_status
  on public.boss_companion_invitations (companion_id, status, created_at desc);

drop trigger if exists trg_bci_updated_at on public.boss_companion_invitations;
create trigger trg_bci_updated_at
before update on public.boss_companion_invitations
for each row execute function public.set_updated_at();

-- ========== 4) RLS ==========
alter table public.boss_levels enable row level security;
alter table public.boss_level_assignments enable row level security;
alter table public.boss_level_events enable row level security;
alter table public.boss_companion_invitations enable row level security;

drop policy if exists boss_levels_public_read on public.boss_levels;
create policy boss_levels_public_read on public.boss_levels
  for select using (is_enabled = true);

drop policy if exists boss_levels_admin_all on public.boss_levels;
create policy boss_levels_admin_all on public.boss_levels
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

drop policy if exists bla_admin_all on public.boss_level_assignments;
drop policy if exists bla_boss_select_own on public.boss_level_assignments;
create policy bla_admin_all on public.boss_level_assignments
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
create policy bla_boss_select_own on public.boss_level_assignments
  for select using (boss_id = auth.uid());

drop policy if exists ble_admin_all on public.boss_level_events;
drop policy if exists ble_boss_select_own on public.boss_level_events;
create policy ble_admin_all on public.boss_level_events
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
create policy ble_boss_select_own on public.boss_level_events
  for select using (boss_id = auth.uid());

drop policy if exists bci_admin_all on public.boss_companion_invitations;
drop policy if exists bci_boss_select on public.boss_companion_invitations;
drop policy if exists bci_companion_select on public.boss_companion_invitations;
create policy bci_admin_all on public.boss_companion_invitations
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
create policy bci_boss_select on public.boss_companion_invitations
  for select using (boss_id = auth.uid());
create policy bci_companion_select on public.boss_companion_invitations
  for select using (companion_id = auth.uid());

notify pgrst, 'reload schema';
