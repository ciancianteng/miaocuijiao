-- Companion withdrawals table for Preview / Production Supabase.
-- companion_id MUST reference public.profiles(id) (uuid), matching companion API auth.profile.id.

create extension if not exists pgcrypto;

create table if not exists public.finance_settings (
  id integer primary key default 1 check (id = 1),
  min_withdraw_cat_food numeric(12,2) not null default 50,
  max_withdrawals_per_month integer not null default 3,
  cat_food_to_rm_rate numeric(12,4) not null default 1,
  withdraw_fee_rm numeric(12,2) not null default 0,
  withdraw_fee_percent numeric(8,4) not null default 0,
  company_name text not null default 'MEOW CUI JIAO ENTERPRISE',
  updated_at timestamptz not null default now()
);
insert into public.finance_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.companion_withdrawals (
  id uuid primary key default gen_random_uuid(),
  withdrawal_no text not null unique,
  companion_id uuid not null references public.profiles(id),
  payment_account_id uuid references public.companion_payment_accounts(id),

  -- Canonical amount fields (API writes cat_food_amount; amount kept in sync)
  amount numeric(12,2) not null default 0,
  cat_food_amount numeric(12,2) not null default 0,
  exchange_rate numeric(12,4) not null default 1,
  gross_amount_rm numeric(12,2) not null default 0,
  fee_rm numeric(12,2) not null default 0,
  net_amount_rm numeric(12,2) not null default 0,

  bank_name text not null default '',
  account_name text not null default '',
  account_holder text not null default '',
  account_number text not null default '',
  account_last4 text not null default '',
  remark text not null default '',

  status text not null default 'pending'
    check (status in (
      'pending',
      'pending_review',
      'approved',
      'approved_pending_pay',
      'rejected',
      'paying',
      'paid_pending_receipt',
      'completed',
      'pay_failed',
      'cancelled'
    )),
  rejection_reason text not null default '',
  reject_reason text not null default '',

  freeze_tx_id uuid,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id),
  approved_at timestamptz,
  approved_by uuid references public.profiles(id),
  paid_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint companion_withdrawals_amount_positive
    check (greatest(amount, cat_food_amount) > 0)
);

create index if not exists idx_companion_withdrawals_status
  on public.companion_withdrawals(status, submitted_at desc);
create index if not exists idx_companion_withdrawals_companion
  on public.companion_withdrawals(companion_id, submitted_at desc);
create index if not exists idx_companion_withdrawals_created
  on public.companion_withdrawals(created_at desc);

create or replace function public.tg_companion_withdrawals_normalize()
returns trigger
language plpgsql
as $$
begin
  -- Keep amount / cat_food_amount aligned
  if coalesce(new.cat_food_amount, 0) <= 0 and coalesce(new.amount, 0) > 0 then
    new.cat_food_amount := new.amount;
  elsif coalesce(new.amount, 0) <= 0 and coalesce(new.cat_food_amount, 0) > 0 then
    new.amount := new.cat_food_amount;
  elsif coalesce(new.amount, 0) > 0 and coalesce(new.cat_food_amount, 0) > 0
        and new.amount is distinct from new.cat_food_amount then
    -- Prefer cat_food_amount (API primary write)
    new.amount := new.cat_food_amount;
  end if;

  -- Keep holder name aliases aligned
  if coalesce(new.account_holder, '') = '' and coalesce(new.account_name, '') <> '' then
    new.account_holder := new.account_name;
  elsif coalesce(new.account_name, '') = '' and coalesce(new.account_holder, '') <> '' then
    new.account_name := new.account_holder;
  end if;

  -- Keep reject reason aliases aligned
  if coalesce(new.reject_reason, '') = '' and coalesce(new.rejection_reason, '') <> '' then
    new.reject_reason := new.rejection_reason;
  elsif coalesce(new.rejection_reason, '') = '' and coalesce(new.reject_reason, '') <> '' then
    new.rejection_reason := new.reject_reason;
  end if;

  -- Keep review / approve aliases aligned
  if new.reviewed_at is null and new.approved_at is not null then
    new.reviewed_at := new.approved_at;
  elsif new.approved_at is null and new.reviewed_at is not null then
    new.approved_at := new.reviewed_at;
  end if;
  if new.reviewed_by is null and new.approved_by is not null then
    new.reviewed_by := new.approved_by;
  elsif new.approved_by is null and new.reviewed_by is not null then
    new.approved_by := new.reviewed_by;
  end if;

  -- Normalize common status aliases used by product vs finance admin
  if new.status = 'pending' then
    new.status := 'pending_review';
  elsif new.status = 'approved' then
    new.status := 'approved_pending_pay';
  end if;

  if coalesce(new.account_last4, '') = '' and coalesce(new.account_number, '') <> '' then
    new.account_last4 := right(regexp_replace(new.account_number, '\s', '', 'g'), 4);
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_companion_withdrawals_normalize on public.companion_withdrawals;
create trigger trg_companion_withdrawals_normalize
before insert or update on public.companion_withdrawals
for each row execute function public.tg_companion_withdrawals_normalize();

create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- RLS: companions manage own rows for insert/select only; service_role bypasses RLS.
alter table public.companion_withdrawals enable row level security;

drop policy if exists companion_withdrawals_select_own on public.companion_withdrawals;
create policy companion_withdrawals_select_own
  on public.companion_withdrawals
  for select
  to authenticated
  using (companion_id = auth.uid());

drop policy if exists companion_withdrawals_insert_own on public.companion_withdrawals;
create policy companion_withdrawals_insert_own
  on public.companion_withdrawals
  for insert
  to authenticated
  with check (
    companion_id = auth.uid()
    and status in ('pending', 'pending_review')
  );

-- Companions cannot update/delete (no policy = denied for authenticated).
-- Admins use service_role via API (bypasses RLS).

grant select, insert on public.companion_withdrawals to authenticated;
grant select, insert, update, delete on public.companion_withdrawals to service_role;
grant select on public.finance_settings to authenticated, service_role;
grant insert, update, delete on public.finance_settings to service_role;

-- Clean placeholder settlement account labels used by test fixtures.
update public.companion_payment_accounts cpa
set
  account_name = coalesce(
    nullif(trim(p.display_name), ''),
    nullif(trim(cpa.account_name), ''),
    '陪玩收款账户'
  ),
  updated_at = now()
from public.profiles p
where cpa.user_id = p.id
  and (
    cpa.account_name ilike '%preview%test%'
    or cpa.account_name ilike '%test preview%'
  );

notify pgrst, 'reload schema';
