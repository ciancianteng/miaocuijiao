-- Weekly Friday unified payout settlement (Asia/Kuala_Lumpur).
-- Extends companion_withdrawals + staff_payrolls + finance_settings.
-- Creates payout_requests as unified mirror for admin「提现与发放」.

create extension if not exists pgcrypto;

-- ── finance_settings: weekly payout config ──────────────────────────
alter table public.finance_settings
  add column if not exists payout_weekday integer not null default 5;
alter table public.finance_settings
  add column if not exists application_cutoff_weekday integer not null default 4;
alter table public.finance_settings
  add column if not exists application_cutoff_time text not null default '23:59';
alter table public.finance_settings
  add column if not exists payout_window_start text not null default '12:00';
alter table public.finance_settings
  add column if not exists payout_window_end text not null default '23:59';
alter table public.finance_settings
  add column if not exists holiday_rollover_enabled boolean not null default true;
alter table public.finance_settings
  add column if not exists max_withdrawals_per_week integer not null default 2;
alter table public.finance_settings
  add column if not exists timezone text not null default 'Asia/Kuala_Lumpur';

update public.finance_settings
set
  payout_weekday = coalesce(payout_weekday, 5),
  application_cutoff_weekday = coalesce(application_cutoff_weekday, 4),
  application_cutoff_time = coalesce(nullif(application_cutoff_time, ''), '23:59'),
  payout_window_start = coalesce(nullif(payout_window_start, ''), '12:00'),
  payout_window_end = coalesce(nullif(payout_window_end, ''), '23:59'),
  holiday_rollover_enabled = coalesce(holiday_rollover_enabled, true),
  max_withdrawals_per_week = coalesce(max_withdrawals_per_week, 2),
  timezone = coalesce(nullif(timezone, ''), 'Asia/Kuala_Lumpur')
where id = 1;

-- ── companion_withdrawals: settlement + source ledger ───────────────
alter table public.companion_withdrawals
  add column if not exists settlement_date date;
alter table public.companion_withdrawals
  add column if not exists source_ledger_ids jsonb not null default '[]'::jsonb;
alter table public.companion_withdrawals
  add column if not exists source_order_ids jsonb not null default '[]'::jsonb;
alter table public.companion_withdrawals
  add column if not exists currency text not null default 'CAT_FOOD';
alter table public.companion_withdrawals
  add column if not exists payout_method text not null default 'bank';
alter table public.companion_withdrawals
  add column if not exists transaction_no text not null default '';
alter table public.companion_withdrawals
  add column if not exists tng_account text not null default '';

-- Relax status check to allow weekly statuses (drop old check if present)
do $$
declare
  r record;
begin
  for r in
    select con.conname as cname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'companion_withdrawals'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%status%'
  loop
    execute format('alter table public.companion_withdrawals drop constraint %I', r.cname);
  end loop;
end $$;

alter table public.companion_withdrawals
  drop constraint if exists companion_withdrawals_status_check;

alter table public.companion_withdrawals
  add constraint companion_withdrawals_status_check
  check (status in (
    'submitted','pending_friday','reviewing','approved','pending_payment','paid','completed','rejected','rolled_over',
    'pending','pending_review','approved_pending_pay','paying','paid_pending_receipt','pay_failed','cancelled'
  ));

-- ── staff_payrolls: settlement + source ledger ─────────────────────
alter table public.staff_payrolls
  add column if not exists settlement_date date;
alter table public.staff_payrolls
  add column if not exists source_ledger_ids jsonb not null default '[]'::jsonb;
alter table public.staff_payrolls
  add column if not exists source_order_ids jsonb not null default '[]'::jsonb;
alter table public.staff_payrolls
  add column if not exists currency text not null default 'MYR';
alter table public.staff_payrolls
  add column if not exists payout_method text not null default 'bank';
alter table public.staff_payrolls
  add column if not exists transaction_no text not null default '';
alter table public.staff_payrolls
  add column if not exists submitted_at timestamptz;
alter table public.staff_payrolls
  add column if not exists reviewed_at timestamptz;
alter table public.staff_payrolls
  add column if not exists reviewed_by uuid references public.profiles(id);
alter table public.staff_payrolls
  add column if not exists frozen_amount_rm numeric(12,2) not null default 0;

