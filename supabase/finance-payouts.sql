-- Finance: companion withdrawals, staff payroll, payments, receipts.
-- Run in Supabase SQL Editor.

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
  cat_food_amount numeric(12,2) not null check (cat_food_amount > 0),
  exchange_rate numeric(12,4) not null default 1,
  gross_amount_rm numeric(12,2) not null default 0,
  fee_rm numeric(12,2) not null default 0,
  net_amount_rm numeric(12,2) not null default 0,
  bank_name text not null default '',
  account_holder text not null default '',
  account_last4 text not null default '',
  remark text not null default '',
  status text not null default 'pending_review'
    check (status in (
      'pending_review','approved_pending_pay','rejected','paying',
      'paid_pending_receipt','completed','pay_failed','cancelled'
    )),
  reject_reason text not null default '',
  freeze_tx_id uuid,
  submitted_at timestamptz not null default now(),
  approved_at timestamptz,
  approved_by uuid references public.profiles(id),
  paid_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_companion_withdrawals_status on public.companion_withdrawals(status, submitted_at desc);
create index if not exists idx_companion_withdrawals_companion on public.companion_withdrawals(companion_id, submitted_at desc);

create table if not exists public.staff_payrolls (
  id uuid primary key default gen_random_uuid(),
  payroll_no text not null unique,
  staff_id uuid not null references public.profiles(id),
  period_start date not null,
  period_end date not null,
  work_days integer not null default 0,
  full_attendance boolean not null default false,
  reception_count integer not null default 0,
  order_count integer not null default 0,
  base_salary_rm numeric(12,2) not null default 0,
  bonus_rm numeric(12,2) not null default 0,
  deduction_rm numeric(12,2) not null default 0,
  net_salary_rm numeric(12,2) not null default 0,
  payment_account_snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'draft'
    check (status in (
      'draft','pending_review','approved_pending_pay','rejected','paying',
      'paid_pending_receipt','completed','pay_failed','cancelled'
    )),
  reject_reason text not null default '',
  note text not null default '',
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  paid_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_staff_payrolls_status on public.staff_payrolls(status, period_end desc);
create index if not exists idx_staff_payrolls_staff on public.staff_payrolls(staff_id, period_start desc);

create table if not exists public.finance_payments (
  id uuid primary key default gen_random_uuid(),
  payment_no text not null unique,
  payment_type text not null check (payment_type in ('companion_withdraw','staff_payroll','refund','other')),
  related_record_id uuid not null,
  payee_user_id uuid not null references public.profiles(id),
  amount_rm numeric(12,2) not null check (amount_rm >= 0),
  actual_amount_rm numeric(12,2),
  variance_reason text not null default '',
  bank_reference text not null default '',
  payer_bank text not null default '',
  payer_account_last4 text not null default '',
  payee_bank text not null default '',
  payee_name text not null default '',
  payee_account_last4 text not null default '',
  payment_date date,
  payment_time time,
  status text not null default 'pending_pay'
    check (status in ('pending_pay','paying','completed','failed','void')),
  created_by uuid references public.profiles(id),
  confirmed_by uuid references public.profiles(id),
  finance_note text not null default '',
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists idx_finance_payments_status on public.finance_payments(status, created_at desc);
create index if not exists idx_finance_payments_type on public.finance_payments(payment_type, created_at desc);

create table if not exists public.finance_receipts (
  id uuid primary key default gen_random_uuid(),
  receipt_no text not null unique,
  payment_id uuid not null references public.finance_payments(id),
  storage_bucket text not null default 'finance-receipts',
  file_path text not null default '',
  file_type text not null default '',
  amount_rm numeric(12,2) not null default 0,
  bank_reference text not null default '',
  accounting_month text not null default '',
  tax_year text not null default '',
  accounting_category text not null default 'companion_settlement',
  company_name text not null default 'MEOW CUI JIAO ENTERPRISE',
  payment_purpose text not null default '',
  reconciliation_status text not null default 'pending'
    check (reconciliation_status in ('pending','reconciled','variance','archived','void')),
  handed_to_accountant boolean not null default false,
  accountant_note text not null default '',
  void_reason text not null default '',
  uploaded_by uuid references public.profiles(id),
  uploaded_at timestamptz not null default now(),
  notes text not null default ''
);
create index if not exists idx_finance_receipts_month on public.finance_receipts(accounting_month, tax_year);
create index if not exists idx_finance_receipts_payment on public.finance_receipts(payment_id);

create table if not exists public.staff_payroll_appeals (
  id uuid primary key default gen_random_uuid(),
  payroll_id uuid not null references public.staff_payrolls(id) on delete cascade,
  staff_id uuid not null references public.profiles(id),
  reason text not null default '',
  status text not null default 'pending',
  admin_note text not null default '',
  created_at timestamptz not null default now()
);

-- Extend companion_payment_accounts if needed
alter table public.companion_payment_accounts
  add column if not exists account_last4 text not null default '';

update public.companion_payment_accounts
set account_last4 = right(regexp_replace(coalesce(bank_account,''), '\s', '', 'g'), 4)
where (account_last4 is null or account_last4 = '') and coalesce(bank_account,'') <> '';

-- Private storage bucket note: created by API ensurePrivateBucket('finance-receipts')

notify pgrst, 'reload schema';