do $$
declare
  r record;
begin
  for r in
    select con.conname as cname
    from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'staff_payrolls'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%status%'
  loop
    execute format('alter table public.staff_payrolls drop constraint %I', r.cname);
  end loop;
end $$;

alter table public.staff_payrolls
  drop constraint if exists staff_payrolls_status_check;

alter table public.staff_payrolls
  add constraint staff_payrolls_status_check
  check (status in (
    'submitted','pending_friday','reviewing','approved','pending_payment','paid','completed','rejected','rolled_over',
    'draft','pending','pending_review','approved_pending_pay','paying','paid_pending_receipt','pay_failed','cancelled'
  ));

-- ── Unified payout_requests (admin list + dual-sync) ────────────────
create table if not exists public.payout_requests (
  id uuid primary key default gen_random_uuid(),
  payout_no text not null unique,
  applicant_type text not null check (applicant_type in ('companion', 'customer_service')),
  applicant_id uuid not null references public.profiles(id),
  applicant_name text not null default '',
  applicant_uid text not null default '',
  amount numeric(12,2) not null default 0,
  currency text not null default 'MYR',
  payout_method text not null default 'bank',
  bank_name text not null default '',
  account_name text not null default '',
  account_number_masked text not null default '',
  tng_account text not null default '',
  source_period_start date,
  source_period_end date,
  source_order_ids jsonb not null default '[]'::jsonb,
  source_ledger_ids jsonb not null default '[]'::jsonb,
  settlement_date date not null,
  status text not null default 'pending_friday'
    check (status in (
      'submitted','pending_friday','reviewing','approved','pending_payment','paid','completed','rejected','rolled_over'
    )),
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id),
  paid_at timestamptz,
  paid_by uuid references public.profiles(id),
  transaction_no text not null default '',
  receipt_url text not null default '',
  reject_reason text not null default '',
  related_table text not null default '',
  related_record_id uuid,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_payout_requests_status_settle
  on public.payout_requests(status, settlement_date);
create index if not exists idx_payout_requests_applicant
  on public.payout_requests(applicant_type, applicant_id, submitted_at desc);
create index if not exists idx_payout_requests_related
  on public.payout_requests(related_table, related_record_id);

-- Unique ledger entry association (one earning → one open payout)
create table if not exists public.payout_source_locks (
  id uuid primary key default gen_random_uuid(),
  source_kind text not null check (source_kind in ('ledger', 'order', 'period')),
  source_id text not null,
  applicant_id uuid not null references public.profiles(id),
  payout_request_id uuid references public.payout_requests(id) on delete cascade,
  related_table text not null default '',
  related_record_id uuid,
  status text not null default 'frozen'
    check (status in ('frozen', 'settled', 'released')),
  created_at timestamptz not null default now(),
  unique (source_kind, source_id)
);

create index if not exists idx_payout_source_locks_applicant
  on public.payout_source_locks(applicant_id, status);

grant select, insert, update, delete on public.payout_requests to service_role;
grant select on public.payout_requests to authenticated;
grant select, insert, update, delete on public.payout_source_locks to service_role;

-- ── Migrate open legacy rows → weekly statuses + settlement_date ────
-- Pending → pending_friday; approved/paying → pending_payment; keep completed/rejected.
update public.companion_withdrawals
set
  status = case
    when status in ('pending', 'pending_review') then 'pending_friday'
    when status in ('approved', 'approved_pending_pay', 'paying') then 'pending_payment'
    when status = 'paid_pending_receipt' then 'paid'
    else status
  end,
  settlement_date = coalesce(
    settlement_date,
    (
      -- nearest upcoming Friday from submitted_at in KL (approx via UTC+8)
      (
        date_trunc('day', coalesce(submitted_at, created_at) + interval '8 hours')::date
        + ((5 - extract(isodow from (coalesce(submitted_at, created_at) + interval '8 hours')::date)::int + 7) % 7)
      )::date
    )
  ),
  updated_at = now()
where status not in ('completed', 'rejected', 'cancelled', 'pay_failed')
  and (
    settlement_date is null
    or status in ('pending', 'pending_review', 'approved', 'approved_pending_pay', 'paying', 'paid_pending_receipt')
  );

update public.staff_payrolls
set
  status = case
    when status in ('draft', 'pending', 'pending_review') then 'pending_friday'
    when status in ('approved', 'approved_pending_pay', 'paying') then 'pending_payment'
    when status = 'paid_pending_receipt' then 'paid'
    else status
  end,
  settlement_date = coalesce(
    settlement_date,
    (
      date_trunc('day', coalesce(submitted_at, created_at) + interval '8 hours')::date
      + ((5 - extract(isodow from (coalesce(submitted_at, created_at) + interval '8 hours')::date)::int + 7) % 7)
    )::date
  ),
  submitted_at = coalesce(submitted_at, created_at),
  updated_at = now()
where status not in ('completed', 'rejected', 'cancelled', 'pay_failed')
  and (
    settlement_date is null
    or status in ('draft', 'pending', 'pending_review', 'approved', 'approved_pending_pay', 'paying', 'paid_pending_receipt')
  );

-- Completed/rejected history: fill settlement_date if missing, do NOT change status
update public.companion_withdrawals
set settlement_date = coalesce(
  settlement_date,
  (
    date_trunc('day', coalesce(submitted_at, created_at) + interval '8 hours')::date
    + ((5 - extract(isodow from (coalesce(submitted_at, created_at) + interval '8 hours')::date)::int + 7) % 7)
  )::date
)
where settlement_date is null;

update public.staff_payrolls
set settlement_date = coalesce(
  settlement_date,
  (
    date_trunc('day', coalesce(submitted_at, created_at) + interval '8 hours')::date
    + ((5 - extract(isodow from (coalesce(submitted_at, created_at) + interval '8 hours')::date)::int + 7) % 7)
  )::date
)
where settlement_date is null;

-- Update normalize trigger: stop forcing pending→pending_review; map to pending_friday
create or replace function public.tg_companion_withdrawals_normalize()
returns trigger
language plpgsql
as $$
begin
  if coalesce(new.cat_food_amount, 0) <= 0 and coalesce(new.amount, 0) > 0 then
    new.cat_food_amount := new.amount;
  elsif coalesce(new.amount, 0) <= 0 and coalesce(new.cat_food_amount, 0) > 0 then
    new.amount := new.cat_food_amount;
  elsif coalesce(new.amount, 0) > 0 and coalesce(new.cat_food_amount, 0) > 0
        and new.amount is distinct from new.cat_food_amount then
    new.amount := new.cat_food_amount;
  end if;

  if coalesce(new.account_holder, '') = '' and coalesce(new.account_name, '') <> '' then
    new.account_holder := new.account_name;
  elsif coalesce(new.account_name, '') = '' and coalesce(new.account_holder, '') <> '' then
    new.account_name := new.account_holder;
  end if;

  if coalesce(new.reject_reason, '') = '' and coalesce(new.rejection_reason, '') <> '' then
    new.reject_reason := new.rejection_reason;
  elsif coalesce(new.rejection_reason, '') = '' and coalesce(new.reject_reason, '') <> '' then
    new.rejection_reason := new.reject_reason;
  end if;

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

  -- Legacy → weekly status aliases
  if new.status = 'pending' then
    new.status := 'pending_friday';
  elsif new.status = 'pending_review' then
    new.status := 'pending_friday';
  elsif new.status = 'approved' then
    new.status := 'pending_payment';
  elsif new.status = 'approved_pending_pay' then
    new.status := 'pending_payment';
  elsif new.status = 'paying' then
    new.status := 'pending_payment';
  elsif new.status = 'paid_pending_receipt' then
    new.status := 'paid';
  end if;

  if coalesce(new.account_last4, '') = '' and coalesce(new.account_number, '') <> '' then
    new.account_last4 := right(regexp_replace(new.account_number, '\s', '', 'g'), 4);
  end if;

  if new.transaction_no is null then new.transaction_no := ''; end if;
  if coalesce(new.transaction_no, '') = '' and coalesce(new.bank_reference, '') <> '' then
    new.transaction_no := new.bank_reference;
  elsif coalesce(new.bank_reference, '') = '' and coalesce(new.transaction_no, '') <> '' then
    new.bank_reference := new.transaction_no;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

notify pgrst, 'reload schema';
